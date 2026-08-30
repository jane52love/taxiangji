#!/usr/bin/env python3
"""她乡记 · 联调桥接服务（零依赖，Python 3 标准库）

职责：
1. 托管 frontend/ 静态页面（http://127.0.0.1:4179/）
2. 前端 ↔ TRAE 主智能体的文件桥：
   - POST /api/send   → 写 桥接/inbox/<taskId>.json（智能体侧消费）
   - GET  /api/poll   → 读 桥接/outbox/<taskId>.json（智能体侧写入，长轮询）
   - POST /api/save   → 真实归档到 我的素材/YYYY-MM-DD-标题/
   - GET/POST /api/knowledge → 读/写 我的知识/场景触发库/

用法：python3 bridge/server.py [端口，默认 4179]
智能体侧协议见 桥接/README.md
"""
import base64
import json
import os
import random
import re
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
BRIDGE_DIR = os.path.join(ROOT, "桥接")
INBOX = os.path.join(BRIDGE_DIR, "inbox")
OUTBOX = os.path.join(BRIDGE_DIR, "outbox")
INBOX_IMAGES = os.path.join(INBOX, "images")
MATERIALS = os.path.join(ROOT, "我的素材")
KB_DIR = os.path.join(ROOT, "我的知识", "场景触发库")

for d in (INBOX, INBOX_IMAGES, OUTBOX):
    os.makedirs(d, exist_ok=True)

UNSAFE = re.compile(r'[\\/:*?"<>|\s]+')
DATAURL = re.compile(r"data:image/(\w+);base64,(.+)", re.S)


def safe_name(s, fallback="未命名"):
    s = UNSAFE.sub("-", (s or "").strip()).strip("-.")
    return s[:60] or fallback


def save_dataurl(dataurl, path):
    m = DATAURL.match(dataurl or "")
    if not m:
        return False
    ext = "jpg" if m.group(1).lower() in ("jpeg", "jpg") else m.group(1).lower()
    if ext not in ("jpg", "png", "gif", "webp", "bmp"):
        ext = "png"
    if not path.endswith("." + ext):
        path += "." + ext
    with open(path, "wb") as f:
        f.write(base64.b64decode(m.group(2)))
    return path


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND, **kwargs)

    def log_message(self, fmt, *args):
        pass  # 静默访问日志，仅保留桥接事件输出

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    # ---------------- GET ----------------
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/api/poll":
            task = safe_name(q.get("taskId", [""])[0], "task")
            wait = min(float(q.get("wait", ["20"])[0] or 20), 30)
            path = os.path.join(OUTBOX, task + ".json")
            deadline = time.time() + wait
            while time.time() < deadline:
                if os.path.exists(path):
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                    os.remove(path)  # 读后即删
                    return self._json(data)
                time.sleep(0.4)
            return self._json({"status": "timeout"})

        if u.path == "/api/knowledge":
            files = sorted(f for f in os.listdir(KB_DIR) if f.endswith(".md"))
            if q.get("file"):
                name = os.path.basename(q["file"][0])
                if name not in files:
                    return self._json({"error": "not found"}, 404)
                with open(os.path.join(KB_DIR, name), encoding="utf-8") as f:
                    return self._json({"file": name, "content": f.read()})
            items = []
            for name in files:
                with open(os.path.join(KB_DIR, name), encoding="utf-8") as f:
                    content = f.read()
                m = re.search(r"^## \d+\.\s*(.+)$", content, re.M)
                tw = re.search(r"\*\*触发词：\*\*\s*(.+)", content)
                items.append({
                    "file": name,
                    "title": m.group(1).strip() if m else name[:-3],
                    "triggers": tw.group(1).strip() if tw else "",
                    "lines": content.count("\n") + 1,
                })
            return self._json({"items": items})

        return super().do_GET()

    # ---------------- POST ----------------
    def do_POST(self):
        u = urlparse(self.path)
        try:
            data = self._body()
        except Exception:
            return self._json({"error": "bad json"}, 400)

        if u.path == "/api/send":
            task = time.strftime("%H%M%S") + "-" + str(random.randint(1000, 9999))
            images = []
            for i, img in enumerate(data.get("images") or [], 1):
                saved = save_dataurl(img.get("dataUrl"), os.path.join(INBOX_IMAGES, f"{task}-{i}"))
                if saved:
                    images.append(os.path.basename(saved))
            msg = {
                "taskId": task,
                "skillId": data.get("skillId", ""),
                "text": data.get("text", ""),
                "images": images,
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            with open(os.path.join(INBOX, task + ".json"), "w", encoding="utf-8") as f:
                json.dump(msg, f, ensure_ascii=False, indent=2)
            print(f"[INBOX] {task} skill={msg['skillId']} text={msg['text'][:60]!r} images={len(images)}", flush=True)
            return self._json({"taskId": task})

        if u.path == "/api/save":
            folder = safe_name(data.get("folderName", ""))
            dest = os.path.join(MATERIALS, folder)
            os.makedirs(dest, exist_ok=True)
            with open(os.path.join(dest, "文案.md"), "w", encoding="utf-8") as f:
                f.write(data.get("contentMd") or "")
            count = len([x for x in os.listdir(dest) if re.match(r"^\d+\.\w+$", x)])
            for img in data.get("images") or []:
                saved = save_dataurl(img.get("dataUrl"), os.path.join(dest, str(count + 1)))
                if saved:
                    count += 1
            print(f"[SAVED] 我的素材/{folder}（文案.md + {count} 张图片）", flush=True)
            return self._json({"path": f"我的素材/{folder}", "images": count})

        if u.path == "/api/knowledge/save":
            name = os.path.basename(data.get("file", ""))
            if name not in os.listdir(KB_DIR) or not name.endswith(".md"):
                return self._json({"error": "not found"}, 404)
            with open(os.path.join(KB_DIR, name), "w", encoding="utf-8") as f:
                f.write(data.get("content") or "")
            print(f"[KB] 已更新 {name}", flush=True)
            return self._json({"ok": True})

        return self._json({"error": "not found"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4179
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"她乡记桥接服务已启动: http://127.0.0.1:{port}/", flush=True)
    print(f"文件桥: {BRIDGE_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

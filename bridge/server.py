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
import socket
import ssl
import subprocess
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
CONFIG_PATH = os.path.join(BRIDGE_DIR, "config.json")
CERT_DIR = os.path.join(BRIDGE_DIR, "certs")
RULES_PATH = os.path.join(ROOT, ".trae", "rules", "project_rules.md")
STYLE_PATH = os.path.join(ROOT, "我的知识", "金梅姐说话风格规则.md")
KB_INDEX = os.path.join(KB_DIR, "00-主题索引.md")
AGENT_MODEL_DEFAULT = "Qwen/Qwen3-VL-32B-Instruct"

SESSIONS = {}  # sessionId -> [{role, content(纯文本)}] 内存会话历史

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


def load_stt_config():
    """语音识别配置：桥接/config.json 的 stt 段（OpenAI 兼容 transcriptions 接口）"""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            stt = (json.load(f) or {}).get("stt") or {}
        if stt.get("api_key") and stt.get("base_url") and stt.get("model"):
            return stt
    except Exception:
        pass
    return None


def read_file(path, limit=30000):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read(limit)
    except Exception:
        return ""


def load_agent_config():
    """智能体配置：agent 段优先，缺省复用 stt 段的接入信息"""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f) or {}
    except Exception:
        cfg = {}
    agent = cfg.get("agent") or {}
    stt = cfg.get("stt") or {}
    return {
        "api_key": agent.get("api_key") or stt.get("api_key"),
        "base_url": agent.get("base_url") or stt.get("base_url"),
        "model": agent.get("model") or AGENT_MODEL_DEFAULT,
    }


def build_system_prompt(user_text):
    """注入项目规则 + 说话风格 + 触发词索引 + 命中主题素材"""
    rules = read_file(RULES_PATH)
    style = read_file(STYLE_PATH)
    index = read_file(KB_INDEX)
    kb_hits = ""
    seen = set()
    if index and user_text:
        for m in re.finditer(r"^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*\[([^]]+\.md)\]", index, re.M):
            topic, triggers, fname = m.group(1), m.group(2), m.group(3).strip()
            if fname in seen:
                continue
            for t in triggers.split("/"):
                t = t.strip()
                if t and t in user_text:
                    seen.add(fname)
                    body = read_file(os.path.join(KB_DIR, fname), 8000)
                    if body:
                        kb_hits += f"\n\n【命中主题素材 · {topic}】\n{body}"
                    break
    return (
        "你是「她乡记」视频文案工作台的智能体，通过网页聊天界面服务金梅姐（木兰）。"
        "严格按以下规则工作，所有交互使用中文。\n\n"
        "==================== 项目规则 ====================\n\n"
        + rules
        + "\n\n==================== 金梅姐说话风格规则（文案用词必须过其中的黑名单检查） ====================\n\n"
        + style
        + "\n\n==================== 场景触发库索引（素材库目录） ====================\n\n"
        + index
        + "\n\n==================== 本次消息命中的主题素材 ====================\n"
        + (kb_hits or "（未命中具体主题，按通用常识与风格规则创作，不要编造细节）")
    )


def call_agent(session_id, text, images):
    agent = load_agent_config()
    if not agent["api_key"]:
        return None, "未配置大模型服务（桥接/config.json）"
    system = build_system_prompt(text)
    hist = SESSIONS.setdefault(session_id or "default", [])
    content = [{"type": "text", "text": text or "请看这些图片。"}]
    for du in (images or [])[:4]:
        content.append({"type": "image_url", "image_url": {"url": du}})
    msgs = [{"role": "system", "content": system}] + hist + [{"role": "user", "content": content}]
    import urllib.error
    import urllib.request
    body = json.dumps({
        "model": agent["model"],
        "messages": msgs,
        "max_tokens": 2500,
        "temperature": 0.7,
        "stream": False,
    }).encode("utf-8")
    req = urllib.request.Request(
        agent["base_url"].rstrip("/") + "/v1/chat/completions",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + agent["api_key"], "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            reply = json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")[:300]
        except Exception:
            detail = ""
        return None, f"大模型服务返回 {e.code} {detail}"
    except Exception:
        return None, "大模型服务连接失败，请检查网络"
    hist.append({"role": "user", "content": text or "（发送了图片）"})
    hist.append({"role": "assistant", "content": reply})
    del hist[:-16]
    return reply, None


def call_stt(audio, audio_type):
    stt = load_stt_config()
    if not stt:
        return None, "未配置语音识别服务（桥接/config.json）"
    ext = {"audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg"}.get(audio_type, "webm")
    boundary = "----taxiangji" + str(int(time.time() * 1000))
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{stt['model']}\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{ext}\"\r\nContent-Type: {audio_type}\r\n\r\n".encode(),
        audio,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    import urllib.error
    import urllib.request
    req = urllib.request.Request(
        stt["base_url"].rstrip("/") + "/v1/audio/transcriptions",
        data=b"".join(parts),
        method="POST",
        headers={
            "Authorization": "Bearer " + stt["api_key"],
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return (json.loads(resp.read().decode("utf-8")).get("text") or "").strip(), None
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8")[:200]
        except Exception:
            detail = ""
        return None, f"识别服务返回 {e.code} {detail}"
    except Exception:
        return None, "识别服务连接失败，请检查网络"


class Handler(SimpleHTTPRequestHandler):
    # SSL 环境下 buffered reader 读 POST body 会异常阻塞，改用无缓冲读
    rbufsize = 0

    def _read_exact(self, n, timeout=15):
        """SSLObject.read 可能返回不足 n 字节，循环读满"""
        self.connection.settimeout(timeout)
        raw = b""
        while len(raw) < n:
            try:
                part = self.rfile.read(n - len(raw))
            except Exception as e:
                print(f"[BODY] 读超时 已读{len(raw)}/{n}: {e}", flush=True)
                break
            if not part:
                break
            raw += part
        self.connection.settimeout(None)
        return raw

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

        if u.path == "/api/stt":
            n = int(self.headers.get("Content-Length", 0) or 0)
            audio = self._read_exact(n, timeout=30)
            audio_type = self.headers.get("X-Audio-Type", "audio/wav")
            text, err = call_stt(audio, audio_type)
            if err:
                print(f"[STT] 失败：{err}", flush=True)
                return self._json({"error": err}, 503 if "未配置" in err else 502)
            print(f"[STT] 识别成功 {len(audio)}B -> {text[:40]!r}", flush=True)
            return self._json({"text": text})

        try:
            data = self._body()
        except Exception:
            return self._json({"error": "bad json"}, 400)

        if u.path == "/api/chat":
            print("[CHAT] 收到请求", flush=True)
            n = int(self.headers.get("Content-Length", 0) or 0)
            raw = self._read_exact(n)
            print(f"[CHAT] body就绪 {len(raw)}/{n}", flush=True)
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                return self._json({"error": "bad json"}, 400)
            print(f"[CHAT] 开始调大模型 text={data.get('text', '')[:30]!r}", flush=True)
            reply, err = call_agent(data.get("sessionId"), data.get("text"), data.get("images"))
            if err:
                print(f"[CHAT] 失败：{err}", flush=True)
                return self._json({"error": err}, 503 if "未配置" in err else 502)
            print(f"[CHAT] session={data.get('sessionId', 'default')} -> {reply[:50]!r}", flush=True)
            return self._json({"replyMd": reply})

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


def local_ip():
    """取本机局域网 IP（不动真实网络）"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert():
    """自签证书（浏览器安全策略要求 HTTPS 才能用麦克风），首次启动自动生成"""
    cert = os.path.join(CERT_DIR, "cert.pem")
    key = os.path.join(CERT_DIR, "key.pem")
    if os.path.exists(cert) and os.path.exists(key):
        return cert, key
    os.makedirs(CERT_DIR, exist_ok=True)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048",
         "-keyout", key, "-out", cert, "-days", "3650", "-nodes",
         "-subj", "/CN=taxiangji",
         "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{local_ip()}"],
        check=True, capture_output=True,
    )
    return cert, key


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4179
    cert, key = ensure_cert()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    ip = local_ip()
    print(f"她乡记桥接服务已启动(HTTPS): https://127.0.0.1:{port}/", flush=True)
    print(f"手机访问: https://{ip}:{port}/（首次打开需在证书警告里选「继续访问」）", flush=True)
    print(f"文件桥: {BRIDGE_DIR}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

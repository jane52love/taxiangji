# 桥接协议（前端 ⇄ 智能体）

前端页面（浏览器）与 TRAE 主智能体之间没有直接 API，通过本项目工作区内的文件桥通信。`bridge/server.py` 负责托管页面并把 HTTP 请求落成文件。

```
浏览器 PWA ⇄ bridge/server.py ⇄ 桥接/inbox·outbox ⇄ TRAE 主智能体
                     ⇅
        我的素材/（真实归档）  我的知识/（真实读写）
```

## 消息流（前端 → 智能体 → 前端）

1. 用户在页面发送消息，服务写 `桥接/inbox/<taskId>.json`：

```json
{
  "taskId": "093015-4821",
  "skillId": "mulan-video-content",
  "text": "用户说的话（可为空）",
  "images": ["inbox/images/093015-4821-1.jpg"],
  "time": "2026-08-30 09:30:15"
}
```

2. 智能体侧发现新 inbox 消息，按项目规则处理（场景触发知识库 → 生成/追问），把回复写到 `桥接/outbox/<taskId>.json`：

```json
{
  "taskId": "093015-4821",
  "replyMd": "Markdown 格式的回复全文",
  "time": "2026-08-30 09:31:02"
}
```

3. 页面长轮询 `/api/poll` 取到回复后渲染，服务端读后即删 outbox 文件。

## 语音识别（按住说话 · push-to-talk）

前端按住「按住说话」录音（MediaRecorder），松开后整段音频 `POST /api/stt`（原始字节，`X-Audio-Type` 头声明格式），服务端转发给 OpenAI 兼容的转写接口，返回 `{"text": "..."}`。

转写服务在 `桥接/config.json` 配置（模板见 `config.example.json`，此文件含密钥已 gitignore）：

```json
{
  "stt": {
    "base_url": "https://api.siliconflow.cn",
    "api_key": "sk-xxx",
    "model": "FunAudioLLM/SenseVoiceSmall"
  }
}
```

- 兼容任何 OpenAI `/v1/audio/transcriptions` 格式的服务（硅基流动 SenseVoice、OpenAI whisper 等）
- 未配置时返回 503，前端自动降级浏览器识别（电脑 Chrome 可用，手机国内网络通常不通），再不行提示文字输入

## 素材归档

页面点「保存」→ `POST /api/save` → 服务直接写真实文件夹 `我的素材/YYYY-MM-DD-标题/`（文案.md + 图片按序编号）。

## 知识库

- `GET /api/knowledge`：主题列表（文件名/标题/触发词）
- `GET /api/knowledge?file=01-茭白.md`：读单个主题全文
- `POST /api/knowledge/save`：页面编辑后写回文件

## 智能体侧工作方式

- 联调会话中：监听桥接服务输出的 `[INBOX]` 日志（或直接扫 `桥接/inbox/`），处理完写 outbox，并打印 `[OUTBOX] <taskId> 已回复`
- 长期方案（金梅姐侧）：Trae 打开本项目后，定期或在用户说「处理收件箱」时执行同样动作；协议见上，无需任何额外工具

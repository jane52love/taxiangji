# 她乡记 PWA 前端原型

这是给 Trae 对接用的纯前端页面原型，包含：

- Skill 场景入口
- 默认语音输入、文字输入、图片上传
- 素材会话保存与导出
- 知识库 Markdown 导入、编辑、导出
- Trae 智能体桥接预留：`window.TaxiangjiBridge`

## 本地预览

可直接打开 `index.html` 预览。若要测试 PWA 安装和离线缓存，请用本地 HTTP 服务打开：

```bash
python3 -m http.server 4179
```

然后访问：

```text
http://127.0.0.1:4179/index.html
```

## Trae 对接点

页面会在发送消息时优先调用：

```js
window.TaxiangjiBridge.sendMessage(payload)
```

保存素材时优先调用：

```js
window.TaxiangjiBridge.saveFolder(material)
```

如果没有注入 bridge，页面会使用本地演示逻辑和 `localStorage` 保存数据。

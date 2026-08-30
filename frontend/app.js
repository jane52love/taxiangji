const skills = [
  {
    id: "mulan-video-content",
    title: "她乡记文案",
    desc: "把你看到的一件小事、一段视频或几张照片，整理成能直接拍、能直接说的家乡短视频。",
    tags: ["先追问", "像你说话", "脚本口播"],
    prompt: "先跟我说说：你今天想拍的是哪一件事？"
  },
  {
    id: "benchmark-copywriting",
    title: "对标账号文案",
    desc: "把你喜欢的对标视频拆开看，学它怎么开头、怎么讲、怎么留住人，再改成适合你的说法。",
    tags: ["学方法", "不照抄", "改成你的"],
    prompt: "你想参考哪条视频？把链接、截图或大概内容发我。"
  },
  {
    id: "account-diff-compare",
    title: "对标账号分析",
    desc: "把你的账号和参考账号放在一起比，看看差在选题、画面、标题、节奏还是结尾互动。",
    tags: ["找差距", "看优先级", "给改法"],
    prompt: "先给我你的账号和一个想学习的账号，我帮你看先改哪里。"
  },
  {
    id: "video-homepage-material",
    title: "视频号首页素材生成",
    desc: "整理视频号首页要用的头像、简介、置顶内容和代表作品，让别人点进来就知道你在讲什么。",
    tags: ["头像简介", "置顶内容", "主页印象"],
    prompt: "你希望别人一打开主页，先记住你是谁、你拍哪里、还是你会讲什么？"
  }
];

const DEMO_REPLY = "我收到这些素材了。下一步我会先追问关键细节，再生成视频脚本、口播文案、标题推荐和视频号配文。\n\n先问你一个问题：这里面最想让别人记住的，是一个画面、一句话，还是一种感觉？";

let currentSkill = skills[0];
let uploadedImages = [];
let messages = [];
let kbMode = "loading"; // bridge | local
let kbItems = [];

const $ = (selector) => document.querySelector(selector);

function storageGet(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  document.body.classList.toggle("subpage-mode", id !== "homeScreen");
}

function renderSkills() {
  $("#skillGrid").innerHTML = skills.map((skill) => `
    <article class="skill-card ${skill.id === currentSkill.id ? "active" : ""}">
      <div class="skill-top">
        <div>
          <h3>${skill.title}</h3>
          <span class="skill-id">${skill.id}</span>
        </div>
        <button class="primary-btn" data-skill="${skill.id}">开始</button>
      </div>
      <p>${skill.desc}</p>
      <div class="skill-meta">${skill.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    </article>
  `).join("");
}

function selectSkill(id) {
  currentSkill = skills.find((skill) => skill.id === id) || skills[0];
  $("#textInput").placeholder = currentSkill.prompt;
  renderSkills();
}

function startSkill(id) {
  selectSkill(id);
  uploadedImages = [];
  messages = [];
  renderMessages();
  renderUploadPreview();
  showScreen("homeScreen");
  $(".app-shell").classList.add("chatting");
  $("#loadingSkill").classList.add("active");

  window.setTimeout(() => {
    $("#loadingSkill").classList.remove("active");
    messages = [
      {
        role: "assistant",
        text: `${currentSkill.title}已加载。\n\n${currentSkill.prompt}`
      }
    ];
    renderMessages();
  }, 520);
}

/* ---------------- 轻量 Markdown 渲染 ---------------- */

function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = String(md).split("\n");
  let html = "", inList = false, inTable = false, inCode = false;

  const closeAll = () => {
    if (inList) { html += "</ul>"; inList = false; }
    if (inTable) { html += "</tbody></table>"; inTable = false; }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      closeAll();
      if (inCode) { html += "</pre>"; inCode = false; }
      else { html += "<pre>"; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(line) + "\n"; continue; }

    if (/^#{1,4}\s/.test(trimmed)) {
      closeAll();
      const level = trimmed.match(/^#+/)[0].length;
      html += `<h${level + 2}>${inline(trimmed.replace(/^#+\s*/, ""))}</h${level + 2}>`;
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      if (inList) { html += "</ul>"; inList = false; }
      const cells = trimmed.split("|").slice(1, -1);
      if (cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) continue;
      if (!inTable) { html += '<table><tbody>'; inTable = true; }
      html += "<tr>" + cells.map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>";
      continue;
    }
    closeTable();
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (!trimmed) { html += "<br />"; continue; }
    html += `<p>${inline(line)}</p>`;
  }
  closeAll();
  if (inCode) html += "</pre>";
  return html;
}

function renderMessages() {
  $("#messages").innerHTML = messages.map((message) => `
    <article class="message ${message.role}">
      <span class="role">${message.role === "user" ? "木兰" : "她乡记"}</span>
      ${message.typing
        ? '<span class="typing-dots"><i></i><i></i><i></i></span>'
        : (message.md ? renderMarkdown(message.text) : message.text.replace(/\n/g, "<br />"))}
    </article>
  `).join("");
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function renderUploadPreview() {
  $("#uploadPreview").innerHTML = uploadedImages.map((image) => `<img src="${image.dataUrl}" alt="${image.name}" />`).join("");
}

/* ---------------- 智能体桥接 ---------------- */

async function bridgeSend(payload) {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("bridge unavailable");
  const { taskId } = await res.json();

  const deadline = Date.now() + 240000; // 智能体生成四件套可能需要一两分钟
  while (Date.now() < deadline) {
    const poll = await fetch(`/api/poll?taskId=${taskId}&wait=25`);
    const data = await poll.json();
    if (data.replyMd) return data.replyMd;
    if (data.error) throw new Error(data.error);
  }
  throw new Error("等待回复超时，请稍后重试。");
}

async function sendToAgent(text) {
  const trimmed = text.trim();
  if (!trimmed && uploadedImages.length === 0) return;

  messages.push({
    role: "user",
    text: trimmed || `我上传了 ${uploadedImages.length} 张图片，请先看画面。`
  });
  renderMessages();

  const payload = {
    skillId: currentSkill.id,
    text: trimmed,
    images: uploadedImages.map(({ name, dataUrl }) => ({ name, dataUrl }))
  };

  $("#textInput").value = "";
  updateComposerMode();

  const typingIndex = messages.push({ role: "assistant", text: "", typing: true }) - 1;
  renderMessages();

  try {
    const replyMd = await bridgeSend(payload);
    messages[typingIndex] = { role: "assistant", text: replyMd, md: true };
  } catch (err) {
    messages[typingIndex] = {
      role: "assistant",
      text: `${err && err.message === "bridge unavailable" ? "桥接服务未启动，当前为本地演示模式。\n\n" : ""}${DEMO_REPLY}`
    };
  }
  renderMessages();
}

function updateComposerMode() {
  document.body.classList.toggle("can-send", $("#textInput").value.trim().length > 0);
}

/* ---------------- 素材保存 ---------------- */

function sampleMaterials() {
  return [
    {
      folderName: "2026-08-30-奶奶的骄傲",
      title: "奶奶的骄傲",
      skillId: "mulan-video-content",
      contentMd: "# 奶奶的骄傲\n\n孙女拿了奖学金，给爷爷奶奶买吃的。重点不是东西多贵，而是长大后还记得回头问一句。",
      images: [],
      createdAt: "2026-08-30T09:30:00+08:00"
    }
  ];
}

function renderMaterials() {
  const materials = storageGet("taxiangji-materials", sampleMaterials());
  $("#materialList").innerHTML = materials.map((item) => `
    <article class="material-item">
      <h3>${item.folderName}</h3>
      <p>${String(item.contentMd).split("\n").filter(Boolean).slice(1, 4).join(" ")}</p>
      <div class="material-meta">
        <span>${item.skillId || ""}</span>
        <span>文案.md</span>
        <span>${(item.images || []).length} 张图片</span>
      </div>
    </article>
  `).join("");
}

/* ---------------- 知识库（真实读写，桥接不可用时降级本地演示） ---------------- */

const LOCAL_KNOWLEDGE = [
  {
    file: "demo-文化习俗.md",
    title: "文化习俗",
    triggers: "腌菜、晒菜、过冬、厨房",
    body: "适合从动作进入：洗、晾、揉、装坛、压实。重点不写成教程，而是写这个习俗为什么还留在家里。"
  },
  {
    file: "demo-身边故事.md",
    title: "身边故事",
    triggers: "邻居、奶奶、孙女、惦记",
    body: "适合从一句真实对话进入。先讲看见了什么，再讲老人怎么说，最后提炼成普通人都懂的牵挂。"
  },
  {
    file: "demo-地方物产.md",
    title: "地方物产",
    triggers: "茭白、白菜、种植户、集市",
    body: "适合把地方知识和人的生活连起来。不要只介绍产地，要写谁在种、怎么吃、为什么这个东西和家乡有关。"
  }
];

async function loadKnowledge() {
  $("#knowledgeList").innerHTML = '<article class="knowledge-item"><p>正在加载知识库...</p></article>';
  try {
    const res = await fetch("/api/knowledge");
    if (!res.ok) throw new Error();
    const data = await res.json();
    kbMode = "bridge";
    kbItems = data.items;
    document.querySelector(".import-btn").style.display = "none";
    $("#exportKnowledge").style.display = "none";
  } catch {
    kbMode = "local";
    kbItems = storageGet("taxiangji-knowledge", LOCAL_KNOWLEDGE).map((item, i) => ({
      file: item.file || `demo-${i}.md`, title: item.title, triggers: (item.tags || []).join("、"), body: item.body
    }));
  }
  renderKnowledge();
}

function renderKnowledge() {
  const query = $("#knowledgeSearch")?.value.trim() || "";
  const filtered = kbItems.filter((item) => !query || `${item.title}${item.triggers}`.includes(query));
  if (!filtered.length) {
    $("#knowledgeList").innerHTML = '<article class="knowledge-item"><p>没有匹配的主题。</p></article>';
    return;
  }
  $("#knowledgeList").innerHTML = filtered.map((item) => `
    <article class="knowledge-item" data-file="${item.file}">
      <h3>${item.title}</h3>
      <div class="knowledge-tags">${(item.triggers || "").split(/[、,，]/).filter(Boolean).map((t) => `<span>${t}</span>`).join("")}</div>
      <p class="kb-file">${item.file} · 点击${item.expanded ? "收起" : "查看并编辑"}</p>
      ${item.expanded
        ? `<textarea data-knowledge-file="${item.file}" rows="12">${item.body ?? ""}</textarea>
           <button class="secondary-btn kb-save" data-kb-save="${item.file}">保存修改</button>`
        : ""}
    </article>
  `).join("");
}

async function toggleKnowledgeItem(file) {
  const item = kbItems.find((x) => x.file === file);
  if (!item) return;
  if (item.expanded) { item.expanded = false; renderKnowledge(); return; }
  if (item.body == null) {
    if (kbMode === "bridge") {
      const res = await fetch(`/api/knowledge?file=${encodeURIComponent(file)}`);
      const data = await res.json();
      item.body = data.content;
    } else {
      item.body = item.body || "";
    }
  }
  kbItems.forEach((x) => { if (x !== item) x.expanded = false; });
  item.expanded = true;
  renderKnowledge();
}

async function saveKnowledgeFile(file, content) {
  if (kbMode === "bridge") {
    const res = await fetch("/api/knowledge/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, content })
    });
    if (!res.ok) throw new Error();
  } else {
    storageSet("taxiangji-knowledge", kbItems.map(({ expanded, ...rest }) => ({
      title: rest.title, tags: (rest.triggers || "").split(/[、,，]/).filter(Boolean), body: rest.body ?? ""
    })));
  }
}

/* ---------------- 其他 ---------------- */

function exportFile(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function knowledgeToMarkdown() {
  return kbItems.map((item) => `## ${item.title}\n\n- 触发词：${item.triggers}\n- 内容规则：${item.body ?? ""}`).join("\n\n");
}

function parseKnowledgeMarkdown(text) {
  const blocks = text.split(/\n(?=##\s+)/).filter(Boolean);
  const parsed = blocks.map((block) => {
    const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || "未命名主题";
    const tagsLine = block.match(/触发词[：:]\s*(.+)/)?.[1] || "";
    const tags = tagsLine.split(/[、,，\s]+/).filter(Boolean).slice(0, 8);
    return {
      file: `demo-${title}.md`,
      title,
      triggers: tags.join("、"),
      body: block.replace(/^##\s+.+$/m, "").trim().slice(0, 260) || "请补充这个主题下的场景、人物、画面和表达边界。"
    };
  });
  if (parsed.length) {
    kbMode = "local";
    kbItems = parsed;
    renderKnowledge();
  }
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = $("#voiceDisplay");
  const statusEl = $("#voiceStatus");
  const setStatus = (t) => { statusEl.textContent = t; };
  let recorder = null, chunks = [], micStream = null, listening = false;
  let useFallback = false, recognition = null, finalText = "";
  let audioCtx = null, analyser = null, rafId = 0;

  /* --- 录音中的实时音量反馈（证明声音被收录） --- */
  function startMeter() {
    let meter = voiceBtn.querySelector(".voice-meter");
    if (!meter) {
      meter = document.createElement("div");
      meter.className = "voice-meter";
      meter.innerHTML = "<span></span>".repeat(5);
      voiceBtn.appendChild(meter);
    }
    const bars = [...meter.querySelectorAll("span")];
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(micStream).connect(analyser);
    } catch { return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        const v = data[i * 6 + 2] / 255;
        bar.style.height = Math.max(3, Math.round(v * 18)) + "px";
      });
      rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopMeter() {
    cancelAnimationFrame(rafId);
    analyser = null;
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  }

  /* --- 主路径：按住录音 → 松开整段送服务端转写 --- */
  async function startRecording() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = transcribe;
    recorder.start(250);
    listening = true;
    voiceBtn.classList.add("recording");
    startMeter();
    setStatus("录音中，请说你的场景和想表达的话（松开结束）……");
  }

  async function transcribe() {
    stopMeter();
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
    recorder = null;
    if (blob.size < 1200) { setStatus("没听到内容，请再按住说一次。"); return; }
    setStatus("识别中……");
    try {
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Audio-Type": blob.type },
        body: blob
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `识别失败（${res.status}）`);
      const text = (data.text || "").trim();
      if (!text) throw new Error("没听到内容，请再按住说一次");
      $("#textInput").value = text;
      setStatus("已识别，放进输入框，可修改后发送。");
      updateComposerMode();
      $("#textInput").focus();
    } catch (err) {
      if (SR && /未配置|识别服务/.test(err.message)) {
        useFallback = true;
        setStatus("服务端语音识别未配置，本次改用浏览器识别，请再按住一次。");
      } else {
        setStatus(`识别失败：${err.message}`);
      }
    }
  }

  /* --- 降级路径：浏览器流式识别（电脑 Chrome 可用） --- */
  function startWebSpeech() {
    if (!SR) { setStatus("当前环境不支持语音输入，请改用文字。"); return; }
    if (!recognition) {
      recognition = new SR();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interim = "", final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        if (final) finalText += final;
        $("#textInput").value = (finalText + interim).trim();
        updateComposerMode();
      };
      recognition.onerror = (event) => {
        listening = false;
        voiceBtn.classList.remove("recording");
        const msgs = {
          network: "浏览器语音服务网络不通，请在 桥接/config.json 配置识别服务，或改用文字输入。",
          "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许后重试。",
          "no-speech": "没听到内容，请再按住说一次。"
        };
        if (event.error !== "aborted") setStatus(msgs[event.error] || `语音识别出错（${event.error}）`);
      };
      recognition.onend = () => {
        listening = false;
        voiceBtn.classList.remove("recording");
        setStatus("已识别，放进输入框，可修改后发送。");
        updateComposerMode();
        $("#textInput").focus();
      };
    }
    try {
      finalText = "";
      $("#textInput").value = "";
      recognition.start();
      listening = true;
      voiceBtn.classList.add("recording");
      setStatus("正在听，请说你的场景和想表达的话……");
    } catch { /* 重复 start 忽略 */ }
  }

  /* --- 按住说话：按下开始，松开结束 --- */
  const startPress = (e) => {
    e.preventDefault();
    try { voiceBtn.setPointerCapture(e.pointerId); } catch { /* */ }
    if (!window.isSecureContext) {
      setStatus("麦克风需要 HTTPS 访问：请把地址开头的 http 改成 https 再打开页面。");
      return;
    }
    if (listening) return;
    if (useFallback) return startWebSpeech();
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      if (SR) { useFallback = true; return startWebSpeech(); }
      setStatus("当前环境不支持语音输入，请改用文字。");
      return;
    }
    startRecording()
      .catch((err) => { stopMeter(); setStatus("无法访问麦克风：" + (err.message || err.name)); });
  };
  const stopPress = () => {
    if (!listening) return;
    listening = false;
    voiceBtn.classList.remove("recording");
    stopMeter();
    if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch { /* */ } }
    if (recognition) { try { recognition.stop(); } catch { /* */ } }
  };

  voiceBtn.addEventListener("pointerdown", startPress);
  voiceBtn.addEventListener("pointerup", stopPress);
  voiceBtn.addEventListener("pointercancel", stopPress);
  voiceBtn.addEventListener("contextmenu", (e) => e.preventDefault());
}

function bindEvents() {
  $("#skillGrid").addEventListener("click", (event) => {
    const id = event.target.dataset.skill;
    if (id) startSkill(id);
  });

  $("#brandHome").addEventListener("click", () => {
    $(".app-shell").classList.remove("chatting");
    $("#loadingSkill").classList.remove("active");
    messages = [];
    renderMessages();
    showScreen("homeScreen");
  });

  document.querySelectorAll(".returnChat").forEach((button) => {
    button.addEventListener("click", () => showScreen("homeScreen"));
  });
  $("#sendMessage").addEventListener("click", () => sendToAgent($("#textInput").value));
  $("#keyboardButton").addEventListener("click", () => {
    const isVoiceMode = document.body.classList.contains("voice-mode");
    document.body.classList.toggle("voice-mode", !isVoiceMode);
    if (isVoiceMode) {
      $("#textInput").focus();
    }
    updateComposerMode();
  });
  $("#textInput").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;
    updateComposerMode();
  });
  $("#textInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendToAgent($("#textInput").value);
    }
  });

  $("#imageInput").addEventListener("change", (event) => {
    [...event.target.files].forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        uploadedImages.push({ name: file.name, dataUrl: reader.result });
        renderUploadPreview();
      };
      reader.readAsDataURL(file);
    });
  });

  $("#formatDialog").addEventListener("close", () => {});

  $("#exportMaterials").addEventListener("click", () => {
    exportFile("taxiangji-materials.json", JSON.stringify(storageGet("taxiangji-materials", sampleMaterials()), null, 2), "application/json");
  });

  $("#knowledgeSearch").addEventListener("input", renderKnowledge);
  $("#addKnowledge").addEventListener("click", async () => {
    if (kbMode === "bridge") {
      alert("联调模式下请直接对助手说「帮我在场景触发库加一个 XX 主题」，由助手按统一结构写入。");
      return;
    }
    kbItems.unshift({ file: `demo-新的场景主题.md`, title: "新的场景主题", triggers: "待补充", body: "写下这个主题的真实场景、人物、动作、情绪和不能编的边界。", expanded: false });
    renderKnowledge();
  });
  $("#exportKnowledge").addEventListener("click", () => exportFile("知识库-场景触发库.md", knowledgeToMarkdown(), "text/markdown"));
  $("#knowledgeImport").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parseKnowledgeMarkdown(reader.result);
    reader.readAsText(file);
  });
  $("#knowledgeList").addEventListener("click", (event) => {
    const saveBtn = event.target.closest("[data-kb-save]");
    if (saveBtn) {
      const file = saveBtn.dataset.kbSave;
      const textarea = document.querySelector(`textarea[data-knowledge-file="${file}"]`);
      if (!textarea) return;
      const item = kbItems.find((x) => x.file === file);
      item.body = textarea.value;
      saveKnowledgeFile(file, textarea.value)
        .then(() => { alert("已保存到 我的知识/场景触发库/"); })
        .catch(() => alert("已保存（本地演示模式）"));
      return;
    }
    const card = event.target.closest(".knowledge-item");
    if (card && card.dataset.file && !event.target.closest("textarea")) {
      toggleKnowledgeItem(card.dataset.file);
    }
  });
}

async function init() {
  document.body.classList.add("voice-mode");
  document.body.classList.remove("can-send");
  renderSkills();
  renderMaterials();
  bindEvents();
  setupVoice();
  selectSkill("mulan-video-content");
  loadKnowledge();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();

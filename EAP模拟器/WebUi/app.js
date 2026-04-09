(() => {
  const pending = new Map();
  let seq = 1;

  function isWebView() {
    return typeof chrome !== "undefined" && chrome.webview && typeof chrome.webview.postMessage === "function";
  }

  function postToHost(obj) {
    // 必须传对象，不要 JSON.stringify：WebView2 会把字符串再包一层，宿主解析不到 type/method
    if (isWebView()) chrome.webview.postMessage(obj);
    else console.warn("[无 WebView] 将不会调用宿主:", obj);
  }

  if (isWebView()) {
    chrome.webview.addEventListener("message", (ev) => {
      let data = ev.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "reply") {
        const cb = pending.get(data.id);
        if (!cb) return;
        pending.delete(data.id);
        if (data.ok) cb.resolve(data.result ?? {});
        else cb.reject(new Error(data.error || "请求失败"));
        return;
      }

      if (data.type === "event") {
        if (data.name === "log") appendLog(data.payload?.line ?? "");
        if (data.name === "connection") onConnectionEvent(data.payload);
      }
    });
  }

  function apiCall(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = seq++;
      pending.set(id, { resolve, reject });
      postToHost({ type: "call", id, method, params });
    });
  }

  const el = (id) => document.getElementById(id);

  const ip = el("ip");
  const port = el("port");
  const deviceId = el("deviceId");
  const active = el("active");
  const btnConnect = el("btnConnect");
  const btnDisconnect = el("btnDisconnect");
  const connStatus = el("connStatus");
  const cmdList = el("cmdList");
  const btnAdd = el("btnAdd");
  const btnDelete = el("btnDelete");
  const name = el("name");
  const stream = el("stream");
  const func = el("function");
  const waitReply = el("waitReply");
  const sml = el("sml");
  const btnSave = el("btnSave");
  const btnSend = el("btnSend");
  const log = el("log");
  const btnClearLog = el("btnClearLog");

  let commands = [];
  let selectedId = null;

  function onConnectionEvent(payload) {
    const connected = !!payload?.connected;
    const state = payload?.state ?? "";
    if (connected) {
      connStatus.textContent = "已连接";
      connStatus.dataset.state = "on";
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
    } else if (state === "Connecting" || state === "Connected") {
      connStatus.textContent = state;
      connStatus.dataset.state = "warn";
    } else {
      connStatus.textContent = "未连接";
      connStatus.dataset.state = "off";
      btnConnect.disabled = false;
      btnDisconnect.disabled = true;
    }
  }

  function appendLog(line) {
    log.textContent += line + "\n";
    log.scrollTop = log.scrollHeight;
  }

  function renderList() {
    cmdList.innerHTML = "";
    commands.forEach((c) => {
      const li = document.createElement("li");
      li.dataset.id = c.id;
      li.textContent = displayName(c);
      if (c.id === selectedId) li.classList.add("active");
      li.addEventListener("click", () => selectCommand(c.id));
      cmdList.appendChild(li);
    });
  }

  function displayName(c) {
    const w = c.waitReply ? " W" : "";
    return `S${c.stream}F${c.function}${w} - ${c.name || ""}`;
  }

  function selectCommand(id) {
    selectedId = id;
    const c = commands.find((x) => x.id === id);
    if (!c) {
      clearEditor();
      return;
    }
    name.value = c.name ?? "";
    stream.value = c.stream;
    func.value = c.function;
    waitReply.checked = !!c.waitReply;
    sml.value = c.smlBody ?? "";
    renderList();
  }

  function clearEditor() {
    name.value = "";
    stream.value = "";
    func.value = "";
    waitReply.checked = true;
    sml.value = "";
    selectedId = null;
    renderList();
  }

  async function persist() {
    await apiCall("setCommands", { commands });
  }

  btnConnect.addEventListener("click", async () => {
    btnConnect.disabled = true;
    try {
      await apiCall("connect", {
        ip: ip.value.trim(),
        port: Number(port.value.trim()),
        deviceId: Number(deviceId.value.trim()),
        active: active.checked,
      });
      btnDisconnect.disabled = false;
      connStatus.textContent = "连接中…";
      connStatus.dataset.state = "warn";
    } catch (e) {
      appendLog(`连接失败: ${e.message}`);
      btnConnect.disabled = false;
    }
  });

  btnDisconnect.addEventListener("click", async () => {
    try {
      await apiCall("disconnect");
    } catch (e) {
      appendLog(`断开异常: ${e.message}`);
    }
    onConnectionEvent({ connected: false, state: "Retry" });
  });

  btnAdd.addEventListener("click", async () => {
    const c = {
      id: crypto.randomUUID(),
      name: "新命令",
      stream: 1,
      function: 1,
      waitReply: true,
      smlBody: "",
    };
    commands.push(c);
    try {
      await persist();
      selectedId = c.id;
      selectCommand(c.id);
    } catch (err) {
      commands.pop();
      appendLog(`新增失败: ${err.message}`);
    }
  });

  btnDelete.addEventListener("click", async () => {
    if (!selectedId) return;
    const c = commands.find((x) => x.id === selectedId);
    if (!c) return;
    if (!confirm(`确定删除 "${displayName(c)}" 吗？`)) return;
    commands = commands.filter((x) => x.id !== selectedId);
    await persist();
    clearEditor();
    if (commands.length) selectCommand(commands[0].id);
  });

  btnSave.addEventListener("click", async () => {
    if (!selectedId) {
      alert("请先选择一条命令");
      return;
    }
    const c = commands.find((x) => x.id === selectedId);
    if (!c) return;
    const s = Number(stream.value);
    const f = Number(func.value);
    if (!Number.isInteger(s) || s < 0 || s > 127) {
      alert("Stream 必须是 0–127");
      return;
    }
    if (!Number.isInteger(f) || f < 0 || f > 255) {
      alert("Function 必须是 0–255");
      return;
    }
    c.name = name.value.trim();
    c.stream = s;
    c.function = f;
    c.waitReply = waitReply.checked;
    c.smlBody = sml.value;
    await persist();
    renderList();
    appendLog(`命令已保存: ${displayName(c)}`);
  });

  btnSend.addEventListener("click", async () => {
    const s = Number(stream.value);
    const f = Number(func.value);
    if (!Number.isInteger(s) || s < 0 || s > 127 || !Number.isInteger(f) || f < 0 || f > 255) {
      alert("请输入有效的 Stream / Function");
      return;
    }
    btnSend.disabled = true;
    try {
      await apiCall("send", {
        stream: s,
        function: f,
        waitReply: waitReply.checked,
        smlBody: sml.value,
      });
    } catch (e) {
      appendLog(`发送异常: ${e.message}`);
    } finally {
      btnSend.disabled = false;
    }
  });

  btnClearLog.addEventListener("click", () => {
    log.textContent = "";
  });

  async function boot() {
    if (!isWebView()) {
      appendLog("提示: 在 WebView2 宿主中运行以使用完整功能。");
    }
    try {
      const { commands: list } = await apiCall("getCommands");
      commands = Array.isArray(list) ? list : [];
      renderList();
      if (commands.length) selectCommand(commands[0].id);
      else clearEditor();
    } catch (e) {
      appendLog(`加载命令失败: ${e.message}`);
    }
  }

  boot();
})();

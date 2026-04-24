(() => {
  const pending = new Map();
  let seq = 1;

  function isWebView() {
    return typeof chrome !== "undefined" && chrome.webview && typeof chrome.webview.postMessage === "function";
  }

  function postToHost(obj) {
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

  const projectSelect = el("projectSelect");
  const projectTree = el("projectTree");
  const projectBadge = el("projectBadge");
  const cmdList = el("cmdList");
  const cmdSearch = el("cmdSearch");
  const ip = el("ip");
  const port = el("port");
  const deviceId = el("deviceId");
  const active = el("active");
  const btnConnect = el("btnConnect");
  const btnDisconnect = el("btnDisconnect");
  const connStatus = el("connStatus");
  const dispIp = el("dispIp");
  const dispPort = el("dispPort");
  const connDuration = el("connDuration");
  const statSent = el("statSent");
  const statRecv = el("statRecv");
  const rateFill = el("rateFill");
  const rateText = el("rateText");
  const name = el("name");
  const stream = el("stream");
  const func = el("function");
  const waitReply = el("waitReply");
  const sml = el("sml");
  const parsePre = el("parsePre");
  const btnAdd = el("btnAdd");
  const btnDelete = el("btnDelete");
  const btnSave = el("btnSave");
  const btnSend = el("btnSend");
  const btnClearSml = el("btnClearSml");
  const btnFormat = el("btnFormat");
  const log = el("log");
  const commTbody = el("commTbody");
  const btnClearLog = el("btnClearLog");
  const fltSend = el("fltSend");
  const fltRecv = el("fltRecv");
  const fltErr = el("fltErr");
  const btnNewProject = el("btnNewProject");
  const btnDelProject = el("btnDelProject");
  const btnSaveWorkspace = el("btnSaveWorkspace");
  const btnExportProject = el("btnExportProject");
  const btnImportProject = el("btnImportProject");
  const importFile = el("importFile");
  const btnTheme = el("btnTheme");

  /** @type {{ projects: any[], currentProjectId: string }} */
  let workspace = { projects: [], currentProjectId: "" };
  let selectedId = null;
  let chipFilter = "all";
  const commRows = [];
  let totalSent = 0;
  let totalRecv = 0;
  let totalFail = 0;
  let connectedSince = null;
  let durationTimer = null;

  function normId(id) {
    if (id && typeof id === "object" && id.toString) return String(id);
    return String(id ?? "");
  }

  function currentProject() {
    const id = normId(workspace.currentProjectId);
    return workspace.projects.find((p) => normId(p.id) === id) ?? workspace.projects[0];
  }

  function currentCommands() {
    const p = currentProject();
    if (!p) return [];
    if (!Array.isArray(p.commands)) p.commands = [];
    return p.commands;
  }

  async function persistWorkspace() {
    await apiCall("setWorkspace", { workspace });
  }

  function updateStatsUi() {
    statSent.textContent = String(totalSent);
    statRecv.textContent = String(totalRecv);
    const denom = totalSent + totalFail;
    const pct = denom === 0 ? null : Math.round((totalSent / denom) * 100);
    if (pct === null) {
      rateText.textContent = "—";
      rateFill.style.width = "0%";
    } else {
      rateText.textContent = `${pct}%`;
      rateFill.style.width = `${pct}%`;
    }
  }

  function updateDispConnectionFields() {
    dispIp.textContent = ip.value.trim() || "—";
    dispPort.textContent = port.value.trim() || "—";
  }

  function updateDuration() {
    if (!connectedSince) {
      connDuration.textContent = "—";
      return;
    }
    const sec = Math.floor((Date.now() - connectedSince) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    connDuration.textContent = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function onConnectionEvent(payload) {
    const connected = !!payload?.connected;
    const state = payload?.state ?? "";
    updateDispConnectionFields();
    if (connected) {
      connStatus.textContent = "已连接";
      connStatus.dataset.state = "on";
      btnConnect.disabled = true;
      btnDisconnect.disabled = false;
      connectedSince = Date.now();
      if (durationTimer) clearInterval(durationTimer);
      durationTimer = setInterval(updateDuration, 1000);
      updateDuration();
    } else if (state === "Connecting" || state === "Connected") {
      connStatus.textContent = state;
      connStatus.dataset.state = "warn";
    } else {
      connStatus.textContent = "未连接";
      connStatus.dataset.state = "off";
      btnConnect.disabled = false;
      btnDisconnect.disabled = true;
      connectedSince = null;
      if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
      }
      connDuration.textContent = "—";
    }
  }

  function appendLog(line) {
    log.textContent += line + "\n";
    log.scrollTop = log.scrollHeight;

    const firstLine = String(line).split("\n")[0];
    const m = firstLine.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(>>|<<)\s*S(\d+)F(\d+)/);
    if (m) {
      commRows.push({
        time: m[1],
        dir: m[2] === ">>" ? "send" : "recv",
        cmd: `S${m[3]}F${m[4]}`,
        summary: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine,
        kind: "msg",
      });
      if (commRows.length > 300) commRows.shift();
      renderCommTable();
      return;
    }
    if (line.includes("发送失败") || line.includes("[ERROR]") || line.includes("异常")) {
      const tm = firstLine.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/);
      commRows.push({
        time: tm ? tm[1] : "",
        dir: "err",
        cmd: "—",
        summary: firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine,
        kind: "err",
      });
      if (commRows.length > 300) commRows.shift();
      renderCommTable();
    }
  }

  function renderCommTable() {
    commTbody.innerHTML = "";
    const rows = commRows.filter((r) => {
      if (r.kind === "err") return fltErr.checked;
      if (r.dir === "send") return fltSend.checked;
      if (r.dir === "recv") return fltRecv.checked;
      return true;
    });
    for (const r of rows.slice(-80).reverse()) {
      const tr = document.createElement("tr");
      const dirCls = r.dir === "send" ? "dir-send" : r.dir === "recv" ? "dir-recv" : "dir-err";
      const dirLabel = r.dir === "send" ? "发送" : r.dir === "recv" ? "接收" : "异常";
      tr.innerHTML = `<td class="mono">${escapeHtml(r.time)}</td><td class="${dirCls}">${dirLabel}</td><td class="mono">${escapeHtml(r.cmd)}</td><td>${escapeHtml(r.summary)}</td>`;
      commTbody.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  [fltSend, fltRecv, fltErr].forEach((x) => x.addEventListener("change", renderCommTable));

  function displayName(c) {
    const w = c.waitReply ? " W" : "";
    return `S${c.stream}F${c.function}${w} - ${c.name || ""}`;
  }

  function renderProjectSelect() {
    projectSelect.innerHTML = "";
    workspace.projects.forEach((p) => {
      const o = document.createElement("option");
      o.value = normId(p.id);
      o.textContent = p.name || "未命名";
      projectSelect.appendChild(o);
    });
    projectSelect.value = normId(workspace.currentProjectId);
  }

  function renderProjectTree() {
    projectTree.innerHTML = "";
    workspace.projects.forEach((p) => {
      const id = normId(p.id);
      const li = document.createElement("li");
      li.dataset.id = id;
      li.classList.toggle("active", id === normId(workspace.currentProjectId));
      const head = document.createElement("div");
      head.textContent = `📁 ${p.name || "未命名"}`;
      head.addEventListener("click", () => selectProject(id));
      head.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        const nn = prompt("项目名称", p.name || "");
        if (nn === null) return;
        p.name = nn.trim() || p.name;
        void persistAndRefresh();
      });
      const ul = document.createElement("ul");
      ul.innerHTML =
        `<li class="folder">SECS 指令集 (${p.commands?.length ?? 0})</li>` +
        `<li class="folder">自定义命令</li>` +
        `<li class="folder">脚本文件</li>`;
      li.appendChild(head);
      li.appendChild(ul);
      projectTree.appendChild(li);
    });
  }

  function commandMatchesFilter(c) {
    const q = cmdSearch.value.trim().toLowerCase();
    if (q) {
      const hay = `${c.name || ""} s${c.stream}f${c.function}`.toLowerCase();
      if (!hay.includes(q) && !String(c.stream).includes(q) && !String(c.function).includes(q)) return false;
    }
    if (chipFilter === "secs") {
      /* 当前模板均为 SECS；预留与自定义分类 */
      return true;
    }
    return true;
  }

  function renderCmdList() {
    cmdList.innerHTML = "";
    const cmds = currentCommands().filter(commandMatchesFilter);
    cmds.forEach((c) => {
      const id = normId(c.id);
      const li = document.createElement("li");
      li.dataset.id = id;
      if (id === normId(selectedId)) li.classList.add("active");
      li.innerHTML = `<div class="cmd-name">${escapeHtml(c.name || "未命名")}</div>` +
        `<div class="cmd-sub">${escapeHtml(displayName(c))}</div>` +
        `<span class="cmd-tag">SECS/GEM</span>`;
      li.addEventListener("click", () => selectCommand(id));
      cmdList.appendChild(li);
    });
  }

  function updateParsePreview() {
    const c = currentCommands().find((x) => normId(x.id) === normId(selectedId));
    if (!c) {
      parsePre.textContent = "（在右侧列表选择一条命令）";
      return;
    }
    const w = c.waitReply ? "W" : "";
    const header = `S${c.stream}F${c.function} ${w}`.trim();
    const body = (c.smlBody || "").trim();
    parsePre.textContent = body ? `${header}\n${body}` : `${header}\n(Header Only)`;
  }

  function selectCommand(id) {
    selectedId = id;
    const c = currentCommands().find((x) => normId(x.id) === normId(id));
    if (!c) {
      clearEditor();
      return;
    }
    name.value = c.name ?? "";
    stream.value = c.stream;
    func.value = c.function;
    waitReply.checked = !!c.waitReply;
    sml.value = c.smlBody ?? "";
    renderCmdList();
    updateParsePreview();
  }

  function clearEditor() {
    name.value = "";
    stream.value = "";
    func.value = "";
    waitReply.checked = true;
    sml.value = "";
    selectedId = null;
    renderCmdList();
    updateParsePreview();
  }

  async function persistAndRefresh() {
    await persistWorkspace();
    renderProjectSelect();
    renderProjectTree();
    renderCmdList();
    const p = currentProject();
    projectBadge.textContent = p ? `· ${p.name}` : "";
  }

  function selectProject(projectId) {
    workspace.currentProjectId = normId(projectId);
    projectSelect.value = workspace.currentProjectId;
    selectedId = null;
    const cmds = currentCommands();
    renderProjectTree();
    renderCmdList();
    projectBadge.textContent = currentProject() ? `· ${currentProject().name}` : "";
    if (cmds.length) selectCommand(normId(cmds[0].id));
    else clearEditor();
    void persistWorkspace();
  }

  btnConnect.addEventListener("click", async () => {
    btnConnect.disabled = true;
    updateDispConnectionFields();
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
      totalFail += 1;
      updateStatsUi();
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
    currentCommands().push(c);
    try {
      await persistWorkspace();
      selectedId = c.id;
      selectCommand(normId(c.id));
      renderProjectTree();
    } catch (err) {
      currentCommands().pop();
      appendLog(`新增失败: ${err.message}`);
    }
  });

  btnDelete.addEventListener("click", async () => {
    if (!selectedId) return;
    const cmds = currentCommands();
    const c = cmds.find((x) => normId(x.id) === normId(selectedId));
    if (!c) return;
    if (!confirm(`确定从当前项目删除「${displayName(c)}」吗？`)) return;
    const idx = cmds.findIndex((x) => normId(x.id) === normId(selectedId));
    if (idx >= 0) cmds.splice(idx, 1);
    await persistWorkspace();
    clearEditor();
    if (cmds.length) selectCommand(normId(cmds[0].id));
    renderProjectTree();
  });

  btnSave.addEventListener("click", async () => {
    if (!selectedId) {
      alert("请先在「常用命令」中选择一条，或点击「新增命令」");
      return;
    }
    const cmds = currentCommands();
    const c = cmds.find((x) => normId(x.id) === normId(selectedId));
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
    await persistWorkspace();
    renderCmdList();
    renderProjectTree();
    updateParsePreview();
    appendLog(`[命令已保存] ${displayName(c)}`);
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
      const result = await apiCall("send", {
        stream: s,
        function: f,
        waitReply: waitReply.checked,
        smlBody: sml.value,
      });
      totalSent += 1;
      if (result.reply) totalRecv += 1;
      updateStatsUi();
    } catch (e) {
      appendLog(`发送异常: ${e.message}`);
      totalFail += 1;
      updateStatsUi();
    } finally {
      btnSend.disabled = false;
    }
  });

  btnClearSml.addEventListener("click", () => {
    sml.value = "";
  });

  btnFormat.addEventListener("click", () => {
    sml.value = sml.value.trim();
  });

  btnClearLog.addEventListener("click", () => {
    log.textContent = "";
    commRows.length = 0;
    renderCommTable();
  });

  projectSelect.addEventListener("change", () => {
    selectProject(projectSelect.value);
  });

  btnNewProject.addEventListener("click", async () => {
    const title = prompt("新项目名称", `项目_${new Date().toISOString().slice(0, 10)}`);
    if (title === null) return;
    const proj = {
      id: crypto.randomUUID(),
      name: title.trim() || "新项目",
      commands: [],
    };
    workspace.projects.push(proj);
    workspace.currentProjectId = normId(proj.id);
    await persistAndRefresh();
    clearEditor();
  });

  btnDelProject.addEventListener("click", async () => {
    if (workspace.projects.length <= 1) {
      alert("至少保留一个项目");
      return;
    }
    const p = currentProject();
    if (!p || !confirm(`删除项目「${p.name}」及其全部命令？`)) return;
    const id = normId(p.id);
    workspace.projects = workspace.projects.filter((x) => normId(x.id) !== id);
    workspace.currentProjectId = normId(workspace.projects[0].id);
    await persistAndRefresh();
    selectProject(workspace.currentProjectId);
  });

  btnSaveWorkspace.addEventListener("click", async () => {
    try {
      await persistWorkspace();
      appendLog(`[工作区已保存] ${new Date().toLocaleString()}`);
    } catch (e) {
      appendLog(`保存失败: ${e.message}`);
    }
  });

  btnExportProject.addEventListener("click", () => {
    const p = currentProject();
    if (!p) return;
    const blob = new Blob([JSON.stringify({ name: p.name, commands: p.commands }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    const base = (p.name || "project").replace(/[\\/:*?"<>|]/g, "_");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  btnImportProject.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      let cmds = Array.isArray(data) ? data : data.commands;
      const projName = (data && !Array.isArray(data) && data.name) || f.name.replace(/\.json$/i, "") || "导入的项目";
      if (!Array.isArray(cmds)) {
        alert("JSON 中需包含 commands 数组，或为命令数组本身");
        return;
      }
      cmds = cmds.map((c) => ({
        id: c.id || crypto.randomUUID(),
        name: c.name ?? "",
        stream: Number(c.stream),
        function: Number(c.function),
        waitReply: c.waitReply !== false,
        smlBody: c.smlBody ?? "",
      }));
      const proj = { id: crypto.randomUUID(), name: String(projName), commands: cmds };
      workspace.projects.push(proj);
      workspace.currentProjectId = normId(proj.id);
      await persistAndRefresh();
      selectProject(proj.id);
    } catch (e) {
      alert(`导入失败: ${e.message}`);
    }
    importFile.value = "";
  });

  btnTheme.addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  });

  cmdSearch.addEventListener("input", renderCmdList);

  document.querySelectorAll(".chip-row .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip-row .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      chipFilter = chip.dataset.filter || "all";
      renderCmdList();
    });
  });

  document.querySelectorAll(".nav-item[data-view]").forEach((nav) => {
    nav.addEventListener("click", () => {
      const view = nav.getAttribute("data-view");
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      nav.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      const panel = document.getElementById(`view-${view}`);
      if (panel) panel.classList.add("active");
    });
  });

  ip.addEventListener("input", updateDispConnectionFields);
  port.addEventListener("input", updateDispConnectionFields);

  async function boot() {
    if (!isWebView()) {
      appendLog("提示: 在 WebView2 宿主中运行以使用完整功能。");
    }
    try {
      const { workspace: ws } = await apiCall("getWorkspace");
      workspace = ws || { projects: [], currentProjectId: "" };
      if (!workspace.projects?.length) {
        appendLog("工作区为空，请新建项目");
      } else {
        if (!workspace.currentProjectId || !workspace.projects.some((p) => normId(p.id) === normId(workspace.currentProjectId))) {
          workspace.currentProjectId = normId(workspace.projects[0].id);
        }
        workspace.projects.forEach((p) => {
          p.commands?.forEach((c) => {
            if (!c.id) c.id = crypto.randomUUID();
          });
        });
      }
      renderProjectSelect();
      renderProjectTree();
      const cmds = currentCommands();
      projectBadge.textContent = currentProject() ? `· ${currentProject().name}` : "";
      renderCmdList();
      if (cmds.length) selectCommand(normId(cmds[0].id));
      else clearEditor();
      updateDispConnectionFields();
      updateStatsUi();
    } catch (e) {
      appendLog(`加载工作区失败: ${e.message}`);
    }
  }

  boot();
})();

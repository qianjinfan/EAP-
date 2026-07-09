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
  const btnMoveCmdUp = el("btnMoveCmdUp");
  const btnMoveCmdDown = el("btnMoveCmdDown");
  const btnDelete = el("btnDelete");
  const btnSave = el("btnSave");
  const btnSend = el("btnSend");
  const btnClearSml = el("btnClearSml");
  const btnFormat = el("btnFormat");
  const log = el("log");
  const commTbody = el("commTbody");
  const btnClearLog = el("btnClearLog");
  const logDirPath = el("logDirPath");
  const btnOpenLogDir = el("btnOpenLogDir");
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
  const excelProjectSelect = el("excelProjectSelect");
  const excelFile = el("excelFile");
  const btnImportExcel = el("btnImportExcel");
  const excelMeta = el("excelMeta");
  const excelTbody = el("excelTbody");
  const autoReplyEnabled = el("autoReplyEnabled");
  const autoReplyTbody = el("autoReplyTbody");

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

    const text = String(line);
    const lines = text.split("\n");
    const firstLine = lines[0];
    const body = lines.slice(1).join("\n").trim();
    const m = firstLine.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(>>|<<)\s*S(\d+)F(\d+)\s*(W?)\s*(.*)$/);
    if (m) {
      const tail = (m[6] || "").trim();
      const summary = body
        ? body.split("\n")[0].trim()
        : tail || `S${m[3]}F${m[4]}${m[5] ? " W" : ""}`;
      commRows.push({
        time: m[1],
        dir: m[2] === ">>" ? "send" : "recv",
        cmd: `S${m[3]}F${m[4]}${m[5] ? " W" : ""}`,
        summary: summary.length > 160 ? `${summary.slice(0, 160)}…` : summary,
        detail: text,
        kind: "msg",
      });
      if (commRows.length > 300) commRows.shift();
      renderCommTable();
      return;
    }
    if (text.includes("发送失败") || text.includes("[ERROR]") || text.includes("异常")) {
      const tm = firstLine.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/);
      commRows.push({
        time: tm ? tm[1] : "",
        dir: "err",
        cmd: "—",
        summary: firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine,
        detail: text,
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
      const hasDetail = !!(r.detail && r.detail.includes("\n"));
      tr.className = "comm-row" + (hasDetail ? " has-detail" : "");
      tr.innerHTML =
        `<td class="mono">${escapeHtml(r.time)}</td>` +
        `<td class="${dirCls}">${hasDetail ? '<span class="caret">▸</span> ' : ""}${dirLabel}</td>` +
        `<td class="mono">${escapeHtml(r.cmd)}</td>` +
        `<td>${escapeHtml(r.summary)}</td>`;
      commTbody.appendChild(tr);

      if (hasDetail) {
        const detailTr = document.createElement("tr");
        detailTr.className = "comm-detail-row";
        detailTr.style.display = "none";
        detailTr.innerHTML = `<td colspan="4"><pre class="comm-detail mono">${escapeHtml(r.detail)}</pre></td>`;
        commTbody.appendChild(detailTr);
        tr.addEventListener("click", () => {
          const open = detailTr.style.display === "none";
          detailTr.style.display = open ? "table-row" : "none";
          const caret = tr.querySelector(".caret");
          if (caret) caret.textContent = open ? "▾" : "▸";
        });
      }
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
    excelProjectSelect.innerHTML = "";
    const mesSel = document.getElementById("mesProjectSelect");
    if (mesSel) mesSel.innerHTML = "";
    workspace.projects.forEach((p) => {
      const o = document.createElement("option");
      o.value = normId(p.id);
      o.textContent = p.name || "未命名";
      projectSelect.appendChild(o);
      excelProjectSelect.appendChild(o.cloneNode(true));
      if (mesSel) mesSel.appendChild(o.cloneNode(true));
    });
    projectSelect.value = normId(workspace.currentProjectId);
    excelProjectSelect.value = normId(workspace.currentProjectId);
    if (mesSel) mesSel.value = normId(workspace.currentProjectId);
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

  function updateCmdReorderButtons() {
    const cmds = currentCommands();
    const idx = cmds.findIndex((x) => normId(x.id) === normId(selectedId));
    const ok = idx >= 0;
    btnMoveCmdUp.disabled = !ok || idx === 0;
    btnMoveCmdDown.disabled = !ok || idx >= cmds.length - 1;
  }

  async function moveSelectedCommand(delta) {
    if (delta !== 1 && delta !== -1) return;
    const cmds = currentCommands();
    const idx = cmds.findIndex((x) => normId(x.id) === normId(selectedId));
    if (idx < 0) return;
    const j = idx + delta;
    if (j < 0 || j >= cmds.length) return;
    const [item] = cmds.splice(idx, 1);
    cmds.splice(j, 0, item);
    try {
      await persistWorkspace();
      renderCmdList();
      renderProjectTree();
      updateParsePreview();
    } catch (err) {
      const [rollback] = cmds.splice(j, 1);
      cmds.splice(idx, 0, rollback);
      appendLog(`调整顺序失败: ${err.message}`);
      updateCmdReorderButtons();
    }
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
    updateCmdReorderButtons();
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
    renderExcelView();
    renderMesSavedList();
  }

  function selectProject(projectId) {
    workspace.currentProjectId = normId(projectId);
    projectSelect.value = workspace.currentProjectId;
    excelProjectSelect.value = workspace.currentProjectId;
    const mesSel = document.getElementById("mesProjectSelect");
    if (mesSel) mesSel.value = workspace.currentProjectId;
    selectedId = null;
    const cmds = currentCommands();
    renderProjectTree();
    renderCmdList();
    projectBadge.textContent = currentProject() ? `· ${currentProject().name}` : "";
    if (cmds.length) selectCommand(normId(cmds[0].id));
    else clearEditor();
    void persistWorkspace();
    renderExcelView();
    mesSelectedIfaceId = null;
    renderMesSavedList();
  }

  function renderExcelView() {
    if (!excelMeta || !excelTbody) return;
    const p = currentProject();
    excelTbody.innerHTML = "";
    const sheet = p?.excelSheet;
    if (!sheet || !Array.isArray(sheet.rows) || sheet.rows.length === 0) {
      excelMeta.textContent = "未导入 Excel。点击「导入/更新」选择该项目对应的 xlsx 文件。";
      return;
    }
    const fn = sheet.fileName || "（未命名）";
    const tm = sheet.importedAt || "";
    excelMeta.textContent = tm ? `已导入：${fn}（${tm}）` : `已导入：${fn}`;

    for (const r of sheet.rows) {
      const tr = document.createElement("tr");
      const dir = (r.direction || "").trim();
      const dirLabel = dir === ">>>" ? ">>>" : dir === "<<<" ? "<<<" : "";
      const dirCls = dir === ">>>" ? "excel-dir-send" : dir === "<<<" ? "excel-dir-recv" : "";
      tr.innerHTML =
        `<td class="mono">${escapeHtml(r.excelRow ?? "")}</td>` +
        `<td>${escapeHtml(r.a ?? "")}</td>` +
        `<td class="${dirCls} mono">${escapeHtml(dirLabel)}</td>` +
        `<td class="mono">${escapeHtml(r.b ?? "")}</td>` +
        `<td>${escapeHtml(r.d ?? "")}</td>` +
        `<td class="mono">${escapeHtml(r.e ?? "")}</td>` +
        `<td>${escapeHtml(r.f ?? "")}</td>` +
        `<td>${escapeHtml(r.g ?? "")}</td>`;
      excelTbody.appendChild(tr);
    }
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

  btnMoveCmdUp.addEventListener("click", () => void moveSelectedCommand(-1));
  btnMoveCmdDown.addEventListener("click", () => void moveSelectedCommand(1));

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

  async function loadLogDir() {
    if (!isWebView()) {
      logDirPath.textContent = "（仅在桌面应用中可用）";
      return;
    }
    try {
      const { dir } = await apiCall("getLogDir");
      logDirPath.textContent = dir || "—";
      logDirPath.title = dir || "";
    } catch {
      logDirPath.textContent = "—";
    }
  }

  btnOpenLogDir.addEventListener("click", async () => {
    try {
      await apiCall("openLogDir");
    } catch (e) {
      appendLog(`打开日志目录失败: ${e.message}`);
    }
  });

  projectSelect.addEventListener("change", () => {
    selectProject(projectSelect.value);
  });

  excelProjectSelect.addEventListener("change", () => {
    selectProject(excelProjectSelect.value);
  });

  btnImportExcel.addEventListener("click", () => excelFile.click());

  excelFile.addEventListener("change", async () => {
    const f = excelFile.files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const contentBase64 = btoa(binary);

      const { workspace: ws } = await apiCall("importExcel", {
        projectId: normId(workspace.currentProjectId),
        fileName: f.name,
        contentBase64,
      });
      workspace = ws || workspace;
      renderProjectSelect();
      renderProjectTree();
      renderCmdList();
      projectBadge.textContent = currentProject() ? `· ${currentProject().name}` : "";
      renderExcelView();
      appendLog(`[Excel 已导入] ${f.name}`);
    } catch (e) {
      alert(`导入失败: ${e.message}`);
    }
    excelFile.value = "";
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

  function renderAutoReplyRules(rules) {
    autoReplyTbody.innerHTML = "";
    (rules || []).forEach((r) => {
      const tr = document.createElement("tr");
      const cells = [r.name, r.primary, r.reply, r.description];
      cells.forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = text ?? "";
        if (i === 1 || i === 2) td.className = "mono";
        tr.appendChild(td);
      });
      autoReplyTbody.appendChild(tr);
    });
  }

  async function loadAutoReplyRules() {
    if (!isWebView()) return;
    try {
      const res = await apiCall("getAutoReplyRules");
      autoReplyEnabled.checked = res.enabled !== false;
      renderAutoReplyRules(res.rules);
    } catch (e) {
      appendLog(`加载自动应答规则失败: ${e.message}`);
    }
  }

  autoReplyEnabled.addEventListener("change", async () => {
    if (!isWebView()) return;
    try {
      await apiCall("setAutoReply", { enabled: autoReplyEnabled.checked });
      appendLog(`[自动应答] ${autoReplyEnabled.checked ? "已启用" : "已停用"}`);
    } catch (e) {
      appendLog(`设置自动应答失败: ${e.message}`);
    }
  });

  // ---------------- MES 接口测试 ----------------
  const mesMethod = el("mesMethod");
  const mesUrl = el("mesUrl");
  const mesTimeout = el("mesTimeout");
  const mesType = el("mesType");
  const mesSoapFields = el("mesSoapFields");
  const mesSoapMethod = el("mesSoapMethod");
  const mesSoapNs = el("mesSoapNs");
  const mesParams = el("mesParams");
  const btnMesAddParam = el("btnMesAddParam");
  const mesParamHint = el("mesParamHint");
  const mesHeaders = el("mesHeaders");
  const mesBody = el("mesBody");
  const mesBodyLabel = el("mesBodyLabel");
  const btnMesPreview = el("btnMesPreview");
  const btnMesSend = el("btnMesSend");
  const mesStatus = el("mesStatus");
  const mesElapsed = el("mesElapsed");
  const mesParsed = el("mesParsed");
  const mesResp = el("mesResp");
  const mesProjectSelect = el("mesProjectSelect");
  const mesIfaceName = el("mesIfaceName");
  const mesSavedList = el("mesSavedList");
  const btnMesSaveIface = el("btnMesSaveIface");
  const btnMesNewIface = el("btnMesNewIface");
  const btnMesDelIface = el("btnMesDelIface");

  const SOAP_NS_DEFAULT = "http://tempuri.org/";
  let mesSelectedIfaceId = null;

  function addMesParamRow(key = "", value = "") {
    if (!mesParams) return;
    const row = document.createElement("div");
    row.className = "mes-kv-row";
    row.innerHTML =
      `<input type="text" class="inp-tiny mes-kv-key" placeholder="参数名" />` +
      `<input type="text" class="inp-tiny grow mes-kv-val" placeholder="参数值" />` +
      `<button type="button" class="btn icon danger mes-kv-del" title="删除">✕</button>`;
    row.querySelector(".mes-kv-key").value = key;
    row.querySelector(".mes-kv-val").value = value;
    row.querySelector(".mes-kv-del").addEventListener("click", () => row.remove());
    mesParams.appendChild(row);
  }

  function collectMesParams() {
    if (!mesParams) return [];
    return [...mesParams.querySelectorAll(".mes-kv-row")]
      .map((r) => ({
        key: r.querySelector(".mes-kv-key").value.trim(),
        value: r.querySelector(".mes-kv-val").value,
      }))
      .filter((p) => p.key);
  }

  function parseHeaderLines(text) {
    return String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(":");
        if (i < 0) return { key: l, value: "" };
        return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      })
      .filter((h) => h.key);
  }

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildSoapEnvelope(methodName, ns, params) {
    const inner = params
      .map((p) => `      <${p.key}>${xmlEscape(p.value)}</${p.key}>`)
      .join("\n");
    const bodyInner = inner ? `\n${inner}\n    ` : "";
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${methodName} xmlns="${ns}">${bodyInner}</${methodName}>
  </soap:Body>
</soap:Envelope>`;
  }

  // 用 {参数名} 占位替换手写请求体
  function substituteParams(body, params) {
    let out = String(body || "");
    for (const p of params) {
      out = out.replace(new RegExp(`\\{${p.key}\\}`, "g"), p.value);
    }
    return out;
  }

  function findHeader(headers, key) {
    return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
  }

  // 返回 { body, headers, contentType, resultTag, parseMode, queryParams }
  function buildMesRequest() {
    const params = collectMesParams();
    const headers = parseHeaderLines(mesHeaders.value);
    const isGet = mesMethod.value === "GET";
    const type = mesType.value;

    // SOAP：仅 POST 时自动拼信封；GET 时退化为普通 HTTP
    if (type === "soap" && !isGet) {
      const methodName = (mesSoapMethod.value || "").trim();
      if (!methodName) throw new Error("请填写 SOAP 接口名");
      const ns = (mesSoapNs.value || "").trim() || SOAP_NS_DEFAULT;
      const body = buildSoapEnvelope(methodName, ns, params);
      if (!headers.some((h) => h.key.toLowerCase() === "soapaction")) {
        headers.push({ key: "SOAPAction", value: ns.replace(/\/$/, "/") + methodName });
      }
      const contentType = findHeader(headers, "Content-Type") || "text/xml; charset=utf-8";
      return { body, headers, contentType, resultTag: `${methodName}Result`, parseMode: "soap", queryParams: [] };
    }

    // REST(JSON)：POST 时参数自动转 JSON（无参数则用手写请求体），返回按 JSON 解析
    if (type === "rest") {
      if (!headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.push({ key: "Content-Type", value: "application/json" });
      }
      const contentType = findHeader(headers, "Content-Type") || "application/json";
      let body = "";
      if (!isGet) {
        body = params.length
          ? JSON.stringify(Object.fromEntries(params.map((p) => [p.key, p.value])), null, 2)
          : substituteParams(mesBody.value, params);
      }
      return { body, headers, contentType, resultTag: "", parseMode: "json", queryParams: isGet ? params : [] };
    }

    // 普通 HTTP / 表单：GET 拼 query，POST 走表单编码（无参数则用手写请求体），不解析
    const contentType = findHeader(headers, "Content-Type") || "application/x-www-form-urlencoded";
    let body = "";
    if (!isGet) {
      body = params.length
        ? params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&")
        : substituteParams(mesBody.value, params);
    }
    return { body, headers, contentType, resultTag: "", parseMode: "none", queryParams: isGet ? params : [] };
  }

  function updateMesModeUi() {
    const type = mesType.value;
    const isGet = mesMethod.value === "GET";
    const soapActive = type === "soap" && !isGet;
    // 自动转换请求体（SOAP 拼信封 / REST 参数转 JSON / 表单编码）时禁用手写框
    const autoBody = soapActive || (type !== "http" && !isGet && collectMesParams().length > 0);

    if (mesSoapFields) mesSoapFields.style.display = soapActive ? "flex" : "none";
    if (mesBodyLabel) mesBodyLabel.style.opacity = autoBody ? "0.5" : "1";
    if (mesBody) mesBody.disabled = autoBody;

    if (mesParamHint) {
      if (isGet) mesParamHint.textContent = "GET：作为查询字符串拼接到 URL";
      else if (type === "soap") mesParamHint.textContent = "SOAP：作为方法入参";
      else if (type === "rest") mesParamHint.textContent = "REST：自动序列化为 JSON（留空则用手写请求体）";
      else mesParamHint.textContent = "普通 HTTP：POST 时按表单 key=value 编码";
    }
  }

  function setMesStatus(state, text) {
    if (!mesStatus) return;
    mesStatus.dataset.state = state;
    mesStatus.textContent = text;
  }

  btnMesAddParam?.addEventListener("click", () => {
    addMesParamRow();
    updateMesModeUi();
  });
  mesType?.addEventListener("change", updateMesModeUi);
  mesMethod?.addEventListener("change", updateMesModeUi);
  // 参数增删会影响 REST/表单是否自动生成请求体
  mesParams?.addEventListener("input", updateMesModeUi);
  mesParams?.addEventListener("click", (e) => {
    if (e.target.classList?.contains("mes-kv-del")) setTimeout(updateMesModeUi, 0);
  });

  btnMesPreview?.addEventListener("click", () => {
    try {
      const req = buildMesRequest();
      const headerText = req.headers.map((h) => `${h.key}: ${h.value}`).join("\n");
      const qText = req.queryParams?.length ? `\n[Query] ${req.queryParams.map((p) => `${p.key}=${p.value}`).join("&")}` : "";
      mesResp.textContent = `[${mesMethod.value}] ${mesUrl.value.trim()}${qText}\n\n[Headers]\n${headerText}\n\n[Body]\n${req.body || "(无)"}`;
      mesParsed.textContent = "—";
      setMesStatus("warn", "预览（未发送）");
    } catch (e) {
      alert(e.message);
    }
  });

  btnMesSend?.addEventListener("click", async () => {
    const url = mesUrl.value.trim();
    if (!url) {
      alert("请填写 URL");
      return;
    }
    let req;
    try {
      req = buildMesRequest();
    } catch (e) {
      alert(e.message);
      return;
    }
    btnMesSend.disabled = true;
    setMesStatus("warn", "请求中…");
    mesElapsed.textContent = "";
    mesParsed.textContent = "—";
    mesResp.textContent = "请求中…";
    try {
      const r = await apiCall("mesRequest", {
        httpMethod: mesMethod.value,
        url,
        headers: req.headers,
        queryParams: req.queryParams,
        body: req.body,
        contentType: req.contentType,
        timeoutSec: Number(mesTimeout.value) || 10,
        resultTag: req.resultTag,
        parseMode: req.parseMode,
      });
      setMesStatus(r.ok ? "on" : "warn", `HTTP ${r.status}`);
      mesElapsed.textContent = r.elapsedMs != null ? `${r.elapsedMs} ms` : "";
      mesResp.textContent = r.body || "(空响应)";
      if (req.parseMode === "none") mesParsed.textContent = "（普通 HTTP：不解析，见下方原文）";
      else if (r.parsed != null && r.parsed !== "") mesParsed.textContent = r.parsed;
      else if (r.parseError) mesParsed.textContent = `（无法解析：${r.parseError}）`;
      else mesParsed.textContent = req.parseMode === "json" ? "（未找到 resultData/result 字段）" : "（未找到 Result 节点）";
      appendLog(`[MES] ${mesMethod.value} ${url} -> HTTP ${r.status}`);
    } catch (e) {
      setMesStatus("off", "请求失败");
      mesResp.textContent = `请求失败: ${e.message}`;
      appendLog(`[MES] 请求失败: ${e.message}`);
    } finally {
      btnMesSend.disabled = false;
    }
  });

  // ---- 已保存接口（按项目） ----
  function currentMesInterfaces() {
    const p = currentProject();
    if (!p) return [];
    if (!Array.isArray(p.mesInterfaces)) p.mesInterfaces = [];
    return p.mesInterfaces;
  }

  function clearMesParams() {
    if (mesParams) mesParams.innerHTML = "";
  }

  function ifaceTypeLabel(t) {
    return t === "rest" ? "REST" : t === "http" ? "HTTP" : "SOAP";
  }

  function updateMesIfaceButtons() {
    const has = !!mesSelectedIfaceId && currentMesInterfaces().some((f) => normId(f.id) === normId(mesSelectedIfaceId));
    if (btnMesDelIface) btnMesDelIface.disabled = !has;
  }

  function renderMesSavedList() {
    if (!mesSavedList) return;
    mesSavedList.innerHTML = "";
    const list = currentMesInterfaces();
    if (list.length === 0) {
      const li = document.createElement("li");
      li.className = "mes-saved-empty";
      li.textContent = "该项目暂无已保存接口";
      mesSavedList.appendChild(li);
      updateMesIfaceButtons();
      return;
    }
    list.forEach((f) => {
      const id = normId(f.id);
      const li = document.createElement("li");
      li.dataset.id = id;
      if (id === normId(mesSelectedIfaceId)) li.classList.add("active");
      li.innerHTML =
        `<div class="cmd-name">${escapeHtml(f.name || "未命名接口")}</div>` +
        `<div class="cmd-sub">${escapeHtml(`${f.httpMethod || "POST"} ${f.url || ""}`)}</div>` +
        `<span class="cmd-tag">${escapeHtml(ifaceTypeLabel(f.type))}</span>`;
      li.addEventListener("click", () => selectMesInterface(id));
      mesSavedList.appendChild(li);
    });
    updateMesIfaceButtons();
  }

  function loadInterfaceToForm(f) {
    mesType.value = f.type || "soap";
    mesMethod.value = f.httpMethod || "POST";
    mesUrl.value = f.url || "";
    mesTimeout.value = f.timeoutSec || 10;
    mesSoapMethod.value = f.soapMethod || "";
    mesSoapNs.value = f.soapNamespace || "";
    mesHeaders.value = f.headers || "";
    mesBody.value = f.body || "";
    mesIfaceName.value = f.name || "";
    clearMesParams();
    (f.params || []).forEach((p) => addMesParamRow(p.key, p.value));
    if ((f.params || []).length === 0) addMesParamRow();
    updateMesModeUi();
  }

  function selectMesInterface(id) {
    const f = currentMesInterfaces().find((x) => normId(x.id) === normId(id));
    if (!f) return;
    mesSelectedIfaceId = id;
    loadInterfaceToForm(f);
    renderMesSavedList();
  }

  function readFormAsInterface() {
    return {
      type: mesType.value,
      httpMethod: mesMethod.value,
      url: mesUrl.value.trim(),
      timeoutSec: Number(mesTimeout.value) || 10,
      soapMethod: mesSoapMethod.value.trim(),
      soapNamespace: mesSoapNs.value.trim(),
      params: collectMesParams(),
      headers: mesHeaders.value,
      body: mesBody.value,
    };
  }

  function newMesInterface() {
    mesSelectedIfaceId = null;
    mesIfaceName.value = "";
    mesType.value = "soap";
    mesMethod.value = "POST";
    mesUrl.value = "";
    mesTimeout.value = 10;
    mesSoapMethod.value = "";
    mesSoapNs.value = "";
    mesHeaders.value = "";
    mesBody.value = "";
    clearMesParams();
    addMesParamRow("waferid", "");
    updateMesModeUi();
    renderMesSavedList();
  }

  btnMesSaveIface?.addEventListener("click", async () => {
    const nm = mesIfaceName.value.trim();
    if (!nm) {
      alert("请填写接口名称");
      return;
    }
    const list = currentMesInterfaces();
    const data = readFormAsInterface();
    let target = list.find((x) => normId(x.id) === normId(mesSelectedIfaceId));
    let created = false;
    if (target) {
      Object.assign(target, data, { name: nm });
    } else {
      target = { id: crypto.randomUUID(), name: nm, ...data };
      list.push(target);
      created = true;
    }
    try {
      await persistWorkspace();
      mesSelectedIfaceId = target.id;
      renderMesSavedList();
      appendLog(`[MES] 接口已${created ? "保存" : "更新"}: ${nm}`);
    } catch (e) {
      if (created) list.pop();
      alert(`保存失败: ${e.message}`);
    }
  });

  btnMesNewIface?.addEventListener("click", newMesInterface);

  btnMesDelIface?.addEventListener("click", async () => {
    const list = currentMesInterfaces();
    const idx = list.findIndex((x) => normId(x.id) === normId(mesSelectedIfaceId));
    if (idx < 0) return;
    const f = list[idx];
    if (!confirm(`删除接口「${f.name || "未命名"}」？`)) return;
    const [removed] = list.splice(idx, 1);
    mesSelectedIfaceId = null;
    try {
      await persistWorkspace();
      renderMesSavedList();
      appendLog(`[MES] 接口已删除: ${f.name || "未命名"}`);
    } catch (e) {
      list.splice(idx, 0, removed);
      alert(`删除失败: ${e.message}`);
    }
  });

  mesProjectSelect?.addEventListener("change", () => {
    selectProject(mesProjectSelect.value);
  });

  function mesInit() {
    if (!mesParams) return;
    if (mesParams.children.length === 0) addMesParamRow("waferid", "");
    updateMesModeUi();
    renderMesSavedList();
  }

  async function boot() {
    if (!isWebView()) {
      appendLog("提示: 在 WebView2 宿主中运行以使用完整功能。");
    }
    void loadLogDir();
    void loadAutoReplyRules();
    mesInit();
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
      renderExcelView();
      renderMesSavedList();
      updateDispConnectionFields();
      updateStatsUi();
    } catch (e) {
      appendLog(`加载工作区失败: ${e.message}`);
    }
  }

  boot();
})();

(function () {
  "use strict";

  const config = JSON.parse(document.getElementById("workspace-template").textContent);
  const app = document.getElementById("app");
  const toastNode = document.getElementById("toast");
  let state = null;
  let route = parseRoute();
  let saveStatus = { type: "ok", label: "本地模式" };
  let currentModal = null;
  let pendingImport = null;
  let query = "";
  let filter = "全部";
  let draggedNav = "";
  let draggedAsset = "";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dateText = (value) => value ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`)) : "未设置日期";
  const moduleById = (id) => config.modules.find((module) => module.id === id);
  const currentModule = () => moduleById(route);
  const label = (key, fallback) => state?.appearance?.labels?.[key] || fallback;
  const styleText = (key) => {
    const style = state?.appearance?.textStyles?.[key] || {};
    return Object.entries(style).map(([name, value]) => `${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}`).join(";");
  };
  const editAttr = (key) => `data-edit-key="${esc(key)}" style="${esc(styleText(key))}"`;

  function applyTheme() {
    const theme = config.theme;
    const root = document.documentElement;
    const mapping = { bg: "--bg", surface: "--surface", surfaceSoft: "--surface-soft", ink: "--ink", muted: "--muted", accent: "--accent", accentStrong: "--accent-strong", success: "--success", warning: "--warning", border: "--border", radius: "--radius", displayFont: "--display-font", bodyFont: "--body-font" };
    Object.entries(mapping).forEach(([key, cssVar]) => root.style.setProperty(cssVar, theme[key]));
    document.body.dataset.template = config.templateId;
    document.title = state?.profile?.title || config.profile.title;
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, "");
    return raw || "home";
  }

  function navigate(next) {
    if (!moduleById(next) && !["home", "setup"].includes(next)) next = config.home.primaryAction.route;
    location.hash = next === "home" ? "home" : next;
    if (location.hash === `#${next}`) {
      route = next;
      render();
    }
  }

  function toast(message) {
    toastNode.textContent = message;
    toastNode.classList.add("show");
    clearTimeout(toastNode._timer);
    toastNode._timer = setTimeout(() => toastNode.classList.remove("show"), 2800);
  }

  function updateSaveBadge() {
    document.querySelectorAll("[data-save-state]").forEach((node) => {
      node.className = `save-state ${saveStatus.type === "error" ? "error" : ""}`;
      node.innerHTML = `<span class="save-dot"></span><span>${esc(saveStatus.label)}</span>`;
    });
  }

  async function save(message) {
    saveStatus = { type: "ok", label: "正在保存…" };
    updateSaveBadge();
    try {
      const result = await WorkspaceStore.save(state);
      saveStatus = result.persistent ? { type: "ok", label: "已保存到本机" } : { type: "error", label: "临时模式：浏览器未提供 IndexedDB" };
      if (message) toast(result.persistent ? message : "暂存于本次会话，请导出备份");
      return result.persistent;
    } catch (error) {
      saveStatus = { type: "error", label: "保存失败" };
      toast(`保存失败：${error.message || "请立即导出备份"}`);
      return false;
    } finally { updateSaveBadge(); }
  }

  function visibleModules() {
    const hidden = new Set(state.navigation.hidden || []);
    return state.navigation.order.map(moduleById).filter((module) => module && !hidden.has(module.id));
  }

  function groupedModules() {
    const groups = new Map();
    visibleModules().filter(m=>!["settings","archive"].includes(m.id)).forEach((module) => {
      if (!groups.has(module.group)) groups.set(module.group, []);
      groups.get(module.group).push(module);
    });
    return groups;
  }

  function moduleLabel(module) { return label(`module.${module.id}.label`, module.label); }
  function moduleDescription(module) { return label(`module.${module.id}.description`, module.description); }

  function icon(name) {
    const paths = {
      home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      edit: '<path d="m4 20 4.5-1 10-10a2 2 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/>',
      trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      backup: '<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/>',
      collapse: '<path d="m14 6-6 6 6 6"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1"/>'
    };
    return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.home}</svg>`;
  }

  function imageCards(pageId) {
    const assets = state.assets.filter((asset) => asset.pageId === pageId);
    if (!assets.length && !WorkspaceEditor.isEditing()) return "";
    const emptyHint = WorkspaceEditor.isEditing() && !assets.length ? `<div class="image-slot-hint">把图片拖到这里，或用顶部“＋ 图片”插入</div>` : "";
    return `<section class="image-grid image-slot" data-image-slot="${esc(pageId)}" aria-label="图片卡片">${emptyHint}${assets.map((asset) => `<article class="image-card size-${esc(asset.size || "m")}" draggable="${WorkspaceEditor.isEditing()}" data-asset-id="${esc(asset.id)}"><img src="${esc(asset.src)}" alt="${esc(asset.alt || "用户插入的图片")}">${WorkspaceEditor.isEditing() ? `<div class="image-card-actions"><button data-action="image-size" data-id="${esc(asset.id)}" data-size="s">小</button><button data-action="image-size" data-id="${esc(asset.id)}" data-size="m">中</button><button data-action="image-size" data-id="${esc(asset.id)}" data-size="l">大</button><label>换<input class="visually-hidden" type="file" accept="image/*" data-image-replace="${esc(asset.id)}"></label><button data-action="image-remove" data-id="${esc(asset.id)}">删</button></div>` : ""}</article>`).join("")}</section>`;
  }

  function optionalAction(id, html) {
    if (state.appearance.hiddenActions.includes(id)) return "";
    return `<span class="optional-action" data-optional-action="${esc(id)}">${html}${WorkspaceEditor.isEditing() ? `<button class="optional-hide" data-action="hide-action" data-action-id="${esc(id)}" title="隐藏这个可选按钮">隐藏</button>` : ""}</span>`;
  }

  function renderHome() {
    const ownerTitle = label("profile.title", state.profile.title);
    const headline = label("home.headline", config.home.headline);
    const [first, ...rest] = headline.split(/[，,]/);
    const renderedHeadline = rest.length ? `${esc(first)}，<span>${esc(rest.join("，"))}</span>` : `<span>${esc(headline)}</span>`;
    return `${WorkspaceEditor.toolbar()}<div class="home-page"><nav class="home-nav" aria-label="首页导航"><button class="home-brand" data-action="home"><span class="brand-mark">${esc(Array.from(state.profile.ownerName || "我")[0])}</span><span ${editAttr("profile.title")}>${esc(ownerTitle)}</span></button><a class="home-nav-link" href="#${esc(config.home.primaryAction.route)}">今日</a><a class="home-nav-link" href="#${esc(config.home.secondaryAction.route)}">进步计划</a><button class="button small" data-action="edit-mode">${icon("edit")} 编辑</button></nav><main class="home-hero" id="main-content"><section class="hero-copy"><span class="eyebrow" ${editAttr("home.eyebrow")}>${esc(label("home.eyebrow", config.home.eyebrow))}</span><h1 ${editAttr("home.headline")}>${renderedHeadline}</h1><p ${editAttr("home.description")}>${esc(label("home.description", config.home.description))}</p><div class="hero-date">${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</div><div class="hero-actions"><button class="button primary" data-action="go" data-route="${esc(config.home.primaryAction.route)}"><span ${editAttr("home.primaryAction")}>${esc(label("home.primaryAction", config.home.primaryAction.label))}</span> →</button>${optionalAction("home.secondary", `<button class="button" data-action="go" data-route="${esc(config.home.secondaryAction.route)}"><span ${editAttr("home.secondaryAction")}>${esc(label("home.secondaryAction", config.home.secondaryAction.label))}</span></button>`)}</div><div class="home-footnote">数据保存在当前浏览器 · 可随时导出 JSON</div>${imageCards("home")}</section></main></div>`;
  }

  function renderSidebar() {
    const groups = groupedModules();
    return `<aside class="sidebar" id="sidebar"><div class="sidebar-head"><button class="sidebar-brand" data-action="home"><span class="brand-mark">${esc(Array.from(state.profile.ownerName || "我")[0])}</span><span class="sidebar-brand-copy"><strong>${esc(state.profile.ownerName)}</strong><small>${esc(state.profile.scene)}</small></span></button><button class="button icon small sidebar-toggle" data-action="sidebar-toggle" aria-label="收起或展开边栏">${icon("collapse")}</button></div>${Array.from(groups.entries()).map(([group, modules]) => `<section class="nav-group"><span class="nav-label">${esc(group)}</span><nav class="sidebar-nav" aria-label="${esc(group)}">${modules.map((module) => `<button class="nav-item ${route === module.id ? "active" : ""}" data-action="go" data-route="${esc(module.id)}" data-nav-id="${esc(module.id)}" draggable="${WorkspaceEditor.isEditing()}" title="${WorkspaceEditor.isEditing() ? "拖动调整顺序" : moduleLabel(module)}"><span class="nav-icon">${esc(moduleLabel(module).slice(0, 1))}</span><span class="nav-copy" ${editAttr(`module.${module.id}.label`)}>${esc(moduleLabel(module))}</span></button>`).join("")}</nav></section>`).join("")}<footer class="sidebar-footer"><div class="save-state" data-save-state></div><div class="side-utilities"><button class="utility" data-action="go" data-route="settings" title="设置" aria-label="设置">设</button><button class="utility" data-action="go" data-route="archive" title="导出记录" aria-label="导出记录">存</button></div></footer></aside>`;
  }

  function renderShell(content) {
    return `${WorkspaceEditor.toolbar()}<div class="app-shell ${state.appearance.sidebarCollapsed ? "collapsed" : ""}">${renderSidebar()}<section class="app-main"><header class="topbar"><div class="breadcrumb"><button class="button icon small mobile-menu" data-action="mobile-menu" aria-label="打开菜单">${icon("menu")}</button> ${esc(state.profile.scene)} / <strong>${esc(moduleLabel(currentModule() || config.modules[0]))}</strong></div><div class="top-actions"><button class="button small" data-action="edit-mode">${icon("edit")} 编辑</button></div></header><main id="main-content">${content}</main></section></div>`;
  }

  function recordsFor(module) { return Array.isArray(state.data[module.collection]) ? state.data[module.collection] : []; }
  function recordSummary(record) { return record.note || record.description || record.source || record.course || record.owner || record.tags || record.url || ""; }
  function recordStatus(record) { return record.status || record.priority || record.period || "本地记录"; }
  function isDone(record) { return ["已完成", "已处理", "已传达", "已归档"].includes(record.status); }

  function recordRows(module, records) {
    if (!records.length) return `<div class="empty"><div><strong>这里还没有内容。</strong><br><span>点击“新增”写下第一条记录。</span></div></div>`;
    return `<div class="list">${records.map((record) => `<article class="record"><div class="record-main"><strong class="record-title">${esc(record.title || "未命名记录")}</strong><span class="record-copy">${esc(recordSummary(record))}</span></div><div class="record-meta"><span class="tag ${isDone(record) ? "success" : record.priority === "紧急" || record.priority === "高" ? "warning" : ""}">${esc(recordStatus(record))}</span>${record.dueDate ? `<span class="tag">${esc(dateText(record.dueDate))}</span>` : ""}<span class="record-actions">${module.fields.some((field) => field.key === "status") ? `<button class="button icon small" data-action="toggle-record" data-module="${esc(module.id)}" data-id="${esc(record.id)}" aria-label="切换完成状态">${icon("check")}</button>` : ""}<button class="button icon small" data-action="edit-record" data-module="${esc(module.id)}" data-id="${esc(record.id)}" aria-label="编辑">${icon("edit")}</button><button class="button icon small danger" data-action="delete-record" data-module="${esc(module.id)}" data-id="${esc(record.id)}" aria-label="删除">${icon("trash")}</button></span></div></article>`).join("")}</div>`;
  }

  function moduleEditHandle(module) {
    if (!WorkspaceEditor.isEditing() || module.protected) return "";
    return `<div class="module-edit-handle"><button class="button small" data-action="hide-module" data-module="${esc(module.id)}">隐藏模块</button></div>`;
  }

  function pageHeading(module, actions) {
    return `<header class="page-heading" data-module-id="${esc(module.id)}">${moduleEditHandle(module)}<div><span class="eyebrow">${esc(module.group)}</span><h1 ${editAttr(`module.${module.id}.label`)}>${esc(moduleLabel(module))}</h1><p ${editAttr(`module.${module.id}.description`)}>${esc(moduleDescription(module))}</p></div><div class="page-actions">${actions || ""}</div></header>`;
  }

  function renderToday(module) {
    const records = recordsFor(module);
    const all = Object.values(state.data).flatMap((items) => Array.isArray(items) ? items : []);
    const dueToday = all.filter((item) => item.dueDate === today() && !isDone(item)).length;
    const done = records.filter(isDone).length;
    const active = records.length - done;
    const recent = [...all].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 5);
    const addAction = optionalAction(`module.${module.id}.new`, `<button class="button primary" data-action="new-record" data-module="${esc(module.id)}">${icon("plus")} 新增事项</button>`);
    return `${pageHeading(module, addAction)}<section class="grid three"><article class="card summary-card soft"><span class="summary-label">今天到期</span><div class="summary-value">${dueToday}</div></article><article class="card summary-card"><span class="summary-label">正在推进</span><div class="summary-value">${active}</div></article><article class="card summary-card"><span class="summary-label">已经完成</span><div class="summary-value">${done}</div></article></section><section class="grid two section-gap"><article class="card"><div class="split"><h2>今日重点</h2><span class="tag">${records.length} 条</span></div>${recordRows(module, records.slice(0, 5))}</article><article class="card"><div class="split"><h2>最近更新</h2><span class="tag">全进步计划</span></div>${recent.length ? `<div class="list">${recent.map((item) => `<div class="record"><div class="record-main"><strong class="record-title">${esc(item.title || "未命名")}</strong><span class="record-copy">${esc(recordSummary(item))}</span></div><span class="tag">${esc(recordStatus(item))}</span></div>`).join("")}</div>` : `<div class="empty">还没有更新。</div>`}</article></section>${imageCards(module.id)}`;
  }

  function renderModule(module) {
    if (module.archive) return renderArchive(module);
    const records = recordsFor(module).filter((record) => {
      const matchesQuery = !query || JSON.stringify(record).toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === "全部" || record.status === filter || record.priority === filter;
      return matchesQuery && matchesFilter;
    });
    const statusField = module.fields.find((field) => field.key === "status" || field.key === "priority");
    const addAction = optionalAction(`module.${module.id}.new`, `<button class="button primary" data-action="new-record" data-module="${esc(module.id)}">${icon("plus")} 新增</button>`);
    return `${pageHeading(module, addAction)}<section class="card"><div class="toolbar-row"><label class="visually-hidden" for="workspace-search">搜索</label><input id="workspace-search" class="field search" data-search placeholder="搜索当前模块" value="${esc(query)}">${statusField ? `<select class="select" data-filter aria-label="筛选"><option>全部</option>${statusField.options.map((option) => `<option ${filter === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>` : ""}<span class="tag">${records.length} 条</span></div>${recordRows(module, records)}</section>${imageCards(module.id)}`;
  }

  function renderArchive(module) {
    return `${pageHeading(module,'')}<section class="card"><h2>导出记录</h2><p>下载备份，保留目标、行动、复盘与布局。</p><button class="button primary" data-action="backup-export">导出记录</button><p class="muted">记录保存在当前浏览器。换设备或清理浏览器前，请先导出。</p></section><section class="card section-gap"><h2>恢复记录</h2><p>导入前会先展示摘要，由你选择合并或恢复。</p><label class="button">导入记录<input class="visually-hidden" type="file" accept="application/json,.json" data-backup-file></label><button class="button" data-action="snapshots">查看恢复快照</button></section>`;
  }

  function render() {
    applyTheme();
    if (route === "home") app.innerHTML = ProgressWorkbench.home();
    else if (route === "setup" || !state.profile.onboarded) app.innerHTML = ProgressWorkbench.setup();
    else {
      const module = currentModule() || moduleById(config.home.primaryAction.route);
      if (state.navigation.hidden.includes(module.id)) route = config.home.primaryAction.route;
      const content = ProgressWorkbench.view(module.id) ?? (module.summary ? renderToday(module) : renderModule(module));
      app.innerHTML = renderShell(content);
      if (!document.querySelector("[data-image-slot]")) document.getElementById("main-content").insertAdjacentHTML("beforeend", imageCards(module.id));
    }
    app.setAttribute("aria-busy", "false");
    applyTextStyles();
    WorkspaceEditor.afterRender();
    updateSaveBadge();
  }

  function applyTextStyles() {
    Object.entries(state.appearance.textStyles || {}).forEach(([key, styles]) => {
      document.querySelectorAll(`[data-edit-key="${globalThis.CSS?.escape ? CSS.escape(key) : key}"]`).forEach((node) => Object.assign(node.style, styles));
    });
  }

  function fieldControl(field, value) {
    const common = `name="${esc(field.key)}" ${field.required ? "required" : ""}`;
    if (field.type === "textarea") return `<textarea class="textarea" ${common}>${esc(value || "")}</textarea>`;
    if (field.type === "select") return `<select class="select" ${common}>${field.options.map((option) => `<option ${value === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>`;
    return `<input class="field" type="${esc(field.type || "text")}" ${common} value="${esc(value || "")}" ${field.type === "number" ? "min=\"1\" max=\"1440\" step=\"1\"" : ""}>`;
  }

  function openRecordModal(moduleId, recordId) {
    const module = moduleById(moduleId);
    const record = recordId ? recordsFor(module).find((item) => item.id === recordId) : null;
    const title = record ? `编辑${moduleLabel(module)}` : `新增${moduleLabel(module)}`;
    openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="record-modal-title"><header class="modal-head"><div><span class="eyebrow">LOCAL RECORD</span><h2 id="record-modal-title">${esc(title)}</h2><p>保存后会立即写入当前浏览器。</p></div><button class="button icon" data-action="modal-close" aria-label="关闭">×</button></header><form class="form-grid two" data-record-form data-module="${esc(moduleId)}" data-id="${esc(recordId || "")}">${module.fields.map((field) => `<label class="field-label ${field.type === "textarea" ? "wide" : ""}"><span>${esc(field.label)}${field.required ? " *" : ""}</span>${fieldControl(field, record?.[field.key])}</label>`).join("")}<div class="modal-actions wide"><button class="button" type="button" data-action="modal-close">取消</button><button class="button primary" type="submit">保存</button></div></form></section>`);
  }

  function openModal(content) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = content;
    backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeModal(); });
    document.body.appendChild(backdrop);
    currentModal = backdrop;
    backdrop.querySelector("input, textarea, select, button")?.focus();
  }

  function closeModal() { currentModal?.remove(); currentModal = null; pendingImport = null; }

  async function submitRecord(form) {
    const module = moduleById(form.dataset.module);
    const values = Object.fromEntries(new FormData(form).entries());
    if(module.id === "tasks" && (!values.title.trim() || (values.minutes && (!Number.isInteger(Number(values.minutes)) || Number(values.minutes)<1 || Number(values.minutes)>1440)))) return toast("请填写行动，预计用时为 1–1440 分钟");
    const now = new Date().toISOString();
    if (!state.data[module.collection]) state.data[module.collection] = [];
    const existing = form.dataset.id ? state.data[module.collection].find((item) => item.id === form.dataset.id) : null;
    if (module.id === "tasks") values.completedAt = values.status === "已完成" ? (existing?.completedAt || today()) : "";
    if (existing) Object.assign(existing, values, { updatedAt: now });
    else state.data[module.collection].unshift({ ...values, id: uid(module.collection), createdAt: now, updatedAt: now });
    closeModal();
    render();
    await save(existing ? "记录已更新" : "记录已保存");
  }

  async function deleteRecord(moduleId, id) {
    const module = moduleById(moduleId);
    const record = recordsFor(module).find((item) => item.id === id);
    if (!record || !confirm(`确定删除“${record.title || "这条记录"}”吗？此操作可以通过 JSON 备份恢复。`)) return;
    state.data[module.collection] = recordsFor(module).filter((item) => item.id !== id);
    render();
    await save("记录已删除");
  }

  async function toggleRecord(moduleId, id) {
    const module = moduleById(moduleId);
    const record = recordsFor(module).find((item) => item.id === id);
    if (!record) return;
    const statusField = module.fields.find((field) => field.key === "status");
    const options = statusField?.options || ["待处理", "已完成"];
    const completedValue = options.at(-1) || "已完成";
    const completed = record.status === completedValue || isDone(record);
    record.status = completed ? (options[0] || "待处理") : completedValue;
    record.completedAt = completed ? "" : today();
    record.updatedAt = new Date().toISOString();
    render();
    await save(completed ? "已恢复为未完成" : "已标记完成");
  }

  function openImportPreview(pkg) {
    const incoming = WorkspaceBackup.packageToState(pkg, config);
    const incomingSummary = WorkspaceBackup.summary(incoming);
    const currentSummary = WorkspaceBackup.summary(state);
    pendingImport = incoming;
    const collections = Array.from(new Set([...Object.keys(currentSummary.collections), ...Object.keys(incomingSummary.collections)])).slice(0, 9);
    openModal(`<section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="import-title"><header class="modal-head"><div><span class="eyebrow">IMPORT PREVIEW</span><h2 id="import-title">确认要导入的备份</h2><p>${esc(pkg.templateId)} · 数据版本 ${esc(pkg.schemaVersion)} · ${esc(pkg.exportedAt.slice(0, 10))}</p></div><button class="button icon" data-action="modal-close" aria-label="关闭">×</button></header><div class="import-summary">${collections.map((key) => `<article><span>${esc(moduleLabel(config.modules.find((module) => module.collection === key) || { id: key, label: key }))}</span><strong>${incomingSummary.collections[key] || 0}</strong><small>当前 ${currentSummary.collections[key] || 0}</small></article>`).join("")}<article><span>图片</span><strong>${incomingSummary.assets}</strong><small>当前 ${currentSummary.assets}</small></article></div><div class="import-modes"><button class="import-mode" data-action="import-apply" data-mode="merge"><span class="tag success">推荐</span><strong>合并导入</strong><p>保留当前姓名、外观、导航和模块；相同 ID 使用备份记录，其余记录合并保留。</p></button><button class="import-mode" data-action="import-apply" data-mode="replace"><span class="tag warning">完整恢复</span><strong>覆盖当前进步计划</strong><p>先创建恢复快照，再用备份中的设置和数据替换当前进步计划。</p></button></div><footer class="modal-actions"><button class="button" data-action="modal-close">取消</button></footer></section>`);
    pendingImport = incoming;
  }

  async function applyImport(mode) {
    if (!pendingImport) return;
    const incoming = pendingImport;
    if (mode === "replace") await WorkspaceStore.createSnapshot(state, "完整恢复前自动快照");
    state = mode === "merge" ? WorkspaceBackup.merge(state, incoming) : incoming;
    closeModal();
    render();
    await save(mode === "merge" ? "备份数据已合并" : "进步计划已完整恢复");
  }

  async function openSnapshots() {
    const snapshots = await WorkspaceStore.listSnapshots();
    openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="snapshot-title"><header class="modal-head"><div><span class="eyebrow">RECOVERY</span><h2 id="snapshot-title">恢复快照</h2><p>完整恢复前自动保存，最多 5 份。</p></div><button class="button icon" data-action="modal-close">×</button></header>${snapshots.length ? `<div class="list">${snapshots.map((item) => `<div class="record"><div class="record-main"><strong class="record-title">${esc(item.reason)}</strong><span class="record-copy">${esc(new Date(item.createdAt).toLocaleString("zh-CN"))}</span></div><button class="button small" data-action="snapshot-restore" data-id="${esc(item.id)}">恢复</button></div>`).join("")}</div>` : `<div class="empty">还没有恢复快照。</div>`}<footer class="modal-actions"><button class="button" data-action="modal-close">关闭</button></footer></section>`);
  }

  async function restoreSnapshot(id) {
    if (!confirm("恢复这个快照会替换当前进步计划，是否继续？")) return;
    try {
      state = await WorkspaceStore.restoreSnapshot(id);
      closeModal();
      render();
      toast("快照已恢复");
    } catch (error) { toast(error.message || "恢复失败"); }
  }

  function openHiddenModules() {
    const hidden = state.navigation.hidden.map(moduleById).filter(Boolean);
    const actionLabels = new Map([["home.secondary", "首页：第二个入口按钮"]]);
    config.modules.forEach((module) => actionLabels.set(`module.${module.id}.new`, `${moduleLabel(module)}：新增按钮`));
    const hiddenActions = state.appearance.hiddenActions || [];
    openModal(`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="hidden-title"><header class="modal-head"><div><span class="eyebrow">HIDDEN CONTENT</span><h2 id="hidden-title">已隐藏内容</h2><p>隐藏不会删除记录，恢复后内容会重新出现。备份与恢复等核心入口不能隐藏。</p></div><button class="button icon" data-action="modal-close">×</button></header>${hidden.length || hiddenActions.length ? `<div class="hidden-list">${hidden.map((module) => `<div class="hidden-row"><span>模块：${esc(moduleLabel(module))}</span><button class="button small" data-action="restore-module" data-module="${esc(module.id)}">恢复</button></div>`).join("")}${hiddenActions.map((id) => `<div class="hidden-row"><span>按钮：${esc(actionLabels.get(id) || id)}</span><button class="button small" data-action="restore-action" data-action-id="${esc(id)}">恢复</button></div>`).join("")}</div>` : `<div class="empty">没有隐藏的模块或按钮。</div>`}<footer class="modal-actions"><button class="button" data-action="modal-close">关闭</button></footer></section>`);
  }

  async function reorderNavigation(source, target) {
    if (!source || !target || source === target) return;
    await WorkspaceEditor.mutate("导航顺序已保存", (next) => {
      const order = [...next.navigation.order];
      const from = order.indexOf(source);
      const to = order.indexOf(target);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to, 0, source);
      next.navigation.order = order;
    });
  }

  async function moveAsset(source, targetPage, targetAsset) {
    if (!source || !targetPage) return;
    await WorkspaceEditor.mutate("图片位置已保存", (next) => {
      const from = next.assets.findIndex((asset) => asset.id === source);
      if (from < 0) return;
      const [asset] = next.assets.splice(from, 1);
      asset.pageId = targetPage;
      const target = targetAsset ? next.assets.findIndex((item) => item.id === targetAsset) : -1;
      if (target >= 0) next.assets.splice(target, 0, asset);
      else next.assets.push(asset);
    });
  }

  document.addEventListener("click", async (event) => {
    const control = event.target.closest("[data-action], [data-editor-action]");
    if (!control) return;
    const action = control.dataset.action;
    if (control.dataset.editorAction) return WorkspaceEditor.handleAction(control.dataset.editorAction);
    if (action === "home") navigate("home");
    if (action === "go") navigate(control.dataset.route);
    if (action === "edit-mode") WorkspaceEditor.isEditing() ? WorkspaceEditor.exit() : WorkspaceEditor.enter();
    if (action === "sidebar-toggle") { state.appearance.sidebarCollapsed = !state.appearance.sidebarCollapsed; render(); await save("边栏状态已保存"); }
    if (action === "mobile-menu") document.getElementById("sidebar")?.classList.add("open");
    if (action === "new-record") openRecordModal(control.dataset.module, "");
    if (action === "edit-record") openRecordModal(control.dataset.module, control.dataset.id);
    if (action === "delete-record") deleteRecord(control.dataset.module, control.dataset.id);
    if (action === "toggle-record") toggleRecord(control.dataset.module, control.dataset.id);
    if (action === "modal-close") closeModal();
    if (action === "hide-module") WorkspaceEditor.hideModule(control.dataset.module);
    if (action === "restore-module") { closeModal(); WorkspaceEditor.restoreModule(control.dataset.module); }
    if (action === "hide-action") WorkspaceEditor.hideAction(control.dataset.actionId);
    if (action === "restore-action") { closeModal(); WorkspaceEditor.restoreAction(control.dataset.actionId); }
    if (action === "image-size") WorkspaceEditor.resizeImage(control.dataset.id, control.dataset.size);
    if (action === "image-remove") WorkspaceEditor.removeImage(control.dataset.id);
    if (action === "backup-export") { WorkspaceBackup.download(state, config); toast("备份已导出"); }
    if (action === "import-apply") applyImport(control.dataset.mode);
    if (action === "snapshots") openSnapshots();
    if (action === "snapshot-restore") restoreSnapshot(control.dataset.id);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-record-form]");
    if (!form) return;
    event.preventDefault();
    submitRecord(form);
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-search]")) return;
    query = event.target.value;
    const active = document.activeElement;
    render();
    document.querySelector("[data-search]")?.focus();
    if (active?.selectionStart != null) document.querySelector("[data-search]")?.setSelectionRange(query.length, query.length);
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches("[data-filter]")) { filter = event.target.value; render(); }
    if (event.target.matches("[data-editor-image]")) { await WorkspaceEditor.addImage(event.target.files?.[0]); event.target.value = ""; }
    if (event.target.matches("[data-image-replace]")) { await WorkspaceEditor.replaceImage(event.target.dataset.imageReplace, event.target.files?.[0]); event.target.value = ""; }
    if (event.target.matches("[data-backup-file]")) {
      const file = event.target.files?.[0];
      if (!file) return;
      try { openImportPreview(WorkspaceBackup.parseText(await file.text(), config)); }
      catch (error) { toast(`导入失败：${error.message}`); }
      event.target.value = "";
    }
  });

  document.addEventListener("dragstart", (event) => {
    if (!WorkspaceEditor.isEditing()) return;
    const asset = event.target.closest("[data-asset-id]");
    const item = event.target.closest("[data-nav-id]");
    if (asset) {
      draggedAsset = asset.dataset.assetId;
      asset.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `asset:${draggedAsset}`);
    } else if (item) {
      draggedNav = item.dataset.navId;
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `nav:${draggedNav}`);
    }
  });
  document.addEventListener("dragover", (event) => {
    if (!WorkspaceEditor.isEditing()) return;
    const slot = event.target.closest("[data-image-slot]");
    const item = event.target.closest("[data-nav-id]");
    if (!item && !slot) return;
    event.preventDefault();
    document.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    (draggedAsset ? slot : item)?.classList.add("drop-target");
  });
  document.addEventListener("drop", (event) => {
    if (!WorkspaceEditor.isEditing()) return;
    const raw = event.dataTransfer.getData("text/plain");
    const slot = event.target.closest("[data-image-slot]");
    const item = event.target.closest("[data-nav-id]");
    if (raw.startsWith("asset:") && slot) {
      event.preventDefault();
      moveAsset(raw.slice(6) || draggedAsset, slot.dataset.imageSlot, event.target.closest("[data-asset-id]")?.dataset.assetId || "");
    } else if (raw.startsWith("nav:") && item) {
      event.preventDefault();
      reorderNavigation(raw.slice(4) || draggedNav, item.dataset.navId);
    }
  });
  document.addEventListener("dragend", () => {
    draggedNav = "";
    draggedAsset = "";
    document.querySelectorAll(".dragging, .drop-target").forEach((node) => node.classList.remove("dragging", "drop-target"));
  });

  document.addEventListener("keydown", (event) => {
    const typing = typeof event.target?.matches === "function" && event.target.matches("input, textarea, select, [contenteditable='true']");
    if (!typing && (event.key === "e" || event.key === "E")) { event.preventDefault(); WorkspaceEditor.enter(); }
    if (event.key === "Escape") { if (currentModal) closeModal(); else WorkspaceEditor.exit(); }
    if (WorkspaceEditor.isEditing() && !typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? WorkspaceEditor.redo() : WorkspaceEditor.undo(); }
  });

  window.addEventListener("hashchange", () => {
    route = parseRoute();
    query = "";
    filter = "全部";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  WorkspaceStore.init(config).then((loaded) => {
    state = loaded;
    ProgressWorkbench.init({ getState: () => state, setState: next => { state = next; }, config, esc, uid, today, save, render, navigate, openModal, closeModal, toast, recordRows, moduleById, imageCards });
    WorkspaceEditor.init({
      getState: () => state,
      setState: (next) => { state = next; },
      getTemplate: () => config,
      getRoute: () => route,
      getEditableValue: (key) => key === 'goal.title' ? state.data.goals[0]?.title : key === 'goal.criteria' ? state.data.goals[0]?.criteria : state.appearance.labels[key],
      setEditableValue: (next, key, value) => {
        if (key === 'goal.title' || key === 'goal.criteria') {
          const g=next.data.goals[0],field=key.slice(5);if(!g)throw new Error('尚未设置目标');
          if(value.length>(field==='title'?120:1200))throw new Error('文字太长，请缩短后再保存');
          next.data.adjustments.push({id:uid('adjust'),date:today(),note:'编辑页面更新目标',before:g[field],after:value,createdAt:new Date().toISOString()});
          g[field]=value;g.updatedAt=new Date().toISOString();
        } else next.appearance.labels[key]=value;
      },
      render,
      save,
      toast,
      openHiddenModules
    });
    render();
    save();
  }).catch((error) => {
    app.innerHTML = `<main class="home-hero"><div class="card"><h1>进步计划启动失败</h1><p>${esc(error.message || "无法读取本地数据")}</p></div></main>`;
  });
})();

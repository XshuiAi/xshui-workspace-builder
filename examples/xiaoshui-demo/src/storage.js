(function (global) {
  "use strict";

  const CURRENT_SCHEMA = 1;
  const WORKSPACE_KEY = "primary";
  let db = null;
  let config = null;
  let memoryState = null;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function initialState(template) {
    return {
      schemaVersion: CURRENT_SCHEMA,
      profile: clone(template.profile),
      appearance: {
        templateId: template.templateId,
        sidebarCollapsed: false,
        textStyles: {},
        labels: {},
        hiddenActions: []
      },
      navigation: {
        order: template.modules.map((module) => module.id),
        hidden: []
      },
      modules: clone(template.modules),
      data: clone(template.demoData || {}),
      assets: [],
      updatedAt: now()
    };
  }

  function normalizeRecord(record, collection, index) {
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : now();
    return {
      ...record,
      id: typeof record.id === "string" && record.id ? record.id : `${collection}-migrated-${index}-${Date.now()}`,
      createdAt,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt
    };
  }

  function migrateState(value, template) {
    if (!value || typeof value !== "object") return initialState(template);
    const base = initialState(template);
    const legacyCollections = ["tasks", "inbox", "journals", "goals", "growth", "reviews", "mediaIdeas", "mediaProjects", "mediaReviews", "meetings", "notices", "files", "projects", "assignments", "courses", "exams", "notes", "clubs"];
    const rawData = value.data && typeof value.data === "object" ? value.data : {};
    legacyCollections.forEach((key) => {
      if (!Array.isArray(rawData[key]) && Array.isArray(value[key])) rawData[key] = value[key];
    });
    const data = { ...base.data };
    Object.entries(rawData).forEach(([collection, records]) => {
      if (Array.isArray(records)) data[collection] = records.map((record, index) => normalizeRecord(record, collection, index));
    });
    const moduleIds = new Set(template.modules.map((module) => module.id));
    const incomingOrder = Array.isArray(value.navigation?.order) ? value.navigation.order.filter((id) => moduleIds.has(id)) : [];
    template.modules.forEach((module) => { if (!incomingOrder.includes(module.id)) incomingOrder.push(module.id); });
    const hidden = Array.isArray(value.navigation?.hidden)
      ? value.navigation.hidden.filter((id) => moduleIds.has(id) && !template.modules.find((module) => module.id === id)?.protected)
      : [];
    return {
      schemaVersion: CURRENT_SCHEMA,
      profile: { ...base.profile, ...(value.profile || {}) },
      appearance: {
        ...base.appearance,
        ...(value.appearance || {}),
        templateId: template.templateId,
        textStyles: value.appearance?.textStyles && typeof value.appearance.textStyles === "object" ? value.appearance.textStyles : {},
        labels: value.appearance?.labels && typeof value.appearance.labels === "object" ? value.appearance.labels : {},
        hiddenActions: Array.isArray(value.appearance?.hiddenActions) ? value.appearance.hiddenActions : []
      },
      navigation: { order: incomingOrder, hidden },
      modules: clone(template.modules),
      data,
      assets: Array.isArray(value.assets) ? value.assets.filter((item) => item && typeof item.id === "string" && typeof item.src === "string") : [],
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now()
    };
  }

  function openDatabase(template) {
    if (!global.indexedDB) return Promise.resolve(null);
    const dbName = `xshui-workspace-${String(template.appId || template.templateId).replace(/[^a-z0-9-]/gi, "-")}`;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const next = request.result;
        if (!next.objectStoreNames.contains("workspace")) next.createObjectStore("workspace");
        if (!next.objectStoreNames.contains("snapshots")) next.createObjectStore("snapshots", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开 IndexedDB"));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error("本地数据库操作失败"));
    });
  }

  async function init(template) {
    config = template;
    db = await openDatabase(template).catch(() => null);
    let stored = null;
    if (db) {
      const tx = db.transaction("workspace", "readonly");
      stored = await requestResult(tx.objectStore("workspace").get(WORKSPACE_KEY)).catch(() => null);
    }
    const embeddedNode = document.getElementById("xshui-embedded-state");
    const embedded = safeJson(embeddedNode?.textContent || "null", null);
    memoryState = migrateState(stored || embedded, template);
    try {
      const pref = safeJson(localStorage.getItem(`${template.appId}:preferences`) || "{}", {});
      if (typeof pref.sidebarCollapsed === "boolean") memoryState.appearance.sidebarCollapsed = pref.sidebarCollapsed;
    } catch (_) {}
    return clone(memoryState);
  }

  async function save(state) {
    memoryState = migrateState({ ...state, updatedAt: now() }, config);
    try {
      localStorage.setItem(`${config.appId}:preferences`, JSON.stringify({
        sidebarCollapsed: Boolean(memoryState.appearance.sidebarCollapsed),
        templateId: config.templateId,
        updatedAt: memoryState.updatedAt
      }));
      localStorage.setItem(`${config.appId}:recovery-config`, JSON.stringify({
        profile: memoryState.profile,
        appearance: memoryState.appearance,
        navigation: memoryState.navigation,
        updatedAt: memoryState.updatedAt
      }));
    } catch (_) {}
    if (!db) return { persistent: false, state: clone(memoryState) };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(memoryState, WORKSPACE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("保存失败"));
      tx.onabort = () => reject(tx.error || new Error("保存被中断"));
    });
    return { persistent: true, state: clone(memoryState) };
  }

  async function createSnapshot(state, reason) {
    const snapshot = { id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: now(), reason: reason || "手动快照", state: clone(state) };
    if (!db) return snapshot;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(snapshot);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("创建快照失败"));
    });
    const snapshots = await listSnapshots();
    const overflow = snapshots.slice(5);
    if (overflow.length) {
      await new Promise((resolve) => {
        const tx = db.transaction("snapshots", "readwrite");
        overflow.forEach((item) => tx.objectStore("snapshots").delete(item.id));
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }
    return snapshot;
  }

  async function listSnapshots() {
    if (!db) return [];
    const tx = db.transaction("snapshots", "readonly");
    const items = await requestResult(tx.objectStore("snapshots").getAll()).catch(() => []);
    return (items || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function restoreSnapshot(id) {
    if (!db) throw new Error("当前浏览器没有可用的本地快照");
    const tx = db.transaction("snapshots", "readonly");
    const snapshot = await requestResult(tx.objectStore("snapshots").get(id));
    if (!snapshot?.state) throw new Error("找不到这个恢复快照");
    await save(snapshot.state);
    return clone(memoryState);
  }

  global.WorkspaceStore = {
    CURRENT_SCHEMA,
    init,
    save,
    initialState,
    migrateState,
    createSnapshot,
    listSnapshots,
    restoreSnapshot,
    clone,
    now
  };
})(window);

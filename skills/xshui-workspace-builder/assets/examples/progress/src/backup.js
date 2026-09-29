(function (global) {
  "use strict";

  const FORMAT = "xshui-workspace-backup";
  const SUPPORTED_VERSIONS = new Set([1]);
  const clone = (value) => global.WorkspaceStore.clone(value);

  function envelope(state, template) {
    return {
      format: FORMAT,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appVersion: template.appVersion || "1.0.0",
      templateId: template.templateId,
      profile: clone(state.profile),
      appearance: clone(state.appearance),
      navigation: clone(state.navigation),
      modules: clone(state.modules),
      data: clone(state.data),
      assets: clone(state.assets)
    };
  }

  function validatePackage(value) {
    if (!value || typeof value !== "object") throw new Error("备份不是有效的 JSON 对象");
    if (value.format !== FORMAT) throw new Error("不是 XShui 工作台备份");
    if (!SUPPORTED_VERSIONS.has(Number(value.schemaVersion))) throw new Error(`不支持的数据版本：${value.schemaVersion ?? "未知"}`);
    if (!value.profile || typeof value.profile !== "object") throw new Error("备份缺少 profile");
    if (!value.appearance || typeof value.appearance !== "object") throw new Error("备份缺少 appearance");
    if (!value.navigation || !Array.isArray(value.navigation.order) || !Array.isArray(value.navigation.hidden)) throw new Error("备份导航结构不完整");
    if (!Array.isArray(value.modules)) throw new Error("备份模块结构不完整");
    if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new Error("备份数据结构不完整");
    for (const [collection, records] of Object.entries(value.data)) {
      if (!Array.isArray(records)) throw new Error(`数据集合 ${collection} 不是数组`);
      if (records.some((record) => !record || typeof record !== "object" || typeof record.id !== "string")) throw new Error(`数据集合 ${collection} 含无效记录`);
    }
    if (!Array.isArray(value.assets)) throw new Error("备份图片结构不完整");
    const inspect=(obj)=>{if(!obj||typeof obj!=="object")return;for(const key of Object.keys(obj)){if(["__proto__","prototype","constructor"].includes(key))throw new Error("备份含不支持的字段");inspect(obj[key]);}};inspect(value);
    if(value.profile.onboarded){
      for(const key of ["goals","tasks","stages","checkins","reviews","adjustments"])if(!Array.isArray(value.data[key]))throw new Error("进步记录缺少 "+key);
      const g=value.data.goals[0],p=value.profile.progressSettings;
      const date=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d));
      if(!g||typeof g.title!=="string"||!date(g.startDate)||!date(g.dueDate)||g.dueDate<g.startDate)throw new Error("目标日期或内容不完整");
      if(!p||typeof p.review!=="string"||typeof p.check!=="string")throw new Error("备份缺少记录设置");
      if(value.data.checkins.some(r=>!date(r.date)||typeof r.action!=="string"))throw new Error("进步记录格式无效");
    }
    if(value.appearance.progressCards && (!Array.isArray(value.appearance.progressCards)||value.appearance.progressCards.some(x=>!x||!["focus","actions","milestone","evidence"].includes(x.id))))throw new Error("卡片布局无效");

    return value;
  }

  function legacyToPackage(value, template) {
    if (!value || typeof value !== "object") return null;
    const known = ["tasks", "inbox", "journals", "goals", "growths", "growth", "reviews", "mediaIdeas", "mediaProjects", "mediaReviews"];
    if (!known.some((key) => Array.isArray(value[key]))) return null;
    const state = global.WorkspaceStore.migrateState(value, template);
    return envelope(state, template);
  }

  function parseText(text, template) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error("文件不是有效 JSON"); }
    if (parsed?.format === FORMAT) return validatePackage(parsed);
    const migrated = legacyToPackage(parsed, template);
    if (migrated) return migrated;
    throw new Error("无法识别这个备份文件");
  }

  function packageToState(pkg, template) {
    validatePackage(pkg);
    return global.WorkspaceStore.migrateState({
      schemaVersion: pkg.schemaVersion,
      profile: pkg.profile,
      appearance: pkg.appearance,
      navigation: pkg.navigation,
      modules: pkg.modules,
      data: pkg.data,
      assets: pkg.assets,
      updatedAt: pkg.exportedAt
    }, template);
  }

  function mergeById(current, incoming) {
    const map = new Map((current || []).map((item) => [item.id, item]));
    (incoming || []).forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  }

  function merge(current, incoming) {
    const next = clone(current);
    const collections = new Set([...Object.keys(current.data || {}), ...Object.keys(incoming.data || {})]);
    next.data = {};
    collections.forEach((collection) => {
      next.data[collection] = mergeById(current.data?.[collection] || [], incoming.data?.[collection] || []);
    });
    next.assets = mergeById(current.assets || [], incoming.assets || []);
    next.updatedAt = new Date().toISOString();
    return next;
  }

  function summary(state) {
    const collections = Object.fromEntries(Object.entries(state.data || {}).map(([key, records]) => [key, Array.isArray(records) ? records.length : 0]));
    return {
      collections,
      totalRecords: Object.values(collections).reduce((sum, count) => sum + count, 0),
      assets: Array.isArray(state.assets) ? state.assets.length : 0,
      modules: Array.isArray(state.modules) ? state.modules.length : 0
    };
  }

  function download(state, template) {
    const payload = envelope(state, template);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${template.templateId}-workbench-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    return payload;
  }

  global.WorkspaceBackup = { FORMAT, envelope, validatePackage, parseText, packageToState, merge, summary, download };
})(window);

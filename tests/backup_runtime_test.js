"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
require(path.resolve(__dirname, "../skills/xshui-workspace-builder/runtime/storage.js"));
require(path.resolve(__dirname, "../skills/xshui-workspace-builder/runtime/backup.js"));

const template = {
  templateId: "xiaoshui",
  appId: "runtime-test",
  appVersion: "1.0.0",
  profile: { ownerName: "测试", title: "测试工作台", scene: "测试" },
  modules: [
    { id: "tasks", label: "任务", collection: "tasks", protected: true, fields: [] },
    { id: "archive", label: "归档", collection: "archive", archive: true, protected: true, fields: [] },
  ],
  demoData: { tasks: [] },
};

const current = WorkspaceStore.initialState(template);
current.data.tasks = [
  { id: "same", title: "当前版本", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "current-only", title: "只在当前", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];
current.appearance.labels = { "profile.title": "保留当前外观" };

const incoming = WorkspaceStore.initialState(template);
incoming.data.tasks = [
  { id: "same", title: "备份版本", createdAt: "2026-02-01", updatedAt: "2026-02-01" },
  { id: "backup-only", title: "只在备份", createdAt: "2026-02-01", updatedAt: "2026-02-01" },
];
incoming.appearance.labels = { "profile.title": "不应覆盖" };

const merged = WorkspaceBackup.merge(current, incoming);
assert.equal(merged.appearance.labels["profile.title"], "保留当前外观");
assert.equal(merged.data.tasks.length, 3);
assert.equal(merged.data.tasks.find((item) => item.id === "same").title, "备份版本");

const valid = WorkspaceBackup.envelope(incoming, template);
assert.equal(WorkspaceBackup.validatePackage(valid).format, "xshui-workspace-backup");
assert.throws(() => WorkspaceBackup.parseText("{broken", template), /有效 JSON/);
assert.throws(() => WorkspaceBackup.validatePackage({ ...valid, schemaVersion: 999 }), /不支持的数据版本/);
assert.throws(() => WorkspaceBackup.validatePackage({ ...valid, data: { tasks: [{}] } }), /无效记录/);

const legacy = { tasks: [{ title: "旧任务" }] };
const migrated = WorkspaceBackup.parseText(JSON.stringify(legacy), template);
assert.equal(migrated.format, "xshui-workspace-backup");
assert.equal(migrated.data.tasks.length, 1);
assert.match(migrated.data.tasks[0].id, /^tasks-migrated-/);

console.log("backup runtime tests passed");

# 存储与备份契约

## 状态分层

- `profile`: 姓名、工作台标题、主场景。
- `appearance`: 模板、文字样式、侧栏状态。
- `navigation`: 顺序与隐藏项。
- `modules`: 模块元数据与用户改写文案。
- `data`: 按 collection 保存的记录。
- `assets`: 压缩后的图片 data URL 与尺寸、页面归属。

业务数据存入 IndexedDB。localStorage 只存轻量偏好与最后一次可恢复配置；不得把整份记录集持续写入 localStorage。

## 备份包

```json
{
  "format": "xshui-workspace-backup",
  "schemaVersion": 1,
  "exportedAt": "ISO-8601",
  "appVersion": "1.0.0",
  "templateId": "xiaoshui",
  "profile": {},
  "appearance": {},
  "navigation": {},
  "modules": [],
  "data": {},
  "assets": []
}
```

## 导入规则

- 解析与完整校验成功前不得修改当前状态。
- 预览显示每个 collection、图片、模块数量，以及当前工作台对照。
- 合并：保留当前 profile、appearance、navigation、modules；每个 collection 与 assets 按 ID 合并，相同 ID 使用备份版本。
- 完整恢复：先创建恢复快照，再替换全部状态。
- 只保留最近 5 个快照。
- 兼容旧版原始对象：存在 `tasks`、`inbox`、`journals` 等数组时迁移到新 `data` collections。

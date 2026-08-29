---
'@proteus/runtime': minor
'@proteus/shared': minor
---

pinia-plan M1-M6 完整实现（多端持久化骨架）

- `@proteus/shared`：Storage 抽象层（Memory/LocalStorage/WxStorage/NativeKV 占位 + 统一 async 契约）+ 序列化（Date/Map/Set 标记、循环引用处理）+ 存储追踪（--trace-storage）
- `@proteus/runtime`：持久化层（社区插件兼容 createPersistedStatePlugin + 自研轻量 persisted()/createPersistence，可共存）+ 四端工厂（createWebPinia/createMpPinia/createAppPinia/createSsrPinia，平台标记注入）+ DevTools 追踪/快照（createDevtoolsPlugin/__PROTEUS_STORES__）
- 迁移指南：docs/pinia-migration.md（≤10 行接入）+ examples/migration-from-vue 对照

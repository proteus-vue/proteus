# @proteus-vue/shared

## 0.2.0-beta.0

### Minor Changes

- 1bda359: pinia-plan M1-M6 完整实现（多端持久化骨架）

  - `@proteus-vue/shared`：Storage 抽象层（Memory/LocalStorage/WxStorage/NativeKV 占位 + 统一 async 契约）+ 序列化（Date/Map/Set 标记、循环引用处理）+ 存储追踪（--trace-storage）
  - `@proteus-vue/runtime`：持久化层（社区插件兼容 createPersistedStatePlugin + 自研轻量 persisted()/createPersistence，可共存）+ 四端工厂（createWebPinia/createMpPinia/createAppPinia/createSsrPinia，平台标记注入）+ DevTools 追踪/快照（createDevtoolsPlugin/**PROTEUS_STORES**）
  - 迁移指南：docs/pinia-migration.md（≤10 行接入）+ examples/migration-from-vue 对照

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）

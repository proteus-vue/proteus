# @proteus-vue/runtime

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.2

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies
  - @proteus-vue/shared@0.2.0-beta.1

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies
  - @proteus-vue/contracts@0.1.1-beta.0

## 0.2.0-beta.1

### Minor Changes

- 框架元素探针：打通「框架 API ↔ 测试数据屏障」（跨端自动化测试降级通道）

  - **`@proteus-vue/runtime`**：新增元素探针注册表（`recordProbe` / `readProbes` / `clearProbes` / `probeEnabled`，全局 `__PROTEUS_PROBES__`，跨端纯 JSON）。
  - **`@proteus-vue/compiler`**：组件 `ready()` 注入自测量——`wx.createSelectorQuery().in(this).select(.<tag>-scopeId)` 取 `boundingClientRect` + `scrollOffset` + `computedStyle` 写注册表（+150ms 二次重测兜首帧）；页面 `onLoad` 复位注册表（同页 key 稳定），`PROTEUS_DEBUG` 构建默认开启。新规则 `script/element-probe`（可禁用）。`ScriptTransformOptions` 增 `scopeId`。
  - **`@proteus-vue/test-core`**：`driver.probes(pid?)` / `driver.enableProbes()`（MP + Web 双端同 API）+ 契约断言原语 `assertProbeScrollable` / `assertProbeGeometry` / `assertProbeVisible` / `getProbe`。
  - **`@proteus-vue/api`**：`useElement`（C58）在工具查询落空时**回落读探针注册表**——框架 API 也能读组件内部节点。
  - **起因**：自动化工具只能查页面拥有的节点（glass-easel 组件内部隔离；Skyline 无 `selectAllComponents`）→ 组件内部几何/可见性/可滚性无法断言（本项目一个横向 scroll-view 容器塌陷漏检两轮）。测量必须从组件内部发起，本通道让断言面不再受运行时 DOM 隔离限制。

## 0.2.0-beta.0

### Minor Changes

- 1bda359: pinia-plan M1-M6 完整实现（多端持久化骨架）

  - `@proteus-vue/shared`：Storage 抽象层（Memory/LocalStorage/WxStorage/NativeKV 占位 + 统一 async 契约）+ 序列化（Date/Map/Set 标记、循环引用处理）+ 存储追踪（--trace-storage）
  - `@proteus-vue/runtime`：持久化层（社区插件兼容 createPersistedStatePlugin + 自研轻量 persisted()/createPersistence，可共存）+ 四端工厂（createWebPinia/createMpPinia/createAppPinia/createSsrPinia，平台标记注入）+ DevTools 追踪/快照（createDevtoolsPlugin/**PROTEUS_STORES**）
  - 迁移指南：docs/pinia-migration.md（≤10 行接入）+ examples/migration-from-vue 对照

- 208cfba: pinia-plan M7-M8 完整实现（超级应用可靠性 + 协同/可观测）

  - `@proteus-vue/runtime`：M7 分片（eager/lazy/keys + $hydrated/$hydrate）、调度器（防抖/maxWait/高频合并/串行 flush）、配额淘汰（protected 优先）、版本迁移（链式/失败兜底）、生命周期 dispose（scope:page）、敏感字段（volatile/encrypted）；M8 快照/时间旅行（capture/restore/take/timeTravel）、状态埋点（采样/批量/敏感字段剔除）、类型注册表配套
  - `@proteus-vue/pinia-sync`（新包）：多端协同引擎（LWW 最终一致 + 离线缓冲重放 + excluded 字段跳过；CRDT 接口占位）
  - 协作规范 docs/pinia-stores-conventions.md + CI stores 铁律门禁

### Patch Changes

- 00c9fb7: 拆包步骤 6：别名与引用面全量切换

  - vite alias / tsconfig paths 全量精确映射 `@proteus-vue/{router,runtime,shared,compiler,plugin-vite,components}`，删除泛化 `@proteus-vue` → `src/`（防误匹配）
  - 新增 `@proteus-vue/components` 精确别名（框架内置组件暂留 `src/components`，组件库 v2.0 方向）
  - create-proteus 模板 alias 同步精确化（vendored 结构）

- Updated dependencies [1bda359]
- Updated dependencies [00c9fb7]
  - @proteus-vue/shared@0.2.0-beta.0

# @proteus-vue/pinia-sync

## 0.2.0-beta.1

### Patch Changes

- 发布同步：shared / pinia-sync 的 npm 版本与本地内容不一致（补 bump）

  这两个包在 `sync-publish-drift` 批次中未被推进版本号——原因是它们此前已把 minor 提升
  消耗在 `0.2.0-beta.0` 上（pre 模式下同一 minor 只应用一次），本轮无新 minor 声明。

  但**内容**确实与 npm 上的 `0.2.0-beta.0` 不同（实测 integrity 不一致），故补 patch bump
  使新内容可发布。`shared` 被 7 个包依赖（api/router/runtime/worklet/…），本 patch 同时
  驱使其依赖方在 `changeset version` 中同步精确依赖（仓内内部依赖均为 exact pin）。

## 0.2.0-beta.0

### Minor Changes

- 208cfba: pinia-plan M7-M8 完整实现（超级应用可靠性 + 协同/可观测）

  - `@proteus-vue/runtime`：M7 分片（eager/lazy/keys + $hydrated/$hydrate）、调度器（防抖/maxWait/高频合并/串行 flush）、配额淘汰（protected 优先）、版本迁移（链式/失败兜底）、生命周期 dispose（scope:page）、敏感字段（volatile/encrypted）；M8 快照/时间旅行（capture/restore/take/timeTravel）、状态埋点（采样/批量/敏感字段剔除）、类型注册表配套
  - `@proteus-vue/pinia-sync`（新包）：多端协同引擎（LWW 最终一致 + 离线缓冲重放 + excluded 字段跳过；CRDT 接口占位）
  - 协作规范 docs/pinia-stores-conventions.md + CI stores 铁律门禁

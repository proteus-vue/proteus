---
'@proteus-vue/runtime': minor
'@proteus-vue/pinia-sync': minor
---

pinia-plan M7-M8 完整实现（超级应用可靠性 + 协同/可观测）

- `@proteus-vue/runtime`：M7 分片（eager/lazy/keys + $hydrated/$hydrate）、调度器（防抖/maxWait/高频合并/串行 flush）、配额淘汰（protected 优先）、版本迁移（链式/失败兜底）、生命周期 dispose（scope:page）、敏感字段（volatile/encrypted）；M8 快照/时间旅行（capture/restore/take/timeTravel）、状态埋点（采样/批量/敏感字段剔除）、类型注册表配套
- `@proteus-vue/pinia-sync`（新包）：多端协同引擎（LWW 最终一致 + 离线缓冲重放 + excluded 字段跳过；CRDT 接口占位）
- 协作规范 docs/pinia-stores-conventions.md + CI stores 铁律门禁

# DevTools 落地评估与批次重排（v2）

> 状态：已落地评估（2026-08）  
> 前置：`00-overview.md`（TraceBus + 六源 + 面板）、`01-m1-trace-bus.md`（事件协议）  
> 结论先行：**B1 TraceBus（统一协议 + 环形缓冲 + 脱敏 + 采样 + 零开销门控）可完整落地且价值最高（把分散的字符串 trace 收敛为统一事件流）；B3-B8 全部依赖「面板 UI」（浏览器扩展/独立窗口）——标长期方向**。

---

## 1. 现状核对（Draft 假设 vs 当前代码库现实）

| # | Draft 假设 | 当前现实 | 结论 |
|---|-----------|----------|------|
| 1 | TraceBus 是唯一 trace 汇聚点 | 现有 trace 分散：lifecycle `--trace-lifecycle` / router `--trace-router` / compiler `--trace-transform`（字符串回调）、组件 `componentRender`（observability）| ✅ **B1 落地 TraceBus**：统一 TraceEvent 协议 + 订阅 + 环形缓冲；后续 B2 把六源逐步接入 |
| 2 | 面板（时间轴/快照/火焰图/根因/设备）| 无任何 UI 基建；浏览器扩展/独立窗口工程量巨大 | ⏸ B3-B8 **标长期**（v1.0+）；B1 的缓冲+flush 已为面板预留接口 |
| 3 | `__DEV__` 编译期注入 + dead-code-elimination | 组件/运行时无 `__DEV__` 注入机制 | ⚠️ 用 **enabled 门控**（与 observability 同模式）：`setEnabled(false)` → emit 为 noop（微基准可测），生产零开销 |
| 4 | 采样 `traceId` hash 取模 + error 强制全采（tail sampling）| 无 traceId 基建 | ✅ B1 实现：`createTraceId` + sampleRate 哈希 + error 强制入缓冲 |
| 5 | 脱敏 redact（递归，REDACT_KEYS）| pinia 敏感字段（volatile/encrypted）有标记 | ✅ B1 实现递归脱敏（Date/Map/Set/数组/嵌套对象）|
| 6 | 可序列化：DOM/节点转 handle | 无节点引用进 payload 的现状（trace 只带字符串）| ✅ 协议约束 payload JSON-safe + 文档标注 handle 约定 |
| 7 | 六源接入（lifecycle/router/store/api/capability/compiler）| 各源有独立 trace 回调 | ⏸ B2 逐个接入（生命周期 orchestration + componentRender 先接入示范）|
| 8 | MP 编译 | 共享模块白名单 `@proteus/*` ✓ | ✅ 纯逻辑 ES5-safe → `_proteus/devtools-runtime` 直接可用 |

---

## 2. 批次重排（B1-B8 → 当前可落地）

| 批 | 交付物 | 说明 |
|----|--------|------|
| B1 | `@proteus/devtools-runtime`：TraceBus（TraceEvent 协议/emit/on/环形缓冲/flush/setEnabled）+ redact 脱敏 + 采样（traceId hash + error tail）+ createTraceId | ✅ 本批（纯逻辑零依赖，可单测）|
| B2 | 六源接入：lifecycle orchestrator trace → bus + componentRender → bus（先两源示范）| 依赖 B1 |
| 后续 | 面板（时间轴/快照/火焰图/根因/设备）+ 六源全量 + handle 序列化 | 标长期（v1.0+），面板为浏览器扩展/独立窗口 |

---

## 3. 事件协议（B1，对齐 01-m1-trace-bus.md）

```ts
export type TraceSource = 'lifecycle' | 'router' | 'store' | 'api' | 'capability' | 'compiler' | 'component'
export type TracePhase = 'start' | 'end' | 'point' | 'error'

export interface TraceEvent<T = unknown> {
  source: TraceSource
  phase: TracePhase
  name: string                 // e.g. 'router.beforeEach' / 'component.render'
  payload?: T                  // JSON-safe（节点引用须转 handle）
  timestamp: number            // Date.now()（MP 无 performance.now 高精度差异标文档）
  traceId?: string             // 跨源链路 ID（采样/串联）
}
```

★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构。

---

## 4. 验收（B1）

1. `emit` 在 `enabled=false` 为 noop（缓冲不增长，微基准 < 0.1ms 量级断言）。
2. 环形缓冲满 → 丢弃最旧，不抛错。
3. `redact` 覆盖：嵌套对象 / 数组 / Map / Set / Date / 大小写键（token/Token/TOKEN）。
4. 采样：`sampleRate=0` → 普通事件全跳过、`phase:'error'` 强制入缓冲（tail sampling）。
5. `createTraceId` 唯一性（批量生成无重复）。
6. 每批独立提交，验证 = `npm run verify` 全绿。

---

## 5. 进度追踪

| 批 | 状态 | 说明 |
|----|------|------|
| B1 TraceBus 包 | ✅ 已落地 | 2026-08，8 用例——协议/环形缓冲/订阅取消/flush/零开销门控/redact 递归脱敏/采样 error tail/createTraceId |
| B2 六源接入 | ✅ 已落地 | 2026-08，6 用例——lifecycle orchestrator（start/end/error/point 结构化事件）+ componentRender（component.render）→ TraceBus；type-only 注入（runtime 产物零 devtools 依赖） |

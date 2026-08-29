# M1 — TraceBus 与统一事件协议

## 目标

定义唯一的 trace 汇聚点，让六层运行时通过统一协议上报，UI 层只订阅。

## 事件协议

```ts
interface TraceEvent<T = unknown> {
  source: 'lifecycle' | 'router' | 'store' | 'api' | 'capability' | 'compiler'
  phase: 'start' | 'end' | 'point' | 'error'
  name: string                    // e.g. "store.patch" | "router.beforeEach"
  payload: T                      // 必须是 JSON-safe
  timestamp: number               // performance.now() 高精度
  traceId: string                 // 跨源链路 ID
  spanId: string                  // 当前 span
  parentSpanId?: string
}
```

## TraceBus API

```ts
export interface TraceBus {
  emit(event: TraceEvent): void
  on(source: Source, handler: (e: TraceEvent) => void): () => void
  buffer: TraceEvent[]            // 环形缓冲，默认 10000 条
  flush(): TraceEvent[]           // 推送给面板
  setEnabled(enabled: boolean): void
}
```

## 采集开关（铁律 #2：生产零开销）

```ts
// 编译期 dead-code-elimination：生产包 useTrace 为空函数
export function useTrace() {
  if (!__DEV__ && !config.devtools?.enabled) return noop
  return bus
}
```

- `__DEV__` 由 Compiler 在 Web/Skyline 两端注入（对齐 Compiler M5 source map）。
- `proteus.config.ts`：
  ```ts
  export default defineConfig({
    devtools: { enabled: true, sampleRate: 0.1, redactKeys: ['token'] }
  })
  ```

## 采样策略

- 默认 `sampleRate: 1`（开发全量）
- 生产 `sampleRate < 1`：按 `traceId` hash 取模，同链路要么全采要么不采
- 异常自动全量（tail sampling）：`phase: 'error'` 事件强制入缓冲

## 隐私脱敏（铁律 #4）

```ts
const REDACT_KEYS = new Set(['password', 'token', 'authorization', 'idcard', 'phone', 'id_card'])
function redact(obj: any): any { /* 递归，命中 REDACT_KEYS → "[REDACTED]" */ }
```

对齐 Pinia M7.6 `volatile` / `encrypted` 字段标记。

## 可序列化（铁律 #3）

DOM / 小程序节点对象不允许直接进 payload，转 handle：
```ts
{ __handle: 'node', kind: 'element', tag: 'view', id: 'h_1' }
```
面板侧通过 `resolveHandle(handle)` 调用 Runtime 反查（受权限控制）。

## 验收

- `bus.emit()` 在 `enabled=false` 时为 noop，微基准 < 0.1ms/次
- 环形缓冲满时丢弃最旧，不抛错
- `redact()` 单测覆盖嵌套对象、数组、Map、Set、Date

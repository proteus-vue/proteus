# M2 — 六源接入

## 目标

把 Lifecycle / Router / Pinia / API / Platform / Compiler 六层的 trace 接入 TraceBus。

## 接入规范

每个源暴露一个 `install(bus)` 函数，幂等，由 `createDevTools()` 统一调用：

```ts
// @proteus-vue/devtools-runtime/sources
export function installLifecycle(bus: TraceBus) { /* ... */ }
export function installRouter(bus: TraceBus, router: Router) { /* ... */ }
export function installStore(bus: TraceBus, pinia: Pinia) { /* ... */ }
export function installApi(bus: TraceBus, request: Request) { /* ... */ }
export function installCapability(bus: TraceBus, registry: CapabilityRegistry) { /* ... */ }
export function installCompiler(bus: TraceBus) { /* ... */ }
```

## 各源事件清单

### Lifecycle
| name | phase | payload |
|------|-------|---------|
| `lifecycle.phase` | start/end | `{ phase: 'bootstrap'\|'coreReady'\|... }` |
| `lifecycle.error` | error | `{ phase, error }` |

### Router
| name | phase | payload |
|------|-------|---------|
| `router.navigate` | start/end | `{ to, from, duration }` |
| `router.guard` | start/end | `{ name, result }` |
| `router.error` | error | `{ to, error }` |

### Pinia
| name | phase | payload |
|------|-------|---------|
| `store.mutate` | point | `{ storeId, type, payload, stateBefore, stateAfter }` |
| `store.patch` | point | 同上（聚合） |

### API
| name | phase | payload |
|------|-------|---------|
| `api.request` | start/end | `{ url, method, duration, status }` |
| `api.error` | error | `{ url, error }` |

### Capability
| name | phase | payload |
|------|-------|---------|
| `capability.detect` | point | `{ name, supported, fallback }` |
| `capability.call` | start/end | `{ name, args, result }` |

### Compiler
| name | phase | payload |
|------|-------|---------|
| `compiler.transform` | start/end | `{ id, name, duration }` |
| `compiler.chunk` | point | `{ name, size, modules }` |

## traceId 传播（对齐 Observability Layer）

- 一次用户操作（如点击 → 导航 → 请求 → 状态变更）共享一个 `traceId`
- 源头生成 `traceId`，通过 `AsyncLocalStorage`（Web：`zone.js` lite / 手动 context）透传
- 跨源链路靠 `parentSpanId` 串成树

## 依赖

- 仅依赖 **Types**（事件类型）与 **Compiler**（source map，用于事件定位源码）
- 不依赖任何运行时层实现 → 可独立单测（mock 层对象即可）

## 验收

- 六源各跑一次，bus 缓冲中按 `source` 分组条数正确
- 一次点击操作，六源事件的 `traceId` 一致，可重建调用树
- 未调用 `createDevTools()` 时，各源 `install` 不被执行（零开销）

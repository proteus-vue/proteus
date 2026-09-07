---
title: State factories across targets
order: 33
group: 数据与状态
---

# State factories across targets

> Beginner entry point: [State management](/docs/15-state-management) — this page covers the framework-side mechanism.

Platform differences (persistence carriers, DevTools, SSR isolation) converge in the four-target factories of `@proteus-vue/runtime`; business stores have zero awareness of the target. **Iron rule**: no platform branching is allowed in `stores/` — the `stores-purity` test case in `npm test` is the hard CI gate.

## Factory matrix

| Factory | Target | Platform marker | Persistence carrier | Debugging | Status |
|---|---|---|---|---|---|
| `createWebPinia()` | Web SPA | `web` | LocalStorageAdapter (namespace isolation) | Vue DevTools native + dev-build trace/snapshots | ✅ |
| `createMpPinia()` | WeChat Mini Program | `mp` | WxStorageAdapter (**100ms debounced disk writes** — `setStorageSync` blocks the main thread) | dev-build trace + `__PROTEUS_STORES__()` snapshot | ✅ |
| `createAppPinia()` | App (Custom Renderer) | `app` | NativeKVAdapter (MMKV bridge landing in v0.6) | — | 🟡 |
| `createSsrPinia()` | SSR | `ssr` | MemoryAdapter (**a separate instance per request**) | — | ✅ |

```ts
// typical wiring (Web)
app.use(createWebPinia())
// SSR: must be called inside each request, never at module top level (§05 SSR isolation)
```

## Persistence: the full `persisted()` options table

Persistence is written only in `defineStore`'s 3rd argument — `persistence: persisted({...})`. **Untagged stores carry zero overhead** (compile time and runtime recognize the `__persisted__` marker and attach no subscription):

| Option | Type | Default | Description |
|---|---|---|---|
| `pick` | `string[]` | — | whitelist fields (supports nested paths `a.b.c`, array indices `a.0.b`) |
| `omit` | `string[]` | — | blacklist fields (mutually exclusive with `pick`) |
| `storage` | `StorageAdapter` | platform default | overrides the global storage implementation |
| `key` | `string` | `store.$id` | the storage key |
| `debounce` | `number` | `50` | debounced disk-write window (ms; `0` disables) |
| `scheduler` | `PersistSchedulerOptions` | — | scheduler (maxWait / high-frequency merging — M7.2) |
| `quota` | `QuotaOptions` | — | storage quota management (M7.3) |
| `scope` | `'app' or 'page'` | `'app'` | lifecycle scope (`page`-level stores are cleared on dispose) |
| `eager` | `boolean` | `true` | hydrates at startup; `false` = lazy (first `$hydrate()`) |
| `lazy` | `boolean` | — | same as `eager: false` (clearer semantics); the `$hydrated` state can drive component loading |
| `keys` | `string[]` | — | hydrate restores only the listed fields (less deserialization — M7.1 sharding) |
| `version` | `number` | `0` | the persisted-schema version (paired with `migrations` for version migration) |
| `migrations` | `Migration[]` | — | migration chain (applied one by one, ordered by `from`) |
| `volatile` | `string[]` | — | fields never written to storage (kept in memory; skipped by both hydrate and persist) |
| `encrypted` | `string[] or SecureFields` | — | encrypted fields (default encryption implementation, or a custom `encrypt`/`decrypt`) |

## Store purity conventions

- **Persistence is written only in `defineStore`'s 3rd argument** (`persisted({...})`); never assembled dynamically at runtime
- **No direct storage access**: `localStorage.setItem` / `wx.setStorage` must never appear — go through the persist config and let the platform pick the backend automatically
- **No persisting transient state**: runtime state such as playback progress and loading stays in memory; the persisted surface narrows down to `pick`
- **App-target serialization boundary**: state crossing the Bridge must be JSON-serializable (no functions/Promises); cross-thread state changes notify native via `$subscribe` + Bridge emit

## Development-time debugging

- **Web**: Vue DevTools hooks in natively (the official pinia plugin); the development build (`PROTEUS_DEBUG=1`) attaches action/mutation traces + state snapshots
- **Mini Program**: no browser DevTools extension — the development build automatically attaches `[pinia]` trace logs + the `__PROTEUS_STORES__()` full-store state snapshot (call it directly in the WeChat DevTools Console; aligned with Vue DevTools' Import State)

## Next steps

- [Data update strategies](/docs/framework/data-updates): the runtime machinery behind setData merging and watch emulation

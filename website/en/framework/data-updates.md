---
title: Data update strategies
order: 34
group: 数据与状态
ends: data-updates
---

# Data update strategies

The unified contract for cross-target data updates: **reactive writes drive view updates automatically — business code never pushes by hand**. Each target has a different "push channel" — Web has no bridge, the Mini Program uses `setData`, the App goes through the Bridge — and the differences are absorbed by the framework's **compile-time rewriting + runtime merging**, so business code stays the same. (Each target's rollout status is in the “Terminal rollout” table above.)

## Mini Program target: `setDataBridge` (16ms batch window)

`setData` is the only entry point for data into the Mini Program view layer — its cost grows with the **amount of data** and the **number of calls**. The `setDataBridge` of `@proteus-vue/runtime` collects dirty paths at page granularity:

- **Path merging**: dot and array paths such as `a.b` / `a[0].c` are merged precisely (two `count.value++` within the same window → one `setData({ count: 2 })`)
- **Value dedupe**: writes of the same value to the same path are skipped
- **Deep diff**: object/array changes are recursed into leaf-path patches — only the changed sub-paths are pushed
- **flushSync**: explicitly flushes when a scene must hit the screen immediately
- the batchWindow is injected by the factory (default 16 ≈ 1 frame)

## Compile time: write-point rewriting

`ref` reads and writes in `<script setup>` are rewritten into bridge calls (see [Script transform](/docs/framework/compile-script)):

| Vue semantics | Compile strategy |
|---|---|
| `ref` reads/writes | dirty-path collection + batched setData |
| `computed` | not stored in data; initialized in onLoad + when a dependency ref is written, **recomputed synchronously and merged into the same setData** |
| `watch(ref, cb)` | generates `proteusWatchX`; invoked automatically after the dependency ref is written to setData (the old value is saved before the write) |
| `provide/inject` (ref linkage) | `proteusSyncProvide` injected at the write point (syncs the registry + notifies subscribers) |

## Data discipline

1. **Symmetric listener cleanup**: inject subscriptions are cancelled in detached/onUnload (the page-level namespace is deleted on onUnload to prevent leaks)
2. **watch MVP boundary**: a single ref referenced directly + arrow-function callbacks; array sources / function sources / `function` callbacks warn at compile time
3. **Static-snapshot semantics**: providing `.value` / a literal = a static snapshot (aligned with Vue: passing a ref links it, passing a value snapshots it)

## Next steps

- [Data passing between pages](/docs/framework/page-data)

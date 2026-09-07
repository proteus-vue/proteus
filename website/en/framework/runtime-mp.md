---
title: Mini Program runtime
order: 13
group: 运行期
---

# Mini Program runtime

On the Mini Program target, the runtime is generated and taken over by the framework — business code never writes `App()`, hand-assembles `app.json`, or calls `setData` directly.

## App skeleton, auto-generated

`src/main.mp.ts` is a minimal entry: **no `App()` written**. At build time, the `appSkeleton` template assembles the `app.js` skeleton automatically (app lifecycle / global registry / plugin slots), and the artifacts are emitted straight through the plugin.

## Page runtime

The compiler rewrites each page SFC's `<script setup>` into a `Page()` constructor:

- `ref` reads/writes → `this.data` + `setData`
- lifecycle hooks such as `onMounted` map to Mini Program page lifecycle events
- `computed` → data derivation (initialized in onLoad + linked on writes)
- `watch` → `proteusWatchX` methods (linked at write points)

## setDataBridge (16ms batch merge + deep diff)

The `setDataBridge` from `@proteus-vue/runtime` collects dirty paths at page granularity and merges multiple changes into a single `setData` within a **16ms (≈ 1 frame) batch window**:

| Mechanism | What it does |
|---|---|
| path merging | parents override children (`a.b` and `a` in the same window push only `a`); the two separator styles — dots and array subscripts (`list[0].c`) — are handled uniformly |
| value dedup | compared against the last pushed value — same-value writes are skipped |
| **deep object/array diff** | object/array changes recurse into **leaf-path patches**, pushing only the changed sub-paths — a direct hit on uni-app's whole-large-object setData pain point |
| `flushSync()` | explicitly flushes when state must hit the screen immediately (clear the timer + flush right away) |

Data structure: dirty paths and last-pushed values are both recorded in Maps keyed by **page path** — pages never interfere with one another.

## Events & lifecycle

- Template events (`@click` / `@tap`) map to `bindtap` and friends, normalized onto a unified event object
- **Event payload normalization** (component library B4, `eventField`): MP reads `e.detail.x`, Web reads `e.target.x` — components read uniformly via `eventField(e, 'value')` / `eventScrollTop(e)`, safe on both targets (the MP artifact is safe: no `?.` / `??` / object spread)
- Page lifecycle (`onLoad` / `onShow` / `onReady` / `onUnload`) is managed uniformly by `pageLifecycle`, firing the Vue hooks at the right moments

## Debugging

- `npm run debug:mp` (`PROTEUS_DEBUG=1`): full-chain debug build — artifacts get `[proteus][stage]` logs and decision-chain files (`.transform-debug/`)
- WeChat DevTools breakpoints debug the logic layer normally

## Next steps

- [Startup & update mechanism](/docs/framework/startup)
- [Script transform](/docs/framework/compile-script): the full table of ref / computed / watch rewrite rules

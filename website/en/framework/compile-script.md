---
title: Script transform
order: 7
group: 编译期
---

# Script transform

The reactive code of `<script setup>` has no direct equivalent on the Mini Program (no Proxy-based reactivity, no native computed/watch concept) — the compiler rewrites it into `Page()` / `Component()` constructors + `setData` calls. The rules each conversion triggers can be observed one by one in the trace.

> **Target scope**: this page describes the compile pipeline for the **mp-weixin** target (Layer 1). On the Web target, `ref` / `computed` / `watch` are real Vue reactivity with zero rewriting; the remaining targets come online as their bridge lines are wired.

## Core rules

| Rule ID | Authoring | Output |
|---|---|---|
| `script/define-props` | `defineProps({...})` | `properties` (type mapping: String/Number/Boolean/Object/Array — unsupported types warn) |
| `script/define-emits` | `defineEmits([...])` | `triggerEvent` wrapper (the event contract is made explicit) |
| `script/define-expose` | `defineExpose({ a, b })` | no-op (the component's methods are naturally reachable via selectComponent) |
| `script/const-to-data` | `const count = ref(0)` | `data.count` |
| `script/ref-read` | `count.value` | `this.data.count` |
| `script/ref-write` | `count.value = expr` | `this.setData({ count: expr })` |
| `script/ref-incdec` | `count.value++` / `--` | `this.setData({ count: this.data.count ± 1 })` |
| `script/computed-to-data` | `const double = computed(...)` | **not stored in data**; initialized in onLoad + recomputed synchronously when a dependency ref is written, merged into the same setData |
| `script/watch-to-methods` | `watch(count, (n, o) => {...})` | `proteusWatchCount`: invoked automatically after a dependency ref is written to setData (the old value is saved before the write) |
| `script/watch-props` | `watch(() => props.x, cb)` | `observers: { x(n, o) {...} }` (immediate additionally generates an attached initialization call) |
| `script/const-to-data` (static evaluation fails) | `const store = usePlayerStore()` | the field is absent from data; `onLoad/attached` injects an **instance property** (template binding unsupported — see Honest boundaries) |
| `script/function-to-methods` | `function handleTap() {...}` | `methods.handleTap` |
| `script/arrow-to-methods` | `const handleTap = () => {...}` | `methods.handleTap` |
| `script/lifecycle-map` | `onMounted` / `onUnmounted` / `onLoad` | `onReady` / `onUnload` / `onLoad` |
| `script/module-import` | relative-path import | compiled as a standalone artifact + `require` conversion (cross-module references genuinely work) |
| `script/provide-inject` | `provide("key", expr)` / `inject("key")` | global-registry read/write through `getApp().__proteusProvides` (MVP: **value snapshot, not reactive**) |
| `script/store-binding` | `{{ store.count }}` in template | onLoad `setData(mapping)` + `store.$subscribe → setData` (Pinia MP binding) |
| `script/vmodel-handler` | `v-model="name"` | `proteusOnNameInput` (setData write-back) |
| `script/nav-handler` | navigation calls | wx.router wiring |
| `script/onload-params` | `onLoad(options)` | page parameters passed through |
| `script/runtime-init` | runtime initialization segment | onLoad/attached injection |
| `script/component-mode` | component form | Page → Component constructor switch |

## Lifecycle mapping

| Vue authoring | Mini Program output | Description |
|---|---|---|
| `onMounted(...)` | `onReady(...)` | |
| `onUnmounted(...)` | `onUnload(...)` | |
| `onLoad(...)` | `onLoad(...)` | Same name, direct passthrough |
| `onErrorCaptured` and the rest | **Stripped + explicit warning** | No equivalent hooks without a Vue runtime on the Mini Program — anti-black-box: nothing is stripped silently anymore; the warning states plainly that the Web target keeps the native semantics |

## setData batch merging

At runtime, `setDataBridge` collects dirty paths at **page granularity** and merges several changes into a single `setData` within a **16ms (≈ 1 frame) batch window** — consecutive `ref` mutations do not produce multiple bridge calls (window/granularity are configured by `setDataBridge.batchWindow` / `perComponent` in `proteus.config.ts`):

```ts
count.value++          // dirty path: count
count.value++          // another change in the same window → merged
// after 16ms: one setData({ count: 2 })
```

Derived/computed linkage merges into the same window — a `count` write triggers a `double` recompute, all in one `setData({ count: 2, double: 4 })`.

## Honest boundaries

- The MVP watch emulation supports only **single-ref direct references** + arrow-function callbacks (array sources / function sources / function callbacks warn at compile time)
- Bindings whose top-level static evaluation fails cannot be read from the template (use module imports for shared logic — `script/module-import` is the full-featured path)
- provide/inject are value snapshots, not reactive (MVP)
- Unmapped lifecycle hooks are stripped with an explicit warning (`onErrorCaptured` and other Web-only capabilities)
- Template complex-expression support is defined by the rule catalog (`npx proteus rules`)
- Prop type mapping supports only String/Number/Boolean/Object/Array (compile-time warning; falls back to String)

## Next steps

- [Style transform](/docs/framework/compile-style)
- [Mini Program runtime](/docs/framework/runtime-mp)

---
title: Framework overview
order: 1
group: 总览
---

# Framework overview

Proteus's core is a “semantic machine”: business code declares **what it wants**, the framework compiles that into a platform-independent intermediate representation (IR), and backends implement **how** according to the semantic fields on the IR. This section takes the machine apart and explains it — architecture, compile time, runtime, the rendering layer, hosts & memory, and quality gates.

## Six-layer architecture

```
┌─ App layer (business)             standard Vue SFC / router / state / pages
├─ Semantic layer (framework core)  p-* semantic components / 136-primitive SSOT / Capability Hook / Fluid
├─ Compile layer                    Compiler + Plugin API + CompilerBackend SPI (Node / Rust / WASM)
├─ Render layer                     RenderBackend SPI (VueDom / Native / Flutter / Skia / Headless)
├─ Host layer                       HostRuntime SPI + six-container strategy + ownership / borrow checking
└─ Capability layer                 NativeBackend SPI (📋 planned) + Capability Hook (50)
```

Core insight: through the IR, the framework only describes “what” (one grid, one scan invocation), and the backend decides “how” (`UICollectionView` or CSS Grid, `AVCapture` or `CameraX`).

## The core formula

> **Any cross-target problem = semantic definition (done by the framework) + backend implementation (done by the platform)**

Every layer's SPI is paired with a conformance suite that CI enforces — **constraints hang on the IR, not on any particular platform**.

## Write once, produce for every target

```
                       ┌─ Web target ─── standard Vite + Vue ──► DOM (zero transformation)
page.vue (standard SFC)─┼─ Mini Program target ─ compiler pipeline ─────► WXML / WXSS / Page() JS / JSON
                       └─ Native/Flutter/Headless ──► RenderBackend SPI implements per semantics
```

- **The Web target, zero transformation**: standard Vite + `@vitejs/plugin-vue` — devtools / HMR / code splitting all work as-is
- **The Mini Program target, compile-time transformation**: tag mapping / reactivity rewriting / style transformation / route generation — the four pipelines all complete at compile time
- **The full end set & their statuses**: see [Ends & maturity](/docs/framework/ends-matrix) (the W-7 end registry — hand-writing a second end list is forbidden)

## Navigating this section

| Group | Contents |
|---|---|
| Semantic Model | CompilerIR & the semantic tree — the contract of “business code → semantic IR” |
| Compile Time | The compiler pipeline in five parts: overview / template / script / style / routes / the rule chain |
| Component Framework | Componentization & audit / reference registration / lifecycle & events / styles & slots |
| Runtime | Web runtime / Mini Program runtime / startup flow |
| Rendering Layer | The RenderBackend SPI + the Flutter / Headless backends |
| Hosts & Memory | Containers & hosts, ownership engineering |
| Data & State | State factories for four ends / data update strategy / inter-page passing / cross-end collaboration |
| Quality & Compatibility | Conformance verification, size budgets, semantic versioning |
| Core Capabilities | Networking, storage, subpackaging & on-demand injection |

## Next steps

- [Pluggable architecture](/docs/framework/22-architecture): the SPI panorama and the “not binding” master table
- [Semantic model](/docs/framework/11-semantic-model): the two contracts (CompilerIR / the semantic tree)

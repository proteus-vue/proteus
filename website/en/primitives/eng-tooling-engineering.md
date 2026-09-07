---
title: Tooling engineering primitives (E24-E28: useDevTools/defineComponent…)
order: 85
group: 工程原语
---

# Tooling engineering primitives (E24-E28: useDevTools/defineComponent…)

Tooling engineering primitives E24-E28: useDevTools/useInspector/defineComponent/defineCapability

> Source module `@proteus-vue/api` (engineering primitive factories — **injection-based**: the consumer injects reactivity/driver/routerLike etc., the api package has zero vue dependency; MP artifact-safe subset: no `?.`/`??`/array destructuring).

**★G-32 B5 continued (3) (proteus-semantic-primitives-plus-plan §8 ④): E24-E28 tooling semantics surface — injectable design**
E24 useDevTools (dev-tooling integration — dev event surface) / E25 useInspector (element inspection — component-tree snapshot)
E26 usePerformance (performance instrumentation — wx.reportPerformance semantics) / E27 defineComponent (typed component definition carrying C-IR metadata)
E28 defineCapability (capability degradation declaration — G-30 degradation-chain resolution)
Injectable: reactivity (vue or mock) + each handle may inject a time source / reporter / probe functions — the createEngineering family with zero runtime dependency on vue
MP artifact-safe (decisions #32/#36): no ?. / ??; no array destructuring

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | Official demo wiring (examples/platform-api-demo — all factories called) |
| WeChat Mini Program | 🟡 | Injectable subset runs on the logic layer (MP artifact-safe); component-form wiring partially rolled out first |
| Headless (SSR/testing) | ✅ | Inject reactivity etc. on Node to run (tooling/testing tier) |
| iOS native | 🟡 | Native validation not started (E-series injection surface follows host batches) |
| Android native | 🟡 | Native validation not started |
| HarmonyOS | 🟡 | Native validation not started |
| Flutter hybrid | 🟡 | same JS logic layer — wiring not started |
| Quick App | ⬜ | target not started |

> Status scale: ✅ target shipped & this primitive usable · 🟡 prototype mapping — wiring not started · ⬜ target not started. Family-level mechanism coverage (not a per-target on-device verification matrix); target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).

## Core exports (SSOT: `packages/api/src/tooling-engineering.ts`)

| Export | Kind | One-liner (source comment) |
|---|---|---|
| `DevToolsEvent` | interface | dev event (consumed by the devtools panel; not emitted while enabled is off) |
| `DevToolsHandle` | interface | E24 useDevTools handle |
| `UseDevToolsOptions` | interface | — |
| `InspectorNode` | interface | Component inspection node (snapshot output) |
| `InspectorHandle` | interface | E25 useInspector handle |
| `PerformanceMetricRecord` | interface | Reported metric record (reactive queue — consumed by the instrumentation panel) |
| `PerformanceHandle` | interface | E26 usePerformance handle |
| `UsePerformanceOptions` | interface | — |
| `ComponentPropDef` | interface | Component prop description (typed declaration — statically extracted by the compiler + aligned with MP properties) |
| `ComponentMeta` | interface | Component definition (C-IR metadata: semantic — consumed by toComponentIR / the rendering backends) |
| `validateComponentMeta` | function | Pure function: validates a component definition (returns the error list; empty = valid) — E27 declaration-time validation, consumed by the compiler / at dev time |
| `defineComponent` | function | / |
| `CapabilityContract` | interface | Capability contract (G-30 degradation-chain declaration) |
| `CapabilityAvailability` | interface | Implementation-availability table (resolveCapabilityChain input) |
| `CapabilityDefinition` | interface | E28 defineCapability handle |
| `validateCapabilityContract` | function | Pure function: validates a capability contract (returns the error list; empty = valid) |
| `resolveCapabilityChain` | function | / |
| `DefineCapabilityOptions` | interface | — |
| `defineCapability` | function | / |
| `ToolingEngineeringOptions` | interface | createToolingEngineering injection options |
| `ToolingEngineering` | interface | G-32 §8 ④ tooling semantics (E24-E28) |
| `createToolingEngineering` | function | / |

## Real usage (dogfooding provenance — the official site itself / example projects run it live, not illustrative)

```ts
const tool = createToolingEngineering({ reactivity: { ref, computed, watch } })
```
> Origin: `examples/pages/platform-api-demo.vue:631`

## Usage & degradation

- **factory injection**: `createXxxEngineering({ reactivity, driver, routerLike… }) → instance` — the consumer injects reactivity (api package has zero vue dependency); instance methods are the E-series primitives
- component forms (e.g. E20 p-animate / E18 p-router-link) enter the C-IR at compile time; injectable Hooks (E1-E28/R1-R4) wire up at runtime per the injected surface
- real example: `examples/pages/platform-api-demo.vue` (E/R factory calls — see the "Real usage" origins)

<!-- generated by website/scripts/gen-primitives.mjs (en overlay) · SSOT：packages/api/src -->
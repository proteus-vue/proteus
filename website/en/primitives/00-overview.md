---
title: Primitives overview
order: 0
group: 总览
---

# Primitives: the soul of Proteus

> One-line framework philosophy: **you write semantics; each target decides the form**. A primitive is that single semantic catalog — declare once, and each target's rendering engine / system capability turns it into its own native implementation.

Everything Proteus ships boils down to **one semantic catalog (136 primitives, the SSOT — `PRIMITIVE_CATALOG`) × multiple consumption forms**. This section documents usage entry by entry, family by family; the components / capabilities two columns are that same catalog's **component form / API form** — complementary to this section, never repeated.

## Family × form matrix

| Family | Semantic domain | Component form | API/directive form | Site location |
|---|---|---|---|---|
| Semantic components | layout / ui / shell (p-* 59) | `p-view` `p-grid` `p-stack`… | —— | [Semantic components overview](/docs/12-components-intro) |
| Capability hooks | capability (50 useXxx) | —— | `useFetch` `useStorage` `useCamera`… | [Capability system](/docs/18-capability-system) |
| Flex layout | fluid (G-22) | `p-fluid` `p-fit` `p-scale`… | `v-p-fluid` | [Flex System overview](/docs/system/01-overview) |
| Desktop/system | desktop (G-24, 21 modules) | —— | `createScrollObserver` `copyText` `v-p-shortcut`… | **this section (below)** |
| Gesture | gesture (G-32 B4) | `p-*` gesture components | `v-gesture` `useGesture` | **this section (below)** |
| Engineering primitives | engineering (E1-E28 + R1-R4) | `p-animate` `p-router-link` (component form) | `createEngineering`-family injection-based factories | **this section (below)** |

> Forms are not copies: the same semantic (say `layout.grid`) can be both `p-grid` (component form) and registered in the catalog entry — **two consumption faces share one semantic inventory** (the 136 SSOT). That is "semantic convergence".

## Desktop/system primitives, entry by entry (this section)

The pages below are produced by the source-code generator (SSOT = `packages/desktop/src/*.ts` — module-header positioning/semantics + export inventory; refresh with `npm run gen:primitives`, never edit by hand):

- **B1 Desktop interaction**: `p-shortcut` keyboard shortcuts · `p-focus-trap` focus trap · `p-context-menu` context menu · `p-hover` hover · directive factories (`v-p-*`)
- **B2 System integration**: `p-notify` notifications · `p-permission` permissions · `p-clipboard` clipboard · `p-deeplink` deep links · pointer glow
- **B3 Navigation structure**: `p-master-detail` three-pane · `p-command` ⌘K · `p-tabs` tabs · `p-breadcrumb` breadcrumbs
- **B4 Lifecycle/device**: `p-lifecycle` · `p-state-restoration` · `p-network-status` · `p-low-power`
- **B5 Web primitives (#449)**: scroll observation · cross-window messaging · anchor positioning · page URL

**Gesture primitives (gesture — this section)**: `Gesture recognizer` (tap/pan/swipe/pinch/rotate… pure logic, zero dependencies; Web Pointer / MP touch normalized into GestureInput) + `useGesture` Hook / `v-gesture` directive (official Web wiring) — "events are a Backend implementation detail"; MP/native ends are taken over by each end's own Backend.

**Engineering primitives (engineering — this section)**: six **injection-based factories** for E1-E28 + R1-R4 (`createEngineering` basics / `createRouterEngineering` / `createAnimationEngineering` / `createToolingEngineering` / `createRequestEngineering` R1-R4 / `createOwnershipEngineering` PSS) — the consumer injects reactivity etc.; the api package has zero vue dependency; MP artifact-safe subset.

Every entry is: **one-line positioning (what it does) → per-target compat rollout (family-level metric) → source positioning quote (module header) → core export table → real usage (dogfooding provenance) → usage & degradation**. Step-by-step examples: [Desktop primitives](/docs/30-desktop-primitives) and [Quality gates](/docs/29-quality-gates) (the official site itself uses these primitives).

## Where to look next

- [Framework overview](/docs/framework/overview): where the semantic layer sits in the six-layer architecture
- [Pluggable architecture](/docs/framework/22-architecture): the G-series dimension tables (platform API / rendering / compiler / layout / desktop… each in its place)
- [Semantic components overview](/docs/12-components-intro) / [Capability system](/docs/18-capability-system): the other two faces of the same catalog

---
title: Flex System overview
order: 1
group: 柔性系统
---

# Flex System

> **Declare intent, not sizes; write content, not form branches.** You state *what* you want; the container and the device form decide *how* it lays out.

## Get started in 30 seconds

```vue
<template>
  <!-- 1. Fluid typography: 32px at the 375 design width → 54px at a 1440 viewport, interpolated continuously (zero jumps) -->
  <p-heading :level="1" v-p-fluid="'font-size(32, 54)'">One semantic model.</p-heading>

  <!-- 2. Fluid grid: declare only "at least this wide per column" — the column count is solved from the container -->
  <p-grid :min-col-width="250" :gap="14">
    <p-box v-for="item in items" :key="item.id" />
  </p-grid>

  <!-- 3. Adaptive sidebar: a rail when the container is wide enough, a collapsing toggle bar when it is not -->
  <p-sidebar :min-sidebar-width="720" :nav-width="200">
    <template #nav>…</template>
    …
  </p-sidebar>
</template>
```

Three declarations solve three things: **continuous type scaling, automatic column counts, adaptive navigation**. No `@media`, no JS width branches, no `window.innerWidth`.

> This is the **real code running on this site's home page** (`website/src/pages/Home.vue`), not an illustration — resize the window to verify.

## What it solves

| What you want | Hand-written responsive CSS | Flex System |
|---|---|---|
| Type that scales with the screen | Three or four breakpoints, jumping at each | One line: `v-p-fluid="'font-size(32, 54)'"`, continuous |
| Card column count that adapts | Hand-computed columns + breakpoints | `p-grid :min-col-width="250"`, solved automatically |
| A component inside a split view / card | `@media` keys off the **viewport** and fails → JS fallback | Solved against the **container**, correct wherever it sits |
| One codebase on seven devices | One branch set per target / `#ifdef` | **Zero form branches**; the framework swaps layout and capability set |
| Parity across targets (native) | Native targets have no media queries — immediate mismatch | Semantic primitives + each target's native container |

The third row is the crux: **media queries solve against the viewport, but a component lives inside a container.** The same card is 1440px full-screen, 700px in a split view, 300px inside a dashboard tile — viewport breakpoints fail for all of it.

## Three core concepts

| Concept | In one sentence | Read more |
|---|---|---|
| **Container solving** | Breakpoints key off the **container** width, not the viewport — correct in any container | [Container queries](/docs/system/02-container-query) |
| **Form profiles** | One `FORM_PROFILES` table declares 7 device forms (input / viewing distance / topology / navigation / capabilities); the framework swaps layout from it | [Form profiles](/docs/system/06-form-profiles) |
| **Capability tri-state** | A capability is not a boolean: `supported` / `fallback` (a degradation path) / `unsupported`, each with a render consequence | [Capability tri-state](/docs/system/08-capabilities) |

Underneath sits one solving formula: **sizes are driven by container width alone** — `k = clamp(min, w/ref, max)`, every variable `k × baseline` ([Fluid metrics](/docs/system/07-fluid-metrics)).

## Pick your path

| I want to… | Read these | Time |
|---|---|---|
| **Get page layout right** | This page → [Fluid grid](/docs/system/03-fluid-grid) → [Adaptive sidebar](/docs/system/04-sidebar) | 15 min |
| **One codebase across targets** | [Form profiles](/docs/system/06-form-profiles) → [One set of slots, seven forms](/docs/system/11-formfactor-composition) → [Multi-device demo](/multi-device) | 30 min |
| **Understand how sizes are solved** | [Fluid metrics](/docs/system/07-fluid-metrics) → [Container queries](/docs/system/02-container-query) | 20 min |
| **Handle foldables / in-car / TV** | [Fold postures](/docs/system/09-postures) → [Focus navigation](/docs/system/10-focus-navigation) → [Capability tri-state](/docs/system/08-capabilities) | 30 min |
| **Look up APIs and gates** | [Breakpoints & forms](/docs/system/05-breakpoints) → [p-formfactor API](/docs/component/p-formfactor) | as needed |

## Recipes

```vue
<!-- Fluid on any CSS property: prop(min, max) — min at the design width, max on large screens, continuous in between -->
<p-box v-p-fluid="'padding-top(24, 44) padding-bottom(40, 76)'" />

<!-- Grid: give only a minimum column width, the column count follows -->
<p-grid :min-col-width="380" :gap="40">…</p-grid>

<!-- Flexible stack: wraps when it gets narrow -->
<p-stack direction="row" wrap :gap="12">…</p-stack>

<!-- Split: side by side in wide containers, stacked in narrow ones -->
<p-split :min-split-width="640" :gap="16">
  <template #aside>…</template>
  …
</p-split>
```

```bash
proteus fluid:check   # compile-time gate: FLD rules are machine-checked (enforced in CI)
```

## Two layers (how this section's 11 pages are organised)

| Layer | What it solves | Capabilities |
|---|---|---|
| **L1 container solving** (since G-22) | "A component living inside a container" — breakpoints, grids, splits, navigation folding | `p-fluid` · `p-grid` · `p-stack`/`p-fit` · `p-split` · `p-sidebar` · `p-adaptive` · `createContainerQuery` |
| **L2 form solving** (2026-09 rebuild) | "Device form as a first-class citizen" — one codebase swapping layout, navigation and capability set | `FORM_PROFILES` · `resolveFluidMetrics` · `CapsLevel` · `postures[]` · `navigateFocus` · `p-formfactor` |

One sentence for the difference: **L1 makes "a card inside a narrow container" correct; L2 makes "the same code a cockpit on an in-car display and a poster row on TV".**

## The zero-`@media` iron rules

| Rule | Content |
|---|---|
| FLD001 | No hand-written `@media` breakpoints (no cross-target parity) |
| FLD002 | No hard-coded breakpoint numbers |
| FLD003 | `p-fluid` must carry a range `(min, max)` |
| FLD004 | `p-grid` must declare `min-col-width` |
| FLD008 | No manual `if (width < 600)` width branching |

This is not a slogan: **this entire site ships zero `@media`** (the home page uses `v-p-fluid`, capability cards use `p-grid`, docs pages use `p-sidebar`) and CI blocks hand-written breakpoints — the official site is itself the Flex System's acceptance ground.

## Landing status (honest tiering)

| Batch | Contents | Status |
|---|---|---|
| G-22 four primitives | `p-fluid` / `p-grid` / `p-stack` / `p-fit` | ✅ |
| S1–S4 | `@proteus-vue/fluid` split-out + `p-split`/`p-zone` + `p-safe`/`p-aspect` + `p-sidebar`/`p-toolbar` + `p-scale` accessibility | ✅ |
| G-22.5 form ranges | `p-adaptive` (sheet / dialog / popover) + `p-modal` auto-switching | ✅ |
| **L2 form layer** | **7 form profiles + fluid metrics v3 + 14 capability tri-states + 3 fold postures + focus navigation + `p-formfactor`** | **✅** |
| S5 all ends | Component catalog into the packages + the App-side native solver interface; `useContainerProfile()` composite entry | ⬜ |

> Status legend: ✅ landed and verifiable · ⬜ not implemented. The runtime core is the standalone, dependency-free `@proteus-vue/fluid` package: `createContainerQuery` / `createSizeAwareObserver` / `createDeviceEnv` / `detectFluidCapabilities` / `createAdaptiveController`.

## Next steps

- **Just want to build**: the 30-second snippet above plus [Fluid grid](/docs/system/03-fluid-grid) is enough to start
- **Going multi-target**: [Multi-device demo](/multi-device) — switch all seven forms by hand (the right panel shows the capability tri-state)
- **Read the whole section**: [Container queries](/docs/system/02-container-query) · [Fluid grid](/docs/system/03-fluid-grid) · [Adaptive sidebar](/docs/system/04-sidebar) · [Breakpoints & forms](/docs/system/05-breakpoints) · [Form profiles](/docs/system/06-form-profiles) · [Fluid metrics](/docs/system/07-fluid-metrics) · [Capability tri-state](/docs/system/08-capabilities) · [Fold postures](/docs/system/09-postures) · [Focus navigation](/docs/system/10-focus-navigation) · [One set of slots, seven forms](/docs/system/11-formfactor-composition)
- **Related sections**: [Semantic primitives](/docs/primitives) · [Components overview](/docs/12-components-intro) · [Ends & maturity](/docs/framework/ends-matrix)

---
title: Flex System overview
order: 1
group: 柔性系统
---

# Flex System overview

> **Declare responsive intent; the framework solves it against the container.**
> You write no `@media`, no JS width branches, no column-count math — you declare the "what", and the container-query runtime handles the "how".

The Flex System is Proteus's responsive-layout system (G-22 Fluid System). Its essence is **folding the OS-level fluid layout capabilities of each end vendor into the framework** — iOS `UIStackView` / `UICollectionView`, Android `ConstraintLayout` / `GridLayoutManager`, HarmonyOS `Flex` / `Grid`, Web CSS Grid / `clamp()` / container queries — rather than inventing a new unit.

## What it solves: breakpoint explosion

Hand-written responsiveness does not cost "writing one `@media`" — it is combinatorial explosion across three dimensions:

| Dimension | Example | Consequence |
|---|---|---|
| Breakpoint count | 768 / 1024 / 1440…… | Every tier added means re-verifying every page |
| Device form factor | Phone / tablet / foldable / in-vehicle / TV | One branch set per form factor |
| Container context | Fullscreen / half-width split screen / inside a card / multi-window | The same component needs different breakpoints in different containers |

The third dimension is where `@media` dies: **media queries are solved against the viewport, yet components live inside containers**. The same card gets 1440px fullscreen, only 700px in a split pane, and only 300px when squeezed into a dashboard card — viewport breakpoints all fail it, leaving no recourse but JS width branches (the same family as the `Dimensions.get()` that FLD006 forbids). And `@media` has no cross-end equivalent: native app ends have no media queries, so the same source code simply mismatches on native render ends (FLD001: error-level, no hand-writing).

rpx is not the answer either. rpx is a "unit conversion" (value × screen width / 750) and the layout structure never changes; the Flex System is a "layout-engine capability" — the three-layer comparison:

| Layer | rpx | Flex System |
|---|---|---|
| Numeric scaling | ✅ proportional conversion (no upper or lower bound) | ✅ `p-fluid` clamp range (held within min/max) |
| Structural adaptation | ❌ column count / wrapping / direction stay fixed | ✅ `p-grid` self-adapts the column count / `p-stack` wraps / `p-split` splits panes |
| Form factor adaptation | ❌ no awareness of foldables / split screen / multi-window | ✅ container queries + breakpoint switching + folded forms |

## Core philosophy: layout = constraint solving

Layout is constraint solving at its core — given the container's size and each child's constraints, solve how the children lay out. Traditional frameworks hand this solving to the developer (media queries, JS computation, `LayoutBuilder`); the Flex System sinks it down into the framework:

```vue
<!-- Traditional (imperative): the developer hand-computes the column count -->
<!-- if (width < 768) columns = 1; else if (width < 1024) columns = 2; else columns = 3 -->

<!-- Fluid (declarative): only the intent is declared; the framework solves it -->
<p-grid :min-col-width="160">
  <p-card v-for="item in items" :key="item.id" />
</p-grid>
```

The framework defines only the "what" (semantic primitives + the FluidContext reactive context); each end implements the "how" with its own native containers — Web via CSS Grid / `clamp()` / container queries, native ends by mapping system-level grid containers. **Proteus does not simulate grids; each platform implements the same semantics with its own native capability.**

## The whole Flex System in one snippet

Real usage on this website (the Hero comes from the homepage; the sidebar comes from the docs page you are reading right now — drag the window to verify it directly):

```vue
<template>
  <!-- Fluid typography: 30px on the 375 design mockup, 60px at a 1440px viewport — clamp interpolates continuously with zero jumps -->
  <p-heading :level="1" v-p-fluid="'font-size(30, 60)'">One semantic model.</p-heading>

  <!-- Fluid grid: declare only the minimum column width; the column count stretches automatically with the container -->
  <p-grid :min-col-width="280" :gap="14">…</p-grid>

  <!-- Adaptive sidebar: a side rail in wide containers, auto-collapsing in narrow ones -->
  <p-sidebar :min-sidebar-width="720">
    <template #nav>…</template>
    …
  </p-sidebar>
</template>
```

## The three flagship capabilities + the whole primitive family

The Flex System's three flagship capabilities (one page each in this section):

| Capability | Primitive | In one sentence | Read more |
|---|---|---|---|
| Split panes | `p-split` | Narrow containers stack, wide containers sit side by side — the core primitive for tablets / vehicle dashboards / multi-window | [Container queries: solved against the container](/docs/system/02-container-query) · [Layout components](/docs/13-layout-components) |
| Fluid grid | `p-grid` | Declare only a minimum column width; the column count is solved automatically | [Fluid grid](/docs/system/03-fluid-grid) |
| Adaptive sidebar | `p-sidebar` | A side rail in wide containers, a collapsing toggle bar in narrow ones (the same interaction as VitePress) | [Adaptive sidebar](/docs/system/04-sidebar) |

The whole primitive family, with its landing batches (honest tiering):

| Batch | Contents | Status |
|---|---|---|
| The G-22 four primitives | `p-fluid` (fluid clamp) / `p-grid` / `p-stack` (flexible stack) / `p-fit` (intrinsic size) | ✅ |
| S1 split-out | `@proteus-vue/fluid` + FluidContext (container queries / breakpoints / orientation) + `p-split` + `p-zone` (container-breakpoint zones) + capability detection + `p-grid` degradation | ✅ |
| S2 safe areas & form factors | `p-safe` (notch / hinge avoidance) + `p-aspect` (aspect ratio) + folded-form display-mode | ✅ |
| S3 navigation | `p-sidebar` / `p-toolbar` (overflow folding) + in-vehicle d-pad focus + drive-mode motion gate | ✅ |
| S4 accessibility | `p-scale` dynamic font size / density + FLD012/013 rules | ✅ |
| G-22.5 forms | `p-adaptive` form-range expressions (the sheet / dialog / popover tiers), `p-modal` auto-switching forms | ✅ |
| S5 all ends | Component catalog goes into the packages + the App-side native solver interface | ⬜ |

> Status legend: ✅ landed and verifiable · ⬜ planned and logged.

The runtime core is a standalone package, `@proteus-vue/fluid` (pure logic, zero dependencies): `createContainerQuery` (container queries), `createSizeAwareObserver` (a unified breakpoint entry for container + viewport), `createDeviceEnv` (folded forms / drive mode / reduced motion), `detectFluidCapabilities` (capability probing and degradation), `createAdaptiveController` (form solving) — API details in [Container queries: solved against the container](/docs/system/02-container-query).

## The zero-`@media` iron rules

- FLD001: no hand-written `@media` breakpoints (they have no cross-end equivalent; breakpoint logic belongs to the semantic primitives)
- FLD002: no hardcoded breakpoint numbers
- FLD003: `p-fluid` must always be given a range (min, max)
- FLD004: `p-grid` must declare `min-col-width`
- FLD008: no manual `if (width < 600)` width branches

```bash
proteus fluid:check   # compile-time gate: the FLD rules are machine-checkable; CI enforces them
```

This is not a slogan: the official site you are reading is zero `@media` end to end (the W-6 fluid-framework-first principle — the CI gate blocks hand-written breakpoints) — typography goes through `v-p-fluid` clamp, the capability cards go through `p-grid`, and the docs pages go through `p-sidebar`. **The official site itself is the Flex System's proving ground.**

## Next steps

- [Container queries: solved against the container](/docs/system/02-container-query): the real createContainerQuery API and its solving baseline
- [Fluid grid](/docs/system/03-fluid-grid): p-grid declares only the minimum column width
- [Adaptive sidebar](/docs/system/04-sidebar): the three-state state machine + in-vehicle d-pad focus

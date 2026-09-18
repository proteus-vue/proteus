---
title: Fluid grid
order: 3
group: 柔性系统
---

# Fluid grid

> **The column count is not yours to compute.** You only declare a "minimum width per column", and the column count stretches automatically with the container width — continuous throughout, no breakpoint jumps.

## The problem with hand-written grids

```css
/* ❌ hand-written: the column count is a function of breakpoint magic numbers */
.cards { grid-template-columns: repeat(3, 1fr); }
@media (max-width: 1024px) { .cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .cards { grid-template-columns: 1fr; } }
```

Three breakpoints × every page × every container position — the canonical form of [breakpoint explosion](/docs/system/01-overview). Worse: drop this card into a 500px sidebar and the viewport breakpoints know nothing about it — the three-column layout blows up. And hand-computing the column count (reading the width in JS then `setState`) is exactly the width branch FLD008 forbids.

## p-grid: declare only the minimum column width

| prop | Type / default | Description |
|---|---|---|
| `min-col-width` | Number, `160` | Minimum width per column in px — the column count is solved automatically (FLD004: it must be declared) |
| `gap` | Number, `12` | Column / row gap in px |

```vue
<p-grid :min-col-width="160" :gap="12">
  <p-card v-for="item in items" :key="item.id" />
</p-grid>
```

On the Web end this generates native CSS Grid (the browser reflows by itself — zero JS cost):

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
gap: 12px;
```

A 320px container → 1 column, 768px → 4 columns, 1440px → 8 columns; it changes continuously while you drag the window. **Breakpoint magic numbers are replaced by one semantic parameter (`min-col-width`)** — the design says "cards are at least 280px", you write `:min-col-width="280"`, and the column count is a solved result, not a hand-written conclusion.

## Compared with a hand-written grid

| Dimension | Hand-written grid + `@media` | `p-grid` |
|---|---|---|
| Column count | Written by hand once per breakpoint | auto-fill solves it automatically |
| Breakpoint magic numbers | 768 / 1024 / 1440 scattered everywhere | none (only the min-col-width semantics) |
| Container context | Viewport breakpoints fail for cards / split panes | Automatically correct by container width |
| Cross-end mapping | CSS only | iOS `UICollectionView` / Android `GridLayoutManager` / HarmonyOS `Grid` / Web CSS Grid |
| Governance | none | The FLD004 gate forces min-col-width to be declared |

Principle #10 projected once more: the framework defines the "adaptive grid" semantics, and each end implements it with **its own system-level grid container** — Proteus does not simulate grids.

## A real example: this website

The capability cards and the data-endorsement strip on the site's homepage are `p-grid` (drag the window and watch the column count stretch continuously, with zero breakpoints the whole way):

```vue
<!-- Capability cards: cards at least 280px -->
<p-grid :min-col-width="280" :gap="14">
  <p-view v-for="p in pillars" :key="p.no" class="pillar-card">…</p-view>
</p-grid>

<!-- Data bar: smaller cells, at least 200px -->
<p-grid :min-col-width="200" :gap="12">
  <p-view v-for="s in stats" :key="s.label" class="stat">…</p-view>
</p-grid>
```

## Degradation: plain but correct (G-22.2)

The grid is solved in pure CSS and needs no JS size listening; degradation happens only when "the render end does not support grid":

- One `detectFluidCapabilities().grid` probe runs at component init (`CSS.supports` checking `repeat(auto-fit, minmax(...))`):
  - supported → native CSS Grid
  - unsupported → **flex-wrap emulation**: the container is `display: flex; flex-wrap: wrap`, each child is `min-width: var(--pgrid-min)` + `flex: 1 1 auto` — `--pgrid-min` is injected inline by the component, and the global rule `.p-grid-fallback > *` takes effect through the container class
- Mini Program: the logic layer has no `CSS.supports` → support is assumed, always grid mode; the render end decides for itself — webview rendering supports grid, while Skyline degrades to a plain container (still a plain-but-correct arrangement)

## When not to use a grid

| Need | Use | Reason |
|---|---|---|
| One-dimensional content flow that wraps when space runs out | `p-stack` (`:wrap="true"`) | Tags / button groups do not need equal-width columns |
| Two-pane split screen (editor + artifact) | [p-split](/docs/13-layout-components) | Stacking / side-by-side switching, not equal column division |
| Single-property fluid scaling (font size / spacing) | `p-fluid` (the `v-p-fluid` directive) | See [Fluid layout](/docs/17-fluid-layout) |

## Next steps

- [Adaptive sidebar](/docs/system/04-sidebar): the three-state state machine of navigation layouts
- [Fluid layout](/docs/17-fluid-layout): the four G-22 primitives and the FLD iron rules
- [Layout components: p-view / p-stack / p-split / p-sidebar](/docs/13-layout-components): recipes for p-view / p-stack / p-split / p-sidebar

---
title: Layout components: p-view / p-stack / p-split / p-sidebar
order: 13
group: 基础概念
---

# Layout components: p-view / p-stack / p-split / p-sidebar

Layout components hand the "responsive intent" to the framework to solve: you declare the container semantics (split panes / sidebar / wrap), and breakpoint and form switching is done by the container-query runtime inside the components — **solved against the container, not the viewport** (split-screen, multi-window, and embedded cards each adapt to their own container width), with zero `@media` and zero JS width branches on the business side (FLD001 / FLD006).

> **First iron rule of this page: `p-view` defaults to `box-sizing: content-box`.**
> This is a deliberate design aligned with the Mini Program Skyline. Every "width 100% + padding" combination must explicitly set `border-box`; otherwise the padding expands outward and punches through the parent container — the official site's measured root cause: content area 584px > container 556px. Page styles are always scoped + carry an explicit `box-sizing`.

## p-view: the base of every container

Its default styles are only three: `display: flex; flex-direction: column; box-sizing: content-box`. Props: `pid` / `disabled` (opacity drops to 0.6) / `ariaLabel`.

```vue
<p-view class="hero-content">
  <p-heading :level="1">One semantic model.</p-heading>
  <p-text>Semantic components overview</p-text>
</p-view>
```

```css
/* ❌ default content-box: width 100% + padding → padding expands outward and punches through the container */
.card.p-view { width: 100%; padding: 16px; }

/* ✅ explicit border-box — mandatory for any width 100% + padding combination */
.card.p-view { width: 100%; padding: 16px; box-sizing: border-box; }
```

Override the direction explicitly when you need horizontal layout (a page-level modifier class; the component keeps its semantic default):

```css
.row.p-view { flex-direction: row; }
```

## p-stack: the flexible stack

Direction + spacing + smart wrapping, with `flex + gap` inside:

| prop | Type / default | Description |
|---|---|---|
| `direction` | String, `column` | Main-axis direction: `row` horizontal / `column` vertical |
| `wrap` | Boolean, `false` | Auto-wraps when space runs out (effective when laid out in a `row`) |
| `gap` | Number, `0` | Spacing between children, px |

Real usage on the official site's nav bar (horizontal + wrappable — on narrow screens items wrap without overflowing):

```vue
<p-stack direction="row" :gap="8" wrap class="nav">
  <router-link to="/" class="brand">…</router-link>
  <p-stack direction="row" :gap="4" wrap class="nav-links">
    <router-link v-for="l in links" :key="l.key" :to="l.to" class="nav-link">…</router-link>
  </p-stack>
</p-stack>
```

## p-split: adaptive split panes

The core primitive for tablets / vehicle dashboards / multi-window. Container width `< min-split-width` → stacked (vertical); `≥` → side by side (horizontal) — the same code, no breakpoints, no JS branches.

| prop | Type / default | Description |
|---|---|---|
| `min-split-width` | Number, `640` | At or above this width the panes sit side by side; below it they stack |
| `gap` | Number, `16` | Spacing between panes / stacked blocks, px |
| `design-width` | Number, `375` | Base width for deriving the container breakpoint |

**The first pane must go in the `#aside` named slot**, and the second pane goes in the default slot (the official site once put both panes in the default slot, so the split state never took effect — fixed in #386):

```vue
<p-split :min-split-width="880" :gap="16" class="pg-grid">
  <template #aside>
    <p-view class="pg-pane">Editor…</p-view>
  </template>
  <p-view class="pg-pane">Artifacts / IR / Trace…</p-view>
</p-split>
```

```css
/* Mode belongs to the primitive, column widths belong to the page: equal halves + panels filling the height are declared at the page level */
.pg-grid { display: flex; align-items: stretch; }
.pg-grid > .pg-pane { flex: 1 1 0; min-width: 0; }
```

> The Mini Program target has no ResizeObserver → always stacked (the main phone scenario; the render target decides its own graceful degradation).

## p-sidebar: adaptive side navigation

The skeleton of documentation pages / settings pages. A three-state state machine: **isWide (derived from the container) is orthogonal to userExpanded (user intent)** — container changes only update isWide and never override the user's interaction state.

| State | Root class | Trigger | Form |
|---|---|---|---|
| side-rail | `p-sidebar-side-rail` | Container ≥ min-sidebar-width | Fixed-width vertical side rail on the left |
| collapsed | `p-sidebar-collapsed` | Narrow container + user hasn't expressed intent | The toggle bar stays; the navigation is tucked away |
| collapsed-open | `p-sidebar-collapsed-open` | Narrow container + user opens the toggle bar | The navigation is shown laid out horizontally |

| prop | Type / default | Description |
|---|---|---|
| `min-sidebar-width` | Number, `640` | At or above this width → side-rail |
| `nav-width` | Number, `200` | Width of the side-rail navigation, px |
| `design-width` | Number, `375` | Base width for deriving the container breakpoint |
| `toggle-label` | String, `'导航'` | Text of the collapsed toggle bar |

Real usage on the official docs pages (two slots — navigation + body — zero layout code in business):

```vue
<p-sidebar :min-sidebar-width="720" :nav-width="240" class="guide">
  <template #nav>
    <p-view class="sidebar-card">Grouped navigation list…</p-view>
  </template>
  <p-view class="doc">Body…</p-view>
</p-sidebar>
```

Built-in capabilities (given by the component — nothing to write):

- **Panel spacing, componentized**: 32px between the sidebar and the main content column, 24px between rows in the expanded state.
- **Vehicle d-pad focus navigation**: the Arrow keys move focus among nav items (up/down in side-rail state, left/right in the expanded state).
- **Motion gate**: drive-mode / `prefers-reduced-motion` → the root class `p-sidebar-no-motion` is added, disabling transition animations across the whole component.
- The root class names are the **official signal for pages to adapt their presentation per state** (e.g., in side-rail state the sidebar card turns sticky, deferring to the navigation).
- The Mini Program target has no ResizeObserver → always collapsed.

## Recipes: writing common layouts

```vue
<!-- Card grid: automatic column count (fewer columns when narrow, more when wide) -->
<p-grid :min-col-width="280" :gap="14">
  <p-view v-for="p in pillars" :key="p.no" v-p-hover class="pillar-card">…</p-view>
</p-grid>

<!-- Horizontal push-apart: heading on the left, button on the right, flexible gap in the middle -->
<p-stack direction="row" :gap="12">
  <p-heading :level="3">Title</p-heading>
  <p-spacer />
  <p-button>Action</p-button>
</p-stack>

<!-- Settings-page skeleton: collapses in narrow containers, side rail in wide ones -->
<p-sidebar :min-sidebar-width="720" :nav-width="240">
  <template #nav>…</template>
  …
</p-sidebar>
```

| Need | Use | One-line reason |
|---|---|---|
| Vertical content flow | `p-view` | flex-column by default |
| Horizontal / wrapping / spacing | `p-stack` | gap + wrap declared in one place |
| Equal-width adaptive grid | `p-grid` | Declare only the minimum column width |
| Two-pane split screen | `p-split` | Container queries auto stack / sit side by side |
| Navigation + content | `p-sidebar` | Three states + d-pad + motion gate all built in |
| Push-apart alignment | `p-spacer` | Flexible placeholder (flex-grow: 1) |

## Next steps

- [Fluid layout](/docs/17-fluid-layout): v-p-fluid clamp expressions and the breakpoint system
- [Feedback & motion](/docs/14-feedback-components): p-segment / p-toast / p-animate
- [Liquid glass](/docs/31-liquid-glass): combining pg-glass with the layout components

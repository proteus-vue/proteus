---
title: Semantic components overview
order: 12
group: 基础概念
---

# Semantic components overview

Proteus's components are not "yet another cross-target UI library" — they are **semantic components**: every `p-*` tag only declares "what you want" — semantics + constraints (a props contract). At compile time, **G-31 semantic mapping** translates the semantics into each target's native controls: `div` / `button` on Web, `view` / `text` in Mini Programs, `UIView` / `UIButton` on iOS, `FrameLayout` / `TextView` on Android. Business code has zero awareness of the rendering target.

> **A component is a semantic in component form, not a container for styles.**
> The same source: `p-view` renders `div` on Web and maps to Mini Program `view` at compile time (the same source for both targets); `p-button`'s `@click` compiles to `bind:tap`. The [semantics → native control mapping](/docs/framework/11-semantic-model) (Semantic Model section) is locked by the seven-target reference table, and a [conformance snapshot gate](/docs/framework/29-conformance) (implemented semantics × 6 render backends) prevents it from drifting.

## Why not a "style library"

| | Traditional cross-target UI library | Proteus semantic components |
|---|---|---|
| Component essence | Styling + structure packaged together | Semantics + constraints (props contract) |
| Rendering form | Self-drawn or emulated via WebView | Mapped at compile time to each target's native controls |
| Platform differences | Runtime `if (isXxx)` branches | Backend implementation, zero branches in business code (PRIM001 bans manual platform checks) |
| Cross-target consistency | Aligned by hand | Conformance snapshot gate |

Below the component layer sits the **136-primitive SSOT** (six families: layout / ui / shell / gesture / capability / engineering): components are the `p-*` component form of primitives, and capability Hooks (`useXxx`) are the API form of primitives — both layers share the same semantic inventory.

## Component catalog

The single aggregation point of the catalog: `src/components/index.ts` (59 `p-*` semantic components + the glass container `pg-glass`).

### Layout (G-22 fluid layout + layout primitives)

| Component | One-line purpose |
|---|---|
| `p-view` | Universal container: flex column + content-box by default (the iron rule lives in [Layout components](/docs/13-layout-components)) |
| `p-stack` | Flexible stack: direction + spacing + auto-wrap when space runs out |
| `p-grid` | Adaptive grid: declare only `min-col-width`, the column count is solved automatically |
| `p-split` | Adaptive panes: stacks in narrow containers, sits side by side in wide ones (solved via container queries) |
| `p-zone` | Container-breakpoint zones: sm/md/lg/xl render different child layouts |
| `p-sidebar` | Adaptive side navigation: left rail in wide containers, collapsed in narrow ones |
| `p-toolbar` | Toolbar overflow folding: items that do not fit are automatically tucked into "More" |
| `p-safe` | Safe-area avoidance: notch / hinge / rounded corners |
| `p-aspect` | Aspect-ratio container |
| `p-fit` | Intrinsic sizing |
| `p-scale` | Dynamic font size / density (accessibility levels) |
| `p-adaptive` | Form-range declaration → sheet / dialog / popover |
| `p-modal` | Modal: the form switches automatically with width |
| `p-inline` | Inline layout |
| `p-spacer` | Flexible whitespace: pushes the layout open so later elements hug the edge |
| `p-divider` | Divider: horizontal / vertical + inset |
| `p-scroll` | Scroll container (as a layout primitive) |

### Scrolling & lists

| Component | Purpose |
|---|---|
| `p-scroll-view` | Scrollable area |
| `p-list-view` | List container |
| `p-virtual-list` | Virtual list (long lists render only the visible region) |
| `p-masonry` | Masonry flow |
| `p-scrollable` | Scrollable (gesture semantics: loadMore at the bottom) |
| `p-draggable` | Draggable (gesture semantics: drag shadow + grid snapping) |
| `VirtualList` | Web-target compatible form of the virtual list (no `p-` prefix; import on demand) |

### Basic views

| Component | Purpose |
|---|---|
| `p-text` | Text (`selectable` mapped on both targets) |
| `p-heading` | Heading, levels 1-6 |
| `p-button` | Button (loading / throttle built in) |
| `p-image` / `p-icon` / `p-avatar` | Image / icon / avatar |
| `p-media` | Unified media entry (image / video / audio / live) |
| `p-canvas` / `p-svg` / `p-rich-text` | Canvas / vector / rich text |
| `p-router-link` | Declarative navigation |

### Forms

| Component | Purpose |
|---|---|
| `p-input` / `p-textarea` | Input / multiline input |
| `p-select` / `p-picker` | Dropdown select / picker |
| `p-checkbox` / `p-radio` / `p-switch` / `p-slider` | Checkbox / radio / switch / slider |
| `p-form` | Form: aggregates rules validation + validate / submit |

### Shell & navigation

| Component | Purpose |
|---|---|
| `p-page` | Page root: semantic declarations for title / statusBar / pullRefresh |
| `p-nav-bar` / `p-nav` | Nav bar / navigation (left and right slots) |
| `p-tabbar` | Bottom tab bar |
| `p-drawer` | Drawer |
| `p-segment` | Segmented control (see [Feedback & motion](/docs/14-feedback-components)) |
| `p-popover` / `p-action-sheet` | Popover / action sheet |

### Feedback & motion

| Component | Purpose |
|---|---|
| `p-toast` | Lightweight toast |
| `p-loading` / `p-skeleton` | Loading indicator / skeleton screen |
| `p-mask` / `p-popup` | Mask / popup layer |
| `p-error-boundary` | Error boundary |
| `p-transition` / `p-animate` | Show/hide transitions / animation primitives |

### Desktop & glass

| Entry | Purpose |
|---|---|
| `v-p-hover` / `v-p-shortcut` / `v-p-focus-trap` / `v-p-context-menu` / `v-p-permission` / `v-p-cursor-glow` | Desktop interaction directives (see [Desktop primitives](/docs/30-desktop-primitives)) |
| `pg-glass` | Unified liquid-glass entry (see [Liquid glass](/docs/31-liquid-glass)) |

## How to use

```ts
// Web target: import on demand (aggregate export, precise aliases)
import { PView, PStack, PgGlass } from '@proteus-vue/components'
```

```ts
// Global registration (the official site's current dogfooding setup — website/src/main.ts)
import { PView, PSidebar, PgGlass } from '@proteus-vue/components'
app.component('p-view', PView)
app.component('p-sidebar', PSidebar)
app.component('pg-glass', PgGlass)
```

Mini Program target: **zero imports** — write `<p-view>` directly in the template; at compile time the framework component is resolved automatically (the `/proteus/` prefix), with no registration needed.

> Naming contract (G-31.1): semantic components always take the `p-` prefix and glass components the `pg-` prefix, and must not share names with Mini Program / HTML tags — a non-`p-` tag produces no semantic IR and only enters the compatibility layer.

## Next steps

- [Layout components: p-view / p-stack / p-split / p-sidebar](/docs/13-layout-components): p-view / p-stack / p-split / p-sidebar, dissected one by one + recipes
- [Feedback & motion: p-segment / p-toast / p-animate](/docs/14-feedback-components): p-segment / p-toast / p-animate
- [Fluid layout](/docs/17-fluid-layout): the responsive-solving system behind the layout components

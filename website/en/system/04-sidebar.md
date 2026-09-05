---
title: Adaptive sidebar
order: 4
group: 柔性系统
---

# Adaptive sidebar

> Navigation is the skeleton of every app, and the most tedious part of responsiveness: a wide screen wants a left side rail, a narrow screen wants it collapsed, and an expanded state wants the items in a horizontal row. `p-sidebar` packs these three layouts into one component — you only write the navigation items and the body.

## The problem with hand-written navigation layouts

The same navigation: a full screen wants a left side rail; dropped into a tablet's half-width split screen it must collapse; squeezed into a card / multi-window it must run horizontally. Hand-writing means three sets of DOM and styles, a pile of `@media` or JS width branches, a collapse interaction, and accessibility attributes — repeated on every page. `p-sidebar`'s division of labor: **layout and collapse interaction belong to the component; business only plugs into the slots** (`#nav` holds the navigation, the default slot holds the body).

## Three-state state machine

| State | Root class | Trigger | Form |
|---|---|---|---|
| side-rail | `p-sidebar-side-rail` | Container ≥ `min-sidebar-width` | Fixed-width vertical side rail on the left (`nav-width`) |
| collapsed | `p-sidebar-collapsed` | Narrow container + user hasn't expressed intent | Built-in "☰ Navigation" toggle bar; the navigation is tucked away |
| collapsed-open | `p-sidebar-collapsed-open` | Narrow container + user opens the toggle bar | The navigation is shown laid out horizontally |

The state machine is an **orthogonal design**: the container-derived (`isWide`) and user-intent (`userExpanded`) signals are kept separate, then composed into the three states:

```ts
// The container callback only updates isWide and never touches userExpanded
mode = isWide ? 'side-rail' : (userExpanded === true ? 'collapsed-open' : 'collapsed')
```

This discipline comes from a real bug: an early version's ResizeObserver callback unconditionally wrote mode back, and the loop "render → slight size change → RO callback → write-back" swallowed the user's clicks — container-derived state and user intent must stay orthogonal, so the interaction state is never overwritten by timing.

So every switching trigger is solved automatically from the container query and user intent — zero business code:

| When | State transition | What you write |
|---|---|---|
| Container dragged narrow to < `min-sidebar-width` | side-rail → collapsed | None (the container query handles it automatically) |
| User taps the "☰ Navigation" toggle bar | collapsed ↔ collapsed-open | None (the toggle bar is built in) |
| Container dragged wide to ≥ `min-sidebar-width` | collapsed-open → side-rail | None (user intent is preserved; a wide container is always a side rail) |
| drive-mode / reduced-motion matches | append `p-sidebar-no-motion` | None (the motion gate is automatic) |

## Props

| Prop | Type / default | Description |
|---|---|---|
| `min-sidebar-width` | Number, `640` | Container reaching this value → side-rail; below it → collapsed |
| `nav-width` | Number, `200` | Width of the side rail, px |
| `design-width` | Number, `375` | Base width for deriving the container breakpoint |
| `toggle-label` | String, `'导航'` | Text of the collapsed toggle bar |

## Usage: the official site's /docs page is a live example

```vue
<p-sidebar :min-sidebar-width="720" :nav-width="224" class="guide">
  <template #nav>
    <p-view class="sidebar-card">Grouped navigation list…</p-view>
  </template>
  <p-view class="doc">Body…</p-view>
</p-sidebar>
```

This is the **real code of the documentation page you are reading right now**: in a wide container the navigation is sticky on the left and follows the scroll; drag the window narrow (or put the page into a split screen) and the navigation automatically collapses into a toggle bar while the body fills the space — zero layout code, zero `@media`, zero JS branches on the business side.

Details built into the component — none of these are yours to write:

- The toggle bar is a real `button` carrying an `aria-expanded` accessibility state (auto-hidden in the side-rail state)
- Panel spacing is componentized: 32px between the side rail and the main content column, 24px between rows in the expanded state
- Horizontal overflow is contained: in the collapsed state the navigation container is `min-width: 0` + `overflow-x: auto` — a flex item defaults to `min-width: auto`, and a long nowrap navigation would otherwise burst through the whole page
- **Root class names are the official signal for pages to adapt their presentation per state**: e.g. in the side-rail state the sidebar card turns sticky to make way for the navigation height — the page writes only the visuals, not the layout

## Pages adapt per state: consuming root classes

The component owns the layout and the state; the page only handles patterned presentation. The official docs pages consume the side-rail root class with real styles (in a narrow container the collapsed state follows the document flow — no sticky needed):

```css
/* side-rail state: the sidebar card turns sticky to make way for the navigation height — the page writes only the visuals */
.p-sidebar-side-rail .sidebar-card {
  position: sticky;
  top: calc(var(--nav-h) + 16px);
  max-height: calc(100vh - var(--nav-h) - 32px);
  overflow-y: auto;
}
```

The counterexample is worth remembering: an early version hand-wrote "compact horizontal chips" page styles for the bottom-bar, and once #384's collapsed mode shipped they were immediately violations — **layout adaptation must never directly change page layout: either the page misused the primitive, or the component should be improved** (here the latter came first: the collapse interaction was eventually built into the component).

## In-vehicle d-pad focus and the motion gate

- **d-pad focus navigation**: the Arrow keys move focus among the navigation items — up / down in the side-rail state, left / right in the collapsed-open state. Implemented as an internal focus cursor inside the component plus `focus()`, without reading `document.activeElement` (the component audit's no-platform-api constraint). The five-way remote control scenarios of in-vehicle / TV work out of the box.
- **Motion gate**: `createDeviceEnv` collects drive-mode (injected by the in-vehicle host) and `prefers-reduced-motion`; if either matches → the root class `p-sidebar-no-motion` is appended, disabling every transition / animation inside the component — no transitional animations while driving.

## Cross-target degradation

- The Mini Program target has no ResizeObserver → always collapsed (the phone main scenario is inherently a narrow-container form anyway; the render end decides its own degradation — nothing crashes)
- No-DOM environments → the focus listeners are skipped automatically
- Container solving goes through [createContainerQuery](/docs/system/02-container-query): `isWide = container width ≥ min-sidebar-width`, solved against the container rather than the viewport — automatically correct in split-screen / multi-window contexts

## Next steps

- [Breakpoints & form factors](/docs/system/05-breakpoints): formForWidth and the G-25 three-dimensional breakpoints
- [Layout components: p-view / p-stack / p-split / p-sidebar](/docs/13-layout-components): recipes for p-view / p-stack / p-split / p-sidebar
- [Container queries: solved against the container](/docs/system/02-container-query): the solving baseline of the three-state switching

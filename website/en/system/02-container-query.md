---
title: Container queries: solved against the container
order: 2
group: 柔性系统
---

# Container queries: solved against the container

> The responsive baseline = the **container**, not the viewport. Split-screen in-vehicle systems, tablet split panes, embedded cards, multi-window — components solve against the width of the container they actually get, not the window width.

## Why viewport breakpoints fail

A component should not care how big the window it is put into is — only how wide a container it gets:

| Scenario | Viewport breakpoint (`@media`) | Container solving (Fluid) |
|---|---|---|
| Fullscreen page | ✅ correct by coincidence | ✅ correct |
| Tablet split screen (two panels, each taking half) | ❌ both panels solve against the full screen width | ✅ each solves against its own panel width |
| Embedded card / dashboard | ❌ no matter how wide the viewport, the card still only has 300px | ✅ solved against the card width |
| Multi-window / foldable | ❌ no awareness of the layout structure | ✅ recomputed whenever the container changes |
| App native end | ❌ no `@media` equivalent | ✅ the same FluidContext state model across ends |

## createContainerQuery: the real API

`createContainerQuery` comes from `@proteus-vue/fluid` (pure logic, zero dependencies; the ResizeObserver is injected via a factory, so unit tests can pass a fake and drive the dimensions directly):

```ts
import { createContainerQuery } from '@proteus-vue/fluid'

const query = createContainerQuery(el, {
  designWidth: 375,       // design-mockup width (baseline for breakpoint derivation; defaults to 375)
  breakpoints,            // custom container breakpoints [{ name, min }]; derived proportionally by default
  createObserver,         // size-observer factory (defaults to globalThis.ResizeObserver; no-op when absent)
  readSize,               // initial-size reader (test injection)
})

query.get()   // the current FluidContextState (snapshot)
query.subscribe((state) => { /* subscribes to changes, fires once immediately; returns an unsubscribe function */ })
query.destroy() // releases the observer and all subscriptions
```

The state model, `FluidContextState`:

| Field | Type | Description |
|---|---|---|
| `width` / `height` | number | Container size (px) |
| `orientation` | `'portrait' / 'landscape'` | Orientation (height > width → portrait) |
| `breakpoint` | `'sm' / 'md' / 'lg' / 'xl'` | **Container-level** breakpoint name (not viewport) |

Default breakpoints are derived proportionally from the design-mockup width (`deriveContainerBreakpoints`: sm 0.5 / md 0.875 / lg 1.25 / xl 1.625) — a 375 design mockup → sm 188 / md 328 / lg 469 / xl 609. To customize the tiers, pass `breakpoints`, or solve manually with the exported `resolveBreakpoint(width, breakpoints)`.

## Viewport-solved vs container-solved: two ways to write the same need

Hand-written JS width branch (forbidden by FLD008):

```ts
// ❌ manual resize listener + magic numbers — all of it breaks once the component lands in a split pane / card
window.addEventListener('resize', () => {
  mode = window.innerWidth < 768 ? 'stacked' : 'split'
})
```

Container solving:

```ts
// ✅ declare the threshold; the runtime solves it against the container
const query = createContainerQuery(el, { designWidth: 375 })
query.subscribe((s) => {
  mode = s.width >= 640 ? 'split' : 'stacked'
})
```

The difference is not code volume but the **solving baseline**: the former watches the window, the latter watches the element itself. Put the same component fullscreen, in a split pane, or in a card, and container solving is automatically correct in every case — which is exactly the pattern written inside `p-split` / `p-sidebar`.

## How components use it internally

All of the framework's own fluid components are built on this one runtime:

| Component | Solving logic |
|---|---|
| `p-split` | `s.width >= minSplitWidth` → `split` (side by side), otherwise `stacked` |
| [p-sidebar](/docs/system/04-sidebar) | `isWide = s.width >= minSidebarWidth`, composed **orthogonally** with the user's expand intent into three states |
| `p-zone` | `s.breakpoint` (sm/md/lg/xl) → renders the matching named slot |
| `p-adaptive` | `createAdaptiveController` reuses the same container query, solved against the form ranges |

The component thin shells only do "state bridging"; all solving logic lives in the fluid package's pure-function layer — which is also why they can be precisely covered by unit tests (a fake observer firing a size drives the state machine).

## The unified breakpoint entry and the device environment

- `createSizeAwareObserver(el)`: subscribe to **container-level + viewport-level + orientation** in one call. The state carries `containerWidth` / `containerBreakpoint` / `viewportWidth` / `viewportBreakpoint` / `orientation` — container changes go through the ResizeObserver, viewport changes through window resize / orientationchange (target injectable). Use it for scenarios that need to "watch both the container and the window".
- `createDeviceEnv()`: device-environment signals — folded-form `displayMode` (`standard / fold / span / expand`), `isDriveMode` (injected by the in-vehicle host), `prefersReducedMotion`, `orientation`, collected from matchMedia and subscribed for changes (matchMedia injectable).

## Degradation and testability

- **No-ResizeObserver environments** (the Mini Program logic layer): the observer degrades to a no-op and components fall back to static defaults — `p-split` always stacked, `p-sidebar` always collapsed, `p-zone` always sm. The render end decides its own degradation and nothing crashes (iron rule G-22.2, "plain but correct").
- `detectFluidCapabilities().containerQuery` probes container-query support with `CSS.supports` (`container-type: inline-size`); where there is nothing to probe (MP logic layer / SSR), full support is assumed.
- Every dependency is injectable: the `createObserver` factory, the `readSize` initial size, matchMedia, the resize target — pure logic with zero DOM dependency, unit-testable in a Node environment.

## Next steps

- [Fluid grid](/docs/system/03-fluid-grid): p-grid declares only the minimum column width, solved in pure CSS
- [Adaptive sidebar](/docs/system/04-sidebar): the three-state state machine + in-vehicle d-pad focus
- [Flex System overview](/docs/system/01-overview): back to the big picture

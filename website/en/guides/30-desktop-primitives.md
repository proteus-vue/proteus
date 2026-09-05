---
title: Desktop primitives
order: 30
group: 专题深入
---

# Desktop primitives

Desktop interactions (hover, shortcuts, right-click, focus, permission, cursor glow) exist in Proteus as the **directive forms of the G-24 semantic primitives**: the `v-p-*` directives come from `@proteus-vue/desktop`, with pure logic kept apart from the DOM wiring — everything is unit-testable. The input form is part of the semantics (the input dimension of the G-25 three-dimensional breakpoints: touch / cursor / remote) — you write semantics, and the terminal decides its own degradation; **hand-writing `if (isDesktop)` is forbidden** (PRIM001).

> **Desktop semantics = directives; the touch side does not cut features, it remaps semantics.**
> On a mouse, hovering is a hover effect; on a touchscreen it degrades to a tap highlight; the cursor glow silently stays off in touch and reduced-motion environments. One copy of business code, no platform branches.

## Install: one line registers every directive

```ts
// website/src/main.ts (the official site's real wiring)
import { createDesktopDirectives } from '@proteus-vue/desktop'

for (const [name, dir] of Object.entries(createDesktopDirectives())) {
  app.directive(name, dir)
}
```

Six directives get registered: `v-p-hover` / `v-p-shortcut` / `v-p-focus-trap` / `v-p-context-menu` / `v-p-permission` / `v-p-cursor-glow`. The Mini Program side registers no directives — desktop interactions have no counterpart there, so they degrade naturally.

## v-p-hover: hover state

The value is a preset name; on a match the element receives the `p-hover-<preset>` class (the transition animation is defined by page CSS):

| Preset | Effect |
|---|---|
| `brighten` (default) | Brightens |
| `lift` | Lifts |
| `underline` | Underlines |
| `none` | Off |

Every pillar card on the official site is covered (real usage on the home page):

```vue
<p-view v-for="(p, i) in pillars" :key="p.no" v-p-hover class="pillar-card">…</p-view>
```

Pointer detection is built in: `mouse` / `pen` can hover; `touch` degrades to a tap highlight — you do not need to write a single line of detection.

## v-p-shortcut: keyboard shortcuts

The expression format is `keys:semantic-id` — `mod` automatically follows platform conventions (Mac → ⌘, everywhere else → Ctrl), and `⌘S` / `Ctrl+S` is automatically written into the element's `title` as a menu-bar hint:

```vue
<button v-p-shortcut="{ expr: 'mod+s:save', handler: (id) => save() }">Save</button>
```

## v-p-context-menu: right-click menu

Right-click pops up a menu with overflow-proof positioning (it auto-flips at the screen edge); it is dismissed on click / `Escape` / focus loss:

```vue
<p-view v-p-context-menu="{ items: [{ label: 'Edit', value: 'edit' }], onSelect: (v) => edit(v) }">
  …
</p-view>
```

## Focus management: v-p-focus-trap and d-pad

**Popup focus trap**: Tab cycles + Shift+Tab goes backward + the first item is focused on open + the previous focus is restored after close (a hard accessibility requirement for popups):

```vue
<p-view v-p-focus-trap>…popup content…</p-view>
```

**Vehicle / TV arrow-key navigation** needs no new directive — `p-sidebar` has it built in: the Arrow keys move focus among the nav items (up/down in the side-rail state, left/right when expanded), d-pad semantics with zero business code.

## v-p-permission: permission gating

A click-interception gate: when already granted, the business `@click` passes through; when not granted, the click is synchronously intercepted and authorization is requested — once the grant succeeds, the click is replayed automatically (the business handler runs exactly once):

```vue
<button v-p-permission="{ semantic: 'notification', onState: (s) => (state = s) }">Send notification</button>
```

`semantic` takes a permission semantic name: `notification` / `camera` / `microphone` / `geolocation` / `clipboard`.

## v-p-cursor-glow: pointer-following glow

A single host-level layer (mount it on the page root and you are done): two radial-gradient spots (primary purple + secondary cyan) follow the pointer with lerp interpolation — an AI-tech pointer ambience. The official site's global config:

```vue
<p-page v-p-cursor-glow="cursorGlowOptions" class="site">…</p-page>
```

```ts
// website/src/App.vue — the real config
const cursorGlowOptions = {
  size: 520,                         // main glow diameter, px
  color: 'rgba(124, 92, 255, 0.13)', // main color (Proteus brand purple)
  accent: 'rgba(0, 224, 198, 0.09)', // secondary spot (brand2 cyan)
  lerp: 0.14,                        // interpolation factor: small = stronger trailing, 1 = snaps immediately
}
```

| Param | Default | Description |
|---|---|---|
| `size` | `460` | Main glow diameter, px (the secondary spot is 60% of the main diameter) |
| `color` | `rgba(124, 92, 255, 0.14)` | Main spot color (rgba with alpha recommended) |
| `accent` | `rgba(0, 224, 198, 0.10)` | Secondary spot color |
| `lerp` | `0.12` | Follow interpolation factor 0-1 |
| `opacity` | `1` | Opacity |

## Where it takes effect

| Environment | Behavior |
|---|---|
| Desktop Web (mouse / pen) | ✅ all six directives active |
| Touch (`pointer: coarse`) | cursor glow off; hover degrades to a tap highlight — silent degradation |
| `prefers-reduced-motion` | cursor glow off (reduced motion wins) |
| Mini Program (logic layer has no DOM) | directives not registered, stripped at compile time — natural degradation |
| In-vehicle / TV (remote control) | focus semantics active: `p-sidebar` d-pad + `v-p-focus-trap` |

Degradation is **silent**: `createCursorGlow` simply returns `null` in unsupported environments, so callers write zero branches. Compare the PRIM001 counterexample — a platform branch like `if (isDesktop) { bind mouse events } else { … }` has no room to live here.

## Next steps

- [Liquid glass](/docs/31-liquid-glass): glass texture and the desktop cursor glow pair up as the official site's ambience layer
- [Fluid layout](/docs/17-fluid-layout): adaptation on the layout dimension (this page is about the input dimension)
- [Containers & hosts](/docs/framework/33-containers-hosts): desktop multi-window container shapes

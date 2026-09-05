---
title: Feedback & motion: p-segment / p-toast / p-animate
order: 14
group: 基础概念
---

# Feedback & motion: p-segment / p-toast / p-animate

Feedback components only declare "what appears when" — the form is then delivered natively on each target. Motion is **pure CSS-declared semantics**: native CSS `animation` on Web, and Skyline supports `animation` too, so both targets run the same source with no JS animation engine introduced. All three components in this page are used for real in the official Playground (tab switching / copy feedback / the LIVE pulse).

> **There is only one cross-target way to write motion: declare a preset — never write frames.**
> `p-animate`'s keyframes presets compile into global `@keyframes p-animate-*`; duration / iterations / delay go through inline style — zero frame code in business, identical across targets.

## p-segment: the segmented control

A controlled component: `options` + `active` (`v-model:active`) — clicking an option emits both `update:active` and `select`.

| prop | Type / default | Description |
|---|---|---|
| `options` | Array, `[]` | `[{ label, value? }]` — value defaults to label |
| `active` | String / Number, `''` | value of the currently active item |

| Event | Payload | Description |
|---|---|---|
| `update:active` | value string | `v-model:active` binding |
| `select` | value string | emitted on click (listen independently of the `v-model` binding) |

The official Playground's tab switching (in place of hand-written tab buttons):

```vue
<p-segment
  :options="TABS.map((t) => ({ label: t, value: t }))"
  :active="activeTab"
  @update:active="activeTab = $event"
/>
```

Theming goes through CSS variable hooks (the defaults are already light mode as-is; a dark theme only needs to inject variables — zero breakage):

```css
--seg-bg: #f2f3f5;         /* container background */
--seg-item-color: #646566; /* unselected text */
--seg-on-bg: #fff;         /* selected background */
--seg-on-color: #323233;   /* selected text */
```

## p-toast: the lightweight toast

| prop | Type / default | Description |
|---|---|---|
| `visible` | Boolean, `false` | display switch (controlled) |
| `text` | String, `''` | message text |
| `duration` | Number, `2000` | ms before auto-dismiss; `0` = never auto-dismiss |
| `position` | String, `'center'` | `center` / `top` / `bottom` |

There is only one event, `close`: when the duration elapses the component emits it automatically and the parent sets `visible` back to false. Behavior details: a transparent overlay blocks accidental touches; the panel is fixed-positioned (64px from top / vertically centered / 120px from bottom) and fades in over 250ms; the timer is cleaned up on unmount.

The real copy feedback for the share link (official Playground):

```vue
<p-toast
  :visible="toastVisible"
  text="Share link copied — open in another browser to reproduce"
  position="bottom"
  @close="toastVisible = false"
/>
```

```ts
function copyShareLink(): void {
  void navigator.clipboard?.writeText(url)
  toastVisible.value = true // auto-closes when the duration elapses
}
```

## p-animate: the animation primitive

| prop | Type / default | Description |
|---|---|---|
| `keyframes` | String, `'fade'` | preset name: `fade` / `bounce` / `pulse` / `shake` / `zoom-in` / `spin` |
| `duration` | Number, `600` | duration in ms |
| `loop` | Boolean, `true` | loops (defaults to true for decorative animation; `false` plays once) |
| `delay` | Number, `0` | delay in ms |

The LIVE badge pulse on the official site (`fade` looping = the standard live indicator):

```vue
<span class="live-badge">
  <p-animate v-if="motionOk" keyframes="fade" :duration="1400" class="live-pulse">
    <span class="live-dot" />
  </p-animate>
  <span v-else class="live-dot" />
  LIVE
</span>
```

The official pattern for reduced-motion static rendering is the **page-side branch**: the component itself does not build in `matchMedia` probing (keeping zero platform API — Mini Program safe), so the consumer decides once and switches:

```ts
const motionOk = !(typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches)
```

For contrast, where degradation is already built in (same-family capabilities with built-in support): `p-sidebar` watches drive-mode / `prefers-reduced-motion` and automatically adds `p-sidebar-no-motion` to disable motion; `v-p-cursor-glow` simply stays off when reduced-motion or a touchscreen is hit. A global reduced-motion static fallback inside `p-animate` itself is a roadmap item (🟡 to be built in); today, follow the page-side pattern above.

## Quick selection reference

| Scenario | Use |
|---|---|
| Switching within a view (Tab / view segment) | `p-segment` (controlled + theme variables) |
| Light feedback for an action's result | `p-toast` (auto-dismiss + position) |
| Decorative motion (breathing / pulse / entrance) | `p-animate` (preset keyframes) |
| Show/hide transitions | `p-transition` (transition presets) |
| Page-level motion toggle | page `no-motion` class + `p-sidebar` motion-gate pattern |

## Next steps

- [Desktop primitives](/docs/30-desktop-primitives): v-p-cursor-glow and the desktop interaction directives
- [Liquid glass](/docs/31-liquid-glass): the single entry point for pg-glass and glass semantics
- [Semantic components overview](/docs/12-components-intro): back to the full component landscape

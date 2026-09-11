---
title: Skyline Render Constraints & Component Patterns (device-verified)
order: 22
group: 渲染与能力
---

# Skyline Render Constraints & Component Patterns (device-verified)

> The constraints on this page come from the 2026-09-07 overlay-family Skyline device/simulator
> regression, each verified item by item (locked into in-repo contract tests P7/P8). **The goal is
> to help self-built / ecosystem `p-*` components get it right the first time.**
> Core claim: **structure decides fate — overlay content must stay inside a *reliable render layer*,
> and variable states must be expressed with static literals.**

## 1. Overlay events: backdrop/pure-visual elements never receive hits

On Skyline, **pure-background/content-less child nodes inside a custom component do not participate
in hit-testing** (they paint, but events never land on them). Binding "click to close" on the mask
element itself simply does not work.

**Do**: bind the close event on the **fixed full-screen container / persistent overlay**; keep the
mask purely visual.

```html
<view class="overlay" :class="{ on: open }" @click="close">  <!-- event on the reliable layer -->
  <view class="mask" />                                        <!-- visual only -->
  <view class="panel" @click.stop="noop">…</view>              <!-- panel swallows its own bubble -->
</view>
```

## 2. Variable-state classes: static literals only, no dynamic concatenation

- **Dynamic class/style bindings are unreliable on Skyline** (p-popup top-left positioning and lost
  animations both came from this).
- The compiler appends the scope suffix into **template-concatenated class literals at the wrong
  spot**: `'x--' + phase` becomes a malformed `---data-v-xxx` class in the output that **never
  matches any rule**.

**Do**: split one element into **static-literal branches** (each branch has a complete class name,
so the scoped suffix always matches):

```html
<view v-if="pos === 'bottom'" class="panel panel--bottom">…</view>
<view v-else-if="pos === 'top'"    class="panel panel--top">…</view>
<view v-else                       class="panel panel--center">…</view>
```

For purely runtime-added classes (e.g. animation phases) use a **computed that returns a raw class
name** (no class literal in the template → no suffix injection) paired with `<style global>` rules.

## 3. The `inset` shorthand is unavailable

Skyline does not recognize `inset: 0`; the box collapses to zero size (the background is there yet
invisible — the "transparent mask" illusion).

**Do**: write explicit four edges `top/left/right/bottom: 0`.

## 4. Overlay content: drop `wx:if` subtrees, use persistent mount + visibility

Under glass-easel, overlay subtrees mounted via `wx:if` can **fail to render entirely**
(multiple rounds of evidence).

**Do**: keep the overlay **persistently mounted** and toggle a container class that switches
`visibility` (hidden when closed → no interception; add a directional `transition: visibility` to
retain an in/out presence):

```css
.overlay { visibility: hidden; transition: visibility 0s linear .25s; }
.overlay.on { visibility: visible; transition: visibility 0s linear 0s; }
```

## 5. `root-portal`: detach loses anchoring — use with care

The official `<root-portal>` (detaches a subtree from the page, like `fixed`, built for dialogs) does
render, but **detaching breaks anchoring** — an `absolute` panel lands at the top-left corner. Anchored
floating layers (e.g. popover) should **not use portal**; for true top-layer rendering take the
"measure rect + fixed coordinates" route (see §7).

> Note: Skyline projects must declare **`componentFramework: glass-easel` in component json too**
> (the framework generator already adds it automatically; adding it to pages only leaves
> portal/floating layers inside components entirely broken).

## 6. Stacking: non-fixed roots paint in DOM order

Skyline stacking rule: **`fixed` nodes are lifted to the top layer; everything else (including
`absolute` panels and `z-index`) paints in DOM order.** An anchored panel can therefore be covered by
content that comes *after* it (z-index cannot escape the glass-easel paint order; the `fixed` layer
keeps working, so tap-outside-to-close always works).

**Do**: panels inside a fixed full-screen container (drawer/modal/popup/action-sheet pattern) are the
most stable; anchored floats should avoid immediately-following overlapping content, or use the
coordinate route in §7.

## 7. When dynamic coordinates are truly required (P2)

Measure the trigger rect inside the component with `createSelectorQuery`, then position the panel
`position: fixed` with pixel coordinates (the panel rides the fixed layer to the top). This introduces
a platform measurement API, so follow the framework platform-API audit before adding it.

## 8. Safe area: `env()` is unavailable — use `p-safe` (runtime read)

**`env(safe-area-inset-*)` is NOT supported under Skyline** — any CSS declaration containing `env()`
is **dropped entirely** (even the `max(env(...), Npx)` fallback form). Because the framework app uses
`navigationStyle: custom` (no native nav bar), pages must clear the status bar + the capsule button
at the top-right themselves, or **the title/content gets covered**.

**Do**: put `<p-safe area="top" :fallback="50" />` at the top of the page. On MP, `p-safe` reads
runtime-measured values (`getWindowInfo().statusBarHeight` + `getMenuButtonBoundingClientRect().bottom`,
the capsule bottom) → inline px; on Web it still uses `env()`.

```html
<view class="page">
  <p-safe area="top" :fallback="50" />
  <text class="title">…</text>
</view>
```

> Use the **capsule bottom** (not just the status-bar height): otherwise content sits **beside** the
> capsule button (no overlap, but ugly).

## 9. Inline event arguments: decimals/negatives/strings OK (member access is not)

Mini-program event handlers **cannot be a call with arguments**; the compiler wraps `@tap="fn(1)"`
into a `proteusInlineFn1` method. Arguments may be **bare identifiers / literals** (numbers including
decimals and negatives `0.4`/`-1`, strings, `true/false/null`).

**Forms that fail silently (not wrappable)**: **member-access arguments** (`fn(item.id)`) — emitted
verbatim as `bindtap="fn(item.id)"` (an **invalid handler** in a mini program; tapping does nothing),
with a compile-time warning. Use an argument-less method or move the value into `data`.

> ⚠️ Whole-number arguments being valid **masked** the argument-type issue — an early whitelist missed
> decimals/negatives, so `setSpeed(0.4)` silently failed while `setSpeed(1)` worked. Fixed (decimals/
> negatives/strings are now supported).

## 10. Regression self-check

After touching overlays/state classes, run the in-repo **product contract probes (P7/P8)** and the
Skyline device gate before merging — and remember most "phantom" issues (stale IDE artifacts etc.)
are resolved by recompiling/restarting the tool before changing code.

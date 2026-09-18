---
title: Fluid layout
order: 17
group: 渲染与能力
---

# Fluid layout (G-22: a generation above rpx)

## rpx is a unit conversion; fluid layout is a system-level layout

rpx is essentially "proportional numeric scaling" — the structure never changes; a larger screen is just a scaled-up phone. Proteus folds the **system-level layout capabilities of iOS `UICollectionView` / Android `GridLayoutManager` / CSS Grid** into semantic primitives:

- `p-fluid`: fluid sizing (clamp interpolation — zero jumps as the viewport changes continuously)
- `p-grid`: adaptive grid (min-col-width decides the column count; the wider the screen, the more columns)
- `p-stack` / `p-split` / `p-aspect` / `p-fit`: structural semantics
- `p-safe`: safe-area semantics (notch / Dynamic Island / gesture bar)

## This website is itself written in fluid layout (W-6: fluid framework first)

```html
<!-- Typography: clamp fluid interpolation — 30px on the 375px design mockup, 58px at a 1440px viewport, linear and continuous in between -->
<h1 v-p-fluid="'font-size(30, 58)'">One semantic model.</h1>

<!-- Grid: the column count stretches automatically with the container width — no magic-number breakpoints -->
<div class="feature-grid">
  <!-- grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)) -->
</div>
```

**Zero `@media` breakpoints**. Breakpoints are "platform-API-style" discrete jumps: at 375px there is 1 column, at 820px there are 2, and any width in between is forced to pick a side. Fluid layout is the continuous solution — and it is how this website (the very page you are reading) implements its responsiveness.

## Iron rules (the FLD series)

- FLD001: no hand-written `@media` breakpoints (breakpoint logic belongs to the semantic primitives)
- FLD002: no hardcoded breakpoint numbers
- FLD003: `p-fluid` must always be given a range (min, max)
- FLD008: no manual `if (width < 600)` width branches

```bash
proteus fluid:check   # compile-time gate
```

## Adaptive containers (G-22.5)

`p-adaptive` switches the popup's **entire form** with the width: `sheet(0,600) | dialog(600,840) | popover(840,∞)`, mapping onto each target's native container (`UISheetPresentationController` / `BottomSheetDialog`). The developer writes it once.

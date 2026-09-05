---
title: Liquid glass
order: 31
group: 专题深入
---

# Liquid glass: pg-glass

Glass material — glassmorphism blur + tint + highlight edge — has a single entry in Proteus: `<pg-glass>` (the G-07 unified entry). You declare the **semantics** (navigation bar / card / floating layer), and the component is responsible for mapping to the best implementation per terminal, degrading gracefully to a solid color when the capability falls short.

> **Why writing raw `backdrop-filter` is forbidden: CSS017 (error level) + GLS001-006.**
> Raw usage means carrying all three burdens yourself: per-terminal implementation differences (iOS `UIGlassEffect` / HarmonyOS fractal / Android `RenderEffect` / Web `backdrop-filter`), accessibility (nobody handles `prefers-reduced-transparency`), and crash-free degradation (a white block when unsupported). Glass semantics belong to the component — pages write zero raw code.

## Per-layer commitments

| Layer | Content | Commitment |
|---|---|---|
| L1 base glass | blur + tint + radius + border | must-hit, consistent across all terminals |
| L2 texture | noise layer + top highlight edge | best-effort on Web / Skyline |
| L3 system level | iOS `UIGlassEffect` / HarmonyOS fractal | native terminals only |

## Props

| prop | Type / default | Description |
|---|---|---|
| `preset` | String, `'custom'` | Preset: `navigationBar` / `tabBar` / `modal` / `card` / `floating` / `sidebar` / `custom` |
| `intensity` | String, `'regular'` | Intensity: `thin` / `regular` / `thick` (scales blur) |
| `tint` | String, `''` | Tint (overrides the preset tint) |
| `radius` | Number, `0` | Corner radius, px (`0` = no override; radius stays under page control) |
| `border` | Boolean, `true` | Highlight edge (0.5px inner stroke) |
| `noise` | Number, `0` | Noise intensity 0-1 (L2; `0` = off) |

## Preset values table (blur / tint, Web implementation)

Final `blur = round(base preset blur × intensity step)`; steps: `thin` 0.6 / `regular` 1.0 / `thick` 1.4.

| preset | Base blur | Default tint |
|---|---|---|
| `navigationBar` | 20 | rgba(255, 255, 255, 0.15) |
| `tabBar` | 20 | rgba(255, 255, 255, 0.15) |
| `modal` | 24 | rgba(255, 255, 255, 0.15) |
| `card` | 16 | rgba(255, 255, 255, 0.08) |
| `floating` | 28 | rgba(255, 255, 255, 0.18) |
| `sidebar` | 20 | rgba(255, 255, 255, 0.12) |
| `custom` | 20 | rgba(255, 255, 255, 0.12) |

Per-terminal preset specs for `radius` / `border` / `noise` are planned items (📋); in the Web L1 implementation, the corner radius and the noise are passed in explicitly through props, while `border` enables the highlight edge by default.

## Real example: the official site's nav bar

```vue
<!-- website/src/App.vue: sticky nav bar = pg-glass + the page only handles positioning -->
<pg-glass preset="navigationBar" class="nav-shell" :class="{ 'is-scrolled': scrolled }">
  <header>
    <p-stack direction="row" :gap="8" wrap class="nav">…</p-stack>
  </header>
</pg-glass>
```

```css
/* The page keeps only positioning and the hairline — blur / tint / highlight edge / noise all belong to the component */
.nav-shell { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--line); }
```

The data endorsement cards (the home page's glass cards, L2 noise enabled):

```vue
<pg-glass preset="card" intensity="thin" :radius="14" :noise="0.03" class="stat">
  <p-text class="stat-value">{{ s.value }}</p-text>
  <p-text class="stat-label">{{ s.label }}</p-text>
</pg-glass>
```

## Positioning and layout belong to the consumer

The root element **does not write `position` / `display`** — sticky, absolute, width/height, and padding are all declared by page classes (the component never overreaches); the noise layer and the highlight edge anchor to the inner `__in` container, so they do not affect your positioning context.

## Degradation: the crash-free iron rule

| Scenario | Behavior |
|---|---|
| `prefers-reduced-transparency: reduce` | blur off; the background becomes solid `#121216` (accessibility first — Iron rule 4) |
| `backdrop-filter` unsupported (`@supports` probe) | degrades to the solid color the same way |
| Mini Program logic layer | no `matchMedia` → always glass (the probe goes through `globalThis`; the rendering side decides) |

When degraded, the noise layer and the highlight edge are turned off as well, while copy and content stay readable as usual — glass is an enhancement, not a dependency.

> Usage rule: prefer `preset` (validated, best-tuned parameter combinations); only when you truly have a special need, override the props with `preset="custom"`; **any hand-written `backdrop-filter` on any page is blocked by the audit rules CSS017 / GLS001**.

## Next steps

- [Desktop primitives](/docs/30-desktop-primitives): cursor glow + glass = the desktop ambience layer
- [Layout components: p-view / p-stack / p-split / p-sidebar](/docs/13-layout-components): ways to combine glass cards with p-grid / p-sidebar
- [Semantic components overview](/docs/12-components-intro): the full component landscape and category tables

---
title: Fluid metrics
order: 7
group: 柔性系统
---

# Fluid metrics

> **Sizes have exactly one input: container width.** A profile's `visual.ratio` declares "how large this form should be", and `resolveFluidMetrics()` turns it into the `k` factor plus the full set of CSS variables. There is no absolute-px size table and no `transform: scale` (the old defect — render at natural viewport then scale and crop — has been removed).

## The solving formula

```ts
k = clamp(ratio.min, containerWidth / ratio.ref, ratio.max)

// ratio.ref = this form's "baseline container width": at that width k = 1 and the design size applies
// min/max   = readability guard rails (a mockup never shrinks into ant type; a real large screen never grows without bound)
```

`ratio.ref` has real device grounding: phone 300 (on a real 390 device k ≈ 1.3, body text ≈ 17pt, aligned with HIG), TV 620, in-car 640, watch 198 (k = 1 is the real device scale).

When the container cannot be measured (SSR / first frame) → `k = 1` (render at design size; the renderer decides, and the first frame is never blocked).

## Emitted variables (every one has a real consumer)

| Variable | Meaning | Example consumer |
|---|---|---|
| `--pf-u` | Baseline unit (= font size) | The shared multiplier for spacing / radius / hit areas |
| `--pf-font` | Body text | All text |
| `--pf-gap` | Element spacing | Multiplied again by `--pf-gap-dense` (density) |
| `--pf-pad` | Container padding | The padding of each topology |
| `--pf-radius` | Corner radius | Cards / pills |
| `--pf-control` | **Hit-area floor** (see below) | `min-height` of buttons / tiles / tabs |
| `--pf-media-ar` / `--pf-media-scale` | Media ratio / display scale | Cover aspect; the hero form gets ×2.6 (10ft hero) |
| `--pf-safe-side/bottom/top` | Safe areas | Overscan / home indicator / notch |
| `--pf-fold-width` | Hinge band | The `column-gap` of the foldable's two panes (real-device `env(fold-width)`) |

Alongside: `resolveFrameVars()` emits the mockup-frame quantities (safe areas and media scale included), kept separate from the metric variables — the frame affects the demo shell only and never content metrics.

## The discipline: physical quantities are projected by display scale

**Hit areas (76dp / 44dp) and safe areas (TV overscan 5%) are device-physical specs, not absolute pixels inside a scaled mockup.**

The demo page draws a 1280pt in-car display inside a 540px frame (display scale 42%) — used as 76px there, the hit area would eat 44% of the content height and starve the hero; conversely a 96px safe area dropped into a 620px frame takes 15.5% (three times the real 5%), which makes TV look "boxed in, not immersive".

```ts
showScale = min(1, containerWidth / deviceWidth)   // a real device / wider container → 1 (never upscaled)
control   = max(2.6, minDp × showScale / (baseFont × k))   // minDp = dpad ? 76 : 44
safeSide  = 96 × showScale                                  // the device quantity behind TV overscan 5%
```

This discipline is the common root of **three measured defects** (hit areas overflowing → TV not immersive → in-car tiles overflowing) and is now frozen into the assertion convention.

## Assertion convention: compare in device space

When writing tests or reviewing, **never compare raw pixels inside the scaled mockup** — convert back to device space first, otherwise the assertion distorts as soon as the stage width changes:

```ts
const dp = framePx / Math.min(1, containerWidth / FORM_PROFILES[form].viewport.width)
expect(dp).toBeGreaterThanOrEqual(76)   // in-car (AAOS)
expect(dp).toBeGreaterThanOrEqual(44)   // touch (HIG 44pt / Material 48dp, conservative floor)
```

> Counter-example (a historical trap): an early assertion `carControl >= phoneControl` was **always true** because both forms were mis-computed to 76px — the assertion looked like it guarded the spec while guarding nothing.

## Dual-viewport verification discipline

The same form has a **different vertical budget** at different stage widths (a real user's screen is not the design-review width), so layout changes must be verified at both tiers:

| Viewport | Role | Coverage |
|---|---|---|
| 1280 | Narrow stage (where users most often see compression) | Content fits one screen, zero overlap, zero cropping |
| **1512** | **The user's actual screen (a shared factor behind earlier misses)** | Same as above |
| 1600 | Design-review wide stage | Same as above |

Machine gate: `tests/e2e-website-multidevice.test.ts` (real Chromium, two viewports × eight forms, including in-session switching).

## Boundaries and degradation

- **Unmeasurable container** (SSR / MP first frame) → `k = 1`; the `clamped` diagnostic field marks whether a guard rail truncated the value (`min` / `max`).
- **MP (Skyline)**: `grid` / `container-query` / `aspect-ratio` are unavailable → a flex degradation branch is required (see [Ends & maturity](/docs/framework/ends-matrix)).
- **Dynamic font size**: today's all-px metrics do **not** follow the user's system font size (a known boundary); the vision is in the [OS-level roadmap](/docs/system/01-overview).

## Next steps

- [Capability tri-state](/docs/system/08-capabilities): where the `dpad` decision inside the hit-area floor comes from
- [p-formfactor](/docs/system/11-formfactor-composition): how these variables land in the container component

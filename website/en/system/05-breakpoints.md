---
title: Breakpoints & form factors
order: 5
group: 柔性系统
---

# Breakpoints & form factors

> In Proteus, a breakpoint is not a CSS magic number — it is **form derivation**: width in, form out — `formForWidth(1440) → popover`. The discrete "device type" enum is reduced to the continuous space of "container characteristics".

## Width → form tier: formForWidth

`@proteus-vue/test-ir` (the G-44 breakpoint matrix) exports the real solving function, whose tier names carry straight through from `p-adaptive`'s sheet / dialog / popover:

```ts
export function formForWidth(w: number): 'sheet' | 'dialog' | 'popover' {
  if (w >= 1200) return 'popover'
  if (w >= 840) return 'dialog'
  return 'sheet'
}
```

| Container width | Form |
|---|---|
| < 840 | `sheet` (bottom, full-width on Web) |
| 840 – 1199 | `dialog` (centered on Web) |
| ≥ 1200 | `popover` (centered; anchored below the trigger when an anchor is present) |

Note that solving looks only at width, never at "what the device is called": an 834px tablet and a 390px phone are both in the `sheet` tier — form is decided by container characteristics, which is exactly why it stays fair across ends. Want your own tiers? Use a `p-adaptive` range expression (e.g. `p-modal` defaults to `sheet(0,600) | dialog(600,840) | popover(840,∞)`, intervals left-closed / right-open, and must be continuous and non-overlapping — gated by FLD007 / FLD009).

## Solve it yourself: p-adaptive's pure functions

`@proteus-vue/fluid` exports the same solving logic (zero-dependency pure functions — unit-testable and customizable):

```ts
import { parseAdaptiveExpression, validateAdaptiveRanges, computeAdaptiveForm, createAdaptiveController } from '@proteus-vue/fluid'

const modes = parseAdaptiveExpression('sheet(0,600) | dialog(600,840) | popover(840,∞)')
validateAdaptiveRanges(modes)      // [] empty array = ranges continuous and non-overlapping (FLD007 passes)
computeAdaptiveForm(modes, 390)    // → 'sheet'
computeAdaptiveForm(modes, 600)    // → 'dialog' (half-open interval [lo, hi))
computeAdaptiveForm(modes, 1024)   // → 'popover'

// Runtime: watch the container size → solve the form live (reuses createContainerQuery; zero steady-state cost, no polling)
const controller = createAdaptiveController(el, { modes })
controller.subscribe(({ form, width }) => { /* form: the current form */ })
controller.destroy()
```

`p-modal` is the consumer of these pure functions: declare the `p-adaptive` attribute once, and as the viewport / container width changes the popup automatically switches between sheet (bottom, full-width) and dialog / popover (centered).

## The Playground is the live example

The official-site Playground's **DEVICE dropdown** solves with the real tiers: five device presets go into the preview frame at their real widths and heights, and the footer shows `Profile3D 1440×900 · F=popover` live ([Try it online](/playground)):

| DEVICE preset | Width × Height | formForWidth result |
|---|---|---|
| Web 1440 | 1440 × 900 | `popover` |
| Tablet 834 | 834 × 1112 | `sheet` |
| Phone 390 | 390 × 844 | `sheet` |
| In-vehicle 1280 | 1280 × 720 | `popover` |
| Watch 198 | 198 × 194 | `sheet` |

The same demo source: switch the DEVICE and every form's rendering is verified — the preview frame's width and height are real, the form solving is real, and the output tree really runs.

## G-25: the three-dimensional breakpoint model (W × H × F)

Width alone only settles the differences among phone / tablet / PC. G-25 (the full-target fluid architecture; plan logged) reduces "device type" to three-dimensional container characteristics:

```
Container characteristics = (W width tier, H height tier, F input form)
```

| Dimension | Tiers / values | Description |
|---|---|---|
| W width | xs 0–320 / sm 320–600 / md 600–900 / lg 900–1280 / xl 1280+ (pt) | Follows G-22 |
| H height | xs 0–320 / sm 320–500 / md 500–800 / lg 800+ (pt) | Special aspect ratios — short in-vehicle screens / portrait TV |
| F input | touch / cursor / remote / dial / voice (+ the driving sub-form) | Fingers, mouse & keyboard, TV remote, watch crown, voice |

Why W alone is not enough: an in-vehicle screen may be wider than a PC (xl) yet interact via touch + voice; a TV is also xl in width but its input is a remote; a watch is extremely narrow but its input is the crown — **width cannot tell them apart; the input form must be brought in**. The three-dimensional notation is backward compatible: `sheet(0,600)` ≡ `sheet(0,600,*)`, so existing p-adaptive code is unaffected.

The G-44 test layer has parameterized the three-dimensional matrix: `W_BREAK [320,600,840,1200,1920] × H_BREAK [480,720,1080,1200] × F_FORMS [touch,cursor,remote,dial,voice]` → `generateBreakpointSuite()` generates 100 Test IRs, and the Device backend solves and runs them by width tier — breakpoint correctness is machine-verifiable, not "looks right".

## Two layers of "breakpoints," each minding its own business

| Layer | API | Baseline | Tier |
|---|---|---|---|
| Container breakpoints | [createContainerQuery](/docs/system/02-container-query) (used inside `p-split` / `p-sidebar` / `p-zone`) | Element container width | sm / md / lg / xl (design mockup × 0.5 / 0.875 / 1.25 / 1.625) |
| Form tiers | `formForWidth` / `computeAdaptiveForm` (`p-adaptive` / `p-modal`) | Width → form range | sheet / dialog / popover (expression customizable) |
| Three-dimensional characteristics | `Profile3D` (W × H × F) | Width + height + input form | xs–xl tiers + 5 input forms |

Component layout decisions (column count, split panes, folding) use container breakpoints; popup / navigation form switching uses form tiers; full-target adaptation uses the three-dimensional characteristics. There are also device-environment signals: `createDeviceEnv`'s folded-form `displayMode` (standard / fold / span / expand) and drive-mode — foldable-hinge avoidance and the ban on motion effects while driving (`shouldReduceMotion`) both come from it.

## Landing status (honest tiering)

- ✅ `formForWidth` tier solving + the 100-profile three-dimensional breakpoint matrix (`@proteus-vue/test-ir`, G-44; the Device backend solves the p-adaptive form by width tier)
- ✅ Folded-form `displayMode`, drive-mode injection, `prefers-reduced-motion` — `createDeviceEnv` + `shouldReduceMotion` (Fluid System S2 / S3)
- ✅ Container-level breakpoint derivation and solving — `deriveContainerBreakpoints` / `resolveBreakpoint` (`@proteus-vue/fluid`)
- 📋 `useContainerProfile()` composite query, in-vehicle / TV / watch primitives (focus engine, crown, single-column one screen) — the G-25 component-layer plan is logged but not yet implemented
- 📋 Companion iron rules: in-vehicle driving-safe (VEH001) / TV focus mode (TV001) / watch single-column (WATCH001) / no hand-written `if (isTV)` — query container characteristics instead (BP003)

> Status legend: ✅ landed and verifiable · 📋 planned and logged (plan + reference implementation, no runnable integration).

## Next steps

- [Full-target adaptation](/docs/21-device-adaptation): G-24 desktop primitives + G-25 full-target
- [Flex System overview](/docs/system/01-overview): back to the big picture
- [Containers & hosts](/docs/framework/33-containers-hosts): container form and host runtime

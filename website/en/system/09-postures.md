---
title: Fold postures & continuity
order: 9
group: 柔性系统
---

# Fold postures & continuity

> **A foldable is a dynamic form**: one device switches between "folded cover screen / tabletop / expanded inner screen", and an app should not restart, should not lose state, and should rearrange continuously. The Flex System makes postures first-class data — `postures[]` declares each posture's topology, navigation, viewport and metric baseline.

## First, two fold types are **two different devices**

A foldable is not one device with two postures — the inner/outer aspect ratios are **exactly inverted** between the two kinds (measured from Samsung's site):

| Device kind | Inner display | Outer display | Half-fold hinge |
|---|---|---|---|
| **Book style / horizontal fold** (Z Fold6 · Mate X5 · MIX Fold) | 2160×1856 → **near-square 0.86** | 968×2376 → **tall strip 0.44** | **Vertical** (Book mode, two halves left/right) |
| **Flip style / vertical fold** (Z Flip6 · MIX Flip) | 2640×1080 → **tall strip 0.44** | 720×748 → **near-square 0.96** | **Horizontal** (TableTop mode, display above / controls below) |

This repo therefore splits them into two forms: `fold` (book style) and `flip` (flip style) — previously merged into one `fold`, which produced data that does not exist on real devices ("expanded 0.70 / folded 0.69, almost identical") and **mismatched a horizontal hinge onto a book-style device**. Xiaomi's *Large-screen App UX Design Guide* explicitly distinguishes "Book mode (horizontal fold)" from "TableTop mode (vertical fold)" — the direct basis for this split.

## Postures (fold · book style)



| Posture `key` | Viewport | Topology | Navigation | Notable semantics |
|---|---|---|---|---|
| `folded` (cover) | **320×727** (0.44 tall strip) | `stack` single column | `side-tabs` | The cover behaves like a narrow phone |
| `book` (half-folded) | **596×693** (0.86 near-square) | `stack` | `side-tabs` | **Vertical** hinge — two halves left/right |
| `expanded` (inner) | **596×693** | `duo` two panes | `side-tabs` | Media + details side by side |

> Viewports and navigation are aligned with **Apple's HIG "Designing for iPhone Duo"** (new page, 2026-09-09) and the official tech specs: iPhone Duo's inner display is 1878×2670px @430ppi ≈ 626×890pt and the outer display 1398×2034px @460ppi ≈ 466×678pt.
> The key takeaway: the cover display is **wider and shorter than a phone** (466×678, ratio 0.69), not a Z Fold-style tall narrow strip; the system therefore moves toolbars/tab bars **to the side** to preserve vertical content space, and keeps them on the same side in landscape on the inner display.

```ts
// packages/fluid/src/formfactor.ts (fold profile excerpt)
postures: [
  { key: 'folded',   topology: 'stack', nav: 'bottom-tabs', viewport: { width: 340, height: 800 },
    ratio: { baseFont: 13, ref: 300, min: 0.85, max: 1.5 } },   // ← posture-level metrics
  { key: 'tabletop', topology: 'stack', nav: 'tabs', viewport: { width: 673, height: 420 }, hinge: 'horizontal' },
  { key: 'expanded', topology: 'duo',   nav: 'tabs', viewport: { width: 673, height: 841 } },
]
```

## Postures (flip · flip style)

| Posture `key` | Viewport | Topology | Navigation | Notable semantics |
|---|---|---|---|---|
| `folded` (cover) | **340×354** (0.96 near-square) | `glance` one screen | `page-stack` | Small cover-card display |
| `tabletop` (flex mode) | **360×420** | `stack` | `side-tabs` | **Horizontal** hinge — display above, controls below |
| `expanded` (inner) | **360×820** (0.44 tall strip) | `stack` single column | `bottom-tabs` | A conventional portrait phone |

## The continuity contract

1. **The form never restarts**: business state (form input, selection, scroll position) survives posture changes — guaranteed by rearranging the same component instance rather than remounting it.
2. **Continuous topology rearrangement**: `stack` ⇄ `duo` is a structural change, not scaling; the folded and expanded topologies **must differ** (enforced by `validateFormProfiles`), otherwise "form switching" is a misnomer.
3. **Increasing viewport**: the expanded viewport must be wider than the folded one (340 → 673), checked by a gate.
4. **Metrics follow the posture**: a posture may override `ratio` — keeping the inner baseline (ref 420) on the 340pt cover yields k = 0.81 → 9.7px body text, below even the WCAG 2.5.8 24px touch floor; switching to the narrow-phone baseline restores 14.7px.

## The tabletop trade-off

Tabletop is the physical form of "top half displays, bottom half operates", with only 420pt of visible height. The implementation makes **prioritised trade-offs** rather than scaling everything down:

- Media capped at 40% (the top pane keeps content, the bottom stays operable)
- **Only** the long description collapses (secondary information); **the SKU picker stays** — it is the purchase path
- Primary actions and tabs stay within reach (tabs move to the side)

> ★★The three-region rule (2026-09-28, borrowed from the **shared Chinese-vendor baseline**: the ITGSA white paper / Xiaomi's "Large-screen App UX Design Guide", co-signed by OPPO, vivo and Xiaomi):
> "Gather display content into region 2, sink interactive controls into region 1, and **avoid placing any element inside region 3**" — region 2 = upper half (display), region 1 = lower half (controls), region 3 = the crease/deformation band.
> This implementation uses an **empty grid row**: the crease band is row 2 and **no element is assigned to it**, so "nothing inside the band" is guaranteed structurally (machine criterion: `tests/fluid-formfactor-render.test.ts` asserts the four-row grid and the band's `::before` placeholder on row 2).
>
> ★Companion guidance: "**do not use rotation; lay out by width and height**" (Xiaomi) and Huawei's *Layout Basics*, which splits breakpoints into **horizontal (width) and vertical (aspect ratio)** as two independent dimensions — this repo therefore adds `resolveAspectClass` (tall / balanced / wide / ultra-wide) and makes the media height cap tighten with aspect ratio (`aspectMediaCap`): the flatter the canvas, the more media yields to information and controls. An in-car 8/3 (ultra-wide) and a TV 16:9 (wide) are thus distinguished — something a binary `orientation` cannot do.
>
> ★Two corrections from Apple's HIG (2026-09-28):
> 1. **No longer hides the SKU picker** — two rules apply: "Maintain the same functionality across device poses" (every pose must reach the **same controls and content**) and "Avoid extreme layout changes as people fold … favor small adjustments over rearrangement" (controls that disappear or shift dramatically are harder to find). Hiding the SKU dropped functionality, so it now uses a compact arrangement instead.
> 2. **Crease semantics**: content must not cross the crease (with a horizontal hinge the crease runs across the middle; the demo draws it from `posture.hinge` — a permanent vertical crease was a bug).

## Hinge geometry

Real devices (Web foldables) expose the hinge band width through `env(fold-*)`; the framework emits `--pf-fold-width`, consumed by the `duo` topology:

```css
.topo-duo .pf-body {
  /* on a real device env(fold-width) > 0 automatically clears the crease; a normal screen falls back to 0px = the design gap */
  column-gap: max(calc(var(--pf-gap) * var(--pf-gap-dense)), var(--pf-fold-width, 0px));
}
```

> Historical trap: an early implementation emitted both "indent from the hinge's left edge" and "indent by the right pane's width" — on a centred-hinge device the two paddings summed to 100% and the **content width collapsed to zero**. The correct semantics is "single-flow content avoids the hinge band", not padding on both sides.

## How a posture is consumed

| Step | Description |
|---|---|
| Declaration | The host passes `posture="folded \| tabletop \| expanded"` (the demo offers shareable `?posture=`) |
| Activation condition | It applies **only if the form's profile actually defines that posture** — `phone + posture=tabletop` is ignored (otherwise it would silently hide the SKU slot and squeeze the cover, contradicting its own declarations) |
| Override scope | `topology` / `nav` / viewport / `ratio` (the metric baseline) |
| Diagnostic attributes | Root `data-pf-posture` / `data-pf-topology` / `data-pf-nav` (assertable in e2e) |

## Honest boundaries

- The posture is **declared by the host**. The web can read `display-mode: fold/span` as an enhancement, but real posture events (WM FoldingFeature / ArkUI foldStatus / hinge angle) belong to the **form-sensing service**, which is not wired yet — see the [OS-level roadmap](/docs/system/01-overview).
- Only three discrete postures are modelled today; the hinge **angle** is continuous and will not be expanded into an enum (handling it as geometric input is planned).

## Next steps

- [Focus navigation](/docs/system/10-focus-navigation): the spatial navigation engine behind keyboard/remote reachability
- [p-formfactor](/docs/system/11-formfactor-composition): how the `posture` prop is used at the component layer

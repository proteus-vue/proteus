---
title: Fold postures & continuity
order: 9
group: 柔性系统
---

# Fold postures & continuity

> **A foldable is a dynamic form**: one device switches between "folded cover screen / half-open (flex) / expanded inner screen", and an app should not restart, should not lose state, and should rearrange continuously. The Flex System makes postures first-class data — `postures[]` declares each posture's topology, navigation, viewport, crease position and metric baseline.

## First, the two fold types are **two different devices**

A foldable is not one device with two postures — the inner/outer aspect ratios are **exactly inverted** between the two kinds (measured from Samsung's site):

| Device kind | Inner display | Outer display | Half-open hinge |
|---|---|---|---|
| **Book style / folds left-right** (Z Fold6 · Mate X5 · MIX Fold) | 2160×1856 → **near-square 0.86** | 968×2376 → **tall strip 0.44** | **Vertical** (Book mode, two halves) |
| **Flip style / folds top-bottom** (Z Flip6 · MIX Flip) | 2640×1080 → **tall strip 0.41** | 720×748 → **near-square 0.96** | **Horizontal** (TableTop mode, display above / controls below) |

This repo therefore splits them into two forms: `fold` (book style) and `flip` (flip style) — previously merged into one `fold`, which produced data that does not exist on real devices ("expanded 0.70 / folded 0.69, almost identical") and **mismatched a horizontal hinge onto a book-style device**. Xiaomi's *Large-screen App UX Design Guide* explicitly distinguishes "Book mode (folds left-right)" from "TableTop mode (folds top-bottom)" — the direct basis for this split.

## ★★Half-open (flex): the app area is only **half of the inner screen**

> **Naming discipline**: a book-style device is **opened to about 90°** (half-**open**, flex posture) — it is not "folded in half". "Half-fold" applies only to the **flip style** (a clamshell, which genuinely folds in half). "Half-folded (book mode)" was an invented term in an earlier revision and has been withdrawn — Xiaomi's original text only says "Book mode" / "TableTop mode".

In half-open, only the half facing the user is the app area; the other half rests flat or faces away — so the half-open viewport **cannot** equal the inner-screen viewport. Converting real-device pixels at the same scale as the expanded posture (÷3):

| Device | Inner (px → pt) | Half-open app area (px → pt) | Share |
|---|---|---|---|
| Book style Fold6 | 2160×1856 → **596×693** (0.86 near-square) | 2160×928 → **693×298** (2.33 **wide strip**) | **50%** |
| Flip style Flip6 | 1080×2640 → **360×880** (0.41 tall strip) | 1080×1320 → **360×440** (0.82 portrait rectangle) | **50%** |

`validateFormProfiles` enforces three rules (machine gates — removing the data turns them red):
① the half-open/expanded **area ratio must be 40–75%** (real devices are exactly 50%);
② the half-open viewport **must not equal** the expanded one;
③ the folded (cover) posture **must not declare a crease** (the crease is not visible on the cover screen — an earlier demo drew one anyway, a **fake crease**).

## Postures (fold · book style)

| Posture `key` | Viewport | Topology | Navigation | Crease | Notable semantics |
|---|---|---|---|---|---|
| `folded` (cover) | **320×727** (0.44 tall strip) | `stack` | `side-tabs` | none | The cover behaves like a narrow phone |
| `book` (half-open) | **693×298** (2.33 **wide strip**) | `duo` | `side-tabs` | horizontal · window **bottom edge** | Left half displays / right half operates (device turned 90°; the hinge axis stays vertical) |
| `expanded` (inner) | **596×693** (0.86 near-square) | `duo` two panes | `side-tabs` | vertical · **through the middle** | Media + details side by side |

## Postures (flip · flip style)

| Posture `key` | Viewport | Topology | Navigation | Crease | Notable semantics |
|---|---|---|---|---|---|
| `folded` (cover) | **340×354** (0.96 near-square) | `glance` | `page-stack` | none | Small cover-card display |
| `tabletop` (flex mode) | **360×440** (0.82 portrait) | `stack` | `side-tabs` | horizontal · window **bottom edge** | Display above / controls below |
| `expanded` (inner) | **360×880** (0.41 tall strip) | `stack` | `bottom-tabs` | horizontal · **through the middle** | A conventional portrait phone |

```ts
// packages/fluid/src/formfactor.ts (fold profile excerpt — real-device pixels ÷3)
postures: [
  { key: 'folded',   topology: 'stack', nav: 'side-tabs', viewport: { width: 320, height: 727 },
    ratio: { baseFont: 13, ref: 320, min: 0.85, max: 1.5 } },   // ← posture-level metrics
  { key: 'book',     topology: 'duo',   nav: 'side-tabs', viewport: { width: 693, height: 298 },
    hinge: 'vertical', crease: { axis: 'horizontal', at: 'bottom' } },  // half-open: hinge at the window's bottom edge
  { key: 'expanded', topology: 'duo',   nav: 'side-tabs', viewport: { width: 596, height: 693 },
    crease: { axis: 'vertical', at: 'middle' } },                       // expanded: crease through the middle
]
```

## Crease geometry: `hinge` and `crease` are **two different quantities**

- `hinge` = the **device's intrinsic axis** (vertical for book style / horizontal for flip style) — hardware, invariant across postures;
- `crease` = **where the crease runs inside this posture's window** — changes per posture:
  - half-open (flex): the hinge sits below the half facing the user → `{ axis: 'horizontal', at: 'bottom' }` (when a book-style device is turned 90°, the hinge axis stays vertical while the on-screen crease is horizontal);
  - expanded (flat): the crease runs through the middle → `at: 'middle'` (vertical for fold / horizontal for flip); **no band is drawn** (on a flat screen the crease is a faint line, not a layout region);
  - folded (cover): **not declared** — no crease is visible.

The component renders a visible crease band when `crease.at === 'bottom'` (`.pf-crease`, and nothing may sit inside it); `data-pf-crease` / `data-pf-crease-geom` are assertion-friendly diagnostics. The end can inject the real hinge-band width (`crease-band` prop / `env(fold-*)`) — **device geometry belongs to the end**, the framework only owns the rules and form classes.

## The continuity contract

1. **The form never restarts**: business state (form input, selection, scroll position) survives posture changes — guaranteed by rearranging the same component instance rather than remounting it.
2. **Continuous topology rearrangement**: `stack` ⇄ `duo` is a structural change, not scaling; the folded and expanded topologies **must differ** (enforced by `validateFormProfiles`).
3. **Increasing viewport**: the expanded viewport must be wider than the folded one, checked by a gate.
4. **Metrics follow the posture**: a posture may override `ratio` — keeping the inner baseline (ref 420) on the 320pt cover would yield k = 0.76 → unreadable body text; the narrow-phone baseline restores ≥11px.

> ★**Honest boundary**: the demo's "state is not lost" is currently **evidence** (assertable `data-biz-*` attributes; the panel shows a before/after comparison). A framework-level continuity **contract** (`onFormChange` / end-side posture events) is still on the [OS-level roadmap](/docs/system/01-overview) (P0/P1) and has not shipped. **Until S4, do not claim "the framework guarantees state continuity".**

## Half-open trade-offs (each device kind follows its own geometry)

Half-open gives only half of the inner screen, so the implementation makes **prioritised trade-offs** rather than scaling everything down:

- **Book style** (wide strip 693×298): left half = display (media as backdrop + title/price) · right half = controls (SKU / primary action / recommendations column);
- **Flip style** (portrait 360×440): top half = display (media left + copy right) · bottom half = controls (SKU + primary action) · recommendations become a single compact row;
- Both: **only** the long description collapses (secondary information); **the SKU picker stays** — it is the purchase path.

> ★★The three-region rule (borrowed from the **shared Chinese-vendor baseline**: the ITGSA white paper / Xiaomi's "Large-screen App UX Design Guide", co-signed by OPPO, vivo and Xiaomi):
> "Gather display content into region 2, sink interactive controls into region 1, and **avoid placing any element inside region 3**" — region 2 = upper half, region 1 = lower half, region 3 = the crease band.
> This implementation uses an **empty grid row plus a dedicated crease-band element**: no element is assigned to the band's row, so "nothing inside the band" is guaranteed structurally — and an e2e geometry assertion checks that the band's rectangle intersects no content block.
>
> ★Supporting quote: "**Do not use rotation; lay out according to width and height**" (Xiaomi), and Huawei's *Layout Basics* splits breakpoints into **horizontal (width) + vertical (aspect ratio)** — the basis for `resolveAspectClass` (tall / balanced / wide / ultra-wide) and for `aspectMediaCap` tightening the media cap as the canvas gets flatter.
>
> ★Two Apple HIG corrections (2026-09-28):
> ① **Stop hiding the SKU** — "Maintain the same functionality across device poses" and "Avoid extreme layout changes as people fold … favor small adjustments over rearrangement". Hiding the SKU drops functionality; it is now laid out compactly, and the demo's "function comparison" panel lists every collapsed control **with its reason** (nothing silently disappears).
> ② **Crease semantics**: content must not cross the crease — and a crease is only drawn **in postures where it is actually visible** (not in folded/expanded).

## Vendor size classes (ITGSA / Xiaomi width + height breakpoints)

The shared Chinese-vendor baseline defines **two sets of breakpoints**, which are a **different coordinate system** from our container breakpoints (design-driven: 188/328/469/609):

| Dimension | Vendor classes (ITGSA / Xiaomi, quoting Google) |
|---|---|
| Width | `<600dp` Compact · `600–840dp` Medium · `≥840dp` Expanded |
| Height | `<480dp` Compact · `480–900dp` Medium · `≥900dp` Expanded |

`vendorSizeClass(width, height)` translates any window into vendor classes (width and height are **independent** — Huawei's "two-dimensional breakpoints"); our container breakpoints still govern how a component changes continuously inside its container. The demo's fold panel shows both side by side (e.g. book-style half-open 693×298 → vendor width class medium / height class compact).

## Hinge geometry

On real devices (Web foldables) `env(fold-*)` reports the hinge band width; the framework emits `--pf-fold-width` and the `duo` topology consumes it:

```css
.topo-duo .pf-body {
  /* env(fold-width) > 0 lets the panes clear the crease; plain screens fall back to 0px */
  column-gap: max(calc(var(--pf-gap) * var(--pf-gap-dense)), var(--pf-fold-width, 0px));
}
```

> Historical pitfall: an early implementation emitted both "indent from the hinge's left edge" and "indent by the right pane's width" — on a centred-hinge device the two paddings summed to 100%, **collapsing the content width to zero**. The correct semantics is "a single content flow clears the hinge band", not two-sided padding.

## How postures are consumed

| Stage | Description |
|---|---|
| Declaration | The host passes `posture="folded \| book \| tabletop \| expanded"` (the demo uses shareable `?posture=`) |
| Precondition | Takes effect **only if the profile actually declares that posture** — `phone + posture=book` is ignored (otherwise a foldable layout would be applied silently) |
| Overrides | `topology` / `nav` / viewport / `ratio` (metric baseline) / crease rendering |
| Diagnostics | Root attributes `data-pf-posture` / `data-pf-topology` / `data-pf-nav` / `data-pf-crease` / `data-pf-crease-geom` (assertable in e2e) |
| End injection | `crease-band` prop (real hinge-band width); device geometry and posture events remain end-side |

## Honest boundaries

- Postures **come from the host declaration**. On the web, `display-mode: fold/span` can enhance detection, but real-device posture events (WM FoldingFeature / ArkUI foldStatus / hinge angle) belong to the **form-awareness service** and are not wired up yet — see the [OS-level roadmap](/docs/system/01-overview).
- Only three discrete postures are modelled; the hinge **angle** is a continuous quantity and is not expanded into an enum.
- Device geometry uses **Samsung Fold6 / Flip6 only** (verified); Huawei Mate X5 / Xiaomi MIX Fold / vivo X Fold specs are **not verified** and are not cited as evidence in the demo.
- Huawei's own honest boundary applies: **small screens (watches) and unusual aspect ratios (Pura X cover) cannot be served by one layout** — they need separate design, and the demo labels them instead of pretending otherwise.

## Next

- [Focus navigation](/docs/system/10-focus-navigation): the spatial-navigation engine for keyboard/remote reachability
- [p-formfactor](/docs/system/11-p-formfactor): the component-level use of the `posture` prop

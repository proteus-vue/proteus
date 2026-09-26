---
title: Fold postures & continuity
order: 9
group: 柔性系统
---

# Fold postures & continuity

> **A foldable is a dynamic form**: one device switches between "folded cover screen / tabletop / expanded inner screen", and an app should not restart, should not lose state, and should rearrange continuously. The Flex System makes postures first-class data — `postures[]` declares each posture's topology, navigation, viewport and metric baseline.

## The three postures

| Posture `key` | Viewport | Topology | Navigation | Notable semantics |
|---|---|---|---|---|
| `folded` (cover) | 340×800 | `stack` single column | bottom-tabs | Metrics follow the **narrow-phone** baseline (`ratio.ref: 300`) |
| `tabletop` (flex mode) | 673×420 | `stack` | tabs | Horizontal hinge — top half displays, bottom half operates |
| `expanded` (inner) | 673×841 | `duo` two panes | tabs | Media + details side by side |

```ts
// packages/fluid/src/formfactor.ts (fold profile excerpt)
postures: [
  { key: 'folded',   topology: 'stack', nav: 'bottom-tabs', viewport: { width: 340, height: 800 },
    ratio: { baseFont: 13, ref: 300, min: 0.85, max: 1.5 } },   // ← posture-level metrics
  { key: 'tabletop', topology: 'stack', nav: 'tabs', viewport: { width: 673, height: 420 }, hinge: 'horizontal' },
  { key: 'expanded', topology: 'duo',   nav: 'tabs', viewport: { width: 673, height: 841 } },
]
```

## The continuity contract

1. **The form never restarts**: business state (form input, selection, scroll position) survives posture changes — guaranteed by rearranging the same component instance rather than remounting it.
2. **Continuous topology rearrangement**: `stack` ⇄ `duo` is a structural change, not scaling; the folded and expanded topologies **must differ** (enforced by `validateFormProfiles`), otherwise "form switching" is a misnomer.
3. **Increasing viewport**: the expanded viewport must be wider than the folded one (340 → 673), checked by a gate.
4. **Metrics follow the posture**: a posture may override `ratio` — keeping the inner baseline (ref 420) on the 340pt cover yields k = 0.81 → 9.7px body text, below even the WCAG 2.5.8 24px touch floor; switching to the narrow-phone baseline restores 14.7px.

## The tabletop trade-off

Tabletop is the physical form of "top half displays, bottom half operates", with only 420pt of visible height. The implementation makes **prioritised trade-offs** rather than scaling everything down:

- Media capped at 40% (the top pane keeps content, the bottom stays operable)
- Description and SKU options collapse (secondary information is unreadable in a half-folded glance)
- Primary actions and tabs stay within reach

Content must not cross the crease: with a horizontal hinge the crease runs across the middle (the demo draws a horizontal crease from `posture.hinge`; a permanent vertical crease was a bug).

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

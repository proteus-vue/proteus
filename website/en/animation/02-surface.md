---
title: Declaration surface
order: 3
group: Usage
---

# Declaration surface

Morpheus exposes exactly one package: **`@proteus-vue/animation`** (declare + validate + compile — pure functions, zero runtime dependencies). It deliberately does not do three things: it does not hold animation state, does not do curve math, and does not touch platform APIs.

## Loop: declare → validate → compile → instructions

| Step | Entry | Description |
|---|---|---|
| Declare | `AnimDecl` (closed set) | property / from / to / duration / curve or spring or sequence |
| Validate | `validateAnimations` | 7 check families: invalid property / duplicate kind / illegal parameters… failures **throw with a fix hint** |
| Compile | `compileAnimations(decls, targets)` | Binds declarations to target nodes; defaults are resolved at compile time (no “unspecified” reaches the engine) |
| Batch | `compileRoute(spec, {enter, exit})` | Route transition: two bound instruction groups, one per screen |
| Align | `compileTimeline({kinds, stops})` | Cross-property shared timeline (kinds dock on the same stops; identical total duration is guaranteed by construction) |

## Properties and curves (cross-language contract, ids must not change)

| Property (`kind`) | Contract id | Composited? |
|---|---|---|
| `translateX` | 0 | ✅ |
| `translateY` | 1 | ✅ |
| `scale` | 2 | ✅ |
| `rotate` | 3 | ✅ |
| `opacity` | 4 | ✅ |
| `color` | 5..8（R/G/B/A 四通道） | ❌ **paint-only**（不触发布局，但不进平台零参与路径——见架构页） |
| `textColor` | 9..12 (R/G/B/A channels, separate track) | ❌ **paint-only** (same as above; runs in parallel with `color` on the same node) |
| `rotateX` / `rotateY` | 13 / 14 | ❌ **tick-only** (3D — see below) |
| `clip` | 15..30 (per-parameter slots, up to 16 channels) | ❌ **tick-only** (clip-path morph — see below) |
| `strokeProgress` | 31 (single scalar channel: 0..1 = how far along the arc to draw) | ❌ **tick-only** (SVG stroke — see below) |
| `gradientMix` | 32 (single channel: blend factor between two gradient states) | ❌ **tick-only** (gradient v1+v2 — see below) |
| `pathMorph` | 33 (single channel: interpolation factor between two path states) | ❌ **tick-only** (path morph v1+v2 — see below) |
| `glowIntensity` | 34 (single channel: glow strength 0..1) | ❌ **tick-only** (glow — see below) |
| `maskProgress` | 35 (single channel: soft-mask reveal progress) | ❌ **tick-only** (mask — see below) |
| `skewX` / `skewY` | 36 / 37 (degrees) | ❌ **tick-only** (skew — see below) |

| Curve | Contract id |
|---|---|
| `linear` | 0 |
| `easeOut` | 1 |
| `easeIn` | 2 |
| `easeInOut` | 3 |
| `springApprox` | 4 |

**3D rotation (`rotateX` / `rotateY`, 2026-10-01)**: rotation about the X/Y axes (degrees; anchor = layer centre), with perspective declared on the node's style (`perspective: 1200`, CSS semantics). It **runs on the tick path** — the two platforms' interpolators differ in 3D semantics, so evaluation is unified in the kernel with the host assembling the matrix (cross-target consistency first, the same decision as `color`). Presets: `presets.element.flipIn` / `flip3D` (combine with `repeat: 'infinite'` for endless flipping).

**Loops & yoyo (`repeat` / `direction`, 2026-10-01)**: `repeat: 3 | 'infinite'` (= CSS `animation-iteration-count`) plus `direction: 'alternate'` (= yoyo — every other round runs backwards, **net displacement 0**). "Breathing lamps / infinite pulses" no longer need the "stretch the duration" hack (which distorts the curve). Colour animations support it too (all four channels loop together — anything less is a colour split).

**Playback control (`animControl`, 2026-10-01)**: global `timeScale` (`0.25` slow-motion / `2` fast-forward) and `paused` (freeze; resuming continues from the frozen point, not a reset). It **only affects time advance** — `seek` and scroll-driven progress come from outside, so pausing/slowing never breaks gesture-following.

**Arbitrary easing (`curveBezier`, promoted 2026-10-01)**: design-handoff curves outside the closed set no longer need an escape hatch — `curveBezier: [x1,y1,x2,y2]` (or paste the CSS value with `parseCubicBezier('cubic-bezier(…)')`) runs on the **same kernel evaluation machine** (65-point table + interpolation; the control-point table is generated once and cached). Constraint: `x1/x2 ∈ [0,1]` (monotonic time axis); `y1/y2` are free (> 1 = overshoot, < 0 = anticipation), and it is mutually exclusive with `curve` / `spring` / `keyframes` (the evaluation mode must be unique).

**Clip-path morph (`clip`, 2026-10-01)**: the shape type is declared **statically** on the node's style (`clipPath: { kind: 'inset' | 'circle' | 'polygon', … }`, parameters as box fractions 0..1) while the parameters animate — **one declaration → up to 16 scalar parameter channels** (kinds 15..30, the same decomposition as colour: curve / spring / keyframes / repeat / takeover all reused unchanged). Cross-shape interpolation is not supported (inset→circle is meaningless, same as CSS). Rendering: iOS `CAShapeLayer` as `layer.mask` / Android `canvas.clipPath` (both static and animated states are covered).

**SVG stroke (`strokeProgress`, 2026-10-01)**: the path itself (`d`) is declared on the node's style (`svgPath: { d, stroke, strokeWidth }`) and the animation is a single scalar: `{ kind: 'strokeProgress', from: 0, to: 1 }` — 0..1 = how far along the arc to draw ("handwriting / line drawing"). The path is parsed by **the kernel, once** (segment list + arc length, shared by both hosts — no "same `d`, two different drawings"). Supports `M/L/C/Q/Z` (relative commands and implicit repetition included; `A` arcs and `S`/`T` shorthands are rejected with an actionable alternative).

**Gradient fill & blending (`gradientMix`, 2026-10-01 · v1+v2)**: the node's style declares `fillGradient`
(`{ kind: 'linear'|'radial', angle | cx/cy/r, stops: [{offset, color, alpha?}] }`, 2..8 stops, strictly
ascending offsets); declaring `fillGradientTo` (the B state — same kind, same stop count) enables a
`gradientMix` channel (32) that blends A↔B: **stops (colour + position) and geometry (angle / cx·cy·r)
all travel on the same factor** — "the light itself moves" (halo expansion / angle turn / highlight drift).
CSS cannot transition gradient geometry at all (`linear-gradient` switches states wholesale); the lerp
lives in the kernel only (`GradState::mixed`) — hosts consume pre-computed values, zero interpolation.

**Path morph (`pathMorph`, 2026-10-01 · v1+v2)**: two path states (`svgPath` A + `svgPathTo` B) are
interpolated point-by-point — **CSS cannot do this at all** (`d` is not in the CSS transition set; on
the web it takes GSAP MorphSVG / flubber-style libraries recomputing points). Since v2, heterogeneous
pairs (different segment counts / types) are **auto-resampled** at tree-build time into a common shape
(uniform arc-length sampling + Catmull-Rom to cubic, count `max(sides).clamp(12,48)`); resampling is an
approximation (arc length within 3%) and is **stated honestly** (query responses carry a `resampled`
flag). The lerp lives in the kernel only (`SvgPath::morphed`); hosts translate the morphed segment list
(binary channel — avoiding per-frame JSON encode/decode).

**Glow (`glow` + `glowIntensity`, 2026-10-01 · glow v1)**: the node declares `glow: {color, radius, alpha}`;
channel 34 drives breathing / fade-in / fade-out (interlocked with stroke progress — "glow follows the
drawing"). Rendering = **N concentric stroke layers** (N=5 cross-language constant; width gradient
`radius×k/N`, alpha falling as `a0×(1-(k-1)/N)²`) — **deliberately not platform-native**: Android's
`Paint.setShadowLayer` ignores Paths under hardware acceleration (silently draws nothing) and iOS
`CALayer.shadow*` is a Gaussian shadow (the two differ in shape). Concentric strokes are deterministic
and pixel-predictable on both targets; measured at p95 0.28ms per frame ("essentially free").

**Soft mask (`mask` + `maskProgress`, 2026-10-01 · mask v1)**: complementary to `clip` — clip cuts a hard
edge, mask fades a soft one ("seeping out of the fog"); the two compose naturally. Declared as
`mask: {kind: 'linear'|'radial', angle|cx/cy/r, softness, progress?}`; channel 35 (0 = hidden, 1 = fully
shown) drives a **two-stop softened reveal**, with the reveal math implemented once in the kernel (hosts do
zero math). Endpoints use an **explicit short-circuit** — a measured f32 lesson: `1.0×1.4−0.4` evaluates
to `0.99999994` in f32, so comparisons never rely on floating point (otherwise "progress hit 1 but a soft
edge remains").

**Skew & transform origin (`skewX` / `skewY` + `transformOrigin`, 2026-10-01)**: channels 36/37 (degrees;
`x' = x + tan(skewX)·y`, same as CSS `skewX`); with `transformOrigin: {x, y}` (box fractions) any anchor
works — "bend from the root" (bottom-centre) / "hinge rotation" (left edge) / "grow from a corner".
Neither target has skew as a first-class property (no `setSkewX` on Android, no skew on `CALayer`) ⇒
both use the tick path. The transform stack is now complete: translate / scale / rotate / 3D / skew ×
any anchor.

**Composited = eligible for the platform zero-involvement path.** The five scalar properties are composited; **`color` / `textColor` / `rotateX` / `rotateY` / `clip` / `strokeProgress` / `gradientMix` / `pathMorph` / `glowIntensity` / `maskProgress` / `skewX` / `skewY` are tick-only or paint-only but non-composited** (they do not trigger layout, but the two platforms' interpolators differ in semantics or cannot interpolate at all, so both targets use the kernel tick path for consistency). Note also: **changing layout properties (width / margin) is not animation, it is relayout**, and compilation rejects it outright.

```ts
// colour is one declaration — compiled into four kernel channels
compileAnimations([{ kind: 'color', from: '#2f6fed', to: '#ff5533', durationMs: 200 }], { nodeId: 7 })
// ⇒ 4 instructions (kinds 5/6/7/8) · batch.composited === false（paint-only —— 见架构页）

// text colour: a separate track (kinds 9..12); keyframes sequences behave exactly like scalar ones
compileAnimations([{ kind: 'textColor', from: '#ffffff', to: '#00ff00',
  keyframes: [{ to: '#ff0000', durationMs: 100 }] }], { nodeId: 7 })
```

## Preset library (13 entries)

Presets over parameters — common motions are one-liners. The full catalogue (with “when to use” and “how to verify”) lives in the [Morpheus declaration manual](/docs/generated/anim-manual).

| Category | Presets | One-liner |
|---|---|---|
| Route transitions | `route.slideUp` / `route.slideDown` / `route.bottomSheet` / `route.zoom` / `route.cupertinoModal` | Push in / dismiss down / half-screen sheet / zoom sink / iOS modal |
| Lists | `list.shift` | Other rows glide out of the way when items are added or removed (FLIP) |
| Elements | `element.press` / `element.shake` / `element.sharedElement` / `element.fadeIn` | Press-and-rebound / shake / cross-element flight / fade in |
| Scroll-linked | `scroll.parallax` / `scroll.sticky` / `scroll.fadeIn` | Parallax / sticky header / fade in |

```ts
import { presets, compileRoute } from '@proteus-vue/animation'

const spec = presets.route.bottomSheet()      // half-screen sheet: only the incoming screen moves
const batch = compileRoute(spec, { enter: 101, exit: 100 })
// batch.enter / batch.exit → two bound instruction groups for the engine
```

## Shared single source with the AI manual

The 48 declaration entries (21 presets / 19 surface primitives / 6 constraints / 2 boundaries) share `ANIM_RULES` as their single source of truth and are **isomorphic** to the compiler’s 112 rules: each carries what / why / when / example / how to verify / implementation site, so an AI can consume a single entry.

The generated [anim-manual](/docs/generated/anim-manual) runs `runConformance()` before rendering — presets must really exist in the export surface, cross-language contract values must match, and `verify` must be traceable; **if the reconciliation fails, no document is generated**.

## Next

- [Route transitions](/docs/animation/03-transitions) — how one enum is honoured per target, and push/pop direction semantics
- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and the not-done list

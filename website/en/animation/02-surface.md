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

| Curve | Contract id |
|---|---|
| `linear` | 0 |
| `easeOut` | 1 |
| `easeIn` | 2 |
| `easeInOut` | 3 |
| `springApprox` | 4 |

**Composited = eligible for the platform zero-involvement path.** The five scalar properties are composited; **`color` / `textColor` are paint-only but non-composited** (they do not trigger layout, but Android's RenderNode cannot interpolate colours, so both targets use the tick path for consistency). Note also: **changing layout properties (width / margin) is not animation, it is relayout**, and compilation rejects it outright.

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

The 26 declaration entries (13 presets / 6 surface primitives / 5 constraints / 2 boundaries) share `ANIM_RULES` as their single source of truth and are **isomorphic** to the compiler’s 111 rules: each carries what / why / when / example / how to verify / implementation site, so an AI can consume a single entry.

The generated [anim-manual](/docs/generated/anim-manual) runs `runConformance()` before rendering — presets must really exist in the export surface, cross-language contract values must match, and `verify` must be traceable; **if the reconciliation fails, no document is generated**.

## Next

- [Route transitions](/docs/animation/03-transitions) — how one enum is honoured per target, and push/pop direction semantics
- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and the not-done list

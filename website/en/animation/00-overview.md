---
title: Overview
order: 1
group: Overview
---

# Morpheus · Declarative Animation Engine

Make “will it jank?” a **compile-time question**.

One line of declaration. Curve evaluation and spring physics live in the Rust core; layout animation is nearly free; transitions ride the system render thread — no custom renderer, zero main-thread involvement.

## Why it exists

Most approaches treat animation as a **continuous runtime task**: compute and write every frame — whether it janks depends on the device and the current load. Morpheus asks a different question: **what can already be decided at compile time?**

| Question | Conventional approach | Morpheus |
|---|---|---|
| Are the parameters valid | Only discovered at runtime (bad value → jump / crash) | **Compile-time validation** (closed set + 7 checks, invalid fails immediately) |
| Will it jank | A tuning gamble on real devices | **Compile-time composited-property check** (transform / opacity ⊆ the set → zero-involvement path) |
| Where are curves evaluated | Every frame in JS | **Single implementation in the Rust kernel** (zero curve math on hosts, no cross-target drift) |
| Cost of layout animation | Reading geometry twice (expensive) | Geometry already lives in the kernel — **snapshot and tween both inside**, zero cross-boundary queries |
| Who renders transitions | Self-draw → self-built raster thread | **No self-draw → use the system render thread** |

## Three differentiators

### ① Layout animation, nearly free

Classic FLIP reads geometry twice (before and after the change) — both reads are expensive inside a VDOM framework. In Morpheus the geometry **already lives in the Rust layout core**: both snapshots are taken inside the kernel, which then emits the `Δ → 0` tween. Zero cross-boundary geometry queries.

Combined with a `0.08ms` full relayout, motion like “other rows glide out of the way when a list item is added or removed” costs almost nothing.

### ② Transitions with zero main-thread involvement

Morpheus **does not self-draw**, so transitions can land directly on the system render thread (Android RenderThread / iOS CoreAnimation render server): the kernel samples keyframes, the host commits **one** platform animation, and the system interpolates on its own from there.

> Flutter self-draws, so it had to build its own raster thread. We do not — the system’s pipeline is more mature, and it is free.

### ③ Compile-time interception, no silent downgrade

The composited-property set (`transform` / `opacity`) is decided **at compile time**: only when the property set falls inside it may the transition use the “commit once, platform interpolates” zero-involvement path; touching layout properties (`width` / `margin` etc.) inside a transition is a **compile error**, and the host **explicitly rejects** it — it never silently degrades into “relayout every frame”.

## Three layers

```
Declaration  (@proteus-vue/animation)        ← one-liners + compile-time errors
      ↓  engine instructions (cross-language contract)
Kernel       (layout-core-rust/anim.rs)      ← curves / physics / window mapping — single implementation
      ↓  per-frame binary channel (24B/record) or commit spec
Host         (platform shells)               ← translate to platform APIs only — zero curve math
```

The **responsibility boundaries are hard constraints**, each one guarded by machine-checked assertions:

- **Curve evaluation and physics integration live only in Rust** (the TS side holds a golden-tested mirror table) — otherwise it becomes “the Nth hand-written copy” and targets silently diverge;
- **Hosts only translate platform APIs** (iOS `CAKeyframeAnimation` / Android `ViewPropertyAnimator`), and springs use **offline kernel sampling** rather than platform springs (the two spring parameterisations differ; mixing them makes the two paths drift apart);
- **Animations bind to Slot identity** (not Node identity) — at a 0.997 reuse ratio, binding the wrong identity means “the wrong row is animating”.

## 30-second start

```ts
// Route level: one declaration, honoured per target
meta: { transition: 'halfScreen' }

// Element level: one line
const spec = presets.route.bottomSheet()          // half-screen sheet sliding up
const batch = compileRoute(spec, { enter: a, exit: b })
// → engine instructions; curves/physics evaluated in the Rust kernel
```

## See it for real

- **Interactive demos** (transition player / curve evaluator / preset catalogue): [Animation engine product page](/animation)
- **Device evidence table** (every row points to a re-runnable script): [Evidence & honest boundaries](/docs/animation/04-boundaries)
- **AI manual** (42 declaration entries with what / why / when / example / how to verify): [Morpheus declaration manual](/docs/generated/anim-manual)

## Next

- [Architecture & boundaries](/docs/animation/01-architecture) — three layers and the two rendering paths
- [Declaration surface](/docs/animation/02-surface) — presets / AnimDecl / curves and compile API
- [Route transitions](/docs/animation/03-transitions) — one enum across three targets / direction semantics / executor wiring
- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and what is not done

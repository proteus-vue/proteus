---
title: Architecture & boundaries
order: 2
group: Principles
---

# Architecture & boundaries

The architecture has exactly one job to get right: **cage the “continuous quantity” so that everything outside the cage becomes a determinate, compilable, checkable problem.**

## Three layers (hard constraints)

```
① Declaration  @proteus-vue/animation        one-liners + compile-time validation
      ↓  engine instructions (cross-language contract: kind / curve ids must not change)
② Kernel       layout-core-rust/src/anim.rs  curves / physics / window mapping — single implementation
      ↓  per-frame binary channel (24B/record) or commit spec (per-node sampling)
③ Host         iOS / Android shells           translate to platform APIs — zero curve math
```

**Why this split is required**: the continuity of an animation (the value at every frame) can never be fully resolved at compile time; but the **shape of the curve**, the **validity of the parameters** and **whether layout will be triggered** all can. Layering exists to collapse what is collapsible and to pass only “minimal facts” across boundaries — the concrete value at t=0.37s **never crosses a boundary**.

## Responsibility rules (each one asserted)

| # | Rule | Consequence if violated | Guarded by |
|---|---|---|---|
| 1 | Curve evaluation and physics **only in Rust** | Multiple implementations → silent visual drift across targets | Cross-language golden (TS ⇄ Rust, 1e-5) + `tests/anim-curve-golden.test.ts` |
| 2 | **Zero curve math on hosts** | “The Nth hand-written copy” | Commit spec is **sampled** by the kernel (17 points/node); hosts only translate to platform APIs |
| 3 | Springs are **sampled offline**, never platform springs | Commit path and tick path drift apart | `commit_spec_spring_uses_same_integration_as_tick` |
| 4 | Spring sampling window uses **natural settle time** | Clipped at the endpoint (spring never settles) | `spring_commit_window_covers_natural_settle` |
| 5 | Animations bind to **Slot identity** (not Node identity) | At a 0.997 reuse ratio, “the wrong row is animating” | `stop_nodes` unbinding + host `onRowDematerialized` (device group D) |
| 6 | No arbitrary JS animation functions | Destroys conformance and AI-verifiability | Closed set + escape hatches must register three fields (what / why / behavioural risk) |

## Two rendering paths (different coverage)

| | **Kernel-driven** (per-frame) | **Platform zero-involvement** (commit once) |
|---|---|---|
| Mechanism | Host frame loop (Choreographer / CADisplayLink) → kernel `tick` → write transforms | Kernel samples → one platform animation object handed to the system render thread |
| Cross-boundary per frame | 1 (24B/record binary) | **0** (main thread hands off after the commit) |
| Coverage | Sequences / scroll-linked / shared elements — **any** motion | Composited properties only (transform / opacity) and not scroll-driven |
| Device readings | 57 frames · p50 0.098ms per frame · zero layout while steady | 0 main-thread draws · 1.0ms CPU over a 600ms window (tick path: 17.4ms) |

**Decided at compile time**: `isPlatformEligible(batch)` pre-judges and the kernel `anim_commit_spec` double-checks; scroll-driven batches are **forbidden** from the platform path (that path means “interpolate by time on its own”; mixing would turn “finger-tracking” into “auto-play on schedule”).

## Escape hatches (explicit, countable)

The closed set of the compile layer **deliberately does not try to cover everything**. Motions the set cannot express go through `escapes.register({ kind, detail, reason, behaviorRisk })` — all three fields are required and any missing one throws; `degraded` entries are **highlighted separately** in reports and compared against the 5% target ratio (instrumentation ready; business usage pending).

> Design stance: **an explicitly registered escape hatch is better than a silently introduced second implementation** — the former is countable and convergent, the latter always diverges.

## Why colour is not in this table (an explicit boundary)

The closed set is `translateX / translateY / scale / rotate / opacity` — **five properties, no colour**. That is not an omission; it is a boundary of the current design, written down so it cannot be misread as “there is a hidden second channel”:

- **Colour is not an animatable property here**: this engine is a *paint-layer transform* engine (the direct payoff of the `is_composited()` judgement). Interpolating colour would drag in colour-space choices (sRGB / linear / P3), interactions with platform blend modes, and per-platform `color`-animation semantics — a **separate capability line**, not a goal of this engine.
- **Static colour is unaffected**: a node's colour in its style is **build-time data**; it travels the layout/paint chain (never through the animation channel, never touched by `tick`).
- **Need to animate colour?** Use an **explicit escape hatch** (`escapes.register({ kind: 'other' | 'platform-mixing', ... })`) — it is possible (e.g. a platform-side `CALayer.backgroundColor` translation), but it must be registered, it is counted as `degraded`, and it is **outside the engine's consistency guarantee**. This is precisely the “explicitly registered escape hatch beats a silent second implementation” case.
- **If it is ever adopted**: step one is extending the cross-language contract (a new `kind` id + Rust-side colour interpolation + host translation) plus conformance coverage — **not** quietly hand-writing a copy inside a demo.

> ★ **Test**: if a demo ever shows colour moving, check whether it is registered in `escapes`. Unregistered = a violation of rule #22 (hand-written copies), not “a new capability”. In the Morpheus showcase the colour is a **static palette** (generated once at build time); no colour participates in the animation.

## Relation to “a second JS runtime”

Route B from the design (a second runtime executing arbitrary animation logic) **stays off for now**: it requires all three of “a real scenario that cannot be analysed at compile time”, “measurements prove the main-thread approach janks”, and “the team accepts the extra memory and startup cost”. Today route A (instruction-driven) is proven viable and much faster by the RT0 comparison — at N=1000 the kernel spends only **2.38µs** per frame, and per-frame work **does not grow with the node count**.

## Next

- [Declaration surface](/docs/animation/02-surface) — concrete presets and compile API
- [Route transitions](/docs/animation/03-transitions) — how one enum is honoured per target
- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and the not-done list

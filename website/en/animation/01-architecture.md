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

## Arbitrary easing curves (promoted 2026-10-01 — from escape hatch to contract capability)

The five curves in the closed set are shortcuts for common cases; a concrete design-handoff easing
(`cubic-bezier(.34,1.56,.64,1)`) previously had to go through the **escape hatch** (`custom-easing`,
registered + degraded). It is now a **contract capability**: `curveBezier: [x1,y1,x2,y2]` runs on the
**same evaluation machine** as the built-ins — the kernel builds a 65-point sample table from the control
points (built once, cached per control point; 800 tiles on the same curve share one table), after which
every frame is one table lookup with interpolation, **zero iteration**; pinned endpoints, byte-identical
across targets, indistinguishable from a built-in.

> **Why this is part of the "strongest" story**: Reanimated / Framer / Web Animations all accept arbitrary
> cubic-bezier, but each solves it in **its own runtime**; we collapse it into a **cross-language contract
> with a single kernel implementation** — the same control point evaluates bit-identically on all targets,
> and it can flow through the platform zero-involvement sampling path.

**Boundaries (honest)**: (1) `x1/x2 ∈ [0,1]` (monotonic time axis; `y` is free); (2) mutually exclusive
with `curve`/`spring`/`keyframes`; (3) **segment-level** custom curves are not supported yet
(each `keyframes` segment still uses the closed set — see the surface page).

## Colour is in the closed set (since 2026-10-01; with new boundaries)

The closed set went from **five to seven**: `translateX / translateY / scale / rotate / opacity`
**+ `color` (background) + `textColor` (text)**.

**One declaration on the surface, four channels in the kernel** — `{ kind: 'color', from: '#2f6fed', to: '#ff5533' }`
compiles into four scalar `R/G/B/A` instructions (contract ids 5/6/7/8; text colour is isomorphic, ids 9/10/11/12).

> **Why decompose this way (an architectural payoff, not a stopgap)**: every evaluation machine in the engine
> (curve lookup / spring integration / sequence segments / scroll windows / seek / takeover velocity handoff /
> endpoint pinning) is **scalar**. Four scalar channels therefore **reuse all of them unchanged** — no second
> “multi-channel evaluation” implementation (rule #22). The cost is stated honestly: one colour animation
> is 4 instructions.

| Item | Notes |
|---|---|
| Value forms | `#RGB` (shorthand, each channel doubled) / `#RRGGBB` / `#RRGGBBAA` (**CSS4 order**, low 8 bits = alpha). Parsing rules are pinned against **one table shared by kernel and TS** (`tests/anim-color-golden.test.ts`) |
| `from` | **Required** — the kernel has **no** “defaults to the current colour” semantics (same discipline as scalar properties) |
| Precondition | The target node must declare `backgroundColor` (it is the **start basis and the reset target**); otherwise the kernel **rejects explicitly** (never silently) |
| Reset | `animStopAll` / node-recycle unbinding / phase cleanup all **restore the base colour** (not the last frame — another application of “unbinding must include clearing”) |

**Text colour** (2026-10-01) is isomorphic to background colour but lives on a **separate track**:
`{ kind: 'textColor', … }` → channel ids **9/10/11/12** (it does not reuse slots 5..8 — both tracks may
animate the same node at once, and sharing slots would let the later write clobber the earlier one).
Precondition: the node declares `color` (the text-colour base; `from` is equally **required**, and stop
restores the base). The landing point is iOS `CATextLayer.foregroundColor` / Android `textPaint`.
The per-frame record therefore grew from 28B to **32B** (last two u32 = packed background + text colour;
`u32::MAX` = that base does not exist; width is derived from the kernel's write sequence by
`scripts/check-anim-record-bytes.mjs` and reconciled against every consumer).

**Colour keyframes (multi-segment sequences)** ship in the same batch: `keyframes: [{ to, durationMs, curve? }, …]`
is expanded per channel with exactly the same semantics as scalar sequences (exact segment boundaries,
pinned endpoints — the same evaluation machine).

**★Remaining boundaries (two, stated honestly)**:

1. **Colour is paint-only but “non-composited” ⇒ it does not take the platform zero-involvement path.**
   Not because it triggers layout (it does not — same cost class as `opacity`, **zero layout** during the
   animation) but for **cross-target consistency**: Android's `RenderNode` has **no colour** in its
   interpolatable set (`setBackgroundColor` is not a RenderThread animation property), so if iOS were allowed
   through unilaterally (a `CALayer.backgroundColor` could in principle be interpolated by the CA render server),
   the two targets would **diverge in path** — a single source running different paths per target, which this
   repository treats as the worst kind of fork. ⇒ both targets use the **tick path**.
2. **Text colour covers “one colour for a whole run of text” only** (`CATextLayer` / `textPaint`).
   Rich-text **run-level colouring** (several colours inside one text node) is out of scope for this engine —
   that is the text-layout layer's job and comes as a separate item.

> **Relation to escape hatches (this boundary has changed meaning)**: `color` is now a **contract capability**
> and no longer needs `escapes.register`. The discipline itself is unchanged: **if colour moves on screen,
> it must be traceable to instructions** (judge: the P groups on both targets assert the whole chain —
> declaration → four channels → the host really writes the layer → reset to base — and the probe **truly reads**
> `CALayer.backgroundColor` / the Android host's colour table).

## Relation to “a second JS runtime”

Route B from the design (a second runtime executing arbitrary animation logic) **stays off for now**: it requires all three of “a real scenario that cannot be analysed at compile time”, “measurements prove the main-thread approach janks”, and “the team accepts the extra memory and startup cost”. Today route A (instruction-driven) is proven viable and much faster by the RT0 comparison — at N=1000 the kernel spends only **2.38µs** per frame, and per-frame work **does not grow with the node count**.

## Next

- [Declaration surface](/docs/animation/02-surface) — concrete presets and compile API
- [Route transitions](/docs/animation/03-transitions) — how one enum is honoured per target
- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and the not-done list

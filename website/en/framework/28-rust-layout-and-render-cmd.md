---
title: Rust layout core & draw command stream
order: 28
group: 渲染层
---

# Rust layout core & draw command stream

The previous page ([render backends](/docs/framework/23-render-backend)) covers *who draws*; this one covers the **two Rust components on the hot path**: the layout core that solves geometry, and the draw command stream that carries *what to draw*. Both serve the same route — **business code declares semantics; geometry and drawing execute efficiently on device**.

## Why layout lives in Rust

Layout is a **hot path that runs on every size change**. Keeping it in JS (or going through recursive View measure) costs twice: many cross-language calls, and a full re-traversal each time.

`@proteus-vue/layout-core` (Rust) takes the other approach: the **layout tree persists inside the core and is solved incrementally** over the changed range.

| Mechanism | What it buys |
|---|---|
| **Persistent taffy tree** | The engine lives per handle instead of being rebuilt (rebuilding loses taffy's internal cache) |
| **Translation propagation** | Sibling shifts avoid re-solving flexbox (6 precondition guards; falls back to full when unmet) |
| **Cross-node measure reuse** | The measure key includes size/weight/family ⇒ identical text is really measured once |
| **Orphan compaction** | Structural churn reclaims detached nodes; memory stays bounded |

**Measured** (device reports `bench-filtered-*.json`): whole-tree relayout **17.16 ms → 1.52 ms** (measure calls 6003 → 0) · cross-node measure reuse cuts CoreText calls **4×** · after 10 churn cycles on a 4000-row list the **last round leaves 0 orphans**.

### Hit-testing lives in the same tree

Hit-testing walks the **core's full tree**, decoupled from whether a layer is materialized — under virtualization an unmaterialized row can still be hit (`V12` measured: hit node 63). Scroll recycling and interaction correctness therefore do not constrain each other.

## Draw command stream (RenderCmd)

After layout, the result must become "what to draw". The command stream is a **platform-independent linear sequence**; a platform consumes it in order, doing no layout maths and no style parsing.

```ts
import { layoutTreeFromPNode, solveLayout, attachParents, emitRenderCmds } from '@proteus-vue/layout-core'

const tree = layoutTreeFromPNode([pnode], { lengthContext })   // PNode → layout tree
solveLayout(tree[0]!, loose(width, height))                     // solve geometry
attachParents(tree[0]!)                                         // link parents (for clipping / culling)
const { cmds, stats } = emitRenderCmds(tree, opts)              // → draw command stream
```

**Three command kinds** (`RenderCmdKind`): `background` (solid/gradient) · `text` · `image`; plus `border` and paired `pushClip` / `popClip`.

### Three architectural invariants

1. **Absolute coordinates** every command carries its absolute position (parent offsets already accumulated) ⇒ platforms convert nothing;
   it also makes **viewport culling** a coordinate comparison (no transform stack to maintain).
2. **Flattening emits no separate command**: a flattened node's drawing is **merged into its parent's command** (provable via `mergedFrom`),
   and **no composite bitmap is created** — breaking this brings back the +78% memory seen on iOS, in a harder-to-find form.
3. **paint-hint is derived at compile time**: `isMonochrome` / `isPureBackground` / `shareableContent`
   travel with the command so the platform can pick a backing-store strategy (**no runtime guessing**).

### Viewport culling (overdraw culling)

`EmitOptions.cullToViewport` keeps off-viewport elements from producing draw commands (geometry still participates in layout).
It is **off by default** — existing full-path readings keep their meaning.

| Scenario | Commands | Generation time |
|---|---|---|
| Long list 400×40 (16401 nodes) | **16001 → 1592 (↓90.1%)** | 14 → 2 ms |
| 4050 elements (50×40) | 2001 → 1592 (↓20.4%) | 3 → 2 ms |

⇒ For long lists the command count goes from "**grows with content**" to "**constant per viewport**".
★Boundary: elements touching the viewport edge are **kept conservatively** (a 1px stroke or shadow would otherwise vanish);
removing fully-occluded elements and merging same-colour neighbours are **not implemented yet**.

## Current status (honest grading)

| Capability | Status |
|---|---|
| Layout core (`@proteus-vue/layout-core`, published on npm) | ✅ Landed · unit-tested · **21 browser-truth golden cases** · device conformance **17 cases / 67 nodes**, max deviation **0.375 dp** (limit 0.5) |
| Draw command stream (public exports incl. `emitRenderCmds`) | ✅ Landed · tested (three hard criteria for culling) |
| On-device consumption (iOS CALayer / Android Canvas hosts) | 🟡 **Experiment hosts** (`hosts/ios`, `hosts/android`), not a product form |
| Mixing with native components | 🟡 IR-declared + experiment-verified (map / WebView embedding) |

★**Relation to the native-control mapping route**: the two routes are **chosen per page** —
system-feature-heavy pages use native control mapping ([native capabilities](/docs/20-native-backend));
high-frequency lists/animations use the high-performance path described here. The choice follows the capability declarations in [render backends](/docs/framework/23-render-backend).

★**Engine choice and compatibility**: the Rust side uses **taffy** (Flexbox; `grid` / `taffy_tree` enabled).
The version is **pinned to 0.14** — 0.13 has exponential measure degradation (measured here).

## Reproducible verification

| Gate | What it locks |
|---|---|
| `pnpm check:vapor-perf` | Performance ratchet (bounds + proof the optimization path is active) |
| `cargo test --manifest-path packages/layout-core-rust/Cargo.toml` | Full Rust tests (including cross-language golden) |
| `npx tsx scripts/bench-culling.mjs 400 40` | Viewport culling benefit (no device needed) |

```bash
cargo test --manifest-path packages/layout-core-rust/Cargo.toml   # Rust tests
npx tsx scripts/bench-culling.mjs 50 40                           # culling benefit on the 4050 scene
pnpm check:vapor-perf                                             # performance ratchet
```

## Section navigation

- [Render backends](/docs/framework/23-render-backend): five backends and pluggable rendering
- [Vapor update path](/docs/framework/43-vapor-update-path): compile-time updates and direct slot writes
- [Flutter backend](/docs/framework/24-flutter-backend): the widget-mapping route
- [Conformance](/docs/framework/29-conformance): browser truth baselines

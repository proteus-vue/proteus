---
title: Vapor update path
order: 43
group: 编译期
---

# Vapor update path

A regular Vue update rebuilds the VNode tree in JS and compares node by node (changing one element still walks the whole diff). Proteus's Vapor path moves that work **into compile time**: the template compiles into a "reactive source → slot" dependency graph, and an update **writes only the changed slots**, then ships them to the core as a binary instruction stream.

Its difference from the other compile-time capabilities in this section is **scope**: the template/script/style transforms describe what the *first* render needs, whereas Vapor governs **every update after the first**.

| Aspect | Regular Vue update | Vapor update path |
|---|---|---|
| Change discovery | Rebuild VNodes at runtime + recursive diff | "Source → slot" deps fixed at compile time |
| What ships | Diff result of a whole new tree | Instructions for changed slots (fixed-width fields) |
| Affected scope | Whatever the diff finds | Layout boundaries + slot dependencies together |

## The three layers

### ① Compile time: source → slot

`buildVaporSubscriptions(source)` scans reactive references in the template and produces one **slot subscription** per changing property: it records which source expression drives that slot, and whether it belongs to L0 (standard path) or L1 (slot direct-write). Tiering is deliberately strict — **a wrong L1 verdict means the UI silently stops updating**, far worse than being ten times slower.

### ② Runtime: direct slot writes

When a source changes, the runtime **settles only the affected slots** along the dependency graph. Two compressions help:

- **Row-level invalidation**: changing one row computes just that row (`relinkRow`), with no whole-table scan;
- **Layout boundaries**: when a change sits inside an element with explicit size, the relayout scope stays inside that subtree.

### ③ Transport: binary instruction stream

Instructions ship as fixed-width fields read sequentially (no character scanning, no float text parsing — this is the update hot path). Since protocol v2 the key pool is **carried on demand**: only the entries this message actually references go into the pool, with references remapped, instead of resending the full pool every message.

## Measured numbers

Every number below comes from a device script you can re-run; follow the "Source" column.

| Metric | Measured | Source |
|---|---|---|
| Single-node update (row-level invalidation) | p50 **0.121 ms** | `hosts/ios/results/bench-filtered-V11.json` |
| Single-node update (coarse full-table trigger) | p50 **3.62 ms** | Same report, other tier |
| Payload per update | **45 bytes** (8964 bytes before protocol v2) | Same report (`payload_bytes`) |
| Structural delta (append / remove / head insert) | 399KB→**67KB** / 332KB→**526B** / 365KB→**34KB** | `hosts/ios/results/bench-filtered-S5.json` |
| Text delta | 281KB→**15KB** | `hosts/ios/results/bench-filtered-S4.json` |
| Whole-tree relayout (persistent taffy tree) | **17.16 ms → 1.52 ms** | Device V0 case (measure calls 6003→0) |
| Long-list viewport culling | instructions **16001 → 1592 (↓90.1%)** | `npx tsx scripts/bench-culling.mjs 400 40` |

## Public API

Three symbols are enough to walk template → subscription table → instantiation:

```ts
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry, SlotRuntime, VaporRuntime } from '@proteus-vue/slot-runtime'

const { template } = buildLayoutTemplate(sfc, 'app.vue')      // template → static structure + slots
const { table } = buildVaporSubscriptions(sfc, 'app.vue')     // reactive sources → slot table
const registry = new ListRegistry()
const inst = instantiateTemplate(template, { viewport, read, table, registry })  // + data → node tree
```

## Current status (honest grading)

"Code exists" and "users can reach it" are two different things — this page grades on the latter.

| Capability | Status |
|---|---|
| Compiler transforms (subscription table / template structure) | ✅ Implemented; inspect per slot via `proteus explain --vapor` |
| On-device instruction consumption (iOS / Android experiment hosts) | ✅ Implemented and measured on device (see table above) |
| **Wired into the default build** | 📋 **Not wired**: the Vite plugin emits no Vapor path, so user projects cannot reach it |
| Full benefit of layout boundaries / row-level invalidation | 🟡 Depends on explicit sizes in the template (otherwise scope floats up) |

### Not yet in the default path

The Vapor path is currently consumed only by the CLI inspection command (`proteus explain --vapor`) and the on-device experiment hosts. **A normal project build does not use it** — so the numbers above describe what this path can reach, not what today's default build gives a user.

### Known boundaries

- **L1 coverage is a single-page reading**: 77.8% on a demo page, not a claim about all business code;
- **Some opcodes unsupported**: `INSERT_BLOCK` / `MOVE_NODE` / `CALL_COMPONENT_UPDATE` are **reported as unsupported**, never silently degraded;
- **`splice` under virtualization is explicitly rejected**: adding/removing layers that were never materialized would silently diverge, so refusal beats wrong ordering;
- **Absolute on-device readings drift with thermal throttling**: ratios are trustworthy, absolute values are not comparable across runs.

## Reproducible verification

| Gate | What it locks |
|---|---|
| `pnpm check:vapor-perf` | Performance ratchet: upper bounds + **proof the optimization path is active** (wired into CI) |
| `cargo test --test ops_conformance` | Cross-language golden: TS encodes → Rust decodes, byte-exact |
| `pnpm check:instr-spec` | Instruction-set spec ↔ code consistency (generated, drift-proof) |

```bash
pnpm check:vapor-perf                          # performance ratchet
npx tsx packages/cli/src/index.ts explain --vapor examples/App.vue   # per-slot tiering
npx tsx scripts/bench-culling.mjs 400 40       # viewport culling benefit (no device needed)
```

## Section navigation

- [Compiler pipeline overview](/docs/framework/26-compiler-pipeline): how the mini-program four-file output is produced
- [Compile rules & decision chain](/docs/framework/compile-rules): anti-black-box and explain
- [Render backends](/docs/framework/23-render-backend): five backends and pluggable rendering
- [Data updates](/docs/framework/data-updates): the regular update path and its triggers

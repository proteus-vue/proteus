---
title: Capability tri-state & degradation
order: 8
group: 柔性系统
---

# Capability tri-state & degradation

> **A capability is not a boolean.** "The in-car display does not support multi-SKU picking" is wrong — the real constraint is "while driving, do not do fine multi-selection; use voice/rotary single-select instead". The Flex System expresses that with a tri-state and makes every entry produce an **observable render consequence**.

## Tri-state semantics

```ts
type CapsLevel = 'supported' | 'fallback' | 'unsupported' | boolean

supported    → render the full UI for that capability
fallback     → render a **degradation path** (another way to do the same task, not a deletion)
unsupported  → do not render (this form genuinely has no such path)
```

| Helper | Semantics |
|---|---|
| `capsEnabled(level)` | Both `supported` and `fallback` are true (a path exists); `unsupported` is false |
| `capsDegraded(level)` | Whether it is `fallback` (the degraded path was taken) |
| `capsLabel(level)` | Normalises to the tri-state string (boolean compatibility: `true→supported` / `false→unsupported`) |

> ⚠️ **Bare truthiness is forbidden**: `v-if="caps.drawer"` is **always true** for the string `'unsupported'` — a real P0 we hit (all seven forms rendered fake badges while the panel said "unsupported"). Both components and the SSOT must go through `capsEnabled()`; a static-scan gate blocks bare usage.

## The 14 capabilities and the truth table

`FORM_CAP_KEYS` is the SSOT for capability keys (14 entries); every form's `caps` key set must match it entry by entry:

| Capability | Meaning | watch | phone | fold | tablet | pc | car | tv |
|---|---|---|---|---|---|---|---|---|
| `skuMulti` | Multi-SKU picking | — | ✅ | ✅ | ✅ | ✅ | **◐ fallback** | — |
| `tabs` | Bottom tabs | — | ✅ | ✅ | — | — | — | — |
| `hover` | Pointer hover | — | — | — | — | ✅ | — | — |
| `dpad` | Remote d-pad focus | — | — | — | — | — | ✅ | ✅ |
| `crown` | Crown / rotary | ✅ | — | — | — | — | ✅ | — |
| `dense` | Dense information | — | ✅ | ✅ | ✅ | ✅ | — | — |
| `focusTree` | Focus-tree navigation | — | — | — | — | — | ✅ | — |
| `focusRows` | Horizontal focus rows | — | — | — | — | — | ✅ | ✅ |
| `multiCol` | Multi-column | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sidebar` | Persistent sidebar | — | — | — | ✅ | ✅ | — | — |
| `drawer` | Drawer / sheet | — | ✅ | ✅ | ✅ | — | — | — |
| `notch` | Notch safe area | — | ✅ | ✅ | — | — | — | — |
| `keyboard` | Hardware keyboard | — | — | — | — | ✅ | — | — |
| `driveAware` | Drive-aware | — | — | — | — | — | ✅ | — |

(`—` = unsupported; the table is derived from `FORM_CAP_KEYS × FORM_PROFILES` and reconciled entry by entry with the source)

Two entries are worth noting: **the in-car `skuMulti` is the only fallback** — it renders a "🎙/↻ pick by voice or rotary" degradation bar (the host may inject copy via `degraded-hint`) instead of silently deleting it; and **TV has no `dense`** — dense information is unreadable at a 10ft viewing distance.

## Consumers: every entry needs an observable consequence

| Consumption form | Example |
|---|---|
| Template filtering | `v-if="capsEnabled(caps.drawer)"` → render the drawer handle (zero DOM when undeclared) |
| Root-class mapping | 14 entries → `has-dpad` / `is-dense` / `has-crown` … (CSS and behaviour wire from these) |
| Degraded rendering | `skuLevel === 'fallback'` → the degradation bar; `supported` → the real multi-SKU slot |
| Behaviour switch | `focusEnabled = capsEnabled(caps.dpad)` → only remote forms take over the arrow keys (PC keeps its native tab order, avoiding a WCAG violation) |
| Layout switch | `caps.focusRows` → the recommendation area becomes a horizontal focus row (TV / in-car) |
| Dimensional impact | `caps.dpad` → a 76dp hit-area floor (44dp otherwise); `caps.dense` → tighter spacing |

The gates enforce both directions: **a declaration must have a consequence**, and **a consequence must have a declaration** (a static scan over the 14 consumers plus render-level reconciliation via `data-pf-caps`).

## The capability evidence surface: `data-pf-caps`

Every `p-formfactor` root exposes a machine-readable tri-state digest (stably ordered by `FORM_CAP_KEYS`):

```html
<div class="p-formfactor topo-dashboard form-car" data-pf-caps="skuMulti=fallback;dpad=supported;crown=supported;…">
```

Its purpose: a **machine-checkable criterion for "a declaration is not empty talk"** — outside parties and gates can assert which capabilities a form actually ended up with, without reading the source; an e2e case reconciles it against the profile declarations form by form (catching both "a class exists but nothing was declared" and "declared but missing from the digest").

## Honest boundaries

- Today every capability comes from the profile declaration (a static table). Whether a device really has a crown or a remote belongs to **runtime capability negotiation** (the end reports, the declaration is intersected, tri-states converge), which is not implemented — the vision and interface sketch are in the [OS-level roadmap](/docs/system/01-overview).
- The `fallback` render path is currently provided by the component layer (`pf-sku-fallback` plus host-injected copy); business-defined degradation paths (a fallback registry) are planned.
- The tri-state is a **closed enum**: it will not grow a fourth or fifth state — finer expression goes into a separate "fallback registry" so existing gates and consumption semantics are not broken.

## Next steps

- [Fold postures](/docs/system/09-postures): postures override topology and metrics (another kind of "dynamic capability")
- [p-formfactor](/docs/system/11-formfactor-composition): the container component where capabilities land

---
title: Form profiles
order: 6
group: 柔性系统
---

# Form profiles

> **Width tells size apart; it cannot tell forms apart.** A 1280px in-car display and a 1280px PC share the same width yet have nothing else in common — the former is rotary + voice, large hit areas, no fine scrolling; the latter is mouse + keyboard, dense three columns, hover feedback. The Flex System's second layer makes "device form" a first-class citizen: one `FORM_PROFILES` table declares every difference, and the framework swaps layout, navigation and capability set from it.

## Why width is not enough

Container queries ([page 2 in this section](/docs/system/02-container-query)) fixed "a component lives inside a container", but forms differ by more than size:

| Form | Typical width | Interaction truth | Can width express it? |
|---|---|---|---|
| In-car | 1280–1920 | Rotary / steering-wheel keys + voice, **no fine manipulation while driving** | ❌ Same width as PC |
| TV | 1920 (viewed at 10ft) | Remote d-pad + focus ring, **readable at distance** | ❌ Same width as PC |
| Watch | 198 | Crown + a wrist-raise glance, **one screen, one meaning** | ⚠️ Merely "very narrow" — the semantics is one-glance |
| Foldable | 340 ⇄ 673 | **One device, two forms** (folded / tabletop / expanded) | ❌ Width is dynamic |

Conclusion: a form is the combination of **input continuity + viewing distance + capability set**, and must be modelled explicitly.

## One table: FORM_PROFILES (the SSOT)

`FORM_PROFILES`, exported by `@proteus-vue/fluid`, is the single source of truth — layout topology, navigation, visual language, mockup frame, fluid ratio and capability declarations are **all derived from this one table**:

| Form | Input | Density | Layout topology | Navigation | Viewing distance | Visual theme |
|---|---|---|---|---|---|---|
| `watch` | dial (crown) | compact | `glance` one screen, one meaning | page-stack | glance | dark (always-on AMOLED) |
| `phone` | touch | regular | `stack` single column + tabs | bottom-tabs | arm | light |
| `fold` | touch | regular | `duo` two panes (expanded) | side-tabs (all postures) | arm | light |
| `tablet` | touch | regular | `rail-split` rail + split | rail | arm | light |
| `pc` | cursor | regular | `rail-grid` rail + grid | side-nav | desk | light |
| `car` | remote (rotary) | comfortable | `dashboard` cockpit | focus-tree | dashboard | dark |
| `tv` | remote | comfortable | `hero-focus-row` hero + poster row | focus-row | **10ft** | dark |

> Each form also carries: `frame` (mockup spec: aspect / max width / notch / status bar / hinge / watch face), `mediaRatio`, `safe` (safe areas), `visual.ratio` (fluid baseline), `postures` (fold postures) and `caps` (capability declarations).

## How the fields are consumed

| Field | Consumer | Example effect |
|---|---|---|
| `topology` | `p-formfactor` root class `topo-*` | Swaps the whole layout structure (not scaling) |
| `nav` | `data-pf-nav` + capability filtering | Foldables get tabs, tablets a rail, TV a focus row |
| `input` / `density` | Root classes + `--pf-gap-dense` | Remote forms enlarge hit areas; in-car gets large spacing |
| `visual` | CSS variables (bg/text/dim/brand/accent/focus) | Dark immersion for TV/in-car, warm accent |
| `visual.ratio` | `resolveFluidMetrics` | Fluid solving of font size and dimensions ([next page](/docs/system/07-fluid-metrics)) |
| `frame` | Mockup shell | The device frame in the demo (aspect / notch / hinge) |
| `caps` | Capability tri-state filtering | See [Capability tri-state](/docs/system/08-capabilities) |
| `postures` | Dynamic forms | See [Fold postures](/docs/system/09-postures) |

## Three machine gates (profiles cannot drift)

Adding or editing a profile is checked by these assertions in CI:

1. **Self-consistency** `validateFormProfiles()` — cross-field rules, for example:
   - `nav=tabs` ⇒ `caps.tabs` must hold (otherwise the navigation never renders)
   - `topology=hero-focus-row` ⇒ `input=remote` and `caps.focusRows`
   - `caps.driveAware` ⇒ `distance=dashboard`; `caps.crown` ⇒ `input∈{dial,remote}`
   - Contrast: `text/bg ≥ 4.5`, `accent/bg ≥ 3` (WCAG AA)
   - A complete posture set; expanded viewport > folded viewport; folded and expanded topologies must differ
2. **Key-set SSOT** `FORM_CAP_KEYS` (14 entries) — every form's `caps` key set must match it entry by entry (no ghost fields, no missing declarations).
3. **Render-level reconciliation** — the `data-pf-caps` digest must agree with the profile declarations entry by entry, and every capability must have a real render consequence (no unfalsifiable green dots).

```bash
pnpm test tests/fluid-formfactor.test.ts tests/fluid-formfactor-render.test.ts   # the three gates
```

## What an 8th form costs (honest count)

Extensibility is **declarative**, but not free — adding a form today touches 5 places:

| # | Location | Change |
|---|---|---|
| 1 | `packages/fluid/src/formfactor.ts` | The `DeviceForm` union + one `FORM_PROFILES` entry (the bulk of the work lives here) |
| 2 | `validateFormProfiles` in the same file | Add the name to the `forms` array (otherwise it is not validated) |
| 3 | `senseForm` in the same file | Add sensing if the form can be inferred; if not (watch/car/tv), keep "host must declare" |
| 4 | `website/src/pages/MultiDevice.vue` | The demo page icon table `ICONS` |
| 5 | `tests/e2e-website-multidevice.test.ts` | The form list + assertion grouping (one-screen / scrollable) |

Constraint: a new form must differ from every existing form in **at least one of topology, navigation or capabilities** — otherwise the gates treat it as a duplicate (near-neighbours like `rail-split` and `rail-grid` are likewise required to justify their difference).

## Honest boundaries

- **A browser cannot auto-detect watch / car / tv** — there is no standard signal and UA strings are forgeable. These three must be **declared** by the host (a `?device=` param, an end profile, app config). The other four (phone/fold/tablet/pc) can be inferred from container size plus pointer capability, but the host declaration stays authoritative.
- **A capability declaration is not a measured capability**: `caps` states "what this form should have"; whether a device actually has a crown or a remote belongs to **runtime negotiation** (see the honest-boundaries section of [Capability tri-state](/docs/system/08-capabilities)).
- The 5-place count shrinks as profile validation, the official site and tests become more automated; today it is not exaggerated as "one line".

## Next steps

- [Fluid metrics](/docs/system/07-fluid-metrics): how `ratio` solves font size and hit areas
- [Capability tri-state](/docs/system/08-capabilities): how the 14 capabilities filter and degrade
- [p-formfactor](/docs/system/11-formfactor-composition): consuming the whole table with zero branching

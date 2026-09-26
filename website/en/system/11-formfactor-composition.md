---
title: One set of slots, seven forms
order: 11
group: 柔性系统
---

# One set of slots, seven forms

> The previous ten pages explain **how the framework solves**; this one is **how business code is written**. The answer: write **one set of semantic content slots** and let the framework derive everything form-related — no `if (form === 'car')`, no breakpoints, no capability checks in business code.

## The divide: changing the form, not scaling it

| | Responsive layout | Flex System |
|---|---|---|
| Adaptation basis | Viewport width | **Form** (input + viewing distance + capability set) |
| What varies | Size scaling of one layout | **Swapped topology, navigation, capability set and visual language** |
| Business code | Breakpoint branches / `if (isTV)` | **Zero form branching** (declare content only) |

## What business code looks like

The demo page's complete slot implementation ([`website/src/components/fluid-product/index.vue`](/multi-device), zero form checks in the whole file):

```vue
<template>
  <!-- one line connects the form: topology / visual language / capabilities / density / metrics / hit areas are all automatic -->
  <p-formfactor :declared="form" :posture="posture ?? ''" :width="width"
                :degraded-hint="t.degraded" :drive-hint="t.drive">
    <!-- rail: rendered only for forms declaring sidebar (tablet / PC) -->
    <template #rail>…</template>

    <template #media><div class="fp-cover">🎧</div></template>

    <template #heading>
      <strong>{{ product.name }}</strong>
      <span>{{ product.desc }}</span>
    </template>

    <template #price><strong>¥{{ product.price }}</strong></template>

    <!-- multi-SKU: the in-car form declares fallback → the framework renders the degradation bar, business unaffected -->
    <template #sku>
      <span v-for="s in skus" :key="s" :class="{ on: picked === s }" @click="picked = s">{{ s }}</span>
    </template>

    <template #actions><button>▶ Buy now</button><button>＋ Save</button></template>

    <!-- recommendation: TV / in-car automatically become a horizontal focus poster row -->
    <template #recommend>…</template>

    <!-- bottom tabs: rendered only for forms declaring tabs -->
    <template #tabbar>…</template>
  </p-formfactor>
</template>
```

The eight slots (`rail` / `media` / `heading` / `price` / `sku` / `actions` / `recommend` / `tabbar`) are **semantic slots**: the framework decides, form by form, what each becomes, where it sits, and whether it renders at all.

## The same content, seven results

| Form | Topology | Navigation | Capability trade-offs (this example) | Visuals |
|---|---|---|---|---|
| Watch | One screen, one meaning (media/recommendation not rendered) | page stack | description collapsed, title clamped to 2 lines, two buttons side by side | dark AMOLED |
| Phone | Single column + tabs | bottom-tabs | All capabilities available | light |
| Foldable | Two panes when expanded | tabs | SKU available; tabletop collapses description/options | light |
| Tablet | Rail + split | rail | + multi-column recommendations | light |
| PC | Rail + three columns + hover | side-nav | + hover / keyboard focus ring | light |
| In-car | Cockpit (media ｜ info / actions ｜ tiles) | focus-tree | SKU → **degradation bar**, only 3 recommendations, 76dp hit areas | dark cockpit |
| TV | Hero + horizontal poster row | focus-row | no dense information, media ×2.6, 3px focus ring | dark immersive |

**One template** produces all seven results above — that is the divide between a "Flex System" and responsive layout.

## Verifiable: the demo page and its machine gates

[Multi-device](/multi-device) is an interactive acceptance ground (`?device=` / `?posture=` are shareable):

- The left column shows **the very same source being executed** (read via `?raw`, syntax highlighted)
- The centre renders all seven forms for real (device frames centred and complete, not screenshots)
- The right panel shows the derived form plus the **14 capability tri-states** (with degradation paths marked)

The machine gates behind it (real Chromium, not eyeballing):

| Gate | Criterion |
|---|---|
| Two viewports × seven forms | Zero overlap, zero out-of-bounds, zero cropping; one-screen forms (watch/car/tv) do not overflow |
| Media-content occlusion | In overlay topologies the hero visual must not cover interactive items |
| Primary label readability | One-screen forms must not ellipsis-truncate titles/prices/tile names |
| Composition balance | The in-car info group must be vertically centred against the media panel (10px tolerance) |
| Capability reconciliation | The `data-pf-caps` digest matches the profile declarations entry by entry |
| In-session switching | Clicking the switcher (not a cold start) still passes for every form |

```bash
pnpm test:e2e:website   # run the same geometry gates locally
```

> Every one of these criteria was **driven by a defect a user found in practice**: narrow-stage overlap → dual viewports; physical quantities as absolute px → device-space conversion; checking containers but not content → Range content boxes + descendant vertical bounds; checking overlap but not composition → the balance gate. Each was **break-tested** (revert the fix and it must go red).

## Honest boundaries

- The demo content is **one scenario** (an e-commerce product page); other content shapes (list-detail, dashboards, poster walls) need their own slot combinations — the framework provides the mechanism, not a universal template.
- The in-car form shows only the first 3 recommendations (the 4th and later are explicitly not rendered): hunting through options while driving is a distraction, so this is a **deliberate capability trade-off**, not a defect.
- `?device=` on the demo page is a host declaration — in a real app the form comes from the end profile (a browser cannot auto-detect watch/car/tv; see [Form profiles](/docs/system/06-form-profiles)).

## Next steps

- [Multi-device demo](/multi-device): switch all seven forms by hand
- [p-formfactor API](/docs/component/p-formfactor): props / slots / implementation notes
- [Form profiles](/docs/system/06-form-profiles): back to the layer above — the SSOT table that drives everything

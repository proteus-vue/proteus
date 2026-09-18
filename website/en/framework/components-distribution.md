---
title: Third-party component distribution
order: 24
group: 自定义组件
---

# Third-party component distribution

You've written a component — how do other projects use it? Two paths, depending on whether the consumer is a Proteus project or an existing Mini Program.

## Path 1: a Proteus project (workspace / npm)

1. **Package the component library**: follow the aggregation pattern of `src/components` — directory convention + `index.ts` aggregated exports + esbuild bundle (built automatically by `build-packages.mjs`)
2. **The consumer installs**: `npm install` (or workspace-links the dist) → `import { PBadge } from 'your-component-library'`
3. **Automatic wiring on the Mini Program side**: plugin-vite scans the component directory → emits the `proteus/<tag>/index` four-file set (wxml/wxss/js/json) + `usingComponents` on pages is written automatically — zero manual registration for the consumer

## Path 2: existing Mini Programs (incremental migration)

An existing project can use the compiled output without adopting the Proteus framework; two entry points:

### codemod: `proteus migrate mp`

Batch migration of legacy Mini Program pages into Proteus semantic syntax (the G-31 B6 codemod; `--dry-run` only reports without writing back, and it is **idempotent** — rerunning yields identical results). The automatic replacement is split into two sets:

**Automatic replacement (12 1:1 pairs, `AUTO_CODEMOD_TAGS`)**:

| Mini Program tag | Proteus component |
|---|---|
| `view` | `p-box` |
| `text` | `p-text` |
| `button` | `p-button` |
| `image` | `p-image` |
| `input` | `p-input` |
| `textarea` | `p-textarea` |
| `switch` / `slider` / `checkbox` / `radio` | `p-switch` / `p-slider` / `p-checkbox` / `p-radio` |
| `form` | `p-form` |
| `picker` | `p-picker` |

**Manual annotation (needs semantic recognition, `MANUAL_TAGS`)** — `scroll-view` / `swiper` / `movable-*` must be restored to **layout/gesture primitives** (e.g., `swiper` → `p-stack snap="mandatory" loop` — "collapsed into a prop"; `movable-view` → a gesture directive); `video`/`audio` → `p-media kind`; `camera`/`map`/`web-view` and others go into L2 — the AI Agent (G-23) backs human confirmation, and the migration report tallies per file `tags N · storage N · manual N`.

### Compatibility layer: `@proteus-vue/compat-miniprogram`

A `wx.*` bridge (platform-agnostic delegation — usable on any target; the MP target's real wx needs no such bridge) + automatic tag replacement + annotation of manual items. Legacy code **runs as-is**; replace it gradually.

## Honest boundaries

- **Platform APIs are banned inside the component library** — a distributed component that fails the audit gets no promise of dual-target behavior
- props forwarding relies on the compiler's static extraction — dynamically concatenated prop names are not supported
- Distributed component styles are under the same default scoped constraint (reaching a host's slot children needs `<style global>`)
- The codemod's manual items must be confirmed semantically by a human (the automatic set covers only unambiguous 1:1 mappings)

## Relationship with the plugin system

A component library is "source-level reuse" (compiled into the artifact at build time); the [Plugin API](/docs/plugin/host) is "runtime reuse" (WASM sandbox + capability authorization). Write panel extensions for Studio via plugins; bank UI assets for business projects via a component library.

## Next steps

- [Component unit testing](/docs/framework/components-test)

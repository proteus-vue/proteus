---
title: DevTools panels & extensions
order: 44
group: 开发者工具
---

# DevTools panels & extensions

> For the overview see [Debugging & observability](/docs/framework/debugging) (three debug layers + ten views); this page covers **panel data flow and extension wiring** (`@proteus-vue/devtools` package layering).

## Architecture: data source → panel / Vue DevTools

```
TraceBus / DevTools events
  ├─ createTraceBusWsBridge (remote WS bridge — dual channel: local floating panel / remote panel page)
  ├─ createDevtoolsWsSource / createTraceBusSource (DevtoolsSource data-source abstraction)
  └─ panel consumption: createDevtoolsPanel (local floating) or the remote WS channel
```

| Module (`@proteus-vue/devtools`) | Exports | Role |
|---|---|---|
| `panel.ts` | `createDevtoolsPanel(options)` | local floating panel (container / router / view mounting) |
| `source.ts` | `createDevtoolsWsSource` / `createTraceBusSource` | data-source abstraction (direct WS / TraceBus pull) |
| `ws-bridge.ts` | `createTraceBusWsBridge` | TraceBus → WS bridge (remote channel) |
| `session-io.ts` / `snapshot-io.ts` | session / snapshot serialization | time-travel import/export (real restoration from store snapshots: `restoreStores` → per-store `$patch`) |
| `vue-devtools.ts` | `installProteusTimeline` / `installProteusInspectors` / `PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR` | **Vue DevTools ecosystem integration** (timeline event stream + custom inspectors) |
| `views/` | `renderTimeline` etc. | ten-view rendering |
| `plugins.ts` / `plugins/` | plugin extension points | panel extensions (the devtools side of the G-58 plugin API) |

## Vue DevTools ecosystem integration

`@proteus-vue/devtools` is not a closed panel — through `installProteusTimeline` (the Vue DevTools timeline: route navigation / state changes / error events) and `installProteusInspectors` (custom inspectors: semantic views such as the component tree / ownership graph) it **lives inside Vue DevTools**. `PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR` is the plugin descriptor (recognized on the app side).

## Remote channel & time travel

- **Dual channel**: `installProteusDevtools` (local floating panel) or a remote panel page (WS bridge — view the panel and the page across devices)
- **Time travel**: store state flows through the unified serialization contract (the store domain of `@proteus-vue/contracts`) → snapshot export/import → real restoration via per-store `$patch`
- **Security**: the remote WS is local-loopback-only plus a one-time token (G-57 security red line)

## Data-flow example (examples devtools-open-api-demo)

`examples/pages/devtools-open-api-demo.vue` demonstrates the open-API funnel chain: route/state events → TraceBus → bridge → consumed by the panel timeline and inspectors.

## Honest boundaries

- The panel is dev-only infrastructure (`__PROTEUS_DEBUG__`-gated; zero injection in production)
- The semantic views among the ten views (graph/ownership) consume Debug-only data sources — the corresponding views are empty in release builds

## Next steps

- [Debugging & observability](/docs/framework/debugging): the three debug layers and the Inspector overlay principle (G-57)
- [JavaScript support & runtime environment](/docs/framework/runtime-js): the TraceBus event surface

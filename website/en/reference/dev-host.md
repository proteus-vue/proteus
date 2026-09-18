---
title: Debug base (dev-host)
order: 45
group: 开发者工具
---

# Debug base (dev-host)

**Install-Once Host** (G-45): the debug base is the host — **host plugins are never reinstalled** — during development you hot-swap backends (plugins), the three-state lifecycle guarantees artifact determinism, and the push protocol carries an integrity gate. `@proteus-vue/dev-host` is the host-shell implementation.

## The three-state lifecycle (`DevHostMode`)

| State | Meaning |
|---|---|
| `dev` | Development: plugin hot-install / hot-swap — the whole debugging surface is open |
| `release` | Release: artifact determinism (stable-layer rebuild under ABI freeze) |
| `runtime` | Runtime: parameter rollout via FeatureFlags (**no code is pushed**, G-45.10) |

## The push protocol (`ModulePushMessage` payload)

`proteus host push <module-dir>`: plugin-module preflight checks → the push envelope (G-45.8 integrity):

| Field | Description |
|---|---|
| `manifest` | BackendManifest (the plugin manifest) |
| `conformance` | **semantic quick-check cases** (the real transport serializes them as Test IR — G-44) |
| `bundle` | the plugin source bundle (binary under the real transport) |
| `bundleHash` / `manifestHash` | integrity hashes — verified at the receiving end; tampering is rejected |

The protocol envelope `ProtocolEnvelope` covers Hello / HelloAck / ModulePush / LoadReport (with error reasons — the protocol report reason semantics).

## ABI-aware stable-layer cache

`stableLayerCacheKey`: `base:{frameworkVersion}:{abi}` + `:{m}:{backendManifestHash}` + `:{s}:{signatureChainHash}` — a stable-layer rebuild is **independent of page count / business scale** (CMP086), yet **manifest / signature-chain changes invalidate it as expected** (safe increments under ABI freeze). The ABI shape is `abi.major.minor` (e.g. `1.3`).

## The CLI gate (`proteus host push`)

```
preflight: proteus.plugin.json integrity / signature sig-* / conformance coverage (CMP084/087)
→ push-envelope generation (manifestHash + bundleHash) → device push
FAIL → exit 1 (blocks CI)
```

Later capabilities land with the B4 transport adapter: `devices/logs/serve`.

## Source layering (`packages/dev-host/src`)

`abi.ts` (three states + ABI cache key) / `protocol.ts` (envelope & reports) / `dev-server.ts` + `device-session.ts` (sessions) / `build-planner.ts` (layered BuildPlan: PluginLayerPlan — layer-based builds) / `shape.ts` + `types.ts`.

## Honest boundaries

- dev-host targets plugin-driven debugging (a prerequisite for the G-58/59 ecosystem); single-project debugging (no plugins) goes through debug:mp and needs no base
- The protocol fields are the current implementation surface; until the B4 transport adapter lands, the CLI reaches only the push envelope

## Next steps

- [DevTools panels & extensions](/docs/reference/devtools-open-api): the debugging consumption surface
- [host (v0.1.0)](/docs/plugin/host): the G-58 plugin form

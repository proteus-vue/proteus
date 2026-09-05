---
title: Capability system
order: 18
group: 渲染与能力
---

# Capability system

QR scanning, geolocation, sharing, clipboard — every target has native APIs, but the moment business code writes `wx.scanCode` / `navigator.clipboard`, platform branches start polluting it. Proteus's capability system (`@proteus-vue/capabilities`) folds "platform capabilities" into a unified contract: business code only writes `useCapability('id')`, and adaptation and degradation are fully contained in the capability definition.

> **Business code depends only on the capability interface — zero platform branches.**
> A missing capability degrades explicitly or errors explicitly, never silently; a missing capability is visible at compile time.

## The capability declaration model

A capability is declared by a **descriptor file** (`capabilities/*.capability.ts`): `meta` (id / tier / name / permissions / required) + `adapters` (per-platform implementation factories) + an optional `fallback` (the id of the degradation capability):

```ts
// capabilities/share.capability.ts
import { defineCapability } from '@proteus-vue/capabilities'

export default defineCapability({
  meta: { id: 'share', tier: 2, name: 'Share' }, // kebab-case id, validated at compile time
  adapters: {
    web: () => ({
      capability: 'share',
      platform: 'web',
      // feature detection: never run platform APIs at module top level — defer to the call
      isSupported: () => typeof navigator !== 'undefined' && 'share' in navigator,
      create: () => ({ isSupported: () => true, invoke: () => navigator.share({ title: document.title }) }),
    }),
    skyline: () => ({
      capability: 'share',
      platform: 'skyline',
      isSupported: () => typeof wx !== 'undefined',
      create: () => ({ isSupported: () => true, invoke: () => wx.showShareMenu({ menus: ['shareAppMessage'] }) }),
    }),
  },
  fallback: 'clipboard', // probing fails on every platform → recursively resolve the clipboard capability
})
```

`tier` is the honest grading of capability levels:

| Tier | Meaning | Examples |
|---|---|---|
| L1 | Universal: every target has a native counterpart | storage, clipboard |
| L2 | Mapping needs adaptation: semantics unified, implemented per target | share, QR scanning |
| L3 | Platform-exclusive: only some targets have it | WeChat login (`login.wechat`) |
| L4 | Experimental: the interface may change | —— |

An invalid descriptor file throws on the spot: `validateCapabilityDefinition` validates the id format (kebab-case), the tier value, non-empty adapters (platforms restricted to `web` / `skyline` / `app`), and the fallback type; whether the degradation target actually exists is validated by `CapabilityRegistry.validate()` (the fallback must be registered).

## Runtime detection & selection

The Adapter Registry (`CapabilityRegistry`) resolves capabilities with a fixed strategy: **platform filter → priority in descending order → probe `isSupported()` one by one → take the first hit; no hit → resolve fallback recursively**. The only entry point on the business side:

```ts
import { useCapability, resolveCapability, matchPlatform } from '@proteus-vue/capabilities'

// synchronous resolution (adapters whose isSupported is synchronous)
const share = useCapability('share')
if (share.isSupported()) {
  share.api.invoke('Title')
} // missing but not required: returns an unsupported wrapper (isSupported false) — no crash

// async full resolution (supports async probing + fallback recursion)
const cap = await resolveCapability('share')

// platform guard (iron rule #4: replaces #ifdef) — all three targets must be exhaustive; a missing branch fails compilation
const label = matchPlatform({
  web: () => 'Web target',
  skyline: () => 'Mini Program target',
  app: () => 'App target',
})
```

Degradation happens at two levels (B4 error model — never silent):

| Scenario | Behavior |
|---|---|
| Missing non-required capability | `unsupported` wrapper: `isSupported()` is false; invoking throws `CapabilityError('UNSUPPORTED')` |
| Missing required capability | Throws `CapabilityError('UNSUPPORTED')` directly, blocking the flow |
| Permission denied / unavailable | `CapabilityError('PERMISSION_DENIED' / 'UNAVAILABLE')` — an explicit error model |

`CapabilityError` carries `code` / `capability` / `platform` / `reason`. DevTools can inject a `CapabilityTraceBus` to observe every `capability.detect` probe and degradation event, and `registry.snapshot()` outputs the support-status table of all capabilities on the current platform.

## Compile time: manifest & gap checking

A capability is not only a runtime contract — at compile time there are two machine gates (node-only subpath imports, never part of the runtime artifact):

1. **Manifest scan** (`@proteus-vue/capabilities/scan`): recursively collects `capabilities/*.capability.ts` → `capability-manifest.json` (each entry carries id / tier / platforms / fallback / source — the origin file path, so artifacts stay traceable), shared with the CLI `capabilities:manifest`.
2. **Reference gap check** (`@proteus-vue/capabilities/check`): scans business code for `useCapability('id')` / `resolveCapability('id')` references and compares them against the manifest's platform coverage:
   - `missing`: referenced by business code, but the current platform has no adapter → compile-time error / warning;
   - `gaps`: in the manifest, but the current platform has no adapter → a coverage-gap list.

```bash
# ① capability manifest + missing-platform report (--platform web|skyline|app appends the gap check)
proteus capabilities:manifest --platform web
# ② static check of raw platform API calls: business directories ban wx.* / window.*
#    (capabilities / adapters / platforms directories are exempt; skyline/app files ban window.*, web files ban wx.*)
proteus capabilities:check
```

Platform pruning principle: **business code stays unchanged; the artifact contains only the current platform's adapters** — the runtime registry already selects per platform by probing.

## Capability gating & conformance

"Explicitly declaring capabilities" is the foundation of Proteus conformance verification, and the same pattern runs through three layers:

- **Compiler conformance (G-38)**: the 42 contract tests (C-01~C-10) are gated by backend capability declarations — when `capabilities.x = false`, the corresponding item is **SKIP rather than FAIL** (e.g. `incremental: false` → the whole C-06 incremental-compilation group is SKIPPED). Honest declarations let a machine distinguish "not implemented" from "implemented but broken".
- **Render backends (G-27)**: `BackendCapabilities` declares its eight fields honestly — **undeclared = unsupported** — and the framework degrades by capability (L3→L2→L1→solid) instead of judging platforms with if/else.
- **Capability system (this guide)**: adapters must implement the `isSupported()` probe; a missing capability follows the explicit degradation chain — no silent failures.

The template side has one more capability entry point: `capability.*` semantic components such as `p-scan-qr` / `p-pick-photo` / `p-location` are collected by the compiler into `CompilerIR.bindings.capabilities` (see [Compiler pipeline](/docs/framework/26-compiler-pipeline)) for the G-28 capability-call chain to consume — the declarative and the imperative paths share one capability table.

## Next steps

- [Platform API](/docs/19-platform-api): a unified runtime across the four domains — storage / router / ui / request
- [Conformance](/docs/framework/29-conformance): how capability declarations anchor every layer's conformance
- [Containers & hosts](/docs/framework/33-containers-hosts): where the capability host sits in the Platform triple

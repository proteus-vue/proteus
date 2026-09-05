---
title: p-permission
order: 26
group: 桌面原语
---

# p-permission

Permission gate: six-semantic catalog + check/request normalization + v-p-permission intercept-and-replay

> Source module `@proteus-vue/desktop` (pure logic + Web wiring — env-injected for testing, falls back to real globals when absent). Platform mapping / degradation chain → see the module header source.

**★G-24 B2 (proteus-semantic-primitives-plan 04-system-integration §2 Permission gating): p-permission pure logic**
· PERMISSION_CATALOG: semantics → web permission channel (principle #10.8—only listed when there is a clear native system counterpart)
· buildPermissionManifest(semantics): compiler-phase permission manifest (04 §2 "p-permission compile-time validation checklist," auto-generating each platform permission declarations"—a pure function hooking G-21: iOS Info.plist / Android Manifest / HarmonyOS module.json5 are each derived from the manifest)
· checkPermission / requestPermission: unified granted/denied/prompt/unsupported normalization (query and request are injectable and unit-testable)
Pure logic with zero direct DOM calls; default wiring goes through injection (document/navigator are passed as env by the caller/directive factory—audited no-platform-api safety)

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | Official wiring: pure logic + env fallback to globals; v-p-* directives (registered via createDesktopDirectives) |
| WeChat Mini Program | 🟡 | Pure logic unit-testable; directives not registered (desktop interactions have no counterpart — stripped at compile time); page wiring is up to the host |
| Headless (SSR/testing) | ✅ | Pure logic runs on Node (tooling/testing tier) |
| iOS native | 🟡 | Mapping planned — official wiring not started (native recognition / system API per the G-24 plan) |
| Android native | 🟡 | Mapping planned — official wiring not started |
| HarmonyOS | 🟡 | Mapping planned — official wiring not started |
| Flutter hybrid | 🟡 | Widget/system mapping not started |
| Quick App | ⬜ | target not started |

> Status scale: ✅ target shipped & this primitive usable · 🟡 prototype mapping — wiring not started · ⬜ target not started. Family-level mechanism coverage (not a per-target on-device verification matrix); target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).

## Core exports (SSOT: `packages/desktop/src/permission.ts`)

| Export | Kind | One-liner (source comment) |
|---|---|---|
| `PermissionState` | type | Pure logic with zero direct DOM calls; default wiring goes through injection (document/navigator are passed as env by the caller/directive factory—audited no-platform-api safety) |
| `PermissionEntry` | interface | — |
| `PERMISSION_CATALOG` | const | ★semantics → web permission channel (04 §1 p-permission rows + additions: entries backed by a web standard are listed) |
| `PermissionEnv` | interface | Permission-query injection surface (default wiring lives on the directive factory/host side—zero direct calls inside the package) |
| `permissionEntry` | function | Semantics → catalog entry (unknown semantics → undefined—honest, never invents permissions) |
| `buildPermissionManifest` | function | ★Compiler-phase permission manifest (04 §2, hooks G-21): the p-permission semantic set found in the input templates → manifest (deduped + unknown filtered + stable order) |
| `defaultPermissionQuery` | function | Default query normalization: navigator.permissions.query (only for entries declaring webQueryName in the catalog); missing API / thrown error → null (caller falls back to prompt) |
| `checkPermission` | function | ★checkPermission: unified state query (unknown to the catalog → unsupported; no web query channel → prompt—honest "may be available; a request is needed to confirm") |
| `requestPermission` | function | ★requestPermission: authorization request (env.request injects the real implementation—notification dialogs / camera streams; missing implementation → unsupported, honest degradation) |
| `defaultPermissionRequest` | function | Common web default request implementation (for host/directive factory wiring): notification → Notification.requestPermission; the rest have no unified channel → false |

## Real usage (dogfooding provenance — the official site itself / example projects run it live, not illustrative)

```ts
const manifest = buildPermissionManifest(['notification', 'camera'])
```
> Origin: `examples/pages/semantic-primitives-demo.vue:360`

```ts
<p-button v-p-permission="{ semantic: 'notification' }" @click="onSendNotify">Send notification</p-button>
```
> Origin: `examples/pages/semantic-primitives-demo.vue:232`

## Usage & degradation

- pure-logic functions: env-injected for testing; browser defaults fall back (`typeof` guards — wrapping lives only inside framework packages, pages keep zero raw platform APIs)
- directive/component forms: `v-p-*` registered via `createDesktopDirectives()` (not registered on MP → degrades naturally)
- official-site dogfooding usage: violation quick-fix table in [Quality gates](/docs/29-quality-gates) and [Desktop primitives](/docs/30-desktop-primitives); G-24 series examples in `examples/pages/semantic-primitives-demo.vue`

<!-- generated by website/scripts/gen-primitives.mjs (en overlay) · SSOT：packages/desktop/src -->
---
title: Runtime config (app.config)
order: 11
group: 代码构成
---

# Runtime config (app.config)

A project has **two config files** with orthogonal responsibilities (decision #211) — split by **when they are consumed**:

| File | Timing | What it governs | Consumers |
|---|---|---|---|
| `proteus.config.ts` | **Build time** (compiler config) | How it's built: targets `targets.{web,mp,ios,android,harmony}` / compile rules / style transforms / route scanning / native project identity | Compiler, CLI, Vite plugin |
| `app.config.ts` | **Runtime** (runtime config) | How it behaves: app identity / API base URL / feature flags / theme & font / safe area | Business code (`useAppConfig`) |

> In short: **`proteus.config` = the compiler config (frozen at build time); `app.config` = the runtime config (read at launch + optional remote hot update)**. Changing the compiler config means re-running `build:mp`; the runtime config can receive remote hot updates. The `AppConfig` type contract has its single source of truth in `@proteus-vue/app-config`.

## Definition

```ts
// app.config.ts
import { defineAppConfig } from '@proteus-vue/app-config'

export default defineAppConfig({
  app: {
    id: 'com.proteus.demo',        // runtime app identifier (reporting / multi-tenancy)
    name: 'Proteus Demo',
    version: '1.0.0',
    buildNumber: 1,
  },
  env: 'dev',                      // 'dev' | 'staging' | 'prod'
  api: {
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    retry: 3,
    cache: { defaultTTL: 60, enabledEndpoints: [] },
  },
  features: {                      // feature flags (consumed by useFeatureFlag)
    glassEffect: true,
    skeletonScreen: true,
    newHomePage: 'control',        // can also be an experiment group value
  },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1.0, allowUserAdjust: true },
  safeArea: { islandGlass: true, statusBar: 'show' },
})
```

> **`app.id` ≠ the `appid` in `proteus.config`**: the former is the app's runtime identifier (used for business reporting); the latter is the WeChat platform compilation identifier (written into `project.config.json` at build time).

## Full field reference (AppConfig Schema)

### `app` (app identity)

| Field | Type | Required | Validation rule | Description |
|---|---|---|---|---|
| `id` | `string` | Yes | non-empty string | Runtime app identifier (reporting / multi-tenancy) |
| `name` | `string` | Yes | non-empty string | App name |
| `version` | `string` | Yes | semver (`1.0.0` / `1.0.0-beta.1`) | App version |
| `buildNumber` | `number` | Yes | non-negative integer | Build number (increments with each build) |

### `env` (environment)

| Field | Type | Required | Validation rule | Description |
|---|---|---|---|---|
| `env` | `'dev' or 'staging' or 'prod'` | Yes | three-value enum | Current environment; drives the `app.config.{env}.ts` override-layer selection |

### `api` (API layer)

| Field | Type | Required | Validation rule | Description |
|---|---|---|---|---|
| `baseUrl` | `string` | Yes | non-empty string | API domain (default origin for R1-layer requests) |
| `timeout` | `number` | Yes | `(0, 120000]` ms | Request timeout |
| `retry` | `number` | Yes | `0-5` integer | Number of retries on failure |
| `cache.defaultTTL` | `number` | No | seconds | Default TTL for the API cache |
| `cache.enabledEndpoints` | `string[]` | No | path list | Whitelist of endpoints with caching enabled |

### `features` (feature flags)

| Field | Type | Required | Description |
|---|---|---|---|
| `glassEffect` | `boolean` | Yes | Glassmorphism effect toggle (G-07 liquid glass) |
| `skeletonScreen` | `boolean` | Yes | Skeleton screen toggle (p-skeleton) |
| `memorialGray` | `boolean` | Yes | Grayscale mode (e.g., national memorial days) |
| `newHomePage` | `'control' or 'variant-a' or 'variant-b'` | Yes | A/B experiment group value |
| `[key: string]` | `boolean or string or number` | No | Business-defined custom flags (consumed by useFeatureFlag) |

### `theme` / `font` / `safeArea` (presentation layer)

| Field | Type | Required | Validation rule | Description |
|---|---|---|---|---|
| `theme.default` | `'light' or 'dark' or 'system'` | Yes | three-value enum | Default theme (`system` follows the system) |
| `theme.allowUserToggle` | `boolean` | Yes | boolean | Whether users can switch the theme |
| `font.defaultScale` | `number` | Yes | `0.5-2.0` | Default font-size scaling (linked to the p-scale accessibility levels) |
| `font.allowUserAdjust` | `boolean` | Yes | boolean | Whether users can adjust the font size |
| `safeArea.islandGlass` | `boolean` | Yes | boolean | Dynamic Island / notch-screen glass adaptation (consumed by p-safe) |
| `safeArea.statusBar` | `'show' or 'hide'` | No | two-value enum | Status-bar display policy (default `'show'`): `'show'` aligns with the Web `viewport-fit=cover` edge-to-edge layout (the content background extends under the status bar, and content yields via `--pf-inset-top`); `'hide'` is immersive full-screen. The three native hosts read this from the build-time `app-config.json` |

### Optional extension fields

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | `Partial<Record<Platform, DeepPartial<AppConfig>>>` | No | Per-target deep override (Platform = `mp-weixin` / `web` / `ios` / `android` / `harmony`); see [Runtime config consumption](/docs/framework/app-config-runtime) |
| `remote` | `RemoteConfigConfig` | No | Remote delivery policy: `enabled` / `source.type` (`'https' or 'local'`) / `source.url` / `strategy` (`fetchOnLaunch` / `fetchInterval` / `cacheToDisk`) / `fallback` (`'last-cached' or 'defaults'`) |

## Validation

```bash
proteus app-config:check app.config.ts
```

The validator is **rule-table driven** (in-house, ~2KB, zero zod dependency; ES5-safe — it ships in the MP artifact at runtime): the "Validation rule" column in the tables above maps one-to-one to the `RULES` entries in `validate.ts`. Semantics:

- **Valid → takes effect; invalid → rejected + warning** (no error thrown, no silent breakage — degrade rather than crash, same philosophy as Style Safety G-31)
- `setConfig()` validates the whole config **after** the deep merge (a shallow merge would replace all of `features`, causing false reports of missing fields)
- Runtime validation failure: `setConfig` returns `{ ok: false, errors }` and refuses the update
- Build-time validation: wired into the `proteus check` aggregate gate in CI

## Tools

- `proteus gen config`: generates a type-safe skeleton (IDE completion for `features.xxx` — inferred from the `defineAppConfig` generic)
- `proteus app-config:check app.config.ts`: field / type / migration validation (a missing file is skipped without blocking; run as a standalone command, it reports errors)

## Next steps

- [Runtime config consumption](/docs/framework/app-config-runtime): merge hierarchy, platform overrides, remote hot update, `useAppConfig`

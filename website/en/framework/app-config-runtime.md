---
title: Runtime config consumption
order: 34
group: 数据与状态
---

# Runtime config consumption

The runtime mechanism of app.config (`@proteus-vue/app-config`): **multi-layer merge → validation → reactive consumption → remote hot updates**.

## Merge layers (priority from low to high)

```
defaults (app.config.ts) < env (app.config.{env}.ts) < platform (per-target override) < remote (remote delivery)
```

- **env override**: `app.config.prod.ts` is selected and merged by the `env` field
- **platform override**: `platform?: Partial<Record<Platform, DeepPartial<AppConfig>>>` — a per-target **DeepPartial deep override** (only the differing fields are overridden, e.g., iOS turns glass off, MP tunes the timeout)
- **remote delivery**: `config.remote` declares the strategy (`fetchOnLaunch` / `fetchInterval` / `cacheToDisk` / `fallback: 'last-cached' or 'defaults'`)

```ts
// platform override example
platform: {
  'mp-weixin': { api: { timeout: 5000 } },   // only this field is overridden; the rest is inherited
  web: { features: { glassEffect: false } },
}
```

## Consumption APIs (full table)

| API | Signature | Context | Description |
|---|---|---|---|
| `useAppConfig()` | `() => AppConfig` | inside page/component setup | reactively reads the full config (a ref proxy; calling outside setup throws — same semantics as `useRoute`) |
| `useFeatureFlag(key)` | `(key: string) => FeatureFlagResult` | inside page/component setup | feature switch: reads `features[key]`, returns `{ enabled, variant }` |
| `getConfig()` | `() => AppConfig` | utility layer / startup | non-reactive read (throws when uninitialized — startup must init) |
| `setConfig(input)` | `(DeepPartial<AppConfig> or ((cur) => DeepPartial)) => { ok, errors }` | runtime updates | deep merge → validate: invalid → **rejects the update + warns** (does not throw); valid → triggers a reactive notification |
| `getFeatureFlag(config, key)` | pure function | tests / non-reactive scenarios | the pure-function version of `useFeatureFlag` (testable outside setup) |
| `initAppConfig(defaults)` | `(AppConfig) => void` | app startup | initializes the config store (calling again = overwrites the defaults while keeping the already-merged layers) |

**`FeatureFlagResult` structure**:

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | true unless the value is `false` or `undefined` |
| `variant` | `boolean or string or number or undefined` | the raw flag value (a boolean switch / an A/B group string) |

```ts
// typical consumption
const config = useAppConfig()
const { enabled, variant } = useFeatureFlag('newHomePage')

if (enabled && variant === 'variant-a') {
  // the experiment-group home page
}
```

## Validation semantics

| Scenario | Behavior |
|---|---|
| valid `setConfig` | deep merge → takes effect → every `useAppConfig` consumer updates reactively |
| invalid `setConfig` | **rejects the update + `console.warn`** (returns `{ ok: false, errors }`) — no silent config breakage |
| required field missing / wrong type | reported one by one against the `validateAppConfig` rule table (path-level `errors: [{ path, message }]`) |
| remote fetch fails | falls back per `fallback` (see below) — **the app never crashes because of a config failure** |

The validation rule table (`RULES`) maps one-to-one onto the full app-config field table (the "Validation rule" column in [Application config (app.config)](/docs/11-app-config)); new fields are covered automatically once they are recorded in `RULES`.

## Remote hot updates

After `config.remote` is declared:

- **fetchOnLaunch**: fetches the remote config at launch
- **fetchInterval**: periodic refresh (ms)
- **cacheToDisk**: writes the fetched result to disk (the L1-cache abstraction — in-memory implementation by default; when integrating with Cache G-28, swap the storage implementation with the interface unchanged)
- **fallback**: fetch failure → `last-cached` (prefer the most recent successful cache) or `defaults` (go straight back to the default values)

Effect chain: remote value → validation (same semantics as `setConfig`; invalid ones are rejected) → deep merge → reactive notification. **Runtime config changes require no release.**

## Validation & tools

- `proteus app-config:check app.config.ts`: field / type / migration validation (a missing file is skipped without blocking; the standalone command reports errors)
- `proteus gen config`: generates a type-safe skeleton

## Next steps

- [Application config (app.config)](/docs/11-app-config): the full field table and validation rules
- [Data passing between pages](/docs/framework/page-data)

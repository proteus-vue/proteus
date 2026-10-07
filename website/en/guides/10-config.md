---
title: Compiler & page configuration
order: 10
group: 代码构成
---

# Compiler & page configuration

Proteus configuration is split into **two orthogonal surfaces**, their boundary drawn by **when they are consumed** (decision #211): fields consumed at build time go in `proteus.config.ts`; fields consumed at runtime go in `app.config.ts`.

| Config surface | File | Timing | What it governs | Consumers |
|---|---|---|---|---|
| **Compiler config** | `proteus.config.ts` | **Build time** | How it's built: targets / compile rules / style conversion / route scanning / native project identity | Compiler, CLI, Vite plugin |
| **Runtime config** | `app.config.ts` | **Runtime** | How it behaves: app identity / API base URL / feature flags / theme & font | Business code (`useAppConfig`) |

> In short: **`proteus.config` = the compiler config (frozen at build time — a change needs a rebuild); `app.config` = the runtime config (read at launch + optional remote hot update)**.

This page covers the **compiler config** and the **page config** (the page `<route>` block — it governs one page's metadata and is likewise consumed at **compile time** by `gen-routes`); for the runtime config see [Runtime config (app.config)](/docs/11-app-config).

## Compiler config: `proteus.config.ts`

The type contract `ProteusConfig` (`@proteus-vue/types/config` is the single source of truth). ★**v4 (decision #641) is per-target**: the targets are top-level keys `targets.{web,mp,ios,android,harmony}`, each holding its own config (including native project identity); **cross-target shared fields** stay at the top level.

```ts
// proteus.config.ts (v4)
export default {
  version: 4,
  targets: {
    web:     { output: 'dist' },
    mp:      { appid: 'wx…', renderer: 'skyline' },
    ios:     { bundleId: 'com.acme.app' },
    android: { applicationId: 'com.acme.app', minSdk: 26 },
    harmony: { bundleName: 'com.acme.app' },
  },
  pagesDir: 'src/pages',
  router: { routesOutput: 'src/router/auto-routes.ts' },
}
```

> **Why per-target**: the old model flattened Mini-Program/Skyline-specific fields onto the top level (`skyline`/`appid`/`setDataBridge`/`style.px2rpx`/`page`/`globalStyle`/`rules`…) — the shape of a "Mini-Program compiler" era; and the old `platform: 'mp-weixin' | 'web'` could not express the three App targets at all. With targets as top-level keys, each target's config no longer pollutes the others, and **the source of truth for the target is the CLI `--target`**.
>
> **Migration**: a v3 flat config is **auto-migrated** on load (`resolveProteusConfig`) — no hand-editing needed; `proteus migrate types` stamps `version: 4`.

### Top-level fields (cross-target shared)

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | `number` | No | Config schema version (4 since v4; an explicit `<4` is auto-migrated on load) |
| `targets` | `ProteusTargets` | **Yes** | The target set (keys = `web` / `mp` / `ios` / `android` / `harmony`); at least one |
| `pagesDir` | `string` | **Yes** | Pages root directory (start of main-package route scanning); defaults to `src/pages` |
| `app` | `{ name?, version?, buildNumber? }` | No | **Shared app identity** (written into each target's native project files at build time; falls back to app.config's `app.*`) |
| `router` | `RouterSection` | No | #492 **project-level route management** (the single declaration surface): structure + tabBar + pages |
| `compiler` | `object` | No | Compiler backend swapping (`backend: 'node' \| 'rust'`) |
| `layout` | `object` | No | Fluid-layout compile parameters (`designWidth` / `fluidViewport`) |
| `budget` | `object` | No | Bundle-size budget (`mainPackageKB` / `strict`) |
| `vite` | `object or function` | No | **vite passthrough** (#418): the vite config is assembled by the framework; this field is for developer extensions |
| `audit` | `object` | No | **D-2 page gate rules** (#447): pick `off`/`warn`/`error` per rule |
| `gates` | `object` | No | **Unified gate switches** (#456): disable gates / aggregate domains via `gates.disabled` |

### `targets`, per target

**`targets.web` (browser SPA)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `output` | `string` | No | Build output directory (defaults to `dist/web`) |

**`targets.mp` (WeChat Mini Program · Skyline / WebView, one pipeline)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `appid` | `string` | **Yes** | Mini Program AppID (written to project.config.json / IDE import / automator check at build time). **≠ `app.id` in app.config** |
| `renderer` | `'skyline' or 'webview'` | No | Renderer (★replaces the old top-level `skyline: boolean`; defaults to `'skyline'`) |
| `style` | `{ px2rpx?, rpxRatio? }` | No | Style conversion (MP-only; defaults `px2rpx: true` / `rpxRatio: 2`). The Web target never converts |
| `setDataBridge` | `{ batchWindow?, perComponent? }` | No | Reactivity → setData bridge strategy (defaults 16ms / per-component) |
| `globalStyle` | `string` | No | ★Global style (the **only** global entry on MP): a CSS file relative to root (defaults to `app.wxss`), compiled into the artifact-root `app.wxss` |
| `page` | `{ autoScrollContainer?, webviewPages? }` | No | Page mode: auto scroll container (default true); `webviewPages` = Skyline iOS white-screen fallback (page-level WebView downgrade) |
| `skylineLayout` | `object` | No | Skyline layout-alignment switches (see below) |
| `profileBoundary` | `{ level? }` | No | Compile-time profile-boundary check (`'error' \| 'warn' \| 'off'`, default `error`) |
| `rules` | `object` | No | Compile rule overrides (`disabled` / `mapping` / `customTags`) |

**`targets.mp.skylineLayout` (Skyline layout alignment)**

Consumes the five alignment switches from the official *Skyline WXSS style support & differences* table — **only `defaultDisplayBlock` defaults to `true`** (verified on real devices here); the rest default to **not injected**:

| Subfield | Type | Required | Description |
|---|---|---|---|
| `defaultDisplayBlock` | `boolean` | No | Nodes default to block layout, aligned with WebView/Web; **default true** |
| `defaultContentBox` | `boolean` | No | Defaults to the `content-box` box model, aligned with Web |
| `tagNameStyleIsolation` | `boolean` | No | Tag selectors match globally (★rejected by the devtools — a platform limit) |
| `enableScrollViewAutoSize` | `boolean` | No | `scroll-view` sizes itself automatically |
| `keyframeStyleIsolation` | `boolean` | No | `@keyframes` styles are shared globally |

**`targets.ios` (→ Info.plist)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `bundleId` | `string` | No | CFBundleIdentifier (defaults to the host's default bundle id) |
| `displayName` | `string` | No | CFBundleDisplayName (falls back to `app.name`) |
| `version` / `buildNumber` | `string` | No | CFBundleShortVersionString / CFBundleVersion (fall back to `app.*`) |
| `minimumOSVersion` | `string` | No | Minimum OS version (default 15.0) |
| `deviceFamily` | `number[]` | No | UIDeviceFamily (1=iPhone / 2=iPad; default `[1]`) |
| `orientations` | `string[]` | No | Supported orientations (default `['portrait']`) |
| `launchPage` | `string` | No | Home page name (the `ProteusHomePage` Info.plist key; default index) |
| `userInterfaceStyle` | `'light' \| 'dark' \| 'automatic'` | No | Interface appearance (not written by default = system) |
| `statusBarStyle` / `statusBarHidden` | `string` / `boolean` | No | Status-bar style / hide it |
| `urlSchemes` | `string[]` | No | Deep-link registration (CFBundleURLTypes, e.g. `['myapp']` → `myapp://…`) |
| `privacyUsageDescriptions` | `Record<string,string>` | No | ★App-Store-required privacy strings (`NSCameraUsageDescription` → purpose) |
| `appCategory` / `developmentRegion` / `requiresFullScreen` | `string` / `boolean` | No | Category / default language / iPad full screen |

**`targets.android` (→ AndroidManifest.xml)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `applicationId` | `string` | No | applicationId / package (defaults to the host runtime's package) |
| `label` | `string` | No | App/launcher name (falls back to `app.name`) |
| `versionName` / `versionCode` | `string` / `number` | No | Version (falls back to `app.*`) |
| `minSdk` / `targetSdk` | `number` | No | SDK range (default 24 / 34) |
| `orientation` | `'portrait' \| 'landscape' \| 'unspecified'` | No | Screen orientation (default unspecified) |
| `permissions` | `string[]` | No | Extra `<uses-permission>` |
| `icon` / `theme` / `launchPage` | `string` | No | Icon resource / app theme / home page (manifest `ProteusHomePage` meta-data) |
| `allowBackup` / `largeHeap` / `hardwareAccelerated` / `supportsRtl` / `usesCleartextTraffic` | `boolean` | No | App flags (set-or-add on `<application>`) |
| `networkSecurityConfig` / `appCategory` | `string` | No | Network security config reference / app category |

**`targets.harmony` (→ AppScope/app.json5 + entry/module.json5 + string.json)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `bundleName` | `string` | No | bundleName (defaults to the host's) — also the **signing-bound** key (changing it means changing the profile) |
| `label` | `string` | No | App name (falls back to `app.name`) |
| `vendor` | `string` | No | vendor (default proteus) |
| `versionName` / `versionCode` | `string` / `number` | No | Version (falls back to `app.*`) |
| `compatibleSdkVersion` / `targetSdkVersion` | `string` | No | SDK (default `5.0.5(17)`) |
| `deviceTypes` | `string[]` | No | Device types (default `["phone","tablet","2in1"]`) |
| `permissions` | `string[]` | No | Extra requestPermissions |
| `icon` / `appCategory` | `string` | No | App icon (app.json5) / app category |
| `orientation` | `string` | No | Entry Ability orientation (module.json5 abilities[0]) |

> **Full per-field reference** (type / required / description, auto-generated and jumpable) is in [Configuration reference](/docs/reference/config).

> **Native identity injection**: the fields under `targets.{ios,android,harmony}` are **rendered by the CLI** (`proteus create host` / `proteus build --target <target> --package`) into the host project's native files — these used to be hardcoded in the host. **Responsibility boundary (G-35.1)**: `targets.*` = build time (writes native files); app.config's `app.*` = runtime (read by business). Values fall back, but the boundary does not change.

### `router` (#492 project-level route management — the single routing declaration surface)

> Cross-target shared. The old top-level `routesOutput` / `subPackages` / `customRoute` are collected here (top-level spelling is a compatibility alias; `router.*` wins).

| Subfield | Type | Required | Description |
|---|---|---|---|
| `routesOutput` | `string` | No | Route output file (generated by gen-routes at compile time; defaults to `src/router/auto-routes.ts`; `''` = explicitly off) |
| `subPackages` | `array` | No | Subpackage config: `root` (independent scan tree) / `name` (app.json display + module mapping) |
| `customRoute` | `object` | No | wx.router custom routes (`registerPresets` / `builders`) |
| `tabBar` | `object` | No | tabBar declaration: `color` / `selectedColor` / `list` (`{ name, text, icon? }[]`). Derived from `isTab` when omitted |
| `pages` | `Record<string, RouteMeta>` | No | **Page config** (the `pages.json` equivalent): per-page title / isTab / transition / guards; `meta` is the synonymous old name |

### `compiler` / `layout` / `budget` / `vite` / `audit` / `gates`

| Field | Subfield | Description |
|---|---|---|
| `compiler` | `backend` | `'node'` (default) or `'rust'` (runs Node/Rust dual-compile semantic-equivalence checks on every .vue) |
| `layout` | `designWidth` / `fluidViewport` | Fluid-layout p-fluid clamp generation parameters |
| `budget` | `mainPackageKB` / `strict` | Main-package size limit (KB) / fail the build when exceeded |
| `vite` | object or function | vite passthrough (`plugins` appended, `resolve.alias` concatenated, `build` deep-merged) |
| `audit` | `dir` / `rules` | D-2 gates (`no-third-party-ui` / `no-media-query` / `no-platform-api` / `no-web-platform-api`, off/warn/error) |
| `gates` | `disabled` | List of gate / preset / aggregate-domain IDs to disable |

### Validation & tooling

```bash
proteus config:check proteus.config.ts   # normalize (v4) + required fields + cross-layer deps (CONFIG_LAYER_VIOLATION) + migration hints
proteus generate types                    # generates the JSON Schema (.proteus/proteus.config.schema.json — IDE autocomplete)
proteus migrate types proteus.config.ts   # migrate an existing config (stamps version: 4; the shape is normalized at runtime)
```

## Page configuration: the `<route>` block

Each page declares its metadata locally in a `<route>` custom block, which `gen-routes` reads at compile time:

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "Profile", "requiresAuth": true, "transition": "slideUp" }
}
</route>
```

### `meta` fields (RouteMeta, single source `@proteus-vue/contracts`)

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | No | Navigation bar title |
| `isTab` | `boolean` | No | Whether it is a tab page (tabBar.list is declared by `router.tabBar`) |
| `requiresAuth` | `boolean` | No | Login guard (checked before route navigation) |
| `permissions` | `string[]` | No | Permission guard (format `resource:action`; security M3) |
| `transition` | `'slideUp' or 'slideDown' or 'halfScreen' or 'scaleDown' or 'none'` | No | Transition animation |
| `[key: string]` | `unknown` | No | Arbitrary extension fields (JSON-serializable only — read by business custom guards) |

Centralized page config (`router.pages` in `proteus.config.ts`) and the per-page `<route>` declaration **can coexist**: match priority — exact path > directory prefix > default; explicit declarations always win.

## Omitting it is also valid

The `<route>` block is entirely optional — `path` / `name` are derived from the file location (`pages/user/profile.vue` → path `pages/user/profile`, name `user-profile`; `index.vue` collapses into the directory path), and pages without a block are still registered. **Explicit declarations always win.**

## Next steps

- [Configuration reference (per field)](/docs/reference/config): type / required / description for every field of proteus.config.ts (auto-generated, jumpable)
- [Runtime config (app.config)](/docs/11-app-config): the full field table of runtime config and useAppConfig
- [Routing & navigation](/docs/16-router): the complete model of the route tree and per-target codegen
- [CLI & project commands](/docs/28-cli): the full `proteus` command-line family

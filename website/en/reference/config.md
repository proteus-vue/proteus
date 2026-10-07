---
title: Configuration reference (proteus.config.ts)
order: 42
group: 工程命令
generated: true
---

# Configuration reference (proteus.config.ts)

> This page is **auto-generated from the type source** (`ProteusConfig` and the target interfaces in `packages/types/src/config.ts`, via `website/scripts/gen-config-ref.mjs`) — do not hand-edit. Every field is its own heading (jump from the outline on the right). Field descriptions come from the JSDoc on the type — **structure and prose stay in sync with the type**.

```ts
// proteus.config.ts (v4, per-target)
export default {
  version: 4,
  targets: {
    mp: { appid: 'wx…', renderer: 'skyline' },
    ios: { bundleId: 'com.acme.app' },
    android: { applicationId: 'com.acme.app', minSdk: 26 },
  },
  pagesDir: 'src/pages',
}
```

## Top-level fields (cross-target shared)

### `version`

- **Type**: `number`
- **Required**: No

Config schema version (4 since v4; an explicit `<4` is auto-migrated on load).

### `targets`

- **Type**: `ProteusTargets`
- **Required**: Yes

The target set (per-target partition) — at least one target; keys = web / mp / ios / android / harmony.

### `pagesDir`

- **Type**: `string`
- **Required**: Yes

Pages root directory (the start of main-package route scanning). Cross-target shared.

### `app`

- **Type**: `AppIdentityConfig`
- **Required**: No

Shared app identity (name / version / buildNumber), written into each target’s native project files at build time; falls back to app.config’s `app.*`.

### `router`

- **Type**: `RouterSection`
- **Required**: No

Project-level route management (the single routing config surface): structure (routesOutput / subPackages) + tabBar + pages.

### `compiler`

- **Type**: `{ backend?: CompilerBackend }`
- **Required**: No

Compiler backend swapping: `backend` = `node` (default) or `rust` (runs Node/Rust dual-compile semantic-equivalence checks).

### `compiler.backend`

- **Type**: `CompilerBackend`
- **Required**: No

`node` (default, zero overhead) or `rust` (dual-compile check on every .vue).

### `layout`

- **Type**: `{ designWidth?: number fluidViewport?: { min?: number; max?: number } }`
- **Required**: No

Fluid-layout p-fluid clamp generation parameters. Cross-target shared (same design baseline on Web/MP/App).

### `layout.designWidth`

- **Type**: `number`
- **Required**: No

Design mockup width (the base for p-fluid clamp generation).

### `layout.fluidViewport`

- **Type**: `{ min?: number; max?: number }`
- **Required**: No

Viewport range (clamp upper/lower bounds).

### `layout.fluidViewport.min`

- **Type**: `number`
- **Required**: No

### `layout.fluidViewport.max`

- **Type**: `number`
- **Required**: No

### `budget`

- **Type**: `{ mainPackageKB: number strict: boolean }`
- **Required**: No

Bundle-size budget.

### `budget.mainPackageKB`

- **Type**: `number`
- **Required**: Yes

Main-package size limit (KB).

### `budget.strict`

- **Type**: `boolean`
- **Required**: Yes

Strict mode: exceeding the limit fails the build.

### `vite`

- **Type**: `ViteUserConfig | ((ctx: ViteConfigContext) => ViteUserConfig | void | Promise<ViteUserConfig | void>)`
- **Required**: No

vite passthrough (the vite config is assembled by the framework; this field is for developer extensions — object or `(ctx) => object`).

### `audit`

- **Type**: `AuditConfig`
- **Required**: No

D-2 dogfooding gates (pages must not raw-write platform APIs / hand-write @media / pull in third-party UI; rule-level `off`/`warn`/`error`).

### `gates`

- **Type**: `GatesConfig`
- **Required**: No

Unified gate switches (`gates.disabled`: disable gates / aggregate domains).

## Target · Web

### `targets.web.output`

- **Type**: `string`
- **Required**: No

Build output directory (defaults to `dist/web`).

## Target · Mini Program (mp)

### `targets.mp.appid`

- **Type**: `string`
- **Required**: Yes

Mini Program AppID (written into project.config.json / IDE import / automator check at build time). **≠ `app.id` in app.config**.

### `targets.mp.renderer`

- **Type**: `'skyline' | 'webview'`
- **Required**: No

Renderer (`'skyline'`, default, or `'webview'`) — replaces the old top-level `skyline: boolean`.

### `targets.mp.style`

- **Type**: `{ px2rpx?: boolean rpxRatio?: number }`
- **Required**: No

Style conversion (MP-only; the Web target never converts — Web keeps standard CSS).

### `targets.mp.style.px2rpx`

- **Type**: `boolean`
- **Required**: No

px → rpx conversion switch (default true).

### `targets.mp.style.rpxRatio`

- **Type**: `number`
- **Required**: No

Conversion ratio (default 2:1 on a 375 design mockup).

### `targets.mp.setDataBridge`

- **Type**: `{ batchWindow?: number perComponent?: boolean }`
- **Required**: No

Reactivity → setData bridge strategy.

### `targets.mp.setDataBridge.batchWindow`

- **Type**: `number`
- **Required**: No

Batch window in ms (default 16 — about one frame).

### `targets.mp.setDataBridge.perComponent`

- **Type**: `boolean`
- **Required**: No

Whether to setData at component granularity (default true).

### `targets.mp.globalStyle`

- **Type**: `string`
- **Required**: No

The only global style entry on MP: a CSS file relative to root (defaults to `app.wxss`), compiled at build time into the artifact-root `app.wxss`.

### `targets.mp.page`

- **Type**: `{ autoScrollContainer?: boolean webviewPages?: string[] }`
- **Required**: No

Page mode (Skyline pages do not scroll by themselves).

### `targets.mp.page.autoScrollContainer`

- **Type**: `boolean`
- **Required**: No

Automatically wrap pages in a scroll container (default true).

### `targets.mp.page.webviewPages`

- **Type**: `string[]`
- **Required**: No

Skyline iOS white-screen fallback: list high-risk pages to force onto WebView rendering (page-level, not global).

### `targets.mp.skylineLayout`

- **Type**: `{ defaultDisplayBlock?: boolean defaultContentBox?: boolean tagNameStyleIsolation?: boolean enableScrollViewAutoSize?: boolean keyframeStyleIsolation?: boolean }`
- **Required**: No

Skyline layout-alignment switches (from the official alignment table). Only `defaultDisplayBlock` defaults to true; the rest are not injected unless declared.

### `targets.mp.skylineLayout.defaultDisplayBlock`

- **Type**: `boolean`
- **Required**: No

Nodes default to block layout, aligned with WebView/Web; **default true** (verified on real devices).

### `targets.mp.skylineLayout.defaultContentBox`

- **Type**: `boolean`
- **Required**: No

Defaults to the `content-box` box model, aligned with Web.

### `targets.mp.skylineLayout.tagNameStyleIsolation`

- **Type**: `boolean`
- **Required**: No

Tag selectors match globally, aligned with WebView (★rejected by the devtools — a platform limit).

### `targets.mp.skylineLayout.enableScrollViewAutoSize`

- **Type**: `boolean`
- **Required**: No

`scroll-view` sizes itself automatically.

### `targets.mp.skylineLayout.keyframeStyleIsolation`

- **Type**: `boolean`
- **Required**: No

`@keyframes` styles are shared globally.

### `targets.mp.profileBoundary`

- **Type**: `{ level?: 'error' | 'warn' | 'off' }`
- **Required**: No

Compile-time profile-boundary check (a style unsupported on a target is reported; also runs on the Web build). Escape hatch: a `proteus-allow-profile: <reason>` comment in the style block.

### `targets.mp.profileBoundary.level`

- **Type**: `'error' | 'warn' | 'off'`
- **Required**: No

Violation severity: `'error'` (default) | `'warn'` | `'off'`.

### `targets.mp.rules`

- **Type**: `TransformRuleOverrides`
- **Required**: No

Compile rule overrides (disabled / mapping / customTags) — changes compile behavior without touching framework code.

## Target · iOS

### `targets.ios.bundleId`

- **Type**: `string`
- **Required**: No

CFBundleIdentifier (defaults to the host’s default bundle id).

### `targets.ios.displayName`

- **Type**: `string`
- **Required**: No

CFBundleDisplayName (falls back to `app.name`).

### `targets.ios.version`

- **Type**: `string`
- **Required**: No

CFBundleShortVersionString (falls back to `app.version`).

### `targets.ios.buildNumber`

- **Type**: `string`
- **Required**: No

CFBundleVersion (falls back to `app.buildNumber`).

### `targets.ios.minimumOSVersion`

- **Type**: `string`
- **Required**: No

Minimum OS version (default 15.0).

### `targets.ios.deviceFamily`

- **Type**: `number[]`
- **Required**: No

UIDeviceFamily (1 = iPhone / 2 = iPad; default `[1]`).

### `targets.ios.orientations`

- **Type**: `Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>`
- **Required**: No

Supported orientations (default `['portrait']`).

### `targets.ios.launchPage`

- **Type**: `string`
- **Required**: No

Home page name (the `ProteusHomePage` Info.plist key; default index) — the host renders this screen on launch.

### `targets.ios.userInterfaceStyle`

- **Type**: `'light' | 'dark' | 'automatic'`
- **Required**: No

Interface appearance (`'light'` / `'dark'` / `'automatic'`; not written by default = system).

### `targets.ios.statusBarStyle`

- **Type**: `string`
- **Required**: No

Status-bar style (e.g. `UIStatusBarStyleLightContent`; not written by default).

### `targets.ios.statusBarHidden`

- **Type**: `boolean`
- **Required**: No

Hide the status bar (not written by default).

### `targets.ios.urlSchemes`

- **Type**: `string[]`
- **Required**: No

URL scheme allow-list (`CFBundleURLTypes`) — registers deep links / being opened by other apps (e.g. `["myapp"]` → `myapp://…`).

### `targets.ios.privacyUsageDescriptions`

- **Type**: `Record<string, string>`
- **Required**: No

Privacy usage descriptions (`NSXxxUsageDescription`) — ★required for App Store review: key = the full plist key (e.g. `NSCameraUsageDescription`), value = the user-facing purpose string.

### `targets.ios.appCategory`

- **Type**: `string`
- **Required**: No

App category (`LSApplicationCategoryType`, e.g. `public.app-category.games`; not written by default).

### `targets.ios.appTransportSecurity`

- **Type**: `{ allowArbitraryLoads?: boolean allowLocalNetworking?: boolean }`
- **Required**: No

App Transport Security（NSAppTransportSecurity）——放宽 ATS（如允许明文 HTTP 联调；缺省不写）

### `targets.ios.appTransportSecurity.allowArbitraryLoads`

- **Type**: `boolean`
- **Required**: No

NSAllowsArbitraryLoads（允许任意明文 HTTP；★上架需说明理由，仅联调建议开启）

### `targets.ios.appTransportSecurity.allowLocalNetworking`

- **Type**: `boolean`
- **Required**: No

NSAllowsLocalNetworking（允许本地网络明文——iOS 10+，比 arbitrary 更窄）

### `targets.ios.requiresFullScreen`

- **Type**: `boolean`
- **Required**: No

`UIRequiresFullScreen` (require full screen on iPad, disable split view; not written by default).

### `targets.ios.developmentRegion`

- **Type**: `string`
- **Required**: No

`CFBundleDevelopmentRegion` (default development language, e.g. `zh_CN` / `en`; not written by default).

## Target · Android

### `targets.android.applicationId`

- **Type**: `string`
- **Required**: No

applicationId / package (defaults to the host runtime’s package for same-package access).

### `targets.android.label`

- **Type**: `string`
- **Required**: No

App/launcher name (`android:label`; falls back to `app.name`).

### `targets.android.versionName`

- **Type**: `string`
- **Required**: No

versionName (falls back to `app.version`).

### `targets.android.versionCode`

- **Type**: `number`
- **Required**: No

versionCode (positive integer; falls back to `app.buildNumber`).

### `targets.android.minSdk`

- **Type**: `number`
- **Required**: No

minSdkVersion (default 24).

### `targets.android.targetSdk`

- **Type**: `number`
- **Required**: No

targetSdkVersion (default 34).

### `targets.android.orientation`

- **Type**: `'portrait' | 'landscape' | 'unspecified'`
- **Required**: No

Screen orientation (`activity android:screenOrientation`; default `'unspecified'`).

### `targets.android.permissions`

- **Type**: `Array<string | AndroidPermission>`
- **Required**: No

Permission declarations (`<uses-permission>`) — string shorthand = name only; a structured entry may carry `maxSdkVersion`.

### `targets.android.permissions.<entry>.name`

- **Type**: `string`
- **Required**: Yes

Full permission name (e.g. `android.permission.CAMERA`).

### `targets.android.permissions.<entry>.maxSdkVersion`

- **Type**: `number`
- **Required**: No

`android:maxSdkVersion` — the permission only applies up to this API level (e.g. storage permissions are obsolete on Android 13+).

### `targets.android.usesFeatures`

- **Type**: `Array<string | AndroidUsesFeature>`
- **Required**: No

Hardware/feature declarations (`<uses-feature>`) — string shorthand = required: true.

### `targets.android.usesFeatures.<entry>.name`

- **Type**: `string`
- **Required**: Yes

Feature name (e.g. `android.hardware.camera` / `android.hardware.location.gps`).

### `targets.android.usesFeatures.<entry>.required`

- **Type**: `boolean`
- **Required**: No

`android:required` (default true — the store filters out devices lacking it).

### `targets.android.queryPackages`

- **Type**: `string[]`
- **Required**: No

Package visibility (`<queries>` `<package>` — declare before querying/opening other apps on Android 11+).

### `targets.android.icon`

- **Type**: `string`
- **Required**: No

App icon resource name (`android:icon`; not written by default).

### `targets.android.launchPage`

- **Type**: `string`
- **Required**: No

Home page name (the `ProteusHomePage` manifest meta-data; default index) — the host renders this screen on launch.

### `targets.android.theme`

- **Type**: `string`
- **Required**: No

App theme (`application android:theme`, e.g. `@android:style/Theme.NoTitleBar.Fullscreen`; not written by default).

### `targets.android.allowBackup`

- **Type**: `boolean`
- **Required**: No

`android:allowBackup` (allow adb/cloud backup; not written by default = platform default true).

### `targets.android.largeHeap`

- **Type**: `boolean`
- **Required**: No

`android:largeHeap` (request a large heap — for big images/lists; not written by default).

### `targets.android.hardwareAccelerated`

- **Type**: `boolean`
- **Required**: No

`android:hardwareAccelerated` (hardware acceleration; not written by default = platform default true).

### `targets.android.supportsRtl`

- **Type**: `boolean`
- **Required**: No

`android:supportsRtl` (RTL layout support; not written by default).

### `targets.android.usesCleartextTraffic`

- **Type**: `boolean`
- **Required**: No

`android:usesCleartextTraffic` (allow cleartext HTTP — often needed for local/intranet debugging; not written by default).

### `targets.android.networkSecurityConfig`

- **Type**: `string`
- **Required**: No

`android:networkSecurityConfig` (network security config resource reference, e.g. `@xml/network_security_config`; not written by default).

### `targets.android.appCategory`

- **Type**: `string`
- **Required**: No

`android:appCategory` (app category, e.g. `game` / `audio`; not written by default).

## Target · HarmonyOS

### `targets.harmony.bundleName`

- **Type**: `string`
- **Required**: No

bundleName (defaults to the host’s) — also the **signing-bound** key (changing it means changing the signing profile).

### `targets.harmony.label`

- **Type**: `string`
- **Required**: No

App name (`$string:app_name` value; falls back to `app.name`).

### `targets.harmony.vendor`

- **Type**: `string`
- **Required**: No

vendor (default proteus).

### `targets.harmony.versionName`

- **Type**: `string`
- **Required**: No

versionName (falls back to `app.version`).

### `targets.harmony.versionCode`

- **Type**: `number`
- **Required**: No

versionCode (positive integer; falls back to `app.buildNumber`).

### `targets.harmony.compatibleSdkVersion`

- **Type**: `string`
- **Required**: No

compatibleSdkVersion (e.g. `"5.0.5(17)"`; default `5.0.5(17)`).

### `targets.harmony.targetSdkVersion`

- **Type**: `string`
- **Required**: No

targetSdkVersion (defaults to compatibleSdkVersion).

### `targets.harmony.deviceTypes`

- **Type**: `string[]`
- **Required**: No

deviceTypes (default `["phone","tablet","2in1"]`).

### `targets.harmony.permissions`

- **Type**: `Array<string | HarmonyPermission>`
- **Required**: No

Permission declarations (`requestPermissions`) — string shorthand = name only; a structured entry may carry `reason` + `usedScene` (★required for user-grant permissions — a plain-text reason makes the framework generate the `$string:` resource).

### `targets.harmony.permissions.<entry>.name`

- **Type**: `string`
- **Required**: Yes

Full permission name (e.g. `ohos.permission.INTERNET` / `ohos.permission.LOCATION`).

### `targets.harmony.permissions.<entry>.reason`

- **Type**: `string`
- **Required**: No

Request reason (★required for user-grant permissions): a plain-text reason makes the framework generate a `$string:` resource (written into the entry string.json in three languages); a `$string:xxx` value is used as a resource reference verbatim (you must supply it).

### `targets.harmony.permissions.<entry>.usedScene`

- **Type**: `{ abilities?: string[] when?: 'inuse' | 'always' }`
- **Required**: No

Usage scene (★required for user-grant permissions).

### `targets.harmony.permissions.<entry>.usedScene.abilities`

- **Type**: `string[]`
- **Required**: No

Related abilities (default = the entry `EntryAbility`).

### `targets.harmony.permissions.<entry>.usedScene.when`

- **Type**: `'inuse' | 'always'`
- **Required**: No

When it is used: `'inuse'` (while in use, default) | `'always'`.

### `targets.harmony.icon`

- **Type**: `string`
- **Required**: No

App icon (`app.json5` icon, e.g. `$media:my_icon` — resource under AppScope resources media/; not written by default).

### `targets.harmony.appCategory`

- **Type**: `string`
- **Required**: No

App category (`app.json5` appCategory, e.g. `game` / `audio`; not written by default).

### `targets.harmony.orientation`

- **Type**: `string`
- **Required**: No

Entry Ability orientation (`module.json5` abilities[0].orientation, e.g. `portrait` / `landscape` / `auto_rotation`; not written by default).

## Shared identity · app

### `app.name`

- **Type**: `string`
- **Required**: No

App display name (falls back to app.config’s `app.name`).

### `app.version`

- **Type**: `string`
- **Required**: No

Version (semver; falls back to app.config’s `app.version`).

### `app.buildNumber`

- **Type**: `string | number`
- **Required**: No

Build number (falls back to app.config’s `app.buildNumber`).

<!-- generated by website/scripts/gen-config-ref.mjs · SSOT：packages/types/src/config.ts（ProteusConfig + 目标端接口） -->
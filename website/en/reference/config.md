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

- **Type**: `{ /** px → rpx 转换开关（缺省 true） */ px2rpx?: boolean /** 换算比例（缺省按 375 设计稿 2:1） */ rpxRatio?: number }`
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

- **Type**: `{ /** 合并窗口（ms，缺省 16——约 1 帧） */ batchWindow?: number /** 是否按组件粒度 setData（缺省 true） */ perComponent?: boolean }`
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

- **Type**: `{ /** 页面自动包滚动容器（缺省 true——Skyline 页面滚动必须 scroll-view） */ autoScrollContainer?: boolean /** ★Skyline iOS 白屏兜底：列出白屏高风险页，强制走 WebView 渲染（页面级降级，不全局） */ webviewPages?: string[] }`
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

- **Type**: `string[]`
- **Required**: No

Extra `<uses-permission android:name="…"/>`.

### `targets.android.icon`

- **Type**: `string`
- **Required**: No

App icon resource name (`android:icon`; not written by default).

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

- **Type**: `string[]`
- **Required**: No

Extra requestPermissions (module.json5).

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
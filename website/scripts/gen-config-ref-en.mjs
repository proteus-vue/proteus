// website/scripts/gen-config-ref-en.mjs —— 配置参考页 EN overlay（数据模块 · 与 gen-primitives-en 同法）
// 结构骨架由 gen-config-ref.mjs 从类型源同源推导；本模块只提供英文文案（未登记的字段回落中文）。

export const PAGE_EN = {
  order: 42,
  group: '工程命令',
  zh: {
    title: '配置参考（proteus.config.ts）',
    lede:
      '> 本页由**类型源码自动生成**（`packages/types/src/config.ts` 的 `ProteusConfig` 与目标端接口，`website/scripts/gen-config-ref.mjs`），请勿手工编辑。每个字段一个标题（右侧目录可跳转）。字段说明取自类型上的 JSDoc——**结构与说明随类型同步**。',
    example:
      "// proteus.config.ts（v4 · 按端分区）\nexport default {\n  version: 4,\n  targets: {\n    mp: { appid: 'wx…', renderer: 'skyline' },\n    ios: { bundleId: 'com.acme.app' },\n    android: { applicationId: 'com.acme.app', minSdk: 26 },\n  },\n  pagesDir: 'src/pages',\n}",
  },
  en: {
    title: 'Configuration reference (proteus.config.ts)',
    lede:
      '> This page is **auto-generated from the type source** (`ProteusConfig` and the target interfaces in `packages/types/src/config.ts`, via `website/scripts/gen-config-ref.mjs`) — do not hand-edit. Every field is its own heading (jump from the outline on the right). Field descriptions come from the JSDoc on the type — **structure and prose stay in sync with the type**.',
    example:
      "// proteus.config.ts (v4, per-target)\nexport default {\n  version: 4,\n  targets: {\n    mp: { appid: 'wx…', renderer: 'skyline' },\n    ios: { bundleId: 'com.acme.app' },\n    android: { applicationId: 'com.acme.app', minSdk: 26 },\n  },\n  pagesDir: 'src/pages',\n}",
  },
}

export const SECTION_EN = {
  top: 'Top-level fields (cross-target shared)',
  web: 'Target · Web',
  mp: 'Target · Mini Program (mp)',
  ios: 'Target · iOS',
  android: 'Target · Android',
  harmony: 'Target · HarmonyOS',
  app: 'Shared identity · app',
}

/** 字段路径 → 英文说明（未登记回落中文 JSDoc） */
export const FIELD_EN = {
  // —— 顶层 ——
  version: 'Config schema version (4 since v4; an explicit `<4` is auto-migrated on load).',
  targets: 'The target set (per-target partition) — at least one target; keys = web / mp / ios / android / harmony.',
  pagesDir: 'Pages root directory (the start of main-package route scanning). Cross-target shared.',
  app: 'Shared app identity (name / version / buildNumber), written into each target\u2019s native project files at build time; falls back to app.config\u2019s `app.*`.',
  router: 'Project-level route management (the single routing config surface): structure (routesOutput / subPackages) + tabBar + pages.',
  compiler: 'Compiler backend swapping: `backend` = `node` (default) or `rust` (runs Node/Rust dual-compile semantic-equivalence checks).',
  'compiler.backend': '`node` (default, zero overhead) or `rust` (dual-compile check on every .vue).',
  layout: 'Fluid-layout p-fluid clamp generation parameters. Cross-target shared (same design baseline on Web/MP/App).',
  'layout.designWidth': 'Design mockup width (the base for p-fluid clamp generation).',
  'layout.fluidViewport': 'Viewport range (clamp upper/lower bounds).',
  budget: 'Bundle-size budget.',
  'budget.mainPackageKB': 'Main-package size limit (KB).',
  'budget.strict': 'Strict mode: exceeding the limit fails the build.',
  vite: 'vite passthrough (the vite config is assembled by the framework; this field is for developer extensions — object or `(ctx) => object`).',
  audit: 'D-2 dogfooding gates (pages must not raw-write platform APIs / hand-write @media / pull in third-party UI; rule-level `off`/`warn`/`error`).',
  gates: 'Unified gate switches (`gates.disabled`: disable gates / aggregate domains).',
  // —— Web ——
  'targets.web.output': 'Build output directory (defaults to `dist/web`).',
  // —— mp ——
  'targets.mp.appid': 'Mini Program AppID (written into project.config.json / IDE import / automator check at build time). **≠ `app.id` in app.config**.',
  'targets.mp.renderer': "Renderer (`'skyline'`, default, or `'webview'`) — replaces the old top-level `skyline: boolean`.",
  'targets.mp.style': 'Style conversion (MP-only; the Web target never converts — Web keeps standard CSS).',
  'targets.mp.style.px2rpx': 'px → rpx conversion switch (default true).',
  'targets.mp.style.rpxRatio': 'Conversion ratio (default 2:1 on a 375 design mockup).',
  'targets.mp.setDataBridge': 'Reactivity → setData bridge strategy.',
  'targets.mp.setDataBridge.batchWindow': 'Batch window in ms (default 16 — about one frame).',
  'targets.mp.setDataBridge.perComponent': 'Whether to setData at component granularity (default true).',
  'targets.mp.globalStyle': 'The only global style entry on MP: a CSS file relative to root (defaults to `app.wxss`), compiled at build time into the artifact-root `app.wxss`.',
  'targets.mp.page': 'Page mode (Skyline pages do not scroll by themselves).',
  'targets.mp.page.autoScrollContainer': 'Automatically wrap pages in a scroll container (default true).',
  'targets.mp.page.webviewPages': 'Skyline iOS white-screen fallback: list high-risk pages to force onto WebView rendering (page-level, not global).',
  'targets.mp.skylineLayout': 'Skyline layout-alignment switches (from the official alignment table). Only `defaultDisplayBlock` defaults to true; the rest are not injected unless declared.',
  'targets.mp.skylineLayout.defaultDisplayBlock': 'Nodes default to block layout, aligned with WebView/Web; **default true** (verified on real devices).',
  'targets.mp.skylineLayout.defaultContentBox': 'Defaults to the `content-box` box model, aligned with Web.',
  'targets.mp.skylineLayout.tagNameStyleIsolation': 'Tag selectors match globally, aligned with WebView (★rejected by the devtools — a platform limit).',
  'targets.mp.skylineLayout.enableScrollViewAutoSize': '`scroll-view` sizes itself automatically.',
  'targets.mp.skylineLayout.keyframeStyleIsolation': '`@keyframes` styles are shared globally.',
  'targets.mp.profileBoundary': 'Compile-time profile-boundary check (a style unsupported on a target is reported; also runs on the Web build). Escape hatch: a `proteus-allow-profile: <reason>` comment in the style block.',
  'targets.mp.profileBoundary.level': "Violation severity: `'error'` (default) | `'warn'` | `'off'`.",
  'targets.mp.rules': 'Compile rule overrides (disabled / mapping / customTags) — changes compile behavior without touching framework code.',
  // —— iOS ——
  'targets.ios.bundleId': 'CFBundleIdentifier (defaults to the host\u2019s default bundle id).',
  'targets.ios.displayName': 'CFBundleDisplayName (falls back to `app.name`).',
  'targets.ios.version': 'CFBundleShortVersionString (falls back to `app.version`).',
  'targets.ios.buildNumber': 'CFBundleVersion (falls back to `app.buildNumber`).',
  'targets.ios.minimumOSVersion': 'Minimum OS version (default 15.0).',
  'targets.ios.deviceFamily': 'UIDeviceFamily (1 = iPhone / 2 = iPad; default `[1]`).',
  'targets.ios.orientations': 'Supported orientations (default `[\'portrait\']`).',
  // —— Android ——
  'targets.android.applicationId': 'applicationId / package (defaults to the host runtime\u2019s package for same-package access).',
  'targets.android.label': 'App/launcher name (`android:label`; falls back to `app.name`).',
  'targets.android.versionName': 'versionName (falls back to `app.version`).',
  'targets.android.versionCode': 'versionCode (positive integer; falls back to `app.buildNumber`).',
  'targets.android.minSdk': 'minSdkVersion (default 24).',
  'targets.android.targetSdk': 'targetSdkVersion (default 34).',
  'targets.android.orientation': "Screen orientation (`activity android:screenOrientation`; default `'unspecified'`).",
  'targets.android.permissions': 'Extra `<uses-permission android:name="…"/>`.',
  'targets.android.icon': 'App icon resource name (`android:icon`; not written by default).',
  // —— Harmony ——
  'targets.harmony.bundleName': 'bundleName (defaults to the host\u2019s) — also the **signing-bound** key (changing it means changing the signing profile).',
  'targets.harmony.label': 'App name (`$string:app_name` value; falls back to `app.name`).',
  'targets.harmony.vendor': 'vendor (default proteus).',
  'targets.harmony.versionName': 'versionName (falls back to `app.version`).',
  'targets.harmony.versionCode': 'versionCode (positive integer; falls back to `app.buildNumber`).',
  'targets.harmony.compatibleSdkVersion': 'compatibleSdkVersion (e.g. `"5.0.5(17)"`; default `5.0.5(17)`).',
  'targets.harmony.targetSdkVersion': 'targetSdkVersion (defaults to compatibleSdkVersion).',
  'targets.harmony.deviceTypes': 'deviceTypes (default `["phone","tablet","2in1"]`).',
  'targets.harmony.permissions': 'Extra requestPermissions (module.json5).',
  // —— app ——
  'app.name': 'App display name (falls back to app.config\u2019s `app.name`).',
  'app.version': 'Version (semver; falls back to app.config\u2019s `app.version`).',
  'app.buildNumber': 'Build number (falls back to app.config\u2019s `app.buildNumber`).',
}

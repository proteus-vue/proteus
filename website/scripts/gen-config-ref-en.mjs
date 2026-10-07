// website/scripts/gen-config-ref-en.mjs —— 配置参考页 EN overlay（数据模块 · 与 gen-primitives-en 同法）
// 结构骨架由 gen-config-ref.mjs 从类型源同源推导；本模块只提供英文文案（未登记的字段回落中文）。

export const PAGE_EN = {
  order: 42,
  group: '工程命令',
  groupEn: 'Toolchain',
  zh: {
    title: '配置参考（proteus.config.ts）',
    lede:
      '> 本页由**类型源码自动生成**（`packages/types/src/{config,router-config,compiler-types}.ts`，`website/scripts/gen-config-ref.mjs`），请勿手工编辑。每个字段一个标题（右侧目录可跳转），被引用的具名接口（如 `RouterSection`）会展开为嵌套条目。字段说明取自类型上的 JSDoc（缺失即留空——不编造）。改类型 → 重跑生成器即同步。',
    example:
      "// proteus.config.ts（v4 · 按端分区）\nexport default {\n  version: 4,\n  targets: {\n    mp: { appid: 'wx…', renderer: 'skyline' },\n    ios: { bundleId: 'com.acme.app' },\n    android: { applicationId: 'com.acme.app', minSdk: 26 },\n  },\n  pagesDir: 'src/pages',\n}",
  },
  en: {
    title: 'Configuration reference (proteus.config.ts)',
    lede:
      '> This page is **auto-generated from the type source** (`packages/types/src/{config,router-config,compiler-types}.ts`, via `website/scripts/gen-config-ref.mjs`) — do not hand-edit. Every field is its own heading (jump from the outline), and referenced named interfaces (e.g. `RouterSection`) expand into nested entries. Descriptions come from the JSDoc on the type (empty when none — nothing is invented). Change the type and re-run the generator to resync.',
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
  'layout.fluidViewport.min': 'Viewport lower bound (px; the minimum size p-fluid generates).',
  'layout.fluidViewport.max': 'Viewport upper bound (px; the maximum size p-fluid generates).',
  budget: 'Bundle-size budget.',
  'budget.mainPackageKB': 'Main-package size limit (KB).',
  'budget.strict': 'Strict mode: exceeding the limit fails the build.',
  vite: 'vite passthrough (the vite config is assembled by the framework; this field is for developer extensions — object or a `(ctx) => object` function whose `ctx` is `{ command: \'serve\' | \'build\', mode: string }`).',
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
  'targets.ios.launchPage': 'Home page name (the `ProteusHomePage` Info.plist key; default index) — the host renders this screen on launch.',
  'targets.ios.userInterfaceStyle': "Interface appearance (`'light'` / `'dark'` / `'automatic'`; not written by default = system).",
  'targets.ios.statusBarStyle': 'Status-bar style (e.g. `UIStatusBarStyleLightContent`; not written by default).',
  'targets.ios.statusBarHidden': 'Hide the status bar (not written by default).',
  'targets.ios.urlSchemes': 'URL scheme allow-list (`CFBundleURLTypes`) — registers deep links / being opened by other apps (e.g. `["myapp"]` → `myapp://…`).',
  'targets.ios.privacyUsageDescriptions': 'Privacy usage descriptions (`NSXxxUsageDescription`) — ★required for App Store review: key = the full plist key (e.g. `NSCameraUsageDescription`), value = the user-facing purpose string.',
  'targets.ios.appCategory': 'App category (`LSApplicationCategoryType`, e.g. `public.app-category.games`; not written by default).',
  'targets.ios.appTransportSecurity': 'App Transport Security (`NSAppTransportSecurity`) — relax ATS (e.g. allow cleartext HTTP for local debugging; not written by default). Prefer the narrower `allowLocalNetworking`.',
  'targets.ios.appTransportSecurity.allowArbitraryLoads': '`NSAllowsArbitraryLoads` — allow arbitrary cleartext HTTP (★App Store requires a justification; recommended only for debugging, not for release).',
  'targets.ios.appTransportSecurity.allowLocalNetworking': '`NSAllowsLocalNetworking` — allow cleartext on local networks only (iOS 10+; narrower than arbitrary).',
  'targets.ios.requiresFullScreen': '`UIRequiresFullScreen` (require full screen on iPad, disable split view; not written by default).',
  'targets.ios.developmentRegion': '`CFBundleDevelopmentRegion` (default development language, e.g. `zh_CN` / `en`; not written by default).',
  // —— Android ——
  'targets.android.applicationId': 'applicationId / package (defaults to the host runtime\u2019s package for same-package access).',
  'targets.android.label': 'App/launcher name (`android:label`; falls back to `app.name`).',
  'targets.android.versionName': 'versionName (falls back to `app.version`).',
  'targets.android.versionCode': 'versionCode (positive integer; falls back to `app.buildNumber`).',
  'targets.android.minSdk': 'minSdkVersion (default 24).',
  'targets.android.targetSdk': 'targetSdkVersion (default 34).',
  'targets.android.orientation': "Screen orientation (`activity android:screenOrientation`; default `'unspecified'`).",
  'targets.android.permissions': 'Permission declarations (`<uses-permission>`) — string shorthand = name only; a structured entry may carry `maxSdkVersion`.',
  'targets.android.permissions.<entry>.name': 'Full permission name (e.g. `android.permission.CAMERA`).',
  'targets.android.permissions.<entry>.maxSdkVersion': '`android:maxSdkVersion` — the permission only applies up to this API level (e.g. storage permissions are obsolete on Android 13+).',
  'targets.android.usesFeatures': 'Hardware/feature declarations (`<uses-feature>`) — string shorthand = required: true.',
  'targets.android.usesFeatures.<entry>.name': 'Feature name (e.g. `android.hardware.camera` / `android.hardware.location.gps`).',
  'targets.android.usesFeatures.<entry>.required': '`android:required` (default true — the store filters out devices lacking it).',
  'targets.android.queryPackages': 'Package visibility (`<queries>` `<package>` — declare before querying/opening other apps on Android 11+).',
  'targets.android.icon': 'App icon resource name (`android:icon`; not written by default).',
  'targets.android.launchPage': 'Home page name (the `ProteusHomePage` manifest meta-data; default index) — the host renders this screen on launch.',
  'targets.android.theme': 'App theme (`application android:theme`, e.g. `@android:style/Theme.NoTitleBar.Fullscreen`; not written by default).',
  'targets.android.allowBackup': '`android:allowBackup` (allow adb/cloud backup; not written by default = platform default true).',
  'targets.android.largeHeap': '`android:largeHeap` (request a large heap — for big images/lists; not written by default).',
  'targets.android.hardwareAccelerated': '`android:hardwareAccelerated` (hardware acceleration; not written by default = platform default true).',
  'targets.android.supportsRtl': '`android:supportsRtl` (RTL layout support; not written by default).',
  'targets.android.usesCleartextTraffic': '`android:usesCleartextTraffic` (allow cleartext HTTP — often needed for local/intranet debugging; not written by default).',
  'targets.android.networkSecurityConfig': '`android:networkSecurityConfig` (network security config resource reference, e.g. `@xml/network_security_config`; not written by default).',
  'targets.android.appCategory': '`android:appCategory` (app category, e.g. `game` / `audio`; not written by default).',
  // —— Harmony ——
  'targets.harmony.bundleName': 'bundleName (defaults to the host\u2019s) — also the **signing-bound** key (changing it means changing the signing profile).',
  'targets.harmony.label': 'App name (`$string:app_name` value; falls back to `app.name`).',
  'targets.harmony.vendor': 'vendor (default proteus).',
  'targets.harmony.versionName': 'versionName (falls back to `app.version`).',
  'targets.harmony.versionCode': 'versionCode (positive integer; falls back to `app.buildNumber`).',
  'targets.harmony.compatibleSdkVersion': 'compatibleSdkVersion (e.g. `"5.0.5(17)"`; default `5.0.5(17)`).',
  'targets.harmony.targetSdkVersion': 'targetSdkVersion (defaults to compatibleSdkVersion).',
  'targets.harmony.deviceTypes': 'deviceTypes (default `["phone","tablet","2in1"]`).',
  'targets.harmony.permissions': 'Permission declarations (`requestPermissions`) — string shorthand = name only; a structured entry may carry `reason` + `usedScene` (★required for user-grant permissions — a plain-text reason makes the framework generate the `$string:` resource).',
  'targets.harmony.permissions.<entry>.name': 'Full permission name (e.g. `ohos.permission.INTERNET` / `ohos.permission.LOCATION`).',
  'targets.harmony.permissions.<entry>.reason': 'Request reason (★required for user-grant permissions): a plain-text reason makes the framework generate a `$string:` resource (written into the entry string.json in three languages); a `$string:xxx` value is used as a resource reference verbatim (you must supply it).',
  'targets.harmony.permissions.<entry>.usedScene': 'Usage scene (★required for user-grant permissions).',
  'targets.harmony.permissions.<entry>.usedScene.abilities': 'Related abilities (default = the entry `EntryAbility`).',
  'targets.harmony.permissions.<entry>.usedScene.when': "When it is used: `'inuse'` (while in use, default) | `'always'`.",
  'targets.harmony.icon': 'App icon (`app.json5` icon, e.g. `$media:my_icon` — resource under AppScope resources media/; not written by default).',
  'targets.harmony.appCategory': 'App category (`app.json5` appCategory, e.g. `game` / `audio`; not written by default).',
  'targets.harmony.orientation': 'Entry Ability orientation (`module.json5` abilities[0].orientation, e.g. `portrait` / `landscape` / `auto_rotation`; not written by default).',
  // —— app ——
  'app.name': 'App display name (falls back to app.config\u2019s `app.name`).',
  'app.version': 'Version (semver; falls back to app.config\u2019s `app.version`).',
  'app.buildNumber': 'Build number (falls back to app.config\u2019s `app.buildNumber`).',
  // —— router 段展开（RouterSection）——
  'router.routesOutput': 'Route-table output path (generated by gen-routes at compile time; defaults to `src/router/auto-routes.ts`; `""` = generate nothing).',
  'router.subPackages': 'Subpackage declarations: `root` (an independent scan tree) / `name` (for app.json display + module mapping).',
  'router.subPackages.<entry>.root': 'Subpackage root directory (relative to the project root, e.g. `subpackages/order`).',
  'router.subPackages.<entry>.name': 'Subpackage name (optional; maps to app.json `subPackages[].name`).',
  'router.customRoute': 'wx.router custom route builders (transition presets), inlined into app.js at build time.',
  'router.customRoute.registerPresets': 'Whether to register the built-in preset builders (default true).',
  'router.customRoute.builders': 'Preset builders registry: name → preset source file.',
  'router.tabBar': 'Native tabBar declaration (`color` / `selectedColor` / `list`).',
  'router.tabBar.color': 'Unselected text color (e.g. `#8a8a99`).',
  'router.tabBar.selectedColor': 'Selected text color (e.g. `#7c5cff`).',
  'router.tabBar.list': 'The tab list (order = display order; `name` = route name).',
  'router.tabBar.list.<entry>.name': 'Route name (matches the page name).',
  'router.tabBar.list.<entry>.text': 'Tab label.',
  'router.tabBar.list.<entry>.icon': 'Icon path (optional).',
  'router.pages': 'Per-page config (the `pages.json` equivalent): title / isTab / transition / guards — the single entry managing every route and target.',
  'router.meta': 'The synonymous old name of `pages` (when both are present, `pages` wins and a duplicate is recorded).',
  // —— audit / gates 段展开 ——
  'audit.dir': 'Directory of the pages under audit (relative to the project root; defaults to `src`).',
  'audit.rules': 'rule → severity; rules not listed default to `error`.',
  'gates.disabled': 'Gate / preset / aggregate-domain IDs to disable (from the `proteus gate ls` catalog); all enabled by default.',
  // —— rules 段展开（TransformRuleOverrides）——
  'targets.mp.rules.disabled': 'Disabled rule IDs (the rule no longer applies; output degrades to no transform + a compile-time warning).',
  'targets.mp.rules.mapping': 'Mapping overrides: rule ID → mapping patch (tag/* tag mapping / event/click-to-tap events / semantic/base-class semantic classes).',
  'targets.mp.rules.customTags': 'Custom tag mapping: new HTML tag → Mini Program tag (the entry point for AI to extend tags).',
  'targets.mp.rules.failFast': 'Support-matrix fail-fast: semantics outside the matrix (the "output verbatim" class — non-method event handlers / tags without an equivalent component / SVG / keyboard events) are upgraded from a soft warning to a compile-time hard error (CompilerError, fail-closed); default false keeps the warning.',
}

/**
 * ★相关超链（See also）：字段路径 → [{ zh, en, url }]（真实站内页——受 check:doc-links 门禁）。
 *   组级 key 命中时，其子字段会**继承**该组的相关链接（renderField 后查 SEE_ALSO[full] ?? SEE_ALSO[组前缀]）。
 */
export const SEE_ALSO = {
  'router': [
    { zh: '路由与导航', en: 'Routing & navigation', url: '/docs/16-router' },
    { zh: '路由配置', en: 'Route config', url: '/docs/framework/route-config' },
    { zh: '分包', en: 'Subpackages', url: '/docs/framework/subpackages' },
  ],
  'router.pages': [{ zh: '页面构成', en: 'Page anatomy', url: '/docs/09-page-anatomy' }],
  'audit': [{ zh: '质量门禁', en: 'Quality gates', url: '/docs/29-quality-gates' }],
  'gates': [{ zh: '质量门禁', en: 'Quality gates', url: '/docs/29-quality-gates' }],
  'app': [{ zh: '运行时配置 app.config', en: 'Runtime config (app.config)', url: '/docs/11-app-config' }],
  'pagesDir': [{ zh: '路由与导航', en: 'Routing & navigation', url: '/docs/16-router' }],
  'layout': [{ zh: '柔性布局', en: 'Fluid layout', url: '/docs/17-fluid-layout' }],
  'budget': [{ zh: '性能预算', en: 'Performance budget', url: '/docs/framework/perf-budget' }],
  'targets.mp.rules': [{ zh: '编译规则目录', en: 'Compile rule catalog', url: '/docs/reference/rules' }],
  'targets.mp': [{ zh: 'Skyline 渲染约束', en: 'Skyline render constraints', url: '/docs/22-skyline-render-constraints' }],
  'targets.mp.skylineLayout': [{ zh: 'Skyline 渲染约束', en: 'Skyline render constraints', url: '/docs/22-skyline-render-constraints' }],
  'targets.mp.page.webviewPages': [{ zh: 'Skyline 渲染约束', en: 'Skyline render constraints', url: '/docs/22-skyline-render-constraints' }],
  'targets.mp.permissions': [{ zh: '平台 API', en: 'Platform API', url: '/docs/19-platform-api' }],
  'targets.android.permissions': [{ zh: '平台 API', en: 'Platform API', url: '/docs/19-platform-api' }],
  'targets.harmony.permissions': [{ zh: '平台 API', en: 'Platform API', url: '/docs/19-platform-api' }],
  'vite': [{ zh: '编译配置', en: 'Compiler config', url: '/docs/10-config' }],
}

/**
 * ★组级 runnable 示例（大厂参考页常见：一个可复制片段）。key = 字段路径（或组路径）。
 */
export const EXAMPLE = {
  'targets.mp.style': {
    zh: "// targets.mp.style\nstyle: { px2rpx: true, rpxRatio: 2 }",
    en: "// targets.mp.style\nstyle: { px2rpx: true, rpxRatio: 2 }",
  },
  'targets.mp.permissions': {
    zh: "// targets.mp —— 仅 name 的简写\npermissions: ['android.permission.INTERNET']",
    en: "// targets.mp — name-only shorthand\npermissions: ['android.permission.INTERNET']",
  },
  'targets.android.permissions': {
    zh: "// 字符串简写 + 结构化（带 maxSdkVersion）\npermissions: [\n  'android.permission.INTERNET',\n  { name: 'android.permission.WRITE_EXTERNAL_STORAGE', maxSdkVersion: 32 },\n]",
    en: "// string shorthand + structured entry (with maxSdkVersion)\npermissions: [\n  'android.permission.INTERNET',\n  { name: 'android.permission.WRITE_EXTERNAL_STORAGE', maxSdkVersion: 32 },\n]",
  },
  'targets.android.usesFeatures': {
    zh: "usesFeatures: ['android.hardware.camera', { name: 'android.hardware.location.gps', required: false }]",
    en: "usesFeatures: ['android.hardware.camera', { name: 'android.hardware.location.gps', required: false }]",
  },
  'targets.harmony.permissions': {
    zh: "// reason 写普通文案 → 框架自动生成 $string: 资源；字符串简写仍可用\npermissions: [\n  { name: 'ohos.permission.LOCATION', reason: '用于展示附近门店' },\n  'ohos.permission.INTERNET',\n]",
    en: "// a plain-text reason makes the framework generate the $string: resource; string shorthand still works\npermissions: [\n  { name: 'ohos.permission.LOCATION', reason: 'Used to show nearby stores' },\n  'ohos.permission.INTERNET',\n]",
  },
  'targets.ios.urlSchemes': {
    zh: "urlSchemes: ['myapp']   // → myapp://…",
    en: "urlSchemes: ['myapp']   // → myapp://…",
  },
  'router.pages': {
    zh: "// router.pages —— pages.json 等价物\npages: {\n  'index': { title: '首页', isTab: true },\n  'user/profile': { title: '个人资料', requiresAuth: true },\n}",
    en: "// router.pages — the pages.json equivalent\npages: {\n  'index': { title: 'Home', isTab: true },\n  'user/profile': { title: 'Profile', requiresAuth: true },\n}",
  },
  'vite': {
    zh: "// 对象形态\nexport default {\n  vite: { server: { port: 5173 }, resolve: { alias: { '@lib': './src/lib' } } },\n}\n// 函数形态（按 command/mode）\nexport default {\n  vite: ({ command, mode }) => ({ base: mode === 'web' ? '/' : undefined }),\n}",
    en: "// object form\nexport default {\n  vite: { server: { port: 5173 }, resolve: { alias: { '@lib': './src/lib' } } },\n}\n// function form (per command/mode)\nexport default {\n  vite: ({ command, mode }) => ({ base: mode === 'web' ? '/' : undefined }),\n}",
  },
}

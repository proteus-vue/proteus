---
title: 配置参考（proteus.config.ts）
order: 42
group: 工程命令
generated: true
---

# 配置参考（proteus.config.ts）

> 本页由**类型源码自动生成**（`packages/types/src/config.ts` 的 `ProteusConfig` 与目标端接口，`website/scripts/gen-config-ref.mjs`），请勿手工编辑。每个字段一个标题（右侧目录可跳转）。字段说明取自类型上的 JSDoc——**结构与说明随类型同步**。

```ts
// proteus.config.ts（v4 · 按端分区）
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

## 顶层字段（跨端共享）

> 目标端是一级键 `targets.{web,mp,ios,android,harmony}`；各端配置见下方对应小节。

### `version`

- **类型**：`number`
- **必填**：否

配置 schema 版本（v4 起为 4；缺省视为当前形态——显式声明且 <4 时加载期自动迁移）

### `targets`

- **类型**：`ProteusTargets`
- **必填**：是

目标端配置（按端分区）——至少声明一个端；键 = web / mp / ios / android / harmony

### `pagesDir`

- **类型**：`string`
- **必填**：是

页面根目录（主包路由扫描起点）——**跨端共享**

### `app`

- **类型**：`AppIdentityConfig`
- **必填**：否

共享应用身份（构建期写进各端原生工程文件；缺省可由 app.config 的 app.* 回退）。 留在跨端层是刻意的——同一身份重复写进三端配置文件更易漂移；各端可覆盖（targets.<端>.label/version…）。 与 app.config 的 app.* 边界（G-35.1）：此处 = **构建期**（CLI 消费，写原生文件）；app.config = **运行期**（业务读取）。

### `router`

- **类型**：`RouterSection`
- **必填**：否

#492 项目级路由管理（统一路由配置面——跨端共享）： routesOutput / subPackages / customRoute / tabBar / pages 全在此； 消费方（gen-routes / app 骨架）经 resolveRouterConfig() 取生效配置——禁止散读。

### `compiler`

- **类型**：`{ backend?: CompilerBackend }`
- **必填**：否

G-29 编译器后端插拔（缺省 node 零开销；'rust' → 每次构建跑 Node/Rust 双编译语义等价校验）

### `compiler.backend`

- **类型**：`CompilerBackend`
- **必填**：否

### `layout`

- **类型**：`{ designWidth?: number fluidViewport?: { min?: number; max?: number } }`
- **必填**：否

G-22 柔性布局（fluid-layout-plan）：p-fluid 编译期 clamp 生成参数——**跨端共享**（Web/MP/App 同一设计基准）

### `layout.designWidth`

- **类型**：`number`
- **必填**：否

### `layout.fluidViewport`

- **类型**：`{ min?: number; max?: number }`
- **必填**：否

### `layout.fluidViewport.min`

- **类型**：`number`
- **必填**：否

### `layout.fluidViewport.max`

- **类型**：`number`
- **必填**：否

### `budget`

- **类型**：`{ mainPackageKB: number strict: boolean }`
- **必填**：否

包体积预算

### `budget.mainPackageKB`

- **类型**：`number`
- **必填**：是

### `budget.strict`

- **类型**：`boolean`
- **必填**：是

### `vite`

- **类型**：`ViteUserConfig | ((ctx: ViteConfigContext) => ViteUserConfig | void | Promise<ViteUserConfig | void>)`
- **必填**：否

#418/★#421 vite 透传（配置收敛——开发者不写 vite.config.ts）

### `audit`

- **类型**：`AuditConfig`
- **必填**：否

#447 D-2 dogfooding 门禁（页面不裸写平台 API / 手写

### `gates`

- **类型**：`GatesConfig`
- **必填**：否

#456 统一门禁开关（gates.disabled：自选关闭门禁/聚合域）

## 目标端 · Web

### `targets.web.output`

- **类型**：`string`
- **必填**：否

构建产物输出目录（缺省由框架推导 dist/web）

## 目标端 · 小程序 mp

### `targets.mp.appid`

- **类型**：`string`
- **必填**：是

小程序 AppID（构建期写 project.config.json / IDE 导入 / automator 体检）。**≠ app.config 的 app.id**（运行时标识）

### `targets.mp.renderer`

- **类型**：`'skyline' | 'webview'`
- **必填**：否

渲染器（★取代旧顶层 `skyline: boolean`）：`'skyline'`（默认）| `'webview'`

### `targets.mp.style`

- **类型**：`{ px2rpx?: boolean rpxRatio?: number }`
- **必填**：否

样式换算（MP 专属；Web 端永不换算——Web 保持标准 CSS，由编译器吸收差异）

### `targets.mp.style.px2rpx`

- **类型**：`boolean`
- **必填**：否

px → rpx 转换开关（缺省 true）

### `targets.mp.style.rpxRatio`

- **类型**：`number`
- **必填**：否

换算比例（缺省按 375 设计稿 2:1）

### `targets.mp.setDataBridge`

- **类型**：`{ batchWindow?: number perComponent?: boolean }`
- **必填**：否

响应式 → setData 桥接策略

### `targets.mp.setDataBridge.batchWindow`

- **类型**：`number`
- **必填**：否

合并窗口（ms，缺省 16——约 1 帧）

### `targets.mp.setDataBridge.perComponent`

- **类型**：`boolean`
- **必填**：否

是否按组件粒度 setData（缺省 true）

### `targets.mp.globalStyle`

- **类型**：`string`
- **必填**：否

全局样式（MP 端唯一全局入口）：相对 root 的 CSS 文件路径（缺省探测根/应用目录的 app.wxss）。构建期编译（px→rpx）后产出产物根 app.wxss（微信自动生效）；Web 端同一文件在入口 import（单源）。

### `targets.mp.page`

- **类型**：`{ autoScrollContainer?: boolean webviewPages?: string[] }`
- **必填**：否

页面模式（Skyline 页面本身不滚动）

### `targets.mp.page.autoScrollContainer`

- **类型**：`boolean`
- **必填**：否

页面自动包滚动容器（缺省 true——Skyline 页面滚动必须 scroll-view）

### `targets.mp.page.webviewPages`

- **类型**：`string[]`
- **必填**：否

Skyline iOS 白屏兜底：列出白屏高风险页，强制走 WebView 渲染（页面级降级，不全局）

### `targets.mp.skylineLayout`

- **类型**：`{ defaultDisplayBlock?: boolean defaultContentBox?: boolean tagNameStyleIsolation?: boolean enableScrollViewAutoSize?: boolean keyframeStyleIsolation?: boolean }`
- **必填**：否

Skyline 布局对齐开关（消费官方《Skyline WXSS 样式支持与差异》对齐表）。 仅 `defaultDisplayBlock` 默认 true（本仓真机验证过）；其余默认**不注入**（未验证的开关不由框架替项目做主）。

### `targets.mp.skylineLayout.defaultDisplayBlock`

- **类型**：`boolean`
- **必填**：否

### `targets.mp.skylineLayout.defaultContentBox`

- **类型**：`boolean`
- **必填**：否

### `targets.mp.skylineLayout.tagNameStyleIsolation`

- **类型**：`boolean`
- **必填**：否

### `targets.mp.skylineLayout.enableScrollViewAutoSize`

- **类型**：`boolean`
- **必填**：否

### `targets.mp.skylineLayout.keyframeStyleIsolation`

- **类型**：`boolean`
- **必填**：否

### `targets.mp.profileBoundary`

- **类型**：`{ level?: 'error' | 'warn' | 'off' }`
- **必填**：否

VC2-b 编译期 Profile 边界校验（使用了某端不支持的样式即报；Web 端构建同样执行）。escape hatch：样式块内注释 `proteus-allow-profile: <理由>`。

### `targets.mp.profileBoundary.level`

- **类型**：`'error' | 'warn' | 'off'`
- **必填**：否

### `targets.mp.rules`

- **类型**：`TransformRuleOverrides`
- **必填**：否

底线循环 ①③：规则覆盖（AI/config 改写或禁用规则）

## 目标端 · iOS

### `targets.ios.bundleId`

- **类型**：`string`
- **必填**：否

CFBundleIdentifier（缺省 = 宿主默认 bundle id，见宿主工程 / proteus.host.json）

### `targets.ios.displayName`

- **类型**：`string`
- **必填**：否

CFBundleDisplayName（缺省回退 app.name / targets.app.name）

### `targets.ios.version`

- **类型**：`string`
- **必填**：否

CFBundleShortVersionString（缺省回退 app.version）

### `targets.ios.buildNumber`

- **类型**：`string`
- **必填**：否

CFBundleVersion（缺省回退 app.buildNumber）

### `targets.ios.minimumOSVersion`

- **类型**：`string`
- **必填**：否

MinimumOSVersion（缺省 15.0）

### `targets.ios.deviceFamily`

- **类型**：`number[]`
- **必填**：否

UIDeviceFamily（1=iPhone / 2=iPad；缺省 [1]）

### `targets.ios.orientations`

- **类型**：`Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>`
- **必填**：否

支持的方向（缺省 [portrait]）

### `targets.ios.launchPage`

- **类型**：`string`
- **必填**：否

起始页名（Info.plist 的 ProteusHomePage；缺省 index）——宿主启动时渲染该屏

### `targets.ios.userInterfaceStyle`

- **类型**：`'light' | 'dark' | 'automatic'`
- **必填**：否

UIUserInterfaceStyle（界面明暗：`'light'` / `'dark'` / `'automatic'`；缺省不写 = 系统）

### `targets.ios.statusBarStyle`

- **类型**：`string`
- **必填**：否

UIStatusBarStyle（状态栏样式，如 `UIStatusBarStyleLightContent`；缺省不写）

### `targets.ios.statusBarHidden`

- **类型**：`boolean`
- **必填**：否

UIStatusBarHidden（隐藏状态栏；缺省不写）

### `targets.ios.urlSchemes`

- **类型**：`string[]`
- **必填**：否

URL scheme 白名单（CFBundleURLTypes）——注册深链/被其他 App 拉起（如 `['myapp']` → `myapp://…`）

### `targets.ios.privacyUsageDescriptions`

- **类型**：`Record<string, string>`
- **必填**：否

隐私用途说明（NSXxxUsageDescription）——★上架必需：key 为完整 plist 键名（如 `NSCameraUsageDescription`），value 为面向用户的用途字符串

### `targets.ios.appCategory`

- **类型**：`string`
- **必填**：否

应用类别（LSApplicationCategoryType，如 `public.app-category.games`；缺省不写）

### `targets.ios.appTransportSecurity`

- **类型**：`{ allowArbitraryLoads?: boolean allowLocalNetworking?: boolean }`
- **必填**：否

App Transport Security（NSAppTransportSecurity）——放宽 ATS（如允许明文 HTTP 联调；缺省不写）

### `targets.ios.appTransportSecurity.allowArbitraryLoads`

- **类型**：`boolean`
- **必填**：否

NSAllowsArbitraryLoads（允许任意明文 HTTP；★上架需说明理由，仅联调建议开启）

### `targets.ios.appTransportSecurity.allowLocalNetworking`

- **类型**：`boolean`
- **必填**：否

NSAllowsLocalNetworking（允许本地网络明文——iOS 10+，比 arbitrary 更窄）

### `targets.ios.requiresFullScreen`

- **类型**：`boolean`
- **必填**：否

UIRequiresFullScreen（iPad 要求全屏、禁用分屏；缺省不写）

### `targets.ios.developmentRegion`

- **类型**：`string`
- **必填**：否

CFBundleDevelopmentRegion（缺省开发语言，如 `zh_CN` / `en`；缺省不写）

## 目标端 · Android

### `targets.android.applicationId`

- **类型**：`string`
- **必填**：否

applicationId / package（缺省 = 宿主运行时同包 dev.proteus.layoutcore，保证同包访问）

### `targets.android.label`

- **类型**：`string`
- **必填**：否

桌面/应用名（android:label；缺省回退 app.name）

### `targets.android.versionName`

- **类型**：`string`
- **必填**：否

versionName（缺省回退 app.version）

### `targets.android.versionCode`

- **类型**：`number`
- **必填**：否

versionCode（正整数；缺省回退 app.buildNumber）

### `targets.android.minSdk`

- **类型**：`number`
- **必填**：否

minSdkVersion（缺省 24）

### `targets.android.targetSdk`

- **类型**：`number`
- **必填**：否

targetSdkVersion（缺省 34）

### `targets.android.orientation`

- **类型**：`'portrait' | 'landscape' | 'unspecified'`
- **必填**：否

屏幕方向（activity android:screenOrientation；缺省 unspecified）

### `targets.android.permissions`

- **类型**：`Array<string | AndroidPermission>`
- **必填**：否

权限声明（`<uses-permission>`）——字符串简写 = 仅 name；结构化条目可带 `maxSdkVersion`

### `targets.android.permissions.<entry>.name`

- **类型**：`string`
- **必填**：是

权限全名（如 `android.permission.CAMERA`）

### `targets.android.permissions.<entry>.maxSdkVersion`

- **类型**：`number`
- **必填**：否

android:maxSdkVersion——该权限仅对 ≤ 此 API level 生效（如存储权限在 Android 13+ 已废弃）

### `targets.android.usesFeatures`

- **类型**：`Array<string | AndroidUsesFeature>`
- **必填**：否

硬件/功能特性（`<uses-feature>`）——字符串简写 = required: true

### `targets.android.usesFeatures.<entry>.name`

- **类型**：`string`
- **必填**：是

特性名（如 `android.hardware.camera` / `android.hardware.location.gps`）

### `targets.android.usesFeatures.<entry>.required`

- **类型**：`boolean`
- **必填**：否

android:required（缺省 true——不满足则应用商店过滤该设备）

### `targets.android.queryPackages`

- **类型**：`string[]`
- **必填**：否

包可见性（`<queries>` 的 `<package>`——Android 11+ 查询/拉起其他应用前需声明）

### `targets.android.icon`

- **类型**：`string`
- **必填**：否

应用图标资源名（android:icon；缺省不写）

### `targets.android.launchPage`

- **类型**：`string`
- **必填**：否

起始页名（manifest 的 ProteusHomePage meta-data；缺省 index）——宿主启动时渲染该屏

### `targets.android.theme`

- **类型**：`string`
- **必填**：否

应用主题（application android:theme，如 `@android:style/Theme.NoTitleBar.Fullscreen`；缺省不写）

### `targets.android.allowBackup`

- **类型**：`boolean`
- **必填**：否

android:allowBackup（允许 adb/云备份；缺省不写 = 平台默认 true）

### `targets.android.largeHeap`

- **类型**：`boolean`
- **必填**：否

android:largeHeap（申请大堆——大图/大列表场景；缺省不写）

### `targets.android.hardwareAccelerated`

- **类型**：`boolean`
- **必填**：否

android:hardwareAccelerated（硬件加速；缺省不写 = 平台默认 true）

### `targets.android.supportsRtl`

- **类型**：`boolean`
- **必填**：否

android:supportsRtl（RTL 布局支持；缺省不写）

### `targets.android.usesCleartextTraffic`

- **类型**：`boolean`
- **必填**：否

android:usesCleartextTraffic（允许明文 HTTP——本地/内网联调常需；缺省不写）

### `targets.android.networkSecurityConfig`

- **类型**：`string`
- **必填**：否

android:networkSecurityConfig（网络安全配置资源引用，如 `@xml/network_security_config`；缺省不写）

### `targets.android.appCategory`

- **类型**：`string`
- **必填**：否

android:appCategory（应用类别，如 `game` / `audio`；缺省不写）

## 目标端 · 鸿蒙

### `targets.harmony.bundleName`

- **类型**：`string`
- **必填**：否

bundleName（缺省 = 宿主默认，见宿主 app.json5）——也是**签名绑定**的键（换它要换 profile）

### `targets.harmony.label`

- **类型**：`string`
- **必填**：否

应用名（$string:app_name 的值；缺省回退 app.name）

### `targets.harmony.vendor`

- **类型**：`string`
- **必填**：否

vendor（缺省 proteus）

### `targets.harmony.versionName`

- **类型**：`string`
- **必填**：否

versionName（缺省回退 app.version）

### `targets.harmony.versionCode`

- **类型**：`number`
- **必填**：否

versionCode（正整数；缺省回退 app.buildNumber）

### `targets.harmony.compatibleSdkVersion`

- **类型**：`string`
- **必填**：否

compatibleSdkVersion（如 "5.0.5(17)"；缺省 5.0.5(17)）

### `targets.harmony.targetSdkVersion`

- **类型**：`string`
- **必填**：否

targetSdkVersion（缺省同 compatibleSdkVersion）

### `targets.harmony.deviceTypes`

- **类型**：`string[]`
- **必填**：否

deviceTypes（缺省 ["phone","tablet","2in1"]）

### `targets.harmony.permissions`

- **类型**：`Array<string | HarmonyPermission>`
- **必填**：否

追加 requestPermissions（module.json5）——字符串简写 = 仅 name；结构化条目可带 `reason` + `usedScene` （★用户授权权限必需——reason 写普通文案则框架自动生成 `$string:` 资源并写入 entry 三语言 string.json）

### `targets.harmony.permissions.<entry>.name`

- **类型**：`string`
- **必填**：是

权限全名（如 `ohos.permission.INTERNET` / `ohos.permission.LOCATION`）

### `targets.harmony.permissions.<entry>.reason`

- **类型**：`string`
- **必填**：否

申请原因（★用户授权权限必需）：写**普通文案**则框架自动生成 `$string:` 资源（写入 entry 三语言 string.json）； 写 `$string:xxx` 则按资源引用原样使用（须自备该资源）

### `targets.harmony.permissions.<entry>.usedScene`

- **类型**：`{ abilities?: string[] when?: 'inuse' | 'always' }`
- **必填**：否

使用场景（★用户授权权限必需）

### `targets.harmony.permissions.<entry>.usedScene.abilities`

- **类型**：`string[]`
- **必填**：否

关联 Ability（缺省 = 入口 `EntryAbility`）

### `targets.harmony.permissions.<entry>.usedScene.when`

- **类型**：`'inuse' | 'always'`
- **必填**：否

使用时机：`'inuse'`（使用时，缺省）| `'always'`（始终）

### `targets.harmony.icon`

- **类型**：`string`
- **必填**：否

应用图标（app.json5 的 icon，如 `$media:my_icon`——资源置于 AppScope 的 resources 下 media/ 目录；缺省不写）

### `targets.harmony.appCategory`

- **类型**：`string`
- **必填**：否

应用类别（app.json5 的 appCategory，如 `game` / `audio`；缺省不写）

### `targets.harmony.orientation`

- **类型**：`string`
- **必填**：否

入口 Ability 方向（module.json5 的 abilities[0].orientation，如 `portrait` / `landscape` / `auto_rotation`；缺省不写）

## 共享身份 app

### `app.name`

- **类型**：`string`
- **必填**：否

应用显示名（缺省回退 app.config 的 app.name）

### `app.version`

- **类型**：`string`
- **必填**：否

版本号（语义化；缺省回退 app.config 的 app.version）

### `app.buildNumber`

- **类型**：`string | number`
- **必填**：否

构建号（缺省回退 app.config 的 app.buildNumber）

<!-- generated by website/scripts/gen-config-ref.mjs · SSOT：packages/types/src/config.ts（ProteusConfig + 目标端接口） -->
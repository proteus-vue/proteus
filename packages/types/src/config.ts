// packages/types/src/config.ts
// ★类型收口（10-type-consolidation）：ProteusConfig（原 @proteus-vue/plugin-vite/src/config.ts 的 interface）
// runtime 值（defineConfig 等助手）留 @proteus-vue/plugin-vite
// ★#421：vite 字段类型 = vite 官方 UserConfig（仅类型 import——vite 为本包类型依赖，零运行时）
// ★★★2026-10-08 配置模型 v4（决策 #641）：**按端分区**——目标端 = 键（web/mp/ios/android/harmony），
//   小程序专属字段（appid/renderer/样式换算/setDataBridge/… ）收进 `targets.mp`，原生工程身份进 `targets.<端>`。
//   去掉了小程序时代的 `platform: 'mp-weixin'|'web'` 二选一（目标端真源 = CLI --target）；
//   跨端共享面（pagesDir/router/budget/vite/audit/gates/compiler/layout/app）留顶层。
//   消费方一律经 `resolveProteusConfig`（迁移 + 默认值归一）读取——**禁止裸读原始 config 字段**。
import type { UserConfig } from 'vite'
import type { TransformRuleOverrides } from './compiler-types'
import type { RouteMeta } from './router-types'
// ★单一来源（铁律 #9）：router 段形状以 RouterSection 为准——本文件**不再**内联第二份定义
//   （此前内联版漏带 `pages`，直到 vue-tsc 把 examples/proteus.config.ts 拦下才被发现）
import type { RouterSection } from './router-config'

export interface ViteConfigContext {
  command: 'serve' | 'build'
  mode: string
}

/** vite 官方配置别名（ProteusConfig.vite 字段语义） */
export type ViteUserConfig = UserConfig

/** ★G-29 编译器后端选择（compiler-backend-1-plan §5「切换方式」）：'node' 默认；'rust' → 构建内双编译语义等价校验 */
export type CompilerBackend = 'node' | 'rust'

// ============ ★#447 D-2 dogfooding 门禁规则（05-dogfooding-conformance D-2 机器化，CLI `audit d2` 消费） ============

/** D-2 门禁规则 id（缺省全部 error——关/降级在审计报告明示，PASS = 启用规则集零违规） */
export const AUDIT_RULE_IDS = ['no-third-party-ui', 'no-media-query', 'no-platform-api', 'no-web-platform-api'] as const
export type AuditRuleId = (typeof AUDIT_RULE_IDS)[number]

/** 规则级别：error = 违规阻断（默认）· warn = 报告不阻断 · off = 不启用 */
export const AUDIT_SEVERITIES = ['off', 'warn', 'error'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

/** ★#447 配置 audit 字段（开发者自选 D-2 规则——rules 未列出的规则沿用默认 error，防静默关闭） */
export interface AuditConfig {
  /** 被审计页面目录（相对工程根；缺省 src——对齐 pagesDir 扫描语义） */
  dir?: string
  /** 规则门禁：缺省 'error'（列出的规则改级别；未列 = error） */
  rules?: Partial<Record<AuditRuleId, AuditSeverity>>
}

/** ★#456 统一门禁开关（Gate 注册表单一来源的 config 消费面——开发者自选启用集） */
export interface GatesConfig {
  /** 禁用的门禁/聚合域 id 列表（值域 = CLI `proteus gate ls` 目录 + 聚合域 route/module/config/i18n/capabilities/components/d2/devtools-budget 与 css/style/router/cli/app-config；缺省全部启用） */
  disabled?: string[]
}

/* ================= ★★★ 目标端（v4 按端分区） =================
 *
 * 【为什么按端分区（决策 #641 · 用户 2026-10-08）】旧模型把小程序/Skyline 专属字段平铺在**顶层**
 *   （`skyline` / `appid` / `setDataBridge` / `style.px2rpx` / `page` / `globalStyle` / `rules` …）——
 *   那是「小程序编译器」时代的形状，与「一份源码、多端承载」的定位不符；且 `platform: 'mp-weixin'|'web'`
 *   二选一根本表达不了 App 三端。
 *   ⇒ 目标端成为**一级键**：`targets.web / targets.mp / targets.ios / targets.android / targets.harmony`
 *     （键 = 具体平台名，去「微信」化；与 CLI `--target` 同一套具体平台命名）。
 *   · 每个端拥有**自己的全部配置**（含原生工程身份）——不再有跨端漂移的顶层 MP 字段；
 *   · **跨端共享**的部分（pagesDir / router / budget / vite / audit / gates / compiler / layout / app 身份）
 *     留在顶层（重复三遍反而更糟，见各自注释）。
 */

/** 共享应用身份（各端缺省回退；可被端侧覆盖）——构建期写入原生工程文件的 name/version/buildNumber */
export interface AppIdentityConfig {
  /** 应用显示名（缺省回退 app.config 的 app.name） */
  name?: string
  /** 版本号（语义化；缺省回退 app.config 的 app.version） */
  version?: string
  /** 构建号（缺省回退 app.config 的 app.buildNumber） */
  buildNumber?: string | number
}

/** Web 目标（浏览器 SPA） */
export interface WebTargetConfig {
  /** 构建产物输出目录（缺省由框架推导 dist/web） */
  output?: string
}

/**
 * 微信小程序目标（`targets.mp`）——Skyline / WebView 同一构建管线。
 * ★旧顶层小程序字段（appid / skyline / skylineLayout / profileBoundary / setDataBridge /
 *   style.px2rpx·rpxRatio / globalStyle / page / rules）全部收此。
 */
export interface MpTargetConfig {
  /** 小程序 AppID（构建期写 project.config.json / IDE 导入 / automator 体检）。**≠ app.config 的 app.id**（运行时标识） */
  appid: string
  /** 渲染器（★取代旧顶层 `skyline: boolean`）：`'skyline'`（默认）| `'webview'` */
  renderer?: 'skyline' | 'webview'
  /** 样式换算（MP 专属；Web 端永不换算——Web 保持标准 CSS，由编译器吸收差异） */
  style?: {
    /** px → rpx 转换开关（缺省 true） */
    px2rpx?: boolean
    /** 换算比例（缺省按 375 设计稿 2:1） */
    rpxRatio?: number
  }
  /** 响应式 → setData 桥接策略 */
  setDataBridge?: {
    /** 合并窗口（ms，缺省 16——约 1 帧） */
    batchWindow?: number
    /** 是否按组件粒度 setData（缺省 true） */
    perComponent?: boolean
  }
  /** ★全局样式（MP 端唯一全局入口）：相对 root 的 CSS 文件路径（缺省探测根/应用目录的 app.wxss）。构建期编译（px→rpx）后产出产物根 app.wxss（微信自动生效）；Web 端同一文件在入口 import（单源）。 */
  globalStyle?: string
  /** 页面模式（Skyline 页面本身不滚动） */
  page?: {
    /** 页面自动包滚动容器（缺省 true——Skyline 页面滚动必须 scroll-view） */
    autoScrollContainer?: boolean
    /** ★Skyline iOS 白屏兜底：列出白屏高风险页，强制走 WebView 渲染（页面级降级，不全局） */
    webviewPages?: string[]
  }
  /** ★Skyline 布局对齐开关（消费官方《Skyline WXSS 样式支持与差异》对齐表）。
   *  仅 `defaultDisplayBlock` 默认 true（本仓真机验证过）；其余默认**不注入**（未验证的开关不由框架替项目做主）。 */
  skylineLayout?: {
    defaultDisplayBlock?: boolean
    defaultContentBox?: boolean
    tagNameStyleIsolation?: boolean
    enableScrollViewAutoSize?: boolean
    keyframeStyleIsolation?: boolean
  }
  /** ★VC2-b 编译期 Profile 边界校验（使用了某端不支持的样式即报；Web 端构建同样执行）。escape hatch：样式块内注释 `proteus-allow-profile: <理由>`。 */
  profileBoundary?: {
    level?: 'error' | 'warn' | 'off'
  }
  /** ★底线循环 ①③：规则覆盖（AI/config 改写或禁用规则） */
  rules?: TransformRuleOverrides
}

/** iOS 目标（→ Info.plist） */
export interface IosTargetConfig {
  /** CFBundleIdentifier（缺省 = 宿主默认 bundle id，见宿主工程 / proteus.host.json） */
  bundleId?: string
  /** CFBundleDisplayName（缺省回退 app.name / targets.app.name） */
  displayName?: string
  /** CFBundleShortVersionString（缺省回退 app.version） */
  version?: string
  /** CFBundleVersion（缺省回退 app.buildNumber） */
  buildNumber?: string
  /** MinimumOSVersion（缺省 15.0） */
  minimumOSVersion?: string
  /** UIDeviceFamily（1=iPhone / 2=iPad；缺省 [1]） */
  deviceFamily?: number[]
  /** 支持的方向（缺省 [portrait]） */
  orientations?: Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>
  /** 起始页名（Info.plist 的 ProteusHomePage；缺省 index）——宿主启动时渲染该屏 */
  launchPage?: string
  /** UIUserInterfaceStyle（界面明暗：`'light'` / `'dark'` / `'automatic'`；缺省不写 = 系统） */
  userInterfaceStyle?: 'light' | 'dark' | 'automatic'
  /** UIStatusBarStyle（状态栏样式，如 `UIStatusBarStyleLightContent`；缺省不写） */
  statusBarStyle?: string
  /** UIStatusBarHidden（隐藏状态栏；缺省不写） */
  statusBarHidden?: boolean
  /** URL scheme 白名单（CFBundleURLTypes）——注册深链/被其他 App 拉起（如 `['myapp']` → `myapp://…`） */
  urlSchemes?: string[]
  /** 隐私用途说明（NSXxxUsageDescription）——★上架必需：key 为完整 plist 键名（如 `NSCameraUsageDescription`），value 为面向用户的用途字符串 */
  privacyUsageDescriptions?: Record<string, string>
  /** 应用类别（LSApplicationCategoryType，如 `public.app-category.games`；缺省不写） */
  appCategory?: string
  /** App Transport Security（NSAppTransportSecurity）——放宽 ATS（如允许明文 HTTP 联调；缺省不写） */
  appTransportSecurity?: {
    /** NSAllowsArbitraryLoads（允许任意明文 HTTP；★上架需说明理由，仅联调建议开启） */
    allowArbitraryLoads?: boolean
    /** NSAllowsLocalNetworking（允许本地网络明文——iOS 10+，比 arbitrary 更窄） */
    allowLocalNetworking?: boolean
  }
  /** UIRequiresFullScreen（iPad 要求全屏、禁用分屏；缺省不写） */
  requiresFullScreen?: boolean
  /** CFBundleDevelopmentRegion（缺省开发语言，如 `zh_CN` / `en`；缺省不写） */
  developmentRegion?: string
}

/** Android 权限条目（`permissions` 数组元素——字符串简写 = 仅 name） */
export interface AndroidPermission {
  /** 权限全名（如 `android.permission.CAMERA`） */
  name: string
  /** android:maxSdkVersion——该权限仅对 ≤ 此 API level 生效（如存储权限在 Android 13+ 已废弃） */
  maxSdkVersion?: number
}

/** Android 硬件/功能特性（`<uses-feature>`）——如 `android.hardware.camera`（字符串简写 = required: true） */
export interface AndroidUsesFeature {
  /** 特性名（如 `android.hardware.camera` / `android.hardware.location.gps`） */
  name: string
  /** android:required（缺省 true——不满足则应用商店过滤该设备） */
  required?: boolean
}

/** Harmony 权限条目（`permissions` 数组元素——字符串简写 = 仅 name）。
 *  ★**用户授权权限（user_grant）必须声明 `reason` + `usedScene`**，否则上架/授权会被拒。 */
export interface HarmonyPermission {
  /** 权限全名（如 `ohos.permission.INTERNET` / `ohos.permission.LOCATION`） */
  name: string
  /** 申请原因（★用户授权权限必需）：写**普通文案**则框架自动生成 `$string:` 资源（写入 entry 三语言 string.json）；
   *  写 `$string:xxx` 则按资源引用原样使用（须自备该资源） */
  reason?: string
  /** 使用场景（★用户授权权限必需） */
  usedScene?: {
    /** 关联 Ability（缺省 = 入口 `EntryAbility`） */
    abilities?: string[]
    /** 使用时机：`'inuse'`（使用时，缺省）| `'always'`（始终） */
    when?: 'inuse' | 'always'
  }
}

/** Android 目标（→ AndroidManifest.xml） */
export interface AndroidTargetConfig {
  /** applicationId / package（缺省 = 宿主运行时同包 dev.proteus.layoutcore，保证同包访问） */
  applicationId?: string
  /** 桌面/应用名（android:label；缺省回退 app.name） */
  label?: string
  /** versionName（缺省回退 app.version） */
  versionName?: string
  /** versionCode（正整数；缺省回退 app.buildNumber） */
  versionCode?: number
  /** minSdkVersion（缺省 24） */
  minSdk?: number
  /** targetSdkVersion（缺省 34） */
  targetSdk?: number
  /** 屏幕方向（activity android:screenOrientation；缺省 unspecified） */
  orientation?: 'portrait' | 'landscape' | 'unspecified'
  /** 权限声明（`<uses-permission>`）——字符串简写 = 仅 name；结构化条目可带 `maxSdkVersion` */
  permissions?: Array<string | AndroidPermission>
  /** 硬件/功能特性（`<uses-feature>`）——字符串简写 = required: true */
  usesFeatures?: Array<string | AndroidUsesFeature>
  /** 包可见性（`<queries>` 的 `<package>`——Android 11+ 查询/拉起其他应用前需声明） */
  queryPackages?: string[]
  /** 应用图标资源名（android:icon；缺省不写） */
  icon?: string
  /** 起始页名（manifest 的 ProteusHomePage meta-data；缺省 index）——宿主启动时渲染该屏 */
  launchPage?: string
  /** 应用主题（application android:theme，如 `@android:style/Theme.NoTitleBar.Fullscreen`；缺省不写） */
  theme?: string
  /** android:allowBackup（允许 adb/云备份；缺省不写 = 平台默认 true） */
  allowBackup?: boolean
  /** android:largeHeap（申请大堆——大图/大列表场景；缺省不写） */
  largeHeap?: boolean
  /** android:hardwareAccelerated（硬件加速；缺省不写 = 平台默认 true） */
  hardwareAccelerated?: boolean
  /** android:supportsRtl（RTL 布局支持；缺省不写） */
  supportsRtl?: boolean
  /** android:usesCleartextTraffic（允许明文 HTTP——本地/内网联调常需；缺省不写） */
  usesCleartextTraffic?: boolean
  /** android:networkSecurityConfig（网络安全配置资源引用，如 `@xml/network_security_config`；缺省不写） */
  networkSecurityConfig?: string
  /** android:appCategory（应用类别，如 `game` / `audio`；缺省不写） */
  appCategory?: string
}

/** Harmony 目标（→ AppScope/app.json5 + entry/module.json5 + string.json） */
export interface HarmonyTargetConfig {
  /** bundleName（缺省 = 宿主默认，见宿主 app.json5）——也是**签名绑定**的键（换它要换 profile） */
  bundleName?: string
  /** 应用名（$string:app_name 的值；缺省回退 app.name） */
  label?: string
  /** vendor（缺省 proteus） */
  vendor?: string
  /** versionName（缺省回退 app.version） */
  versionName?: string
  /** versionCode（正整数；缺省回退 app.buildNumber） */
  versionCode?: number
  /** compatibleSdkVersion（如 "5.0.5(17)"；缺省 5.0.5(17)） */
  compatibleSdkVersion?: string
  /** targetSdkVersion（缺省同 compatibleSdkVersion） */
  targetSdkVersion?: string
  /** deviceTypes（缺省 ["phone","tablet","2in1"]） */
  deviceTypes?: string[]
  /** 追加 requestPermissions（module.json5）——字符串简写 = 仅 name；结构化条目可带 `reason` + `usedScene`
   *  （★用户授权权限必需——reason 写普通文案则框架自动生成 `$string:` 资源并写入 entry 三语言 string.json） */
  permissions?: Array<string | HarmonyPermission>
  /** 应用图标（app.json5 的 icon，如 `$media:my_icon`——资源置于 AppScope 的 resources 下 media/ 目录；缺省不写） */
  icon?: string
  /** 应用类别（app.json5 的 appCategory，如 `game` / `audio`；缺省不写） */
  appCategory?: string
  /** 入口 Ability 方向（module.json5 的 abilities[0].orientation，如 `portrait` / `landscape` / `auto_rotation`；缺省不写） */
  orientation?: string
}

/** 目标端集合（键 = 具体平台名；至少声明一个） */
export interface ProteusTargets {
  web?: WebTargetConfig
  mp?: MpTargetConfig
  ios?: IosTargetConfig
  android?: AndroidTargetConfig
  harmony?: HarmonyTargetConfig
}

/** 目标端名（具体平台；与 CLI 具体平台命名一致） */
export type ProteusTargetName = 'web' | 'mp' | 'ios' | 'android' | 'harmony'

export interface ProteusConfig {
  /** 配置 schema 版本（v4 起为 4；缺省视为当前形态——显式声明且 <4 时加载期自动迁移） */
  version?: number
  /** ★目标端配置（按端分区）——至少声明一个端；键 = web / mp / ios / android / harmony */
  targets: ProteusTargets
  /** 页面根目录（主包路由扫描起点）——**跨端共享** */
  pagesDir: string
  /**
   * ★共享应用身份（构建期写进各端原生工程文件；缺省可由 app.config 的 app.* 回退）。
   *   留在跨端层是刻意的——同一身份重复写进三端配置文件更易漂移；各端可覆盖（targets.<端>.label/version…）。
   *   与 app.config 的 app.* 边界（G-35.1）：此处 = **构建期**（CLI 消费，写原生文件）；app.config = **运行期**（业务读取）。
   */
  app?: AppIdentityConfig
  /**
   * ★#492 项目级路由管理（统一路由配置面——跨端共享）：
   *   routesOutput / subPackages / customRoute / tabBar / pages 全在此；
   *   消费方（gen-routes / app 骨架）经 resolveRouterConfig() 取生效配置——禁止散读。
   */
  router?: RouterSection
  /** ★G-29 编译器后端插拔（缺省 node 零开销；'rust' → 每次构建跑 Node/Rust 双编译语义等价校验） */
  compiler?: {
    backend?: CompilerBackend
  }
  /** ★G-22 柔性布局（fluid-layout-plan）：p-fluid 编译期 clamp 生成参数——**跨端共享**（Web/MP/App 同一设计基准） */
  layout?: {
    designWidth?: number
    fluidViewport?: { min?: number; max?: number }
  }
  /** 包体积预算 */
  budget?: {
    mainPackageKB: number
    strict: boolean
  }
  /** ★#418/★#421 vite 透传（配置收敛——开发者不写 vite.config.ts） */
  vite?: ViteUserConfig | ((ctx: ViteConfigContext) => ViteUserConfig | void | Promise<ViteUserConfig | void>)
  /** ★#447 D-2 dogfooding 门禁（页面不裸写平台 API / 手写 @media / 引第三方 UI；规则级可配 off/warn/error） */
  audit?: AuditConfig
  /** ★#456 统一门禁开关（gates.disabled：自选关闭门禁/聚合域） */
  gates?: GatesConfig
}

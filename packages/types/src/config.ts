// packages/types/src/config.ts
// ★类型收口（10-type-consolidation）：ProteusConfig（原 @proteus-vue/plugin-vite/src/config.ts 的 interface）
// runtime 值（defineConfig 等助手）留 @proteus-vue/plugin-vite
// ★#421：vite 字段类型 = vite 官方 UserConfig（仅类型 import——vite 为本包类型依赖，零运行时）
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

/* ================= ★★★原生项目配置（`native` 段 · 决策 #635） =================
 *
 * 【它解决什么（用户 2026-10-08）】「app.config 没有完整的平台项目配置……无法把项目的这些
 *   传递到构建链」。此前**原生项目身份**（包名/Bundle ID/版本/SDK/方向/权限/图标）**硬编码**
 *   在各宿主工程文件里（AndroidManifest.xml / Info.plist / AppScope/app.json5 / module.json5），
 *   项目侧只能手改宿主——`proteus build --target <端> --package` 也从不注入这些值。
 *   ⇒ 在**构建期**配置面（`proteus.config`，按 G-35.1「proteus.config=构建期」）新增 `native` 段，
 *     由 CLI **渲染进**宿主工程的原生项目文件，再走平台工具链打包。
 *
 * 【与 app.config 的边界（决策 #635）】`native` = **构建期**（CLI/工具链消费，写进原生工程文件）；
 *   app.config 的 `app.name/version/buildNumber` = **运行时**（业务读取/上报）。二者可互为镜像，
 *   但**不改职责边界**：需要进原生工程的，写这里；运行期展示的，写 app.config。缺省缺值时，
 *   CLI 回退读取 `app.config.ts` 的 `app.*`（减少重复声明）。
 */
export interface NativeAppConfig {
  /** 应用显示名（缺省回退 app.config 的 app.name） */
  name?: string
  /** 版本号（语义化；缺省回退 app.config 的 app.version） */
  version?: string
  /** 构建号（缺省回退 app.config 的 app.buildNumber） */
  buildNumber?: string | number
}

/** Android 原生项目配置（→ AndroidManifest.xml） */
export interface NativeAndroidConfig {
  /** applicationId / package（缺省 = 宿主运行时同包 dev.proteus.layoutcore，保证同包访问） */
  applicationId?: string
  /** 桌面/应用名（android:label；缺省回退 native.app.name） */
  label?: string
  /** versionName（缺省回退 native.app.version） */
  versionName?: string
  /** versionCode（正整数；缺省回退 native.app.buildNumber） */
  versionCode?: number
  /** minSdkVersion（缺省 24） */
  minSdk?: number
  /** targetSdkVersion（缺省 34） */
  targetSdk?: number
  /** 屏幕方向（activity android:screenOrientation；缺省 unspecified） */
  orientation?: 'portrait' | 'landscape' | 'unspecified'
  /** 追加 <uses-permission android:name="..."/>（缺省空） */
  permissions?: string[]
  /** 应用图标资源名（android:icon；缺省不写） */
  icon?: string
}

/** iOS 原生项目配置（→ Info.plist） */
export interface NativeIosConfig {
  /** CFBundleIdentifier（缺省 = 宿主默认 bundle id，见宿主工程 / proteus.host.json） */
  bundleId?: string
  /** CFBundleDisplayName（缺省回退 native.app.name） */
  displayName?: string
  /** CFBundleShortVersionString（缺省回退 native.app.version） */
  version?: string
  /** CFBundleVersion（缺省回退 native.app.buildNumber） */
  buildNumber?: string
  /** MinimumOSVersion（缺省 15.0） */
  minimumOSVersion?: string
  /** UIDeviceFamily（1=iPhone / 2=iPad；缺省 [1]） */
  deviceFamily?: number[]
  /** 支持的方向（缺省 [portrait]） */
  orientations?: Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>
}

/** Harmony 原生项目配置（→ AppScope/app.json5 + entry/module.json5 + string.json） */
export interface NativeHarmonyConfig {
  /** bundleName（缺省 = 宿主默认，见宿主 app.json5） */
  bundleName?: string
  /** 应用名（$string:app_name 的值；缺省回退 native.app.name） */
  label?: string
  /** vendor（缺省 proteus） */
  vendor?: string
  /** versionName（缺省回退 native.app.version） */
  versionName?: string
  /** versionCode（正整数；缺省回退 native.app.buildNumber） */
  versionCode?: number
  /** compatibleSdkVersion（如 "5.0.5(17)"；缺省 5.0.5(17)） */
  compatibleSdkVersion?: string
  /** targetSdkVersion（缺省同 compatibleSdkVersion） */
  targetSdkVersion?: string
  /** deviceTypes（缺省 ["phone","tablet","2in1"]） */
  deviceTypes?: string[]
  /** 追加 requestPermissions（module.json5） */
  permissions?: string[]
}

/** 原生项目配置（构建期——CLI 渲染进三端原生工程文件） */
export interface NativeProjectConfig {
  /** 三端共享的应用身份（name/version/buildNumber） */
  app?: NativeAppConfig
  android?: NativeAndroidConfig
  ios?: NativeIosConfig
  harmony?: NativeHarmonyConfig
}

export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** ★G-29 编译器后端插拔：backend 选 'rust' 时，构建（proteus build / build:mp）对每个 .vue 跑 Node/Rust
   *  双编译语义等价校验（G-29.1）——不一致构建红；产物仍由 Node 引擎生成（阶段定位，产物级 Rust codegen 后续批次）
   *  缺省 'node'（不校验——零开销）；CLI 可用 `proteus build --compiler rust` 临时覆盖 */
  compiler?: {
    backend?: CompilerBackend
  }
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /**
   * ★Skyline 布局对齐（VC2-c：消费官方《Skyline WXSS 样式支持与差异》的 5 个对齐开关
   *   ——版本要求见 docs/generated/css-capability-alignment.json 的 profile.skylineAlignSwitches）。
   *
   * 各开关语义与最低版本（Android/iOS/基础库）：
   *   · defaultDisplayBlock      默认 block 布局，对齐 WebView      8.0.34/8.0.36/2.31.1（**默认 true**）
   *   · defaultContentBox        默认 content-box 盒模型，对齐 Web   8.0.42/8.0.42/3.1.0
   *   · tagNameStyleIsolation    tag 选择器全局匹配，对齐 WebView    8.0.51/8.0.51/3.6.0
   *   · enableScrollViewAutoSize scroll-view 自动撑开               8.0.54/8.0.54/3.7.2
   *   · keyframeStyleIsolation   @keyframes 样式全局共享             8.0.57/8.0.57/3.8.0
   *
   * ★默认策略（产物中如实记录实际取值，见构建期 skyline-options 记录）：
   *   只有 defaultDisplayBlock 默认 true（本仓 2026-08 真机验证过）；其余默认 **不注入**
   *   （保守：未在本仓验证过的开关不由框架替项目做主，避免静默改变布局/样式语义）。
   *   ★已知限制：tagNameStyleIsolation 在开发者工具校验被拒（本仓 2026-09 实测）——
   *     显式开启会构建失败，属平台限制，注释保留。
   */
  skylineLayout?: {
    defaultDisplayBlock?: boolean
    defaultContentBox?: boolean
    tagNameStyleIsolation?: boolean
    enableScrollViewAutoSize?: boolean
    keyframeStyleIsolation?: boolean
  }
  /**
   * ★VC2-b：Profile 边界校验（编译期静态校验——「使用了某端不支持的样式」报错）。
   *   数据源：《Skyline WXSS 样式支持与差异》官方属性表的纯枚举 formats（生成物见
   *   `packages/css-compat/src/generated/skyline-boundary-rules.generated.ts`）。
   *   默认 `'error'`（阻断构建——**Web 端构建同样执行**，卡片硬性要求：否则问题延迟到 App 端暴露）。
   *   escape hatch：样式块内注释 `proteus-allow-profile: <理由>`（理由非空才生效；豁免计入统计）。
   */
  profileBoundary?: {
    level?: 'error' | 'warn' | 'off'
  }
  /** ★G-22 柔性布局（fluid-layout-plan）：p-fluid 编译期 clamp 生成参数（构建期配置——编译需要，运行期由 app-config 覆盖 Web 端） */
  layout?: {
    designWidth?: number
    fluidViewport?: { min?: number; max?: number }
  }
  /** 小程序 AppID——★平台编译标识（构建期写 project.config.json / IDE 导入 / automator 体检）
   *  ★决策 #211 职责边界：区别于 app.config.ts 的 app.id（应用运行时标识）——appid 是构建期消费，必须在此 */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成）
   *  ★#492 已收编 router 段（router.routesOutput）——顶层写法保留为向后兼容别名，建议统一到 router 段（项目级路由管理） */
  routesOutput?: string
  /** 分包配置（可选）
   *  ★#492 已收编 router 段（router.subPackages）——顶层写法保留为向后兼容别名，建议统一到 router 段 */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置
   *  ★#492 已收编 router 段（router.customRoute）——顶层写法保留为向后兼容别名，建议统一到 router 段 */
  customRoute?: {
    registerPresets?: boolean
    /** 内置预设 builders 注册表：name → 预设源码文件 */
    builders?: Record<string, string>
  }
  /** ★底线循环 ①③：规则覆盖（AI/config 改写或禁用规则） */
  rules?: TransformRuleOverrides
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    batchWindow: number
    perComponent: boolean
  }
  /** 样式换算策略 */
  style: {
    px2rpx: boolean
    rpxRatio: number
  }
  /** ★全局样式（MP 端唯一全局样式入口）：相对 root 的 CSS 文件路径（缺省探测根/应用目录的 app.wxss）。
   *  构建期编译（px→rpx）后产出产物根 `app.wxss`（微信自动全局生效）——用于设计 token / 全局重置；
   *  Web 端同一文件在入口 import（单源）。页面级 wxss 各自 scoped，变量无法跨页继承，故需此全局通道。 */
  globalStyle?: string
  /** ★15-page-scroll-container：页面模式自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view；默认 true） */
  page?: {
    autoScrollContainer?: boolean
    /** ★Skyline iOS 白屏兜底（roadmap v0.5 对策② · 页面级降级通道）：
     *  指定页面（页面名，如 'home' / 'list' 或 'pages/home'）强制走 WebView 渲染（page.json renderer 不写 skyline），
     *  仅对 Skyline 白屏高风险页启用——不全局降级。为空/未设 → 全站随 config.skyline。 */
    webviewPages?: string[]
  }
  /** 包体积预算 */
  budget?: {
    mainPackageKB: number
    strict: boolean
  }
  /** ★#492 项目级路由管理（统一路由配置面——路由相关配置唯一声明处）：
   *  结构（routesOutput/subPackages/customRoute）+ tabBar + 页面配置（pages）全部在此；
   *  顶层三字段为向后兼容别名，双处同时声明时 router.* 优先（config:check 提示收敛）。
   *  消费方（gen-routes / app 骨架）经 resolveRouterConfig() 取生效配置——禁止散读顶层字段 */
  router?: RouterSection
  /** ★#418/★#421 vite 透传（配置收敛——开发者不写 vite.config.ts）：
   *   框架用 resolveProteusViteConfig 组装 vite 配置（vue/mpTransform/别名/构建参数全内置），
   *   本字段做开发者扩展——**类型即 vite 官方 UserConfig**（plugins/server/resolve/build…全兼容）：
   *   对象形态直接给；函数形态 (ctx) => 对象（ctx 携带 command/mode，async 可用——module manualChunks 场景）。
   *   合并语义：plugins 追加在框架插件后、resolve.alias 拼接保框架 @、define/build 深合并。
   *   类型依赖：@proteus-vue/types 依赖 vite（仅类型引用，零运行时） */
  vite?: ViteUserConfig | ((ctx: ViteConfigContext) => ViteUserConfig | void | Promise<ViteUserConfig | void>)
  /** ★#447 D-2 dogfooding 门禁（05-dogfooding-conformance D-2）：页面不裸写平台 API / 手写 @media / 引第三方 UI
   *   规则级可配（off/warn/error——缺省全部 error）；消费者：CLI `proteus audit d2`（★#448 官网/开发者双场景单引擎） */
  audit?: AuditConfig
  /** ★#456 统一门禁开关（gates.disabled：自选关闭门禁/聚合域——check/audit all/gate run 统一生效；缺省全部启用） */
  gates?: GatesConfig
  /** ★★★原生项目配置（`native` 段 · 决策 #635）：包名/Bundle ID/版本/SDK/方向/权限/图标——
   *   由 CLI（`create host` / `build --target <端> --package`）**渲染进**宿主工程的原生项目文件。
   *   构建期消费（区别于 app.config 的运行期职责，G-35.1）；缺省值回退 app.config 的 app.*。 */
  native?: NativeProjectConfig
}

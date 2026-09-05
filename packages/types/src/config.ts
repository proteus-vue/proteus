// packages/types/src/config.ts
// ★类型收口（10-type-consolidation）：ProteusConfig（原 @proteus-vue/plugin-vite/src/config.ts 的 interface）
// runtime 值（defineConfig 等助手）留 @proteus-vue/plugin-vite
// ★#421：vite 字段类型 = vite 官方 UserConfig（仅类型 import——vite 为本包类型依赖，零运行时）
import type { UserConfig } from 'vite'
import type { TransformRuleOverrides } from './compiler-types'
import type { RouteMeta } from './router-types'

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
  /** ★Skyline 布局对齐（2026-08 真机实测：Skyline 节点默认 flex 布局——switch/slider/icon 等表单元素被 stretch 占满一行且居中，
   *   与 WebView/Web 块级布局不一致——默认开启 defaultDisplayBlock（Skyline 官方对齐方案） */
  skylineLayout?: {
    defaultDisplayBlock?: boolean
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
  /** 路由输出文件（编译期生成） */
  routesOutput: string
  /** 分包配置（可选） */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    registerPresets: boolean
    /** 内置预设 builders 注册表：name → 预设源码文件 */
    builders: Record<string, string>
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
  /** ★15-page-scroll-container：页面模式自动包滚动容器（Skyline 页面本身不滚动，滚动必须 scroll-view；默认 true） */
  page?: {
    autoScrollContainer?: boolean
  }
  /** 包体积预算 */
  budget?: {
    mainPackageKB: number
    strict: boolean
  }
  /** 路由通用配置（tabBar 唯一声明源 / 集中式 meta） */
  router?: {
    tabBar?: {
      color?: string
      selectedColor?: string
      list: Array<{ name: string; text: string; icon?: string }>
    }
    /** 集中式 meta（决策 #113）：精确路径 > 目录前缀 > 默认 */
    meta?: Record<string, RouteMeta>
  }
  /** ★#418/★#421 vite 透传（配置收敛——开发者不写 vite.config.ts）：
   *   框架用 resolveProteusViteConfig 组装 vite 配置（vue/mpTransform/别名/构建参数全内置），
   *   本字段做开发者扩展——**类型即 vite 官方 UserConfig**（plugins/server/resolve/build…全兼容）：
   *   对象形态直接给；函数形态 (ctx) => 对象（ctx 携带 command/mode，async 可用——module manualChunks 场景）。
   *   合并语义：plugins 追加在框架插件后、resolve.alias 拼接保框架 @、define/build 深合并。
   *   类型依赖：@proteus-vue/types 依赖 vite（仅类型引用，零运行时） */
  vite?: ViteUserConfig | ((ctx: ViteConfigContext) => ViteUserConfig | void | Promise<ViteUserConfig | void>)
  /** ★框架内置组件目录（决策 #115 过渡：组件库未拆包时显式指向共享组件目录；缺省 root/src/components）
   *   ★v2.0 退役：@proteus-vue/components 拆为独立 npm 包后删除 */
  frameworkComponentsDir?: string
  /** ★#447 D-2 dogfooding 门禁（05-dogfooding-conformance D-2）：页面不裸写平台 API / 手写 @media / 引第三方 UI
   *   规则级可配（off/warn/error——缺省全部 error）；消费者：CLI `proteus audit d2`（★#448 官网/开发者双场景单引擎） */
  audit?: AuditConfig
  /** ★#456 统一门禁开关（gates.disabled：自选关闭门禁/聚合域——check/audit all/gate run 统一生效；缺省全部启用） */
  gates?: GatesConfig
}

// packages/types/src/router-config.ts
// ★#492 项目级路由管理：路由相关配置统一收口 router 段（routesOutput/subPackages/customRoute 从顶层收编，
//   与 tabBar/pages 合并成**唯一路由配置面**）。顶层三字段保留为向后兼容别名（router.* 优先），
//   消费方（gen-routes / plugin app 骨架 / bundle-report）一律经本解析器取「生效路由配置」。
// ★★2026-10-02 统一路由页面管理（用户反馈「两份 generated 太乱，应当只有一个路由管理入口」）：
//   · 页面配置首选名 **`router.pages`**（`pages.json` 等价物，一个入口管全端页面）；
//     旧名 `router.meta` 保留为同义别名（双写时 pages 胜并登记 duplicate）。
//   · **单一产物**：gen-routes 只生成 `routesOutput` 一个文件（routes + screens + 类型三投影），
//     原先单独的 App 导航注册表产物（`appNavigationOutput`）已废弃删除。
// 定位：纯函数零依赖（build 期消费——gen-routes/plugin 均在 node 侧）；MP 产物安全风格（无 ?./??/对象展开）
import type { RouteMeta } from './router-types'

/** 分包声明（与顶层 subPackages 同形） */
export interface SubPackageDecl {
  root: string
  name?: string
}

/** wx.router 自定义路由配置（与顶层 customRoute 同形；统一形态下两字段均可选——缺省 registerPresets: true） */
export interface CustomRouteConfig {
  registerPresets?: boolean
  builders?: Record<string, string>
}

/** 统一路由段（proteus.config.ts 的 router 字段——项目级路由管理唯一声明面） */
export interface RouterSection {
  /** 路由表产物路径（编译期 gen-routes 生成；缺省 src/router/auto-routes.ts） */
  routesOutput?: string
  /** 分包配置（各分包独立扫描树） */
  subPackages?: Array<SubPackageDecl>
  /** wx.router 自定义路由（转场 builders） */
  customRoute?: CustomRouteConfig
  /** tabBar 声明（list.name 对应路由名；缺省按 meta.isTab 推导） */
  tabBar?: {
    color?: string
    selectedColor?: string
    list: Array<{ name: string; text: string; icon?: string }>
  }
  /**
   * ★★★**页面配置**（2026-10-02 · 统一路由页面管理 —— `pages.json` 等价物）：
   *   每页的配置集中声明在此（标题 / isTab / 转场 / 登录与权限 / MP 页面窗口扩展 …），
   *   是"一个入口管理全端路由页面"的**核心字段**（对齐 uni-app：一个 pages.json 管全端）。
   *   匹配规则（决策 #113）：**精确页面路径 > 目录前缀 > 默认**；
   *   页面出现次序由 pages/ 目录扫描（约定式）决定——配置不重复声明"有哪些页"。
   *   取值见 `RouteMeta`（`title`/`isTab`/`transition`/`requiresAuth`/`permissions`/`redirectTo`/
   *   `parent`/`pageJson` …）。
   */
  pages?: Record<string, RouteMeta>
  /** 页面配置的**旧名**（与 `pages` 同义；两份都写时 `pages` 胜并登记 duplicate）。建议迁移到 `pages`。 */
  meta?: Record<string, RouteMeta>
}

/** 生效路由配置（解析产出——消费方只读这个形态） */
export interface EffectiveRouterConfig {
  routesOutput: string
  subPackages: Array<SubPackageDecl>
  customRoute: { registerPresets: boolean; builders: Record<string, string> }
  tabBar?: RouterSection['tabBar']
  /** ★页面配置（pages.json 等价物）——`router.pages` 的生效值 */
  pages?: Record<string, RouteMeta>
  /** ★`pages` 的旧名别名（同一对象；仅向后兼容消费方，新代码用 `pages`） */
  meta?: Record<string, RouteMeta>
}

/** routesOutput 缺省值（docs/packages.md 与 gen-routes 文档口径一致） */
export const DEFAULT_ROUTES_OUTPUT = 'src/router/auto-routes.ts'

/** 顶层遗留别名 → router 段字段映射（向后兼容；router.* 显式声明优先） */
const LEGACY_ALIASES: Array<{ legacy: string; unified: keyof RouterSection }> = [
  { legacy: 'routesOutput', unified: 'routesOutput' },
  { legacy: 'subPackages', unified: 'subPackages' },
  { legacy: 'customRoute', unified: 'customRoute' },
]

/**
 * 解析生效路由配置（★#492）：
 * - router.X 显式声明优先；顶层同名字段视为遗留别名（仅在 router.X 未声明时生效）
 * - 双处同时声明 → duplicates 登记该字段名（构建期 console.warn 提示收敛，不阻断）
 * - 缺省值：routesOutput = src/router/auto-routes.ts · customRoute = { registerPresets: true, builders: {} }
 */
export function resolveRouterConfig(config: Record<string, unknown>): { router: EffectiveRouterConfig; duplicates: string[] } {
  const section = (isObj(config) && isObj(config.router) ? config.router : {}) as RouterSection
  const cfg = isObj(config) ? config : {}
  const duplicates: string[] = []

  let routesOutput: string
  if (section.routesOutput !== undefined) {
    routesOutput = section.routesOutput
    if (cfg.routesOutput !== undefined) duplicates.push('routesOutput')
  } else if (cfg.routesOutput !== undefined) {
    routesOutput = cfg.routesOutput as string
  } else {
    routesOutput = DEFAULT_ROUTES_OUTPUT
  }

  // ★★页面配置：`pages`（首选）与 `meta`（旧名）——同义；双写时 pages 胜并登记 duplicate
  let pages: Record<string, RouteMeta> | undefined
  if (section.pages !== undefined) {
    pages = section.pages
    if (section.meta !== undefined) duplicates.push('pages/meta')
  } else {
    pages = section.meta
  }

  let subPackages: Array<SubPackageDecl>
  if (section.subPackages !== undefined) {
    subPackages = section.subPackages
    if (cfg.subPackages !== undefined) duplicates.push('subPackages')
  } else if (cfg.subPackages !== undefined) {
    subPackages = cfg.subPackages as Array<SubPackageDecl>
  } else {
    subPackages = []
  }

  let customRoute: EffectiveRouterConfig['customRoute']
  if (section.customRoute !== undefined) {
    const cr = isObj(section.customRoute) ? section.customRoute : {}
    customRoute = {
      registerPresets: cr.registerPresets !== false,
      builders: (cr.builders as Record<string, string>) ?? {},
    }
    if (cfg.customRoute !== undefined) duplicates.push('customRoute')
  } else if (cfg.customRoute !== undefined) {
    const cr = isObj(cfg.customRoute) ? cfg.customRoute : {}
    customRoute = {
      registerPresets: cr.registerPresets !== false,
      builders: (cr.builders as Record<string, string>) ?? {},
    }
  } else {
    customRoute = { registerPresets: true, builders: {} }
  }

  return {
    router: {
      routesOutput,
      subPackages,
      customRoute,
      tabBar: section.tabBar,
      // ★pages 与 meta 指向**同一对象**（旧消费者读 meta 不破；新代码读 pages）
      pages,
      meta: pages,
    },
    duplicates,
  }
}

/** 顶层遗留别名是否已声明（CLI config:check 迁移提示用） */
export function hasLegacyRouterAliases(config: Record<string, unknown>): string[] {
  if (!isObj(config)) return []
  return LEGACY_ALIASES.filter((a) => config[a.legacy] !== undefined).map((a) => a.legacy)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

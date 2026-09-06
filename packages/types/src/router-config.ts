// packages/types/src/router-config.ts
// ★#492 项目级路由管理：路由相关配置统一收口 router 段（routesOutput/subPackages/customRoute 从顶层收编，
//   与既有 tabBar/meta 合并成唯一路由配置面）。顶层三字段保留为向后兼容别名（router.* 优先），
//   消费方（gen-routes / plugin app 骨架 / bundle-report）一律经本解析器取「生效路由配置」。
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
  /** 集中式 meta（决策 #113）：精确路径 > 目录前缀 > 默认 */
  meta?: Record<string, RouteMeta>
}

/** 生效路由配置（解析产出——消费方只读这个形态） */
export interface EffectiveRouterConfig {
  routesOutput: string
  subPackages: Array<SubPackageDecl>
  customRoute: { registerPresets: boolean; builders: Record<string, string> }
  tabBar?: RouterSection['tabBar']
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
      meta: section.meta,
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

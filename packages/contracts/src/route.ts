// packages/contracts/src/route.ts
// ★types-plan §07 / 架构规约 L0：路由域跨层共享 DTO（RouteTransition/RouteMeta/RouteRecord）
// 收口自 @proteus-vue/types（router-types/index-shared）——单一来源，消除重复定义（铁律 #9）
// ★本包零依赖（纯类型，不 import types 包）——types 侧 re-export 兼容（依赖方向 types → contracts）

/** 转场枚举（webTransitionName / MP routeType 映射共享） */
export type RouteTransition = 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'

/** 路由元信息（<route> meta + 集中式配置合并产物；任意扩展字段仅 JSON 可序列化） */
export interface RouteMeta {
  requiresAuth?: boolean
  /** ★security M3：所需权限（permission = resource:action） */
  permissions?: string[]
  title?: string
  isTab?: boolean
  transition?: RouteTransition
  /** 任意扩展字段（仅 JSON 可序列化） */
  [key: string]: unknown
}

/** 单个路由记录（编译期生成，勿手动编辑） */
export interface RouteRecord {
  /** 命名路由（kebab-case） */
  name: string
  /** 小程序页面路径（相对小程序根目录，含分包 root 前缀） */
  path: string
  /** 对应 .vue 文件路径（相对 src/router/，Web RouterView 加载） */
  component: string
  parent?: string
  meta?: RouteMeta
  /** Skyline 自定义路由 key */
  customRouteKeyName?: string
  /** 所属分包名（主包 undefined） */
  subPackage?: string
  /** 路由参数类型声明 */
  params?: Record<string, string>
  /** ★G-42/官网：仅 Web 路由（MP app.json 不收录 + mpTransform 跳过编译） */
  webOnly?: boolean
  /** ★平台变体·路由门控（2026-09-13，第 4 层）：本路由生效平台白名单（web | mp | native）；
   *  未声明 = 全平台。两端运行时据此过滤（Web RouterView / MP 路由表）。 */
  platforms?: string[]
}

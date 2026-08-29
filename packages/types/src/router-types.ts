// packages/types/src/router-types.ts
// ★类型收口（10-type-consolidation）：路由类型契约（原 @proteus/router/types.ts）
// 模块扩充（RouteParamsByName declare module）仍由应用侧 auto-routes.ts 生成（机制不动）
import type { RouteTransition } from './index-shared'

export type { RouteTransition } from './index-shared'

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
}

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

/**
 * 路由参数类型表：基类为空接口，应用侧 auto-routes.ts 用模块扩充注入具体路由
 * 基类为空 → 无扩充时 keyof = never（name 受限负例成立）
 */
export interface RouteParamsByName {}

/** M1：<route> 块扫描产物（scan.ts） */
export interface RouteBlock {
  loc: { file: string; line: number; column: number }
  path: string
  name?: string
  redirect?: string
  parent?: string
  meta: RouteMeta
  lazy?: boolean
  componentPath: string
  params?: Record<string, string>
  pageJson?: Record<string, unknown>
  customRouteKeyName?: string
  /** ★Router M7.1：页面归属模块分包（与 proteus-module.config.ts chunk 对齐校验） */
  chunk?: string
}

/** M2：嵌套路由树节点（tree.ts） */
export interface RouteNode extends Omit<RouteBlock, 'lazy'> {
  children: RouteNode[]
  lazy: boolean
}

/** M2：全局路由默认值 */
export interface GlobalRouteDefaults {
  meta?: RouteMeta
  lazy?: boolean
}

/** 路由参数（跳转时传入） */
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}

/** 页面 onLoad 参数类型（N = 本页路由名，自动匹配 RouteParamsByName[N]） */
export type PageOnLoad<N extends keyof RouteParamsByName> = RouteParamsByName[N]

/** 路由跳转基础选项 */
export interface BaseNavigateOptions {
  path?: string
  query?: RouteParams
  routeType?: string
  replace?: boolean
  reLaunch?: boolean
  switchTab?: boolean
}

/** 路由跳转选项（name 受限 + params 匹配 RouteParamsByName[N]） */
export type NavigateOptions<N extends keyof RouteParamsByName = keyof RouteParamsByName> = BaseNavigateOptions & {
  name?: N
  params?: RouteParamsByName[N]
}

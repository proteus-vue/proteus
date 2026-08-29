// src/router/types.ts
// 路由类型契约（P2-1）—— 编译期 gen-routes.ts 生成 auto-routes.ts 的类型依据，勿手动编辑

/** 单个路由记录（编译期生成，勿手动编辑） */
export interface RouteRecord {
  /** 命名路由（kebab-case，由文件路径推导） */
  name: string
  /** 小程序页面路径（相对小程序根目录，含分包 root 前缀） */
  path: string
  /** 对应 .vue 文件的路径（相对 src/router/，Web 端 RouterView 据此加载组件） */
  component: string
  /** 父路由 name（用于嵌套路由，同目录 index.vue 存在时推导） */
  parent?: string
  /** 路由元信息 */
  meta?: RouteMeta
  /** Skyline 自定义路由 key（对应 page.json 的 customRouteKeyName） */
  customRouteKeyName?: string
  /** 所属分包名（主包为 undefined） */
  subPackage?: string
  /** 路由参数类型声明（<route> 块 params，类型提示全链路） */
  params?: Record<string, string>
}

export interface RouteMeta {
  /** 是否需要登录 */
  requiresAuth?: boolean
  /** 页面标题 */
  title?: string
  /** 是否为 TabBar 页面 */
  isTab?: boolean
  /** 任意扩展字段 */
  [key: string]: unknown
}

import type { RouteParamsByName } from './auto-routes'

/** 路由参数（跳转时传入） */
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}

/** 路由跳转基础选项（name/params 由 NavigateOptions<N> 泛型覆盖，类型提示全链路步骤 2） */
export interface BaseNavigateOptions {
  /** 页面路径（命名路由优先） */
  path?: string
  /** URL query（与 params 合并） */
  query?: RouteParams
  /** Skyline 自定义路由类型 */
  routeType?: string
  /** 是否替换当前页面（redirectTo） */
  replace?: boolean
  /** 是否重新启动（reLaunch） */
  reLaunch?: boolean
  /** 是否切换 Tab（switchTab，需 isTab=true） */
  switchTab?: boolean
}

/**
 * 路由跳转选项（类型提示全链路步骤 2）：
 * N = 命名路由（字面量推断）——name 受限为路由名 + params 匹配 RouteParamsByName[N]；
 * 未命名（path 跳转）时 N 回退全部路由名 → params 为联合（宽松）
 */
export type NavigateOptions<N extends keyof RouteParamsByName = keyof RouteParamsByName> = BaseNavigateOptions & {
  /** 命名路由（受限为路由名） */
  name?: N
  /** 路由参数（自动序列化为 query，匹配该路由声明的参数类型；多余字段报错） */
  params?: RouteParamsByName[N]
}

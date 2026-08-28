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

/** 路由参数（跳转时传入） */
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}

/** 路由跳转选项 */
export interface NavigateOptions {
  /** 命名路由 */
  name?: string
  /** 页面路径（命名路由优先） */
  path?: string
  /** 路由参数（自动序列化为 query） */
  params?: RouteParams
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

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
  /** 转场枚举（router-plan M1：Skyline routeType / Web Transition 映射） */
  transition?: 'slideUp' | 'slideDown' | 'halfScreen' | 'scaleDown' | 'none'
  /** 任意扩展字段（仅 JSON 可序列化） */
  [key: string]: unknown
}

// ============ 路由管理透明化（docs/proteus-router-plan M1/M2） ============

/**
 * 路由参数类型表（类型提示全链路）：基类为空接口，应用侧由 gen-routes 生成的 auto-routes.ts
 * 用模块扩充注入具体路由（vue-router 同款模式）：
 * ```
 * // examples/router/auto-routes.ts（AUTO-GENERATED）
 * declare module '@proteus/router/types' {
 *   interface RouteParamsByName {
 *     'user-profile': { id?: string }
 *   }
 * }
 * ```
 * 基类为空 → 无扩充时 keyof = never（name 受限负例成立）；扩充后 keyof = 全部路由名联合
 */
export interface RouteParamsByName {}

/** M1：<route> 块扫描产物（scan.ts） */
export interface RouteBlock {
  /** 源码位置（--trace-router 报错定位） */
  loc: { file: string; line: number; column: number }
  path: string
  name?: string
  redirect?: string
  /** 显式子父关系（覆盖 path 推导） */
  parent?: string
  meta: RouteMeta
  /** 懒加载（默认 true；未声明时由全局 defaults 决定，M2 tree.ts 解析） */
  lazy?: boolean
  /** 对应 .vue 文件绝对路径（codegen 生成 import 用） */
  componentPath: string
}

/** M2：嵌套路由树节点（tree.ts）——lazy 已解析为最终值；parent 保留（显式声明，children 反映实际嵌套） */
export interface RouteNode extends Omit<RouteBlock, 'lazy'> {
  children: RouteNode[]
  lazy: boolean
}

/** M2：全局路由默认值（proteus.config router.defaults） */
export interface GlobalRouteDefaults {
  meta?: RouteMeta
  lazy?: boolean
}

/** 路由参数（跳转时传入） */
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}

/**
 * 页面 onLoad 参数类型（类型提示全链路步骤 3）：N = 本页路由名，自动匹配 RouteParamsByName[N]
 * 用法：onLoad((options: PageOnLoad<'user-profile'>) => { ... })——options.id?: string 推导
 */
export type PageOnLoad<N extends keyof RouteParamsByName> = RouteParamsByName[N]

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

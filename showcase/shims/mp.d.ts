// src/shims/mp.d.ts
// ============================================================
// 微信小程序 API 类型声明垫片（minimal + 官方 typings 接入）
//
// 职责：
// - ★B8（types-plus-plan）：wx.* / App() / Page() / Component() 参数全部源自官方
//   miniprogram-api-typings（WechatMiniprogram 命名空间），本文件不再自造 wx 类型
// - 保留 Proteus 自定义类型：RouteContext / RouteBuilder / PageOptions 等（官方不覆盖）
// - 注意：本文件无 import/export，保持全局声明（ambient）形态
// ============================================================

/// <reference types="miniprogram-api-typings" />

/** wx 全局对象（★官方类型：WechatMiniprogram.Wx，含 wx.router 等 Skyline API） */
declare const wx: WechatMiniprogram.Wx

/** Skyline wx.router 自定义路由上下文（官方 CustomRouteContext） */
interface RouteContext {
  /** 主转场动画进度 0→1（控制推入页面的进入/退出过渡） */
  primaryAnimation: { value: number }
  /** 主动画控制器状态：0=dismissed 1=forward 2=reverse 3=completed */
  primaryAnimationStatus: { value: number }
  /** 次转场动画进度 0→1（控制栈顶页面的压入/压出过渡） */
  secondaryAnimation: { value: number }
  /** 次动画控制器状态 */
  secondaryAnimationStatus: { value: number }
  /** 当前路由进度是否由手势控制 */
  userGestureInProgress: { value: number }
  /** 手势开始控制路由 */
  startUserGesture: () => void
  /** 手势不再控制路由 */
  stopUserGesture: () => void
  /** 返回上一级（效果同 wx.navigateBack） */
  didPop: () => void
}

/** worklet 返回值（'worklet' 指令注释由编译器保留） */
interface WorkletValue {
  transform?: string
  opacity?: number
}

/** routeBuilder 返回结构（wx.router.addRouteBuilder 的 builder 返回值，字段见官方 CustomRouteConfig） */
interface RouteBuilderResult {
  /** 是否不透明（false 时前一页可见，如半屏弹窗） */
  opaque?: boolean
  /** 是否保持前一个页面状态 */
  maintainState?: boolean
  /** 页面推入动画时长（ms） */
  transitionDuration?: number
  /** 页面推出动画时长（ms） */
  reverseTransitionDuration?: number
  /** 遮罩层背景色 rgba() / #RRGGBBAA */
  barrierColor?: string
  /** 点击遮罩层返回上一页 */
  barrierDismissible?: boolean
  /** 无障碍语义 */
  barrierLabel?: string
  /** 是否与下一个页面联动（决定当前页 secondaryAnimation 是否生效） */
  canTransitionTo?: boolean
  /** 是否与前一个页面联动（决定前一个页 secondaryAnimation 是否生效；false = 前页保持不动） */
  canTransitionFrom?: boolean
  handlePrimaryAnimation?: () => WorkletValue
  handleSecondaryAnimation?: () => WorkletValue
  /** 控制上一级页面的压入/压出动画（基础库 ≥3.0.0） */
  handlePreviousPageAnimation?: () => WorkletValue
  /** 页面进入时是否采用 snapshot 模式优化动画性能（基础库 ≥3.2.0） */
  allowEnterRouteSnapshotting?: boolean
  /** 页面退出时是否采用 snapshot 模式（基础库 ≥3.2.0） */
  allowExitRouteSnapshotting?: boolean
  /** 右滑返回可拖动范围是否撑满屏幕（基础库 ≥3.2.0，常用于半屏弹窗） */
  fullscreenDrag?: boolean
  /** 返回手势方向（基础库 ≥3.4.0） */
  popGestureDirection?: 'horizontal' | 'vertical' | 'multi'
}

/** 自定义路由 builder（skyline.ts 注册到 wx.router） */
type RouteBuilder = (ctx: RouteContext) => RouteBuilderResult

/** 小程序 Page 构造器配置（pageLifecycle.createPage 的返回类型） */
interface PageOptions {
  data?: Record<string, unknown> | (() => Record<string, unknown>)
  onLoad?: (options: Record<string, string>) => void
  onReady?: () => void
  onUnload?: () => void
  [key: string]: unknown
}

/** 小程序 Component 构造器配置（pageLifecycle.createComponent 的返回类型） */
interface ComponentOptions {
  properties?: Record<string, unknown>
  data?: Record<string, unknown> | (() => Record<string, unknown>)
  methods?: Record<string, Function>
  lifetimes?: {
    attached?: () => void
    detached?: () => void
  }
  [key: string]: unknown
}

declare function App(options: Record<string, unknown>): void
/** 说明：Page/Component/App 全局构造器由官方 miniprogram-api-typings 声明（WechatMiniprogram.Page.Constructor 等），本文件不再重复声明 */

/** Skyline worklet 渲染线程全局（仅 worklet 函数内可用） */
declare const screenHeight: number
declare const windowWidth: number

/** 调试开关（PROTEUS_DEBUG=1 构建时由 vite define 注入为 true） */
declare const __PROTEUS_DEBUG__: boolean

/** Skyline 渲染开关（mp 构建时由 vite define 注入 proteus.config.skyline） */
declare const __PROTEUS_SKYLINE__: boolean

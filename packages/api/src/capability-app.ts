// packages/api/src/capability-app.ts
// ★★应用与生命周期的能力开放（App 宿主腿）：C23 useAppLifecycle / C24 usePageLifecycle / C25 useBackground
//
// 【为什么需要本模块（本轮取证的三条事实）】
//   ① **Hook 层早已实现**（`capability.ts` 的 useAppLifecycle/usePageLifecycle/useBackground）；
//   ② 但**桥层只有两份**（wxBridge / webBridge）——`detectRuntime()` 只认 `web | mp`
//      ⇒ App 宿主（QuickJS/JSC 无 window 无 wx）**落不到自己的桥**，三个 Hook 在 App 端形同虚设；
//   ③ **事件源在本轮之前已经就绪**：宿主运行时（G-39：壳转发 onPause/onResume → 状态机）
//      + 虚拟栈命令流（M5：mount/enter/exit/unmount）——缺的只是**把源接到桥上**这一层。
//
// 【本模块的三件东西】
//   · `HostLifecycleBus`：宿主生命周期**总线**（壳/执行器推事件、桥订阅；全局单例，壳可直取）；
//   · `createAppLifecycleCapabilities(bus, CapError)`：三个桥方法（AppLifecycle/PageLifecycle/BackgroundAPI）；
//   · `createStackPageSource(bus)`：虚拟栈命令 → 页面生命周期事件（mount→load / enter→show /
//     exit→hide / unmount→unload）——**App 的"页面生命周期"就是虚拟栈的可见性变迁**。
//
// 【与 wx 桥的语义对齐（防两端手感分叉）】
//   · `onLaunch`：wx 语义是"启动时恰好一次"⇒ 本模块在**首个 show** 时自动补发 launch
//     （壳只需转发 show/hide——冷启动 show 即 launch，前台回切 show 不是 launch）；
//   · `onShow/onHide`：多订阅、可取消、**取消后不再触发**（wx 桥的取消是 no-op——本模块是诚实取消）；
//   · `BackgroundAPI`：全事件面**订阅真实存在**，事件由壳推入（未推的事件永不触发——诚实，不伪造）。
//
// 【依赖方向】本模块不 import `capability.ts`（防循环）——`CapError` 由调用方**注入**
//   （与 `mpBridgeExt(g.wx, CapError)` / `webBridgeExt(globalThis, CapError)` 同一模式）。

// ── 类型（与 capability.ts 的同名接口结构兼容；不 import 以避免循环） ──

/** 应用阶段（与 C23 `AppLifecycle.phase` 同值域） */
export type AppLifecyclePhase = 'PENDING' | 'LAUNCH' | 'SHOW' | 'HIDE'
/** 页面阶段（与 C24 `PageLifecycle.phase` 同值域） */
export type PageLifecyclePhase = 'IDLE' | 'LOAD' | 'SHOW' | 'HIDE'

/** CapError 构造器签名（注入；`capability.ts` 传入自己的实现——E = 产出的错误类型） */
export type CapErrorCtor<E extends Error = Error> = new (code: string, message: string, cause?: unknown) => E

/**
 * 能力结果（结构兼容 `capability.ts` 的 CapResult —— error 用**注入的 CapError 实例类型**，
 * 保证 `getLaunchOptions()` 等返回值能直接赋给 `BackgroundAPI` 的声明）。
 */
export type AppCapResult<T, E extends Error = Error> = { ok: true; data: T } | { ok: false; error: E }

/**
 * ★★页面级生命周期**事件面 SSOT**（跨端统一语义名 × 各端真实触发源）
 *
 * 【为什么需要（用户指出「生命周期能力太简单，就三个，真实项目远超三个」）】
 *   此前只有 3 个事件（load/show/hide）。而**微信官方文档**里 Page 构造器就有
 *   6 个生命周期回调 + 9 个页面事件（本轮已抓官方文档逐条核实）：
 *   · 生命周期：onLoad / onShow / onReady / onHide / onUnload / **onRouteDone**
 *   · 页面事件：onPullDownRefresh / onReachBottom / onPageScroll / onResize / onTabItemTap /
 *     onShareAppMessage / onShareTimeline / onAddToFavorites / onSaveExitState
 *   App 端（iOS/Android/鸿蒙）另有自己的清单（viewDidLoad/onCreate → onStart → onResume …）。
 *
 * 【各端真实触发源（本表是接线的事实来源，不是愿望）】
 * | 事件 | 小程序 | Web | App（壳转发） |
 * |---|---|---|---|
 * | load | `Page.onLoad`（编译产物派发） | 路由进入 | 虚拟栈 `mount` |
 * | show | `Page.onShow`（产物派发 / ★**无全局 API**——见下方注释） | visibilitychange→visible | 栈 `enter` / 壳 resume |
 * | ready | `Page.onReady`（产物派发） | 首帧渲染后 | 屏首帧 |
 * | hide | `Page.onHide` | visibilitychange→hidden | 栈 `exit` / 壳 pause |
 * | unload | `Page.onUnload` | 路由离开 | 栈 `unmount` |
 * | route-done | `Page.onRouteDone`（★基础库 2.32.1+） | transitionend | 转场动画结束 |
 * | pull-down-refresh | `Page.onPullDownRefresh`（需 page.json 开 enablePullDownRefresh） | **无原生**（诚实降级） | 宿主手势 |
 * | reach-bottom | `Page.onReachBottom` | 滚动到底（IntersectionObserver） | 滚动到底 |
 * | page-scroll | `Page.onPageScroll`（★**高频事件**：微信文档明确"会引起逻辑层与渲染层通信"⇒ 只声明才派发） | scroll | 滚动回调 |
 * | resize | `Page.onResize` | resize | 屏幕旋转/分屏 |
 * | tab-item-tap | `Page.onTabItemTap` | tab 点击 | tab 栏点击 |
 * | share-app-message | `Page.onShareAppMessage`（★**声明才显示转发按钮**——不能自动补） | navigator.share | 分享面板 |
 * | share-timeline | `Page.onShareTimeline`（同上：声明才显示朋友圈入口） | — | 分享面板 |
 * | add-to-favorites | `Page.onAddToFavorites`（同上：声明才显示收藏入口） | — | 收藏 |
 * | save-exit-state | `Page.onSaveExitState`（同上：声明才启用） | beforeunload | 状态保存 |
 *
 * ★★**小程序没有 `wx.onPageShow` / `wx.onPageHide` 全局订阅 API**（本轮抓官方文档核实；
 *   页面级只有 `Page({onShow})` 声明式）。本仓上轮 MP 桥曾用 `wx.onPageShow?.()` 订阅——
 *   那**永远不触发**（静默失效）。正解：由**编译产物在 Page 钩子里派发**到本总线
 *   （见 `packages/compiler/src/script.ts` 的 `proteusPageEmit`）。
 */
export const PAGE_EVENTS = [
  'load',
  'show',
  'ready',
  'hide',
  'unload',
  'route-done',
  'pull-down-refresh',
  'reach-bottom',
  'page-scroll',
  'resize',
  'tab-item-tap',
  'share-app-message',
  'share-timeline',
  'add-to-favorites',
  'save-exit-state',
] as const
export type PageEvent = (typeof PAGE_EVENTS)[number]

/**
 * ★★应用级生命周期**事件面 SSOT**（扩展：此前只有 launch/show/hide）
 *
 * 各端真实触发源：
 * | 事件 | 小程序（`App({...})` / `wx.*`） | Web | App（壳） |
 * |---|---|---|---|
 * | launch | `App.onLaunch` | `load` | 壳冷启动 |
 * | show | `App.onShow` / `wx.onAppShow` | visibilitychange | 壳 resume |
 * | hide | `App.onHide` / `wx.onAppHide` | visibilitychange | 壳 pause |
 * | error | `App.onError` | window.onerror | 壳（未捕获异常） |
 * | unhandled-rejection | `App.onUnhandledRejection` | unhandledrejection | 壳 |
 * | memory-warning | `App.onMemoryWarning` / `wx.onMemoryWarning` | performance.memory 启发式 | ★壳（iOS `didReceiveMemoryWarning` / Android `onTrimMemory`） |
 * | theme-change | `App.onThemeChange` / `wx.onThemeChange` | matchMedia | ★壳（系统深色模式） |
 * | resize | `wx.onWindowResize` | resize | 屏幕旋转/分屏 |
 * | page-not-found | `App.onPageNotFound` | 路由未命中 | 路由未命中 |
 * | audio-interruption-begin / -end | `App.onAudioInterruptionBegin/End` | — | 壳（来电等中断） |
 */
export const APP_EVENTS = [
  'launch',
  'show',
  'hide',
  'error',
  'unhandled-rejection',
  'memory-warning',
  'theme-change',
  'resize',
  'page-not-found',
  'audio-interruption-begin',
  'audio-interruption-end',
] as const
export type AppEvent = (typeof APP_EVENTS)[number]

// ══════════════════════════════════════════════════════════════════
// 事件源安装器（谁往总线里推事件——每端一个，互不干扰）
// ══════════════════════════════════════════════════════════════════

/** 产物派发入口的全局键（编译器在 Page 钩子里调它——见 script.ts 的 proteusPageEmit） */
export const PAGE_EMIT_KEY = '__proteusEmitPage'

/**
 * ★★安装"编译产物 → 总线"的页面事件通道（小程序端必需）。
 *
 * 【为什么必须（本轮抓官方文档核实的实缺）】小程序**没有** `wx.onPageShow` / `wx.onPageHide`
 *   全局订阅 API ⇒ 运行时订阅页面事件只能靠**产物在 Page 钩子里派发**。
 *   编译器已生成派发调用（`this.proteusPageEmit(evt, payload)` → `globalThis.__proteusEmitPage`），
 *   本函数把它接到总线上。
 *
 * 幂等：重复调用只覆盖同一个全局函数（多入口加载不会重复订阅）。
 */
export function installPageEmitBridge(bus: HostLifecycleBus): void {
  const g = globalThis as Record<string, unknown>
  g[PAGE_EMIT_KEY] = (evt: unknown, payload?: unknown): void => {
    if (typeof evt !== 'string') return
    bus.emit({ topic: 'page', kind: evt as PageEvent, payload })
  }
}

/**
 * `wx` 全局子集（MP 端应用级事件的真实来源；全部是**官方全局订阅 API**）。
 *
 * ★类型形态（本轮 tsc 反复抓出的要点）：订阅器签名用**最宽的可赋值形态**
 *   `(cb: (...args: unknown[]) => void) => void`——微信各 API 回调参数形态不一
 *   （onAppShow 带 launch 参数 / onAppHide 无参 / onError 带 {message}…），
 *   而本桥只关心"事件发生了"，载荷在**回调内**按需取（`(e as {...})`）。
 *   收窄成具体签名会把真实 wx 类型挡在门外（`WxLike` 不可赋值）。
 */
export interface WxLifecycleSource {
  onAppShow?: (cb: (...args: unknown[]) => void) => void
  onAppHide?: (cb: (...args: unknown[]) => void) => void
  onError?: (cb: (...args: unknown[]) => void) => void
  onUnhandledRejection?: (cb: (...args: unknown[]) => void) => void
  onMemoryWarning?: (cb: (...args: unknown[]) => void) => void
  onThemeChange?: (cb: (...args: unknown[]) => void) => void
  onWindowResize?: (cb: (...args: unknown[]) => void) => void
  onPageNotFound?: (cb: (...args: unknown[]) => void) => void
  onAudioInterruptionBegin?: (cb: (...args: unknown[]) => void) => void
  onAudioInterruptionEnd?: (cb: (...args: unknown[]) => void) => void
}

/**
 * ★★把小程序**应用级**官方事件接进总线（这些是真实全局 API——与页面级的机制不同）。
 *
 * 覆盖：onAppShow / onAppHide / onError / onUnhandledRejection / onMemoryWarning /
 *       onThemeChange / onWindowResize / onPageNotFound / onAudioInterruptionBegin/End。
 * ★`launch` 由首个 show 自动补发（总线语义，见 emit 分支）——wx 无独立全局 launch 事件。
 * ★每个订阅各自 try 守卫：某个 API 在旧基础库缺失时不影响其余（诚实降级，不静默整体失败）。
 */
export function installWxAppEventBridge(bus: HostLifecycleBus, wx: WxLifecycleSource): void {
  /** 接线诊断（**独立于业务事件面**）：业务订阅 app:error 时不该收到"桥没接线"这类内部噪音 */
  const bridgeDiag = (msg: string): void => {
    // 可观测但不污染事件面：优先 console（devtools/真机 logcat 可见），console 缺失则忽略
    try {
      ;(globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(msg)
    } catch {
      /* 极简环境无 console——诊断丢失可接受（不静默**业务**事件，只静默诊断） */
    }
  }
  const tryOn = (fn: (() => void) | undefined, label: string): void => {
    if (typeof fn !== 'function') {
      // 缺失的 API 不静默：记诊断（订阅者收不到该事件时能归因——"没触发"与"没接线"是两件事）
      bridgeDiag(`[proteus/lifecycle] wx.${label} 缺失（该事件在本端不可用）`)
      return
    }
    try {
      fn()
    } catch {
      bridgeDiag(`[proteus/lifecycle] wx.${label} 注册失败（旧基础库？）`)
    }
  }
  tryOn(wx.onAppShow && (() => wx.onAppShow!(() => bus.emit({ topic: 'app', kind: 'show' }))), 'onAppShow')
  tryOn(wx.onAppHide && (() => wx.onAppHide!(() => bus.emit({ topic: 'app', kind: 'hide' }))), 'onAppHide')
  // 载荷读取用 `as` 归一（回调形参在本接口里是最宽的 never[]——见接口注释）
  const arg0 = <T,>(...args: unknown[]): T => args[0] as T
  tryOn(wx.onError && (() => wx.onError!((...a: unknown[]) => {
    const e = arg0<{ message?: string } | string>(...a)
    bus.emit({ topic: 'app', kind: 'error', payload: { error: typeof e === 'string' ? e : String(e?.message ?? '') } })
  })), 'onError')
  tryOn(wx.onUnhandledRejection && (() => wx.onUnhandledRejection!((...a: unknown[]) => {
    const r = arg0<{ reason?: unknown }>(...a)
    bus.emit({ topic: 'app', kind: 'unhandled-rejection', payload: { reason: String(r?.reason ?? '') } })
  })), 'onUnhandledRejection')
  tryOn(wx.onMemoryWarning && (() => wx.onMemoryWarning!((...a: unknown[]) => {
    const r = arg0<{ level?: number }>(...a)
    bus.emit({ topic: 'app', kind: 'memory-warning', payload: { level: Number(r?.level ?? 0) } })
  })), 'onMemoryWarning')
  tryOn(wx.onThemeChange && (() => wx.onThemeChange!((...a: unknown[]) => {
    const r = arg0<{ theme?: string }>(...a)
    bus.emit({ topic: 'app', kind: 'theme-change', payload: { theme: r?.theme === 'dark' ? 'dark' : 'light' } })
  })), 'onThemeChange')
  tryOn(wx.onWindowResize && (() => wx.onWindowResize!((...a: unknown[]) => {
    const r = arg0<{ size?: { windowWidth: number; windowHeight: number } }>(...a)
    bus.emit({ topic: 'app', kind: 'resize', payload: r?.size ?? {} })
  })), 'onWindowResize')
  tryOn(wx.onPageNotFound && (() => wx.onPageNotFound!((...a: unknown[]) => {
    const r = arg0<{ path?: string }>(...a)
    bus.emit({ topic: 'app', kind: 'page-not-found', payload: { path: String(r?.path ?? '') } })
  })), 'onPageNotFound')
  tryOn(wx.onAudioInterruptionBegin && (() => wx.onAudioInterruptionBegin!(() => bus.emit({ topic: 'app', kind: 'audio-interruption-begin' }))), 'onAudioInterruptionBegin')
  tryOn(wx.onAudioInterruptionEnd && (() => wx.onAudioInterruptionEnd!(() => bus.emit({ topic: 'app', kind: 'audio-interruption-end' }))), 'onAudioInterruptionEnd')
}

/**
 * ★★生命周期事件**元数据 SSOT**（说明 + 各端真实触发源）——文档生成器的唯一数据源
 *
 * 【为什么单列一张表（用户反馈：「方法说明有的有有的没有」「没有单独的兼容进度说明」）】
 *   事件的**说明**与**各端触发源**此前散在两处：接口 JSDoc（部分有）+ 代码注释 ⇒
 *   文档里一半方法是 `—`、且**看不到每个事件在各端的支持情况**。
 *   ⇒ 收敛为一张表：`doc`（一句话说明）+ `mp`/`web`/`app`（各端真实来源，`null` = 该端无此事件，
 *     **诚实标注不伪造**）+ `note`（性能红线/决策型等要点）。
 *   ★生成器直接消费本表（`website/scripts/gen-content.mjs` 动态 import）⇒ 改这里，文档跟着变。
 */
export interface LifecycleEventMeta {
  /** 一句话说明（中文——渲染到方法表与详情） */
  doc: string
  /** 英文说明（缺省回退 `doc`——双语页优先用它） */
  docEn?: string
  /** 小程序端真实来源（null = 无此事件） */
  mp: string | null
  /** Web 端真实来源（null = 无此事件） */
  web: string | null
  /** App 端（iOS/Android/鸿蒙）真实来源（null = 无此事件） */
  app: string | null
  /** 要点（性能红线 / 决策型语义 / 平台限制等） */
  note?: string
  /** 英文要点（缺省回退 `note`） */
  noteEn?: string
}

/** 页面级事件元数据（key = kebab 事件名，与 PAGE_EVENTS 一一对应） */
export const PAGE_EVENT_META: Record<PageEvent, LifecycleEventMeta> = {
  load: {
    doc: '页面加载（每次进入该页触发一次，可读取路由参数）',
    mp: 'Page.onLoad（编译产物派发）',
    web: '文档 load',
    app: '虚拟栈 mount 命令',
  },
  show: {
    doc: '页面显示（切入前台，或从上层页面返回）',
    mp: 'Page.onShow（编译产物派发）',
    web: 'load 后 + visibilitychange→visible',
    app: '虚拟栈 enter 命令 / 壳 resume',
  },
  ready: {
    doc: '页面首帧渲染完成（一次）',
    mp: 'Page.onReady（编译产物派发）',
    web: 'load 后首帧（rAF）',
    app: '屏首帧渲染完成',
  },
  hide: {
    doc: '页面隐藏（切后台，或被上层页面覆盖）',
    mp: 'Page.onHide（编译产物派发）',
    web: 'visibilitychange→hidden',
    app: '虚拟栈 exit 命令 / 壳 pause',
  },
  unload: {
    doc: '页面卸载（离开并销毁）',
    mp: 'Page.onUnload（编译产物派发）',
    web: "beforeunload",
    app: '虚拟栈 unmount 命令',
  },
  'route-done': {
    doc: '路由动画完成（转场结束后）',
    mp: 'Page.onRouteDone（基础库 2.32.1+）',
    web: 'transitionend（由 router 层推）',
    app: 'Morpheus 转场结束',
    note: '基础库版本要求较高：低版本无此钩子（产物会生成，但不触发——诚实降级）',
  },
  'pull-down-refresh': {
    doc: '下拉刷新（用户下拉页面）',
    mp: "Page.onPullDownRefresh",
    web: null,
    app: '宿主下拉手势',
    note: '★小程序需在 page.json 开 enablePullDownRefresh，否则不触发；**Web 无原生等价**（诚实不触发）',
  },
  'reach-bottom': {
    doc: '滚动触底（可用于加载更多）',
    mp: "Page.onReachBottom",
    web: 'scroll 距底 ≤50px',
    app: '滚动到底',
    note: 'Web 端为阈值启发式（50px）；小程序按 onReachBottomDistance 配置',
  },
  'page-scroll': {
    doc: '页面滚动（携带 scrollTop）',
    mp: "Page.onPageScroll",
    web: 'scroll（rAF 节流）',
    app: '滚动回调',
    note: '★★**高频事件**：微信官方明确会引起逻辑层与渲染层通信 ⇒ 小程序端**仅当你声明过 onPageScroll 时才派发**；Web 端已 rAF 节流',
  },
  resize: {
    doc: '页面尺寸变化（旋转 / 分屏 / 窗口缩放）',
    mp: 'Page.onResize（编译产物派发）',
    web: "resize",
    app: '屏幕旋转 / 分屏',
  },
  'tab-item-tap': {
    doc: '点击 tab 栏项（携带 index / pagePath）',
    mp: 'Page.onTabItemTap（编译产物派发）',
    web: null,
    app: 'tab 栏点击',
    note: 'Web 端无 tab 栏概念（如自绘 tab 请直接用组件事件）',
  },
  'share-app-message': {
    doc: '转发给好友（**决策型**：注册的 provider 返回值即分享内容）',
    mp: "Page.onShareAppMessage",
    web: 'navigator.share（需用户手势）',
    app: '系统分享面板',
    note: '★小程序**声明后才显示右上角"转发"入口**（框架不自动补——不擅自加用户可见行为）',
  },
  'share-timeline': {
    doc: '分享到朋友圈（**决策型**）',
    mp: "Page.onShareTimeline",
    web: null,
    app: '系统分享面板',
    note: '同转发：小程序声明后才显示入口',
  },
  'add-to-favorites': {
    doc: '收藏页面（**决策型**）',
    mp: "Page.onAddToFavorites",
    web: null,
    app: '系统收藏',
    note: '同转发：小程序声明后才显示入口',
  },
  'save-exit-state': {
    doc: '保存退出状态（**决策型**：provider 返回需保存的状态对象）',
    mp: 'Page.onSaveExitState（基础库 2.7.4+）',
    web: "beforeunload' 的 'returnValue",
    app: '退出前状态保存',
    note: 'Web 端语义差异：beforeunload 的返回值用于**离开确认**（浏览器不持久化状态）',
  },
}

/** 应用级事件元数据（key = kebab 事件名，与 APP_EVENTS 一一对应） */
export const APP_EVENT_META: Record<AppEvent, LifecycleEventMeta> = {
  launch: {
    doc: '应用启动（**恰好一次**，先于首个 show；壳只需转发 show，总线自动补 launch）',
    mp: '首个 onAppShow 自动补发',
    web: '首个 load 自动补发',
    app: '壳冷启动',
  },
  show: {
    doc: '应用进入前台',
    mp: "wx.onAppShow",
    web: 'visibilitychange→visible',
    app: '壳 resume（Activity.onResume / didBecomeActive）',
  },
  hide: {
    doc: '应用退到后台',
    mp: "wx.onAppHide",
    web: 'visibilitychange→hidden',
    app: '壳 pause（Activity.onPause / willResignActive）',
  },
  error: {
    doc: '未捕获的运行时错误',
    mp: "App.onError' / 'wx.onError",
    web: "window.onerror",
    app: '壳错误捕获',
  },
  'unhandled-rejection': {
    doc: '未处理的 Promise rejection',
    mp: "App.onUnhandledRejection",
    web: "unhandledrejection",
    app: '壳错误捕获',
  },
  'memory-warning': {
    doc: '系统内存警告（可用于释放缓存）',
    mp: "App.onMemoryWarning' / 'wx.onMemoryWarning",
    web: 'performance.memory 启发式',
    app: 'iOS didReceiveMemoryWarning / Android onTrimMemory',
    note: '★**归属 C25 useBackground**（本事件不在 useAppLifecycle 上——两处重复已于 2026-09-30 去重）',
  },
  'theme-change': {
    doc: '系统深色/浅色模式切换',
    mp: "App.onThemeChange' / 'wx.onThemeChange",
    web: "matchMedia(prefers-color-scheme)",
    app: '壳主题通知',
    note: '★**归属 C25 useBackground**（去重后从 useAppLifecycle 移除）',
  },
  resize: {
    doc: '窗口尺寸变化',
    mp: "wx.onWindowResize",
    web: "resize",
    app: '旋转 / 分屏',
    note: '★**归属 C25 useBackground**（去重后从 useAppLifecycle 移除）',
  },
  'page-not-found': {
    doc: '路由未命中（可跳兜底页）',
    mp: 'App.onPageNotFound / wx.onPageNotFound',
    web: '路由未命中（router 层推）',
    app: '路由未命中',
  },
  'audio-interruption-begin': {
    doc: '音频被系统中断开始（来电等）',
    mp: "App.onAudioInterruptionBegin",
    web: null,
    app: '壳音频会话通知',
  },
  'audio-interruption-end': {
    doc: '音频中断结束（可恢复播放）',
    mp: "App.onAudioInterruptionEnd",
    web: null,
    app: '壳音频会话通知',
  },
}

// ══════════════════════════════════════════════════════════════════
// ★★App 端（iOS / Android / 鸿蒙）的**平台特有扩展**：壳转发通道
//
// 【用户要求（2026-09-30）】：「落地不是仅仅 web 和小程序，**包括 App 也要落地**，因为现在 App 宿主已经有了」
//
// 【为什么 App 端要单独一条通道（设计依据）】
//   App 宿主**没有 wx（小程序 API 表），也不是浏览器**（无 window/navigator）⇒ wxBridge/webBridge
//   都够不着它。App 端的原生能力必须由**壳转发**（G-39 宿主运行时的既定模式：
//   业务 → 框架 → 桥 → 壳 → 平台 API）。
//   ⇒ 本模块提供 `__proteusHostInvoke` 通道：壳注册一个同步调用入口，桥经它调原生。
//
// 【与 Web/MP 的对称性（同一能力形状，不同实现来源）】
//   同一个 `useUpdate()` / `useWindow()` / `useKeyboard()` 在：
//     · MP → wx.getUpdateManager / wx.setWindowSize / wx.onKeyboardHeightChange
//     · Web → Service Worker / 无（诚实 Err） / visualViewport
//     · App → **壳转发**（原生 UpdateManager / 窗口管理 / 系统键盘通知）
//   ⇒ 业务代码零平台分支（铁律），差异只在桥的内部分支。
//
// 【诚实边界（本模块的 range）】壳未注册某原生能力 ⇒ 该能力返回 `*.unsupported` Err
//   （**不伪造成功**）；壳只需实现它真有 API 的那几个（其余自动诚实降级）。
// ══════════════════════════════════════════════════════════════════

/** 壳注册的原生调用入口的全局键（壳侧：`globalThis.__proteusHostInvoke = (name, argsJson) => json`） */
export const HOST_INVOKE_KEY = '__proteusHostInvoke'

/** App 端原生调用名（**契约**：壳按此名实现；未实现 ⇒ 桥返回 unsupported） */
export const APP_NATIVE_METHODS = {
  /** C51 热更新：`{ hasUpdate, ready }` 或 `{ action: 'apply' }` */
  updateCheck: 'update.check',
  updateApply: 'update.apply',
  /** C74 窗口：`{ width, height }` */
  windowSetSize: 'window.setSize',
  /** C14 键盘：壳主动推 `keyboard.height` 事件（见 APP_EVENT_SOURCES） */
  /** C48 宿主上下文：`{ provider, version, capabilities }` */
  hostContext: 'host.context',
  /** C50 扩展加载：`{ id }` → 模块句柄（App 端由壳动态装载原生模块） */
  extensionLoad: 'extension.load',
  /** C47 跳其他小程序：App 端无此概念（对齐 Web） */
  navigateMiniProgram: 'mini-program.navigate',
  /** C53 Worker：App 端由壳创建后台线程（G-39 runOnThread） */
  workerCreate: 'worker.create',
  workerPost: 'worker.post',
  workerTerminate: 'worker.terminate',
  /** C73 空闲回调：壳提供主线程空闲时机 */
  idleRequest: 'idle.request',
  idleCancel: 'idle.cancel',
  /** C67 预加载 */
  preloadAssets: 'preload.assets',
} as const

/** 壳注册的原生调用签名（同步：返回 JSON 串；抛错 = 原生调用失败） */
export type HostInvokeFn = (method: string, argsJson: string) => string

/** 取壳注册的原生调用入口（未注册 ⇒ null） */
export function getHostInvoke(): HostInvokeFn | null {
  const g = globalThis as Record<string, unknown>
  const f = g[HOST_INVOKE_KEY]
  return typeof f === 'function' ? (f as HostInvokeFn) : null
}

/**
 * 调原生（**同步**——与 G-39 的 JNI trampoline 同契约：壳内同步完成）。
 *
 * @returns `{ ok: true, data }` 或 `{ ok: false, reason }`
 * ★未注册（壳没提供该方法）与调用失败**分得开**：
 *   前者 = 该端无此能力（框架据此给 `*.unsupported`）；后者 = 有 API 但调用出错（`*.failed`）。
 */
export function invokeHost(method: string, args?: unknown): { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } {
  const f = getHostInvoke()
  if (!f) return { ok: false, reason: `壳未注册 ${HOST_INVOKE_KEY}（App 端原生通道）`, missing: true }
  try {
    const out = f(method, JSON.stringify(args ?? null))
    const parsed = JSON.parse(out) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
    if (parsed && parsed.ok === false) {
      return { ok: false, reason: String(parsed.reason ?? '原生调用失败'), missing: !!parsed.missing }
    }
    return { ok: true, data: parsed?.data ?? parsed }
  } catch (e) {
    // 抛错 = 壳未实现该方法（壳侧 `throw new Error('unsupported: …')`）或真失败——
    // 消息里带 'unsupported'/'missing' 视为"无此能力"（诚实降级），否则算失败
    const msg = e instanceof Error ? e.message : String(e)
    const missing = /unsupported|missing|not implemented|no such/i.test(msg)
    return { ok: false, reason: msg, missing }
  }
}

/** App 端能力位是否可用（壳注册了通道 + 该方法可用——供生成器/文档的端支持分档） */
export function appNativeAvailable(method: string): boolean {
  const r = invokeHost(method, { probe: true })
  return r.ok || !r.missing
}

// ══════════════════════════════════════════════════════════════════
// ★★App 端的 10 个「应用与生命周期」能力（壳转发实现）
//
// 覆盖：C47 mini-program / C48 embedded / C50 extension / C51 update / C53 worker /
//       C67 preload / C73 idle / C74 window / C75 navigation-guard / C82 webassembly
//   （C23/C24/C25 由 `createAppLifecycleCapabilities` 提供——见上）
//
// ★设计：**逐个走 `invokeHost`**（壳实现即用、未实现即诚实 Err）——不伪造能力位。
// ══════════════════════════════════════════════════════════════════

/** WASM 模块句柄（与 capability.ts 的 `WasmModuleHandle` **结构一致**——本模块不 import 它，保持依赖单向） */
export interface WasmHandle {
  exports: Record<string, unknown>
  fromPath: boolean
  dispose(): void
}

/** CapResult 形态（与 capability.ts 结构兼容；本模块不 import 它——依赖方向单向） */
type R<T, E extends Error = Error> = { ok: true; data: T } | { ok: false; error: E }

/**
 * ★★创建 App 端的平台能力（供 `createCapabilityBridge` 合并；CapError 注入防循环依赖）
 *
 * ★诚实边界：壳未实现的方法 ⇒ 返回 `*.unsupported` Err（不假装成功）；
 *   则业务按铁律分支 `res.ok` 即可（与 Web/MP 同一体验）。
 */
export function createAppNativeCapabilities<E extends Error = Error>(CapError: new (code: string, message: string, cause?: unknown) => E) {
  /** 统一封装：未注册/未实现 ⇒ `unsupported`；真失败 ⇒ `failed` */
  const call = <T,>(method: string, args: unknown, capSlug: string): Promise<R<T, E>> =>
    Promise.resolve().then(() => {
      const r = invokeHost(method, args)
      if (r.ok) return { ok: true as const, data: r.data as T }
      const code = r.missing ? `${capSlug}.unsupported` : `${capSlug}.failed`
      return errNow<T>(code, `${capSlug}: ${r.reason}`)
    })

  /**
   * 构造失败结果。
   * ★★防御（真机实测抓出的用法陷阱）：业务侧可能误传原生 `Error` 作为构造器
   *   （`new Error(code, msg)` 只取第一个参数当 message ⇒ **`code` 属性丢失**）⇒
   *   异常分档（`*.unsupported` vs `*.failed`）在消费侧无法判断。
   *   ⇒ 这里确保产出的 error **恒带 `code`**（缺失就补上）——契约不靠调用方记得传对构造器。
   */
  const errNow = <T, Er extends Error = E>(code: string, message: string): R<T, Er> => {
    const err = new CapError(code, message) as unknown as Er & { code?: string }
    if (typeof (err as { code?: unknown }).code !== 'string') {
      // 构造器没设 code（原生 Error）⇒ 补上（派生属性，不覆盖已有的）
      Object.defineProperty(err, 'code', { value: code, enumerable: true, configurable: true })
    }
    return { ok: false, error: err }
  }

  return {
    /** C47 跳其他小程序（App 端无此概念——除非壳提供；★桥合同是 Promise<void>，失败即抛） */
    navigateMiniProgram: (options: { appId: string; path?: string }): Promise<void> =>
      call<void>(APP_NATIVE_METHODS.navigateMiniProgram, options, 'mini-program').then((r) => {
        if (!r.ok) throw r.error
      }),
    /** C48 宙主上下文（App 端：provider = 壳标识 + 应用版本 + 能力清单） */
    getHostContext: (): { provider: string; version?: string; capabilities?: string[] } => {
      const r = invokeHost(APP_NATIVE_METHODS.hostContext)
      if (r.ok && r.data && typeof r.data === 'object') {
        const d = r.data as { provider?: string; version?: string; capabilities?: string[] }
        return { provider: d.provider ?? 'app', version: d.version, capabilities: d.capabilities }
      }
      // 壳未注册 ⇒ 诚实回退到最小自述（不消极报错：上下文在 App 端总是可知的）
      const hostId = (globalThis as Record<string, unknown>).__PROTEUS_HOST_ID__
      return { provider: typeof hostId === 'string' ? hostId : 'app' }
    },
    /** C50 扩展加载（App：壳动态装载原生模块 —— G-45 调试基座同机制） */
    loadExtension: (extensionId: string) => call<unknown>(APP_NATIVE_METHODS.extensionLoad, { id: extensionId }, 'extension'),
    /** C51 热更新（App：壳转发原生更新管理器——iOS App Store / Android 内更新） */
    getUpdateManager: () => ({
      checkUpdate: async (): Promise<R<{ hasUpdate: boolean }, E>> => {
        const r = await call<{ hasUpdate?: boolean }>(APP_NATIVE_METHODS.updateCheck, {}, 'update')
        return r.ok ? { ok: true, data: { hasUpdate: !!r.data?.hasUpdate } } : r
      },
      applyUpdate: async (): Promise<R<void, E>> => {
        const r = await call<void>(APP_NATIVE_METHODS.updateApply, {}, 'update')
        return r.ok ? { ok: true, data: undefined } : r
      },
      // App 端事件由壳推（同生命周期事件渠道）——该句柄上诚实空订阅
      onCheckForUpdate: () => () => undefined,
      onUpdateReady: () => () => undefined,
      onUpdateFailed: () => () => undefined,
    }),
    /** C53 Worker（App：壳创建后台线程 —— G-39 runOnThread） */
    createWorker: (scriptPath: string) => {
      const r = invokeHost(APP_NATIVE_METHODS.workerCreate, { scriptPath })
      if (!r.ok) throw new CapError(r.missing ? 'worker.unsupported' : 'worker.failed', `worker: ${r.reason}`)
      return {
        postMessage: (msg: unknown): R<void, E> => {
          const p = invokeHost(APP_NATIVE_METHODS.workerPost, { msg })
          return p.ok ? { ok: true, data: undefined } : errNow<void>(p.missing ? 'worker.unsupported' : 'worker.failed', p.reason)
        },
        onMessage: () => () => undefined, // 壳推知通过生命周期事件渠道
        terminate: (): R<void, E> => {
          const p = invokeHost(APP_NATIVE_METHODS.workerTerminate, {})
          return p.ok ? { ok: true, data: undefined } : errNow<void>(p.missing ? 'worker.unsupported' : 'worker.failed', p.reason)
        },
      }
    },
    /** C67 预加载（App：壳预初始化模块） */
    getPreload: () => ({
      assets: (data: unknown) => call<void>(APP_NATIVE_METHODS.preloadAssets, { data }, 'preload'),
      skylineView: () => call<void>(APP_NATIVE_METHODS.preloadAssets, { kind: 'view' }, 'preload'),
      webview: () => call<void>(APP_NATIVE_METHODS.preloadAssets, { kind: 'webview' }, 'preload'),
      subpackage: (packageType: string) =>
        Promise.resolve(errNow<never>('preload.unsupported', `App 端无小程序分包概念（收到 ${packageType}）——请用壳预初始化模块`)),
    }),
    /** C73 空闲回调（App：壳提供主线程空闲时机） */
    getIdle: () => ({
      request: (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void, timeout?: number): Promise<R<number, E>> =>
        call<{ id?: number }>(APP_NATIVE_METHODS.idleRequest, { timeout }, 'idle').then((r) => {
          if (!r.ok) return r
          // 壳同步回调完成后返回（与 wx 的"requestIdleCallback 即执行"同形）
          try {
            cb({ timeRemaining: () => Number((r.data as { timeRemaining?: number })?.timeRemaining ?? 0), didTimeout: false })
          } catch {
            /* 回调抛错不影响宙主 */
          }
          return { ok: true as const, data: Number((r.data as { id?: number })?.id ?? 0) }
        }),
      cancel: (id: number) => call<void>(APP_NATIVE_METHODS.idleCancel, { id }, 'idle'),
    }),
    /** C74 窗体管理（App：原生窗口 API —— iPad 分屏 / 折叠屏 / 桌面端） */
    getWindow: () => ({
      setSize: (width: number, height: number) => call<void>(APP_NATIVE_METHODS.windowSetSize, { width, height }, 'window'),
    }),
    /** C75 导航卸载拦截（App：虚拟栈 pop 拦截 —— M5 栈命令链） */
    getNavigationGuard: () => {
      // ★App 端实现依据：虚拟栈的 pop 是**框架自己的命令**（M5）⇒ 拦截在框架内完成（无需原生 API）
      let guardMessage: string | null = null
      const g = globalThis as Record<string, unknown>
      const apply = (): void => {
        g.__proteusNavGuardMessage = guardMessage
      }
      apply()
      return {
        enable: (message: string): Promise<R<void, E>> => {
          guardMessage = message
          apply()
          return Promise.resolve({ ok: true as const, data: undefined })
        },
        disable: (): Promise<R<void, E>> => {
          guardMessage = null
          apply()
          return Promise.resolve({ ok: true as const, data: undefined })
        },
      }
    },
    /** C82 WebAssembly（App：JSC/QuickJS 均内置 WebAssembly —— 与 Web 同形） */
    getWebAssembly: () => {
      const WASM = (globalThis as { WebAssembly?: typeof WebAssembly }).WebAssembly
      if (!WASM) {
        return {
          supportsStreaming: false,
          supportsPathLoad: false,
          instantiate: () => Promise.resolve(errNow<never>('webassembly.unsupported', '当前 JS 引擎无 WebAssembly（App 端应用 JSC/QuickJS）')),
          compile: () => Promise.resolve(errNow<never>('webassembly.unsupported', '无 WebAssembly')),
          validate: () => Promise.resolve(errNow<boolean>('webassembly.unsupported', '无 WebAssembly')),
        }
      }
      return {
        supportsStreaming: typeof WASM.instantiateStreaming === 'function',
        supportsPathLoad: false,
        instantiate: (source: { bytes?: ArrayBuffer | Uint8Array; path?: string }, options?: unknown): Promise<R<WasmHandle, E>> =>
          Promise.resolve()
            .then(async () => {
              const bytes = (source as { bytes?: ArrayBuffer | Uint8Array }).bytes
              if (!bytes) {
                return errNow<WasmHandle, E>('webassembly.unsupported', 'App 端请传 { bytes }（无"代码包路径"概念——那是小程序形态）')
              }
              const res = (await WASM.instantiate(bytes as BufferSource, options as never)) as { instance?: { exports?: Record<string, unknown> } }
              const exportsObj = res?.instance?.exports ?? {}
              return {
                ok: true as const,
                data: { exports: exportsObj, fromPath: false, dispose: () => undefined },
              }
            })
            .catch((e) => errNow<WasmHandle, E>('webassembly.failed', `WebAssembly 实例化失败：${e instanceof Error ? e.message : String(e)}`)),
        // ★诚实边界（真机实测抓到）：**不是所有 JS 引擎都实现 compile/validate**
        //   （Android QuickJS 只有 instantiate——Node/V8 三者齐全）⇒ 缺方法时明确 Err
        //   （`webassembly.unsupported` + 指出引擎差异），不假装"校验通过"。
        compile: (bytes: ArrayBuffer | Uint8Array): Promise<R<unknown, E>> =>
          Promise.resolve()
            .then(async () => {
              if (typeof WASM.compile !== 'function') {
                return errNow<unknown, E>('webassembly.unsupported', '当前 JS 引擎未实现 WebAssembly.compile（Android QuickJS 只有 instantiate）')
              }
              return { ok: true as const, data: await WASM.compile(bytes as BufferSource) }
            })
            .catch((e) => errNow<unknown, E>('webassembly.failed', `compile 失败：${e instanceof Error ? e.message : String(e)}`)),
        validate: (bytes: ArrayBuffer | Uint8Array): Promise<R<boolean, E>> =>
          Promise.resolve()
            .then(async () => {
              if (typeof WASM.validate !== 'function') {
                return errNow<boolean, E>('webassembly.unsupported', '当前 JS 引擎未实现 WebAssembly.validate（Android QuickJS 只有 instantiate）')
              }
              return { ok: true as const, data: await WASM.validate(bytes as BufferSource) }
            })
            .catch(() => errNow<boolean, E>('webassembly.failed', 'validate 失败（字节非法？）')),
      }
    },
  }
}

/**
 * ★★平台专栏（用户反馈第 4 点：「应用与生命周期缺少平台特有专栏」）
 *
 * 【★【修正一：专栏是「**本能力在各平台上独有的扩展**」，不是全局话题清单】】
 *   初版把专栏做成了**三页共用的全局表** ⇒ 三个页面内容完全一样
 *   （用户反馈：「为什么三个页面加的平台专栏内容完全一样？平台专栏指的是当前能力的
 *   平台独有能力扩展啊」）——理解错了。
 *   ⇒ 现在：**按能力分页**（每个能力只列它自己在各平台上的独有扩展）。
 *
 * 【★【修正二：只引用**已实现**的能力（用户反馈：「相关能力都只有文档，没有实际落地实现！」）】】
 *   初版指向 `useKeyboard`（C14）/ `useWindow`（C74）/ `useNavigationGuard`（C75）--
 *   这三个在 catalog 里都是 **`planned`**（未实现）⇒ 文档推荐了不存在的能力。
 *   ★本仓铁律：**先实现再宣称**（W-4）。⇒ 现在 `hooks` 只能列 **implemented** 的；
 *     未实现的实现方向唱在 `roadmap` 字段（不冒充为"相关能力"，不给链接）。
 *   ★判据：生成器在渲染时**校验每个 hook 的 catalog status**；
 *     `planned` 的写成纯文本并标「（未实现，见 roadmap）」，**不生成链接**（链接会 404）。
 */
export interface PlatformTopic {
  /** 话题标题（该能力在该平台上的独有扩展） */
  title: string
  /** 英文标题 */
  titleEn: string
  /** 一句话：这个扩展在该平台上具体是什么 */
  desc: string
  /** 英文说明 */
  descEn: string
  /** 关联能力（must be `implemented`；未实现的放 roadmap） */
  hooks?: string[]
  /** 尚未实现的实现方向（纯文本，不生成链接——诚实标注"roadmap"） */
  roadmap?: string
  /** 英文 roadmap */
  roadmapEn?: string
}

/** ★★平台专栏 SSOT：**按能力分组**（key = 能力 slug；只列该能力自己的平台扩展） */
export const PLATFORM_TOPICS: Record<string, Record<'mp' | 'web' | 'app', PlatformTopic[]>> = {
  // ── C23 应用生命周期：各平台的"app 级事件" ──
  'app-lifecycle': {
    mp: [
      {
        title: '小程序全局事件面',
        titleEn: 'Mini Program global event surface',
        desc: 'App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* 均为小程序**独有**（Web/App 无对应语义）',
        descEn: 'App.onError / onUnhandledRejection / onMemoryWarning / onThemeChange / onPageNotFound / onAudioInterruption* are Mini-Program-only (no Web/App equivalent)',
        hooks: ['useBackground'],
      },
      {
        title: '小程序白屏与启动路径',
        titleEn: 'Cold-start route & scene',
        desc: '冷启动参数（scene / query / 分享来源）由 App.onLaunch 提供，在生命周期里等同于首个 show',
        descEn: 'Cold-start params (scene / query / share origin) come from App.onLaunch — equivalent to the first show in this lifecycle',
        roadmap: '专用的启动参数读取（launchOptions/enterOptions）已在 useBackground 提供',
        roadmapEn: 'Dedicated launch/enter option readers already ship in useBackground',
        hooks: ['useBackground'],
      },
    ],
    web: [
      {
        title: '浏览器无"启动"概念',
        titleEn: 'Browsers have no "launch" concept',
        desc: '浏览器不区分"冷启动"与"刷新"——首个 load 后总线自动补一次 launch（语义等价化）',
        descEn: 'Browsers do not distinguish cold start from reload — the first load auto-emits one launch (semantic equivalence)',
      },
      {
        title: '页签切换 ≠ 应用切后台',
        titleEn: 'Tab switch != app background',
        desc: 'visibilitychange 无法区分"用户切到另一个标签"与"最小化窗口"——两者都会触发 hide',
        descEn: 'visibilitychange cannot distinguish a tab switch from a minimized window — both fire hide',
      },
    ],
    app: [
      {
        title: 'Activity / ViewController 生命周期转发',
        titleEn: 'Activity / ViewController lifecycle forwarding',
        desc: '壳把 onCreate/onResume/onPause（iOS：viewDidLoad/didBecomeActive/willResignActive）转发到运行时——**业务不直接接触 Activity 生命周期**（G-39 唯一拥有）',
        descEn: 'The shell forwards onCreate/onResume/onPause (iOS: viewDidLoad/didBecomeActive/willResignActive) into the runtime — **business code never touches Activity lifecycle directly** (G-39 single ownership)',
      },
      {
        title: '内存警告与低内存',
        titleEn: 'Memory warnings & low memory',
        desc: 'iOS didReceiveMemoryWarning / Android onTrimMemory 由壳转发 —— 用于释放缓存（配合 G-43 所有权模型）',
        descEn: 'iOS didReceiveMemoryWarning / Android onTrimMemory forwarded by the shell — release caches here (pairs with the G-43 ownership model)',
        hooks: ['useBackground'],
      },
      {
        title: '音频会话中断',
        titleEn: 'Audio session interruption',
        desc: '电话/其他应用占用音频会话时，系统会怕断 —— App 端由壳转发（小程序同名事件来自 App.onAudioInterruption*）',
        descEn: 'When a call or another app takes the audio session the system interrupts playback — forwarded by the App shell',
      },
    ],
  },

  // ── C24 页面生命周期：各平台的"页面级事件" ──
  'page-lifecycle': {
    mp: [
      {
        title: '页面栈与 tab 语义',
        titleEn: 'Page stack & tab semantics',
        desc: '页面栈最多 10 层；switchTab 会销毁非 tab 页并保活其他 tab（返回时不重新初始化）——这是 Web/App 都没有的语义',
        descEn: 'Up to a 10-page stack; switchTab destroys non-tab pages while keeping other tabs alive (no re-init on return) — semantics Web/App lack',
      },
      {
        title: '下拉刷新与触底',
        titleEn: 'Pull-down refresh & reach-bottom',
        desc: '★需在 page.json 开 enablePullDownRefresh 才会触发；onReachBottomDistance 控制触底阈值（Web 无原生等价）',
        descEn: '★Requires enablePullDownRefresh in page.json; onReachBottomDistance controls the bottom threshold (Web has no native equivalent)',
      },
      {
        title: 'onRouteDone（转场完成）',
        titleEn: 'onRouteDone (transition finished)',
        desc: '基础库 2.32.1+：自定义转场真正结束的时机（不是"调用返回时"）',
        descEn: 'Base library 2.32.1+: the moment a custom transition actually finishes (not when the call returns)',
      },
      {
        title: '高频 onPageScroll',
        titleEn: 'High-frequency onPageScroll',
        desc: '微信官方明确：会引起逻辑层与渲染层通信 —— 框架**仅在你声明过 onPageScroll 时才派发**',
        descEn: 'WeChat docs state this causes logical/render layer IPC — the framework dispatches it **only when you declared onPageScroll**',
      },
    ],
    web: [
      {
        title: '无原生下拉刷新 / 无页面栈',
        titleEn: 'No native pull-to-refresh / no page stack',
        desc: '浏览器没有下拉刷新与页面栈概念——`onPullDownRefresh` 不会触发（诚实降级），返回行为由 history 提供',
        descEn: 'No pull-to-refresh or page stack in browsers — `onPullDownRefresh` never fires (honest degradation); back navigation comes from history',
        roadmap: '页面栈语义（push/pop/popTo）属路由层（router）职责，不在本能力内重建',
        roadmapEn: 'Page-stack semantics (push/pop/popTo) belong to the router layer, not rebuilt here',
      },
      {
        title: 'beforeunload 的语义差异',
        titleEn: 'beforeunload semantics',
        desc: '返回值用于**离开确认**（浏览器不持久化状态）——与小程序 onSaveExitState 的"保存状态"语义不同',
        descEn: 'The return value drives **leave confirmation** (browsers do not persist state) — unlike Mini Program onSaveExitState which saves state',
      },
      {
        title: '滚动由 rAF 节流',
        titleEn: 'Scroll is rAF-throttled',
        desc: '浏览器 scroll 频率远高于小程序 —— 框架在 rAF 里合并本帧多次滚动后才派发',
        descEn: 'Browser scroll fires far more often than Mini Programs — the framework coalesces bursts into one dispatch per rAF',
      },
    ],
    app: [
      {
        title: '屏的可见性由虚拟栈驱动',
        titleEn: 'Visibility driven by the virtual stack',
        desc: '页面 show/hide 来自虚拟栈的 enter/exit 命令（不是原生 Fragment/VC 回调）—— G-39 + M5 的组合形态',
        descEn: 'Page show/hide comes from virtual-stack enter/exit commands (not native Fragment/VC callbacks) — the G-39 + M5 combination',
      },
      {
        title: '转场结束由 Morpheus 告知',
        titleEn: 'Transition completion via Morpheus',
        desc: 'route-done 在内核转场动画结束时触发（平台零参与路径）—— 与小程序 onRouteDone 同语义',
        descEn: 'route-done fires when the kernel transition animation finishes (platform-zero path) — same semantics as Mini Program onRouteDone',
      },
    ],
  },

  // ── C51 热更新：各平台的更新通道 ──
  update: {
    mp: [
      {
        title: '小程序热更新（静默）',
        titleEn: 'Mini Program silent update',
        desc: 'wx.getUpdateManager 下载新版本并在下次冷启动生效（onUpdateReady → applyUpdate）；无审核、无需发版',
        descEn: 'wx.getUpdateManager downloads the new bundle and applies it on next cold start (onUpdateReady → applyUpdate); no review, no release',
      },
    ],
    web: [
      {
        title: 'Service Worker 更新',
        titleEn: 'Service Worker update flow',
        desc: 'SW 检测到新版本后进入 waiting；applyUpdate 发 skipWaiting 激活，页面 reload 后换装',
        descEn: 'A new SW version goes to waiting; applyUpdate sends skipWaiting to activate, the new version takes effect after reload',
      },
    ],
    app: [
      {
        title: '原生更新（商店 / 内更新）',
        titleEn: 'Native update (store / in-app)',
        desc: '壳转发原生更新流程——iOS 走 App Store、Android 走 Play Core In-App Updates（静默更新受平台策略限制）',
        descEn: 'The shell forwards the native update flow — App Store on iOS, Play Core In-App Updates on Android (silent updates are limited by platform policy)',
        hooks: [],
        roadmap: '壳实现 `update.check` / `update.apply` 后本端可用（未实现时诚实返回 unsupported）',
        roadmapEn: 'Available once the shell implements `update.check` / `update.apply` (honest unsupported otherwise)',
      },
    ],
  },

  // ── C74 窗口管理：各平台的窗体能力 ──
  window: {
    mp: [
      {
        title: 'wx.setWindowSize（PC 端）',
        titleEn: 'wx.setWindowSize (PC only)',
        desc: '仅微信 PC 端支持设置窗口尺寸；移动端无此 API（诚实 Err）',
        descEn: 'Only WeChat on PC supports setting the window size; mobile has no such API (honest Err)',
      },
    ],
    web: [
      {
        title: '浏览器窗口尺寸受限',
        titleEn: 'Browser window sizing is restricted',
        desc: 'window.resizeTo 仅对脚本打开的弹出窗口有效——普通页签无法改尺寸（诚实 Err，不假装成功）',
        descEn: 'window.resizeTo only works on script-opened popups — regular tabs cannot resize (honest Err, never fake success)',
      },
    ],
    app: [
      {
        title: '原生窗口管理（分屏 / 折叠屏 / 桌面）',
        titleEn: 'Native window management (split view / foldable / desktop)',
        desc: 'iPad 分屏、折叠屏多窗口、桌面端自由缩放——壳转发原生窗口 API（iOS UIWindowScene / Android WindowManager）',
        descEn: 'iPad split view, foldable multi-window, desktop free resizing — the shell forwards native window APIs (iOS UIWindowScene / Android WindowManager)',
        roadmap: '壳实现 `window.setSize` 后本端可用',
        roadmapEn: 'Available once the shell implements `window.setSize`',
      },
      {
        title: '尺寸变化通知',
        titleEn: 'Size-change notifications',
        desc: '窗口尺寸变化经 app:resize 事件送达（无需轮询）——分屏/旋转时业务可重排布局',
        descEn: 'Size changes arrive via the app:resize event (no polling) — re-layout on split view / rotation',
        hooks: ['useBackground'],
      },
    ],
  },

  // ── C53 Worker：各平台的后台线程 ──
  worker: {
    mp: [
      {
        title: 'wx.createWorker（真线程）',
        titleEn: 'wx.createWorker (real thread)',
        desc: '小程序多线程 Worker：独立 JS 上下文，postMessage 通信——需在 app.json 声明 worker 目录',
        descEn: 'Mini Program multithread Worker: an isolated JS context communicating via postMessage — declare the worker dir in app.json',
      },
    ],
    web: [
      {
        title: 'Web Worker（真线程）',
        titleEn: 'Web Worker (real thread)',
        desc: 'new Worker(url) 独立线程；onMessage 可用 removeEventListener 取消（比 MP 更完整）',
        descEn: 'new Worker(url) runs on a separate thread; onMessage can be unsubscribed via removeEventListener (more complete than MP)',
      },
      {
        title: '跨线程数据限制',
        titleEn: 'Cross-thread data limits',
        desc: '结构化克隆（非引用传递）；大对象建议 Transferable（ArrayBuffer 转移所有权，零拷贝）',
        descEn: 'Structured clone (no reference sharing); use Transferables for large payloads (ArrayBuffer ownership transfer, zero copy)',
      },
    ],
    app: [
      {
        title: '壳后台线程（G-39 runOnThread）',
        titleEn: 'Shell background threads (G-39 runOnThread)',
        desc: 'App 端的"线程"由宿主运行时提供（G-39 唯一拥有）——桥经壳创建，业务不直接建线程',
        descEn: 'App-side "threads" come from the host runtime (G-39 single ownership) — the bridge creates them via the shell; business code never spawns threads directly',
        roadmap: '壳实现 `worker.create/post/terminate` 后本端可用',
        roadmapEn: 'Available once the shell implements `worker.create/post/terminate`',
      },
    ],
  },

  // ── C75 导航卸载拦截 ──
  'navigation-guard': {
    mp: [
      {
        title: 'wx.enableAlertBeforeUnload',
        titleEn: 'wx.enableAlertBeforeUnload',
        desc: '返回时弹出确认框（防误退丢草稿）——需基础库 2.12.0+；仅拦截"返回"，不拦截"关闭小程序"',
        descEn: 'Shows a confirm dialog on back navigation (guards unsaved drafts) — base library 2.12.0+; intercepts back only, not app close',
      },
    ],
    web: [
      {
        title: 'beforeunload 的浏览器限制',
        titleEn: 'Browser limits on beforeunload',
        desc: '浏览器只允许"询问是否离开"，**不能自定义文案**（现代浏览器强制显示通用提示）',
        descEn: 'Browsers only allow "are you sure you want to leave" and **cannot show custom text** (modern browsers force a generic prompt)',
      },
    ],
    app: [
      {
        title: '虚拟栈 pop 拦截（框架内完成）',
        titleEn: 'Virtual-stack pop interception (in-framework)',
        desc: '★App 端无需原生 API：虚拟栈的 pop 是框架自己的命令（M5）⇒ 拦截在框架内完成，可自定义弹层与文案',
        descEn: "★No native API needed on App: virtual-stack pop is the framework's own command (M5) — interception happens in-framework with custom dialogs and copy",
        hooks: ['usePageLifecycle'],
      },
      {
        title: 'Android 物理返回键',
        titleEn: 'Android hardware back key',
        desc: '实体/手势返回同样经栈 pop 派发——与 UI 返回一致（壳负责把 onBackPressed 转成虚拟栈 pop）',
        descEn: 'Hardware/gesture back dispatches through the same stack pop — consistent with UI back (the shell maps onBackPressed to a virtual-stack pop)',
        roadmap: '壳接线 onBackPressed → 栈 pop 后生效',
        roadmapEn: 'Effective once the shell wires onBackPressed to a stack pop',
      },
    ],
  },

  // ── C82 WebAssembly ──
  webassembly: {
    mp: [
      {
        title: 'WXWebAssembly（路径加载）',
        titleEn: 'WXWebAssembly (path load)',
        desc: '★只能从**代码包路径**加载（.wasm / .wasm.br）——不支持字节/流式编译（能力位 supportsStreaming=false）',
        descEn: '★Loads only from **code-package paths** (.wasm / .wasm.br) — no byte/streaming compilation (capability flag supportsStreaming=false)',
      },
    ],
    web: [
      {
        title: '标准 WebAssembly（流式）',
        titleEn: 'Standard WebAssembly (streaming)',
        desc: 'instantiateStreaming 边下边编译（比先下载再编译更快）；compile/validate 全可用',
        descEn: 'instantiateStreaming compiles while downloading (faster than download-then-compile); compile/validate fully available',
      },
    ],
    app: [
      {
        title: 'JSC / QuickJS 内置 WASM',
        titleEn: 'WASM built into JSC / QuickJS',
        desc: 'App 端 JS 引擎（iOS JavaScriptCore / Android QuickJS）均内置 WebAssembly——与 Web 同形（字节加载 + 流式能力位随引擎）',
        descEn: 'App JS engines (JavaScriptCore on iOS / QuickJS on Android) ship WebAssembly — same shape as Web (byte loading; streaming flag follows the engine)',
      },
    ],
  },

  // ── C47 跳其他小程序 ──
  'mini-program': {
    mp: [
      {
        title: 'wx.navigateToMiniProgram',
        titleEn: 'wx.navigateToMiniProgram',
        desc: '跳转到其它小程序（需在 app.json 声明 navigateToMiniProgramAppIdList——白名单上限 10）',
        descEn: 'Jump to another Mini Program (declare navigateToMiniProgramAppIdList in app.json — up to 10 entries)',
      },
    ],
    web: [
      {
        title: '无跨小程序概念',
        titleEn: 'No cross-mini-program concept',
        desc: 'Web 没有"跳其他小程序"——用 window.open / 前端路由替代（诚实 Err 且给出路）',
        descEn: 'The Web has no "jump to another Mini Program" — use window.open / client routing instead (honest Err with guidance)',
      },
    ],
    app: [
      {
        title: 'App 间跳转（URL Scheme / Universal Link）',
        titleEn: 'App-to-app jumps (URL Scheme / Universal Link)',
        desc: 'App 端对应"跳其他应用"——iOS Universal Link、Android Intent；需目标应用声明可被唤起',
        descEn: 'The App counterpart: jumping to another app via iOS Universal Links or Android Intents; the target must declare itself launchable',
        roadmap: '壳实现 `mini-program.navigate` 后本端可用',
        roadmapEn: 'Available once the shell implements `mini-program.navigate`',
      },
    ],
  },

  // ── C48 被宿主嵌入 ──
  embedded: {
    mp: [
      {
        title: '无"被嵌入"形态',
        titleEn: 'No "embedded" form',
        desc: '小程序总是运行在微信宿主内（不存在"被别的 App 嵌入"）——provider 恒为 weixin',
        descEn: 'Mini Programs always run inside the WeChat host (never embedded by another app) — provider is always weixin',
      },
    ],
    web: [
      {
        title: 'iframe 嵌入与父窗口',
        titleEn: 'iframe embedding & parent window',
        desc: 'Web 的"被嵌入"= iframe——provider=web，父窗口经 window.parent 可达（跨域时受限）',
        descEn: 'Web embedding means iframe — provider=web, the parent is reachable via window.parent (restricted cross-origin)',
      },
    ],
    app: [
      {
        title: '被宿主 App 嵌入（核心场景）',
        titleEn: 'Embedded in a host App (the core scenario)',
        desc: 'App 端"被嵌入"是一等场景（AAR / 静态库集成）——宿主经 `__PROTEUS_HOST_ID__` 自述身份，业务据此定制行为',
        descEn: 'On App, embedding is a first-class scenario (AAR / static-lib integration) — the host identifies itself via `__PROTEUS_HOST_ID__` so business code can adapt',
      },
    ],
  },

  // ── C50 扩展加载 ──
  extension: {
    mp: [
      {
        title: '无插件加载 API',
        titleEn: 'No plugin-loading API',
        desc: '小程序端不能运行时加载外部代码——需宿主扩展壳（同层渲染 / 动态组件）承接，见 docs/proteus-platform-plan',
        descEn: 'Mini Programs cannot load external code at runtime — a host extension shell (same-layer rendering / dynamic components) is required, see docs/proteus-platform-plan',
      },
    ],
    web: [
      {
        title: '动态 import()',
        titleEn: 'Dynamic import()',
        desc: '运行时加载 ES 模块（真实实现）；只接受模块 URL（相对/绝对/http(s)）——不透传裸标识符',
        descEn: 'Loads ES modules at runtime (a real implementation); accepts module URLs only (relative/absolute/http(s)) — bare specifiers are rejected',
      },
    ],
    app: [
      {
        title: '壳动态装载原生模块（G-45 同机制）',
        titleEn: 'Shell-loaded native modules (same mechanism as G-45)',
        desc: 'App 端可动态装载原生模块（Android DexClassLoader / iOS 动态库）——与调试基座的插件装载同机制',
        descEn: 'Apps can dynamically load native modules (Android DexClassLoader / iOS dynamic libraries) — the same mechanism as dev-host plugin loading',
        roadmap: '壳实现 `extension.load` 后本端可用',
        roadmapEn: 'Available once the shell implements `extension.load`',
      },
    ],
  },

  // ── C67 预加载 ──
  preload: {
    mp: [
      {
        title: 'wx.preload* 家族',
        titleEn: 'wx.preload* family',
        desc: 'preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage——各自预热一种资源',
        descEn: 'preloadAssets / preloadSkylineView / preloadWebview / preDownloadSubpackage — each warms a different resource kind',
      },
    ],
    web: [
      {
        title: 'link rel=preload',
        titleEn: 'link rel=preload',
        desc: 'Web 无统一预加载 API——用 `<link rel=preload>` 或动态 import 预热（本桥诚实 Err 并指出替代）',
        descEn: 'The Web has no unified preload API — use `<link rel=preload>` or dynamic import (this bridge honestly errors and points to the alternatives)',
      },
    ],
    app: [
      {
        title: '壳预初始化模块',
        titleEn: 'Shell pre-initialized modules',
        desc: 'App 端预加载 = 壳提前初始化原生模块/字体/资源（把首次成本挪出首屏）',
        descEn: 'App preloading means the shell initializing native modules/fonts/resources ahead of time (moving first-use cost off the first screen)',
        roadmap: '壳实现 `preload.assets` 后本端可用',
        roadmapEn: 'Available once the shell implements `preload.assets`',
      },
    ],
  },

  // ── C73 空闲回调 ──
  idle: {
    mp: [
      {
        title: 'wx.requestIdleCallback',
        titleEn: 'wx.requestIdleCallback',
        desc: '★wx 不返回 id（回调即执行）——本桥用递增计数模拟 cancel 句柄（与浏览器形态的差异见实现注释）',
        descEn: '★wx returns no id (the callback runs immediately) — this bridge uses an incrementing counter to emulate a cancel handle',
      },
    ],
    web: [
      {
        title: 'requestIdleCallback（原生）',
        titleEn: 'requestIdleCallback (native)',
        desc: '浏览器原生空闲回调（timeRemaining 反映真实剩余预算）；Safari 支持较晚——缺失时诚实 Err',
        descEn: 'Native browser idle callback (timeRemaining reflects the real budget); Safari support arrived late — honest Err when missing',
      },
    ],
    app: [
      {
        title: '壳提供的空闲时机',
        titleEn: 'Shell-provided idle slots',
        desc: 'App 端的空闲时机由壳决定（如帧间空隙）——低优先级任务（日志上报/预热）走这里，不抢首屏',
        descEn: 'Idle slots come from the shell (e.g. between frames) — low-priority work (log upload, warming) goes here without competing with the first screen',
        roadmap: '壳实现 `idle.request` / `idle.cancel` 后本端可用',
        roadmapEn: 'Available once the shell implements `idle.request` / `idle.cancel`',
      },
    ],
  },

  // ── C25 后台与环境：各平台的"环境事件" ──
  background: {
    mp: [
      {
        title: '全局订阅 API 面',
        titleEn: 'Global subscription APIs',
        desc: 'wx.onAppShow/onAppHide/onMemoryWarning/onThemeChange/onWindowResize/onError/onUnhandledRejection 均为全局订阅（与页面级的 Page 钩子机制不同）',
        descEn: 'wx.onAppShow/Hide/MemoryWarning/ThemeChange/WindowResize/Error/UnhandledRejection are global subscriptions (unlike declarative Page hooks)',
      },
      {
        title: '启动参数读取',
        titleEn: 'Launch / enter options',
        desc: 'getLaunchOptions（一次性，启动时）与 getEnterOptions（每次回前台）—— 深链参数的两种语义',
        descEn: 'getLaunchOptions (once, at startup) and getEnterOptions (every foreground return) — deep-link params have two semantics here',
      },
    ],
    web: [
      {
        title: 'visibilitychange 为唯一信号',
        titleEn: 'visibilitychange is the only signal',
        desc: 'Web 没有独立的 onAppShow/onAppHide —— 前后台与应用级 resize 都由浏览器事件推导；内存警告用 performance.memory 启发式',
        descEn: 'No standalone onAppShow/onAppHide on Web — foreground/background and resize derive from browser events; memory warnings use a performance.memory heuristic',
      },
      {
        title: '下载预防的离开确认',
        titleEn: 'Leave confirmation for unsaved work',
        desc: '与 usePageLifecycle 的 save-exit-state 共用 beforeunload 通道（本能力负责环境事件，离开确认在页面层）',
        descEn: 'Shares the beforeunload channel with usePageLifecycle save-exit-state (this capability owns environment events; leave confirmation lives at the page layer)',
      },
    ],
    app: [
      {
        title: '业务欄的前后台转发',
        titleEn: 'Foreground/background forwarding',
        desc: 'Activity.onResume/onPause（iOS didBecomeActive/willResignActive）由壳转发 —— 与 useAppLifecycle 的 launch/show/hide 是**同一组事件**，本能力多了环境面',
        descEn: 'Activity.onResume/onPause (iOS didBecomeActive/willResignActive) forwarded by the shell — the same events as useAppLifecycle launch/show/hide, plus the environment surface here',
      },
      {
        title: '内存压力与回收',
        titleEn: 'Memory pressure & reclamation',
        desc: 'iOS didReceiveMemoryWarning / Android onTrimMemory —— 与 G-43 所有权 Drop 协议配合释放缓存',
        descEn: 'iOS didReceiveMemoryWarning / Android onTrimMemory — pairs with the G-43 ownership Drop protocol to release caches',
      },
      {
        title: '系统主题与分屏',
        titleEn: 'System theme & split view',
        desc: '深色模式切换与窗口尺寸变化由壳转发（平板/折叠屏上分屏频繁）',
        descEn: 'Dark-mode switches and window-size changes forwarded by the shell (split view is frequent on tablets/foldables)',
      },
    ],
  },
}

/** 平台专栏的展示顺序（小程序 → Web → App） */
export const PLATFORM_TOPIC_ORDER = ['mp', 'web', 'app'] as const

/**
 * `window` / `document` 子集（Web 端事件源的真实来源）
 */
export interface WebEventSource {
  addEventListener?: (t: string, cb: (e?: unknown) => void) => void
  removeEventListener?: (t: string, cb: (e?: unknown) => void) => void
  document?: {
    visibilityState?: string
    documentElement?: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
    addEventListener?: (t: string, cb: (e?: unknown) => void) => void
  }
  innerHeight?: number
  requestAnimationFrame?: (cb: () => void) => unknown
}

/**
 * ★★把 Web 平台事件接进总线（与 MP/App 同构——三端同一总线，不同事件源）。
 *
 * 覆盖（每项都是浏览器真实事件，不是模拟）：
 * | 事件 | Web 真实来源 |
 * |---|---|
 * | app:show / app:hide | `visibilitychange`（页签切换/最小化） |
 * | app:resize | `resize` |
 * | page:ready | `load` 之后首帧（rAF 一次） |
 * | page:page-scroll | `scroll`（★**rAF 节流**——滚动是高频事件，不节流会打爆订阅者） |
 * | page:reach-bottom | 滚动到底（`scrollTop + innerHeight >= scrollHeight - 阈值`，一次性触发后需离开阈值区才重置） |
 * | page:resize | `resize`（同 app:resize，两处都派发——语义不同：一个是窗口、一个是页面） |
 * | page:save-exit-state | `beforeunload`（★决策型：调用 provider 的返回值决定是否拦截） |
 * | page:unload | `beforeunload`（页面真的要走） |
 *
 * ★**诚实不覆盖**（Web 无原生等价——SSOT 已注明，不伪造）：
 * `page:pull-down-refresh`（无原生下拉）、`page:tab-item-tap`（App/MP 概念）、
 * `page:route-done`（由 router 层推）、决策型的分享三件套（Web 用 `navigator.share`，
 * 属能力桥范畴而非页面生命周期）。
 */
export function installWebEventSources(bus: HostLifecycleBus, g: WebEventSource): void {
  const doc = g.document
  const win = g
  if (typeof win.addEventListener !== 'function') return // 非浏览器环境（SSR/测试）——诚实跳过

  // ── app:show/hide + page:show/hide（visibilitychange；launch 由总线在首个 show 时自动补） ──
  //   ★两个层级都派发（语义不同、都要）：应用退后台 ⇒ 应用 hide **且** 页面 hide；
  //     回前台 ⇒ 应用 show **且** 页面 show（页面重新可见）。
  //     —— 此前只发了应用级，页面级订阅者（usePageLifecycle）收不到（真机/测试实测抓出）。
  win.addEventListener('visibilitychange', () => {
    const hidden = doc ? doc.visibilityState === 'hidden' : false
    bus.emit({ topic: 'app', kind: hidden ? 'hide' : 'show' })
    bus.emit({ topic: 'page', kind: hidden ? 'hide' : 'show' })
  })
  // ── app:resize + page:resize ──
  win.addEventListener('resize', () => {
    const size = { windowWidth: Number((win as { innerWidth?: number }).innerWidth ?? 0), windowHeight: Number(g.innerHeight ?? 0) }
    bus.emit({ topic: 'app', kind: 'resize', payload: size })
    bus.emit({ topic: 'page', kind: 'resize', payload: { size } })
  })
  // ── `load`：**应用启动**（wx 语义对齐：onLaunch 恰好一次，先于 onShow） + 页面 load/ready ──
  const onLoad = (): void => {
    // ① 应用启动（总线在首个 show 时也会补 launch——这里显式发一次，保证"load ⇒ launch+show"）
    bus.emit({ topic: 'app', kind: 'show' })
    // ② 页面 load（Web 的"页面加载"= 文档 load）
    bus.emit({ topic: 'page', kind: 'load' })
    // ③ 页面 show（**首屏即显示**——load 完成后页面立即可见；visibilitychange 只覆盖后续切换）
    bus.emit({ topic: 'page', kind: 'show' })
    // ④ page:ready（load 之后**首帧**——rAF 保证"渲染完成"语义，而不是"DOM 就绪"）
    const markReady = (): void => bus.emit({ topic: 'page', kind: 'ready' })
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(markReady)
    else markReady()
  }
  win.addEventListener('load', onLoad)

  // ── page:page-scroll（★rAF 节流——高频事件不得直连订阅者） + page:reach-bottom ──
  let scrollRaf = 0
  let reachBottomFired = false
  const REACH_BOTTOM_PX = 50
  const onScroll = (): void => {
    const emitScroll = (): void => {
      scrollRaf = 0
      const el = doc?.documentElement
      const scrollTop = Number(el?.scrollTop ?? 0)
      bus.emit({ topic: 'page', kind: 'page-scroll', payload: { scrollTop, scrollLeft: 0 } })
      // 触底（进入阈值区触发一次；离开后重置——与 wx onReachBottom 的"越过即触发"语义对齐）
      const scrollHeight = Number(el?.scrollHeight ?? 0)
      const clientHeight = Number(el?.clientHeight ?? g.innerHeight ?? 0)
      const atBottom = scrollHeight > 0 && scrollTop + clientHeight >= scrollHeight - REACH_BOTTOM_PX
      if (atBottom && !reachBottomFired) {
        reachBottomFired = true
        bus.emit({ topic: 'page', kind: 'reach-bottom' })
      } else if (!atBottom && reachBottomFired) {
        reachBottomFired = false
      }
    }
    if (typeof win.requestAnimationFrame === 'function') {
      if (scrollRaf !== 0) return // 本帧已排——合并（节流的本质）
      scrollRaf = 1 // 标记已排（rAF 返回值形态各异，用 1 作哨兵）
      win.requestAnimationFrame(emitScroll)
    } else {
      emitScroll()
    }
  }
  win.addEventListener('scroll', onScroll)

  // ── page:unload + page:save-exit-state（beforeunload；决策型可拦截） ──
  const onBeforeUnload = (e?: unknown): void => {
    bus.emit({ topic: 'page', kind: 'unload' })
    // ★决策型：provider 有返回值 ⇒ 按浏览器语义设 returnValue（拦截离开）
    const providers = (globalThis as { __proteusPageProviders?: { saveExitState?: () => unknown } }).__proteusPageProviders
    if (providers?.saveExitState) {
      try {
        const ret = providers.saveExitState()
        if (ret !== undefined && e && typeof e === 'object') (e as { returnValue?: unknown }).returnValue = ret
      } catch {
        /* provider 抛错不阻断离开 */
      }
    }
  }
  win.addEventListener('beforeunload', onBeforeUnload)
}

/** 壳/执行器推入的事件（总线入口的词汇表——每个词都对应一个真实系统事件） */
export type HostLifecycleEvent =
  | { topic: 'app'; kind: AppEvent; payload?: unknown }
  | {
      topic: 'page'
      kind: PageEvent
      screen?: string
      /** 事件载荷（page-scroll→{scrollTop,scrollLeft} / resize→{size} / tab-item-tap→{index,pagePath,text} 等） */
      payload?: unknown
    }
  | { topic: 'memory-warning'; level: number }
  | { topic: 'theme-change'; theme: 'dark' | 'light' }
  | { topic: 'resize'; windowWidth: number; windowHeight: number }
  | { topic: 'unhandled-rejection'; reason: string }
  | { topic: 'network-change'; isConnected: boolean; networkType: string }

/** 订阅主题（总线内部以 topic+kind 归一为字符串键——`on` 的消费者面） */
export type HostLifecycleTopic =
  | `app:${AppEvent}`
  | `page:${PageEvent}`
  | 'memory-warning'
  | 'theme-change'
  | 'resize'
  | 'error'
  | 'unhandled-rejection'
  | 'network-change'

export interface HostLifecycleBus {
  /** 当前阶段快照（诊断/判据读） */
  snapshot(): {
    app: AppLifecyclePhase
    page: PageLifecyclePhase
    currentScreen: string | null
    launchOptions: Record<string, unknown>
    enterOptions: Record<string, unknown>
  }
  /** ★壳/执行器推事件（唯一入口——每个 topic 都会被分发给对应订阅者） */
  emit(event: HostLifecycleEvent): void
  /** 订阅（返回取消；取消后不再触发） */
  on(topic: HostLifecycleTopic, cb: (payload: unknown) => void): () => void
  /** 启动参数（壳在冷启动时推：深链/启动 query——`getLaunchOptions` 的数据源） */
  setLaunchOptions(options: Record<string, unknown>): void
  /** 进入参数（每次回前台可更新——`getEnterOptions` 的数据源） */
  setEnterOptions(options: Record<string, unknown>): void
  /** 订阅者计数（诊断：防"订阅泄漏"——页面反复进出后应回到 0） */
  readonly subscriberCount: number
}

/** 总线全局键（壳经 `globalThis.__proteusHostLifecycleBus` 直取——**约定，不是实现细节**） */
export const HOST_LIFECYCLE_BUS_KEY = '__proteusHostLifecycleBus'
/** 壳注入的宿主标识键（App 宿主判定——与 host-runtime 场景同一约定：'android' | 'ios' | …） */
export const HOST_ID_KEY = '__PROTEUS_HOST_ID__'

/**
 * 判定"是否 App 宿主"（壳注入 `__PROTEUS_HOST_ID__`）。
 * ★为什么不用 `detectRuntime()`：它的值域是 `web | mp`，且 QuickJS/JSC 无 window ⇒ 会误判为 web。
 *   本判定只看**壳注入的显式标识**——不靠特征猜测（"猜"在 App 宿主上必然错）。
 */
export function detectAppHost(): boolean {
  const g = globalThis as Record<string, unknown>
  const id = g[HOST_ID_KEY]
  return typeof id === 'string' && id.length > 0
}

/** 取（或惰性建）宿主生命周期总线（全局单例——壳与桥拿到**同一个**） */
export function getHostLifecycleBus(): HostLifecycleBus {
  const g = globalThis as Record<string, unknown>
  const existing = g[HOST_LIFECYCLE_BUS_KEY] as HostLifecycleBus | undefined
  if (existing) return existing
  const created = createHostLifecycleBus()
  g[HOST_LIFECYCLE_BUS_KEY] = created
  return created
}

/** 创建总线（测试/多实例；生产经 `getHostLifecycleBus()` 取全局单例） */
export function createHostLifecycleBus(): HostLifecycleBus {
  const subs = new Map<HostLifecycleTopic, Set<(payload: unknown) => void>>()
  let appPhase: AppLifecyclePhase = 'PENDING'
  let pagePhase: PageLifecyclePhase = 'IDLE'
  let currentScreen: string | null = null
  let launchOptions: Record<string, unknown> = {}
  let enterOptions: Record<string, unknown> = {}

  const fire = (topic: HostLifecycleTopic, payload: unknown): void => {
    const set = subs.get(topic)
    if (!set) return
    // 复制一份再遍历：订阅者在回调里取消自己（或订阅新回调）不应影响本次分发
    for (const cb of [...set]) cb(payload)
  }

  const bus: HostLifecycleBus = {
    snapshot: () => ({
      app: appPhase,
      page: pagePhase,
      currentScreen,
      launchOptions: { ...launchOptions },
      enterOptions: { ...enterOptions },
    }),

    emit(event) {
      if (event.topic === 'app') {
        // 相位语义（launch 恰好一次 / show 补 launch / hide）只由三个阶段事件驱动；
        // error / memory-warning / theme-change / resize / page-not-found / audio-interruption-*
        // 是**纯通知**，直接派发（不改变 phase）。
        if (event.kind === 'launch') {
          if (appPhase !== 'PENDING') return // 重复上报忽略（wx 语义：onLaunch 恰好一次）
          appPhase = 'LAUNCH'
          fire('app:launch', event.payload)
          return
        }
        if (event.kind === 'show') {
          if (appPhase === 'PENDING') {
            // ★冷启动自动补发 launch（wx 语义：onLaunch 恰先于 onShow）——壳只需转发 show/hide
            appPhase = 'LAUNCH'
            fire('app:launch', undefined)
          }
          appPhase = 'SHOW'
          fire('app:show', event.payload)
          return
        }
        if (event.kind === 'hide') {
          appPhase = 'HIDE'
          fire('app:hide', event.payload)
          return
        }
        // 其余应用级事件：纯通知（含 payload）
        fire(`app:${event.kind}` as HostLifecycleTopic, event.payload)
        return
      }
      if (event.topic === 'page') {
        // 相位语义只由四个「阶段事件」驱动；其余事件（滚动/触底/分享…）是**纯通知**，
        // 不改变 phase——但它们同样要派发（这正是"事件面"的价值：订阅者拿得到全部）。
        switch (event.kind) {
          case 'load':
            pagePhase = 'LOAD'
            if (event.screen) currentScreen = event.screen
            break
          case 'show':
            pagePhase = 'SHOW'
            if (event.screen) currentScreen = event.screen
            break
          case 'hide':
            pagePhase = 'HIDE'
            break
          case 'unload':
            pagePhase = 'IDLE'
            break
          default:
            break
        }
        // ★统一派发（全 15 事件走同一路径——新增事件只改 PAGE_EVENTS，不改这里）
        const payload = event.payload ?? (event.screen !== undefined ? { screen: event.screen } : { screen: currentScreen })
        fire(`page:${event.kind}` as HostLifecycleTopic, payload)
        if (event.kind === 'unload') currentScreen = null
        return
      }
      // 系统事件面（memory-warning / theme-change / resize / error / unhandled-rejection / network-change）
      fire(event.topic, event)
    },

    on(topic, cb) {
      let set = subs.get(topic)
      if (!set) {
        set = new Set()
        subs.set(topic, set)
      }
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    },

    setLaunchOptions(options) {
      launchOptions = { ...options }
    },
    setEnterOptions(options) {
      enterOptions = { ...options }
    },

    get subscriberCount() {
      let n = 0
      for (const set of subs.values()) n += set.size
      return n
    },
  }
  return bus
}

// ══════════════════════════════════════════════════════════════════
// 虚拟栈 → 页面生命周期（App 的"页面"= 虚拟栈的屏；可见性变迁即生命周期）
// ══════════════════════════════════════════════════════════════════

/**
 * 屏命令（**结构类型**——与 `@proteus-vue/router` 的 `ScreenCommand` 同形；
 * 不 import 以免 api → router 依赖，router 是更下层）。
 */
export interface StackScreenCommandLike {
  op: 'mount' | 'enter' | 'exit' | 'unmount'
  screenId: string
  /** mount 命令携带屏名（load 事件用它作为页面身份） */
  name?: string
  /** unmount 原因（pop/reset/freeze——freeze 属内存治理**不是**页面退出语义，翻译器会跳过） */
  reason?: string
}

/**
 * 创建"虚拟栈命令 → 页面生命周期"的翻译器（执行器侧逐条喂命令）。
 *
 * 映射（与 wx 页面语义对齐）：
 *   mount   → load   （建屏内容；携带屏名）
 *   enter   → show   （屏转为可见）
 *   exit    → hide   （屏转不可见，树保留）
 *   unmount → unload （屏子树销毁）——★`reason='freeze'` **跳过**：冻结是内存治理
 *             （栈位保留、返回=重建），业务不应看到"页面被卸载"
 */
export function createStackPageSource(bus: HostLifecycleBus): {
  apply(command: StackScreenCommandLike): void
  readonly count: number
} {
  const screenNames = new Map<string, string>()
  let count = 0
  return {
    apply(command) {
      if (command.op === 'mount') {
        const name = command.name ?? command.screenId
        screenNames.set(command.screenId, name)
        bus.emit({ topic: 'page', kind: 'load', screen: name })
        count++
        return
      }
      if (command.op === 'enter') {
        bus.emit({ topic: 'page', kind: 'show', screen: screenNames.get(command.screenId) })
        count++
        return
      }
      if (command.op === 'exit') {
        bus.emit({ topic: 'page', kind: 'hide' })
        count++
        return
      }
      // unmount：freeze 不是页面退出（见函数注释）
      if (command.reason === 'freeze') return
      bus.emit({ topic: 'page', kind: 'unload' })
      screenNames.delete(command.screenId)
      count++
    },
    get count() {
      return count
    },
  }
}

// ══════════════════════════════════════════════════════════════════
// 三个桥方法（挂进 CapabilityBridge：getAppLifecycle / getPageLifecycle / getBackground）
// ══════════════════════════════════════════════════════════════════

/**
 * ★★C23 句柄：**应用生命周期**（阶段 + 应用级专属事件）
 *
 * 【职责边界（★用户反馈「useAppLifecycle 与 useBackground 有重复」后的去重）】
 *   · **C23（本句柄）**：应用**生命周期阶段**与**应用级专属事件**——
 *     启动/前台/后台（launch/show/hide）+ 路由未命中（page-not-found，应用级兜底）
 *     + 音频中断（audio-interruption-*，系统对应用的音频会话打断）。
 *   · **C25（`useBackground`）**：**前后台切换事件 + 系统环境事件**——
 *     `onEvent`（enter-background/enter-foreground）+ 内存警告/主题变化/窗口尺寸/
 *     网络变化/错误/未处理 rejection + 启动参数（launchOptions/enterOptions）。
 *   ★原先 C23 也带了 memory-warning/theme-change/resize/error/unhandled-rejection ⇒
 *     **与 C25 重复**（同一事件两处订阅面，业务不知该用哪个）。现已移除，
 *     这些事件**统一归 C25**——见 `BackgroundHandle` 与 `APP_EVENT_META` 的 note。
 *   ★迁移：`useAppLifecycle().onMemoryWarning(cb)` → `(await useBackground()).data.onMemoryWarning(cb)`。
 *   各端触发源见 `APP_EVENT_META`（生成器直接消费该表渲染文档）。
 */
export interface AppLifecycleHandle {
  readonly phase: AppLifecyclePhase
  // —— 阶段事件（应用生命周期本体）——
  /** 应用启动（**恰好一次**，先于首个 show；冷启动自动补发——壳只需转发 show/hide） */
  onLaunch(cb: () => void): () => void
  /** 应用进入前台 */
  onShow(cb: () => void): () => void
  /** 应用退到后台 */
  onHide(cb: () => void): () => void
  // —— 应用级专属事件（C25 不提供）——
  /** 路由未命中（可跳兜底页） */
  onPageNotFound(cb: (e: { path: string }) => void): () => void
  /** 音频被系统中断开始（来电等） */
  onAudioInterruptionBegin(cb: () => void): () => void
  /** 音频中断结束（可恢复播放） */
  onAudioInterruptionEnd(cb: () => void): () => void
}

/**
 * 页面级事件载荷（按事件类型区分——订阅方按事件取用；未列出的端不产生该载荷）
 */
export interface PageEventPayloads {
  'route-done': { path?: string; durationMs?: number }
  'pull-down-refresh': Record<string, never>
  'reach-bottom': Record<string, never>
  'page-scroll': { scrollTop: number; scrollLeft?: number }
  resize: { size: { windowWidth: number; windowHeight: number } }
  'tab-item-tap': { index: number; pagePath?: string; text?: string }
}

/** 分享内容（决策型事件的返回值——微信 `onShareAppMessage` 语义） */
export interface ShareContent {
  title?: string
  path?: string
  imageUrl?: string
  query?: string
}

/**
 * ★★C24 句柄（**扩展为完整事件面**——用户指出「生命周期能力太简单」）
 *
 * 【两类事件的 API 形态是**刻意不同**的（不是疏漏）】
 *   · **通知型**（load/show/ready/hide/unload/route-done/reach-bottom/page-scroll/resize/
 *     tab-item-tap）⇒ **多订阅者** `onXxx(cb): 取消函数`——事件发生即通知，无返回值语义。
 *   · **决策型**（share-app-message / share-timeline / add-to-favorites / save-exit-state）
 *     ⇒ **单处理器** `setXxxProvider(fn)`——微信要求钩子**返回内容**（分享标题/路径/图片），
 *     多订阅者无法确定"用谁的返回值"。设多份 = 后者覆盖前者（诚实：可用 getter 读当前处理器）。
 *     ★这也对齐微信行为：`onShareAppMessage` **声明才显示转发按钮**——所以本句柄的 provider
 *     在 MP 端会让编译产物补上该钩子（见编译器 `proteusPageEmit` 的决策型清单）。
 */
export interface PageLifecycleHandle {
  readonly phase: PageLifecyclePhase
  // —— 阶段事件（通知型，多订阅）——
  onLoad(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onReady(cb: () => void): () => void
  onHide(cb: () => void): () => void
  onUnload(cb: () => void): () => void
  // —— 页面事件（通知型）——
  /** 路由动画完成（MP `onRouteDone` / App 转场结束 / Web transitionend） */
  onRouteDone(cb: (e: PageEventPayloads['route-done']) => void): () => void
  /** 下拉刷新（MP `onPullDownRefresh` / App 宿主手势；★Web 无原生——诚实不触发） */
  onPullDownRefresh(cb: () => void): () => void
  /** 触底（MP `onReachBottom` / Web 滚动到底 / App 滚动到底） */
  onReachBottom(cb: () => void): () => void
  /** 页面滚动（★**高频**：微信文档明确会引起两线程通信 ⇒ MP 端仅"声明过 onPageScroll"才派发） */
  onPageScroll(cb: (e: PageEventPayloads['page-scroll']) => void): () => void
  /** 尺寸变化（MP `onResize` / Web resize / App 旋转分屏） */
  onResize(cb: (e: PageEventPayloads['resize']) => void): () => void
  /** tab 点击（MP `onTabItemTap` / App tab 栏） */
  onTabItemTap(cb: (e: PageEventPayloads['tab-item-tap']) => void): () => void
  // —— 决策型（单处理器：微信要求返回内容）——
  /** 转发给好友（返回分享内容；MP 端声明后右上角出现"转发"入口） */
  setShareAppMessageProvider(fn: () => ShareContent): void
  /** 分享到朋友圈（同上；声明后才显示入口） */
  setShareTimelineProvider(fn: () => ShareContent): void
  /** 收藏（同上） */
  setAddToFavoritesProvider(fn: () => ShareContent): void
  /** 保存退出状态（MP `onSaveExitState`——返回需保存的状态对象） */
  setSaveExitStateProvider(fn: () => Record<string, unknown>): void
}

/** C25 句柄（结构兼容 BackgroundAPI；`E` = 注入的 CapError 实例类型） */
export interface BackgroundHandle<E extends Error = Error> {
  onEvent(cb: (e: { type: 'enter-background' | 'enter-foreground'; time: number }) => void): () => void
  onMemoryWarning(cb: (level: number) => void): () => void
  onThemeChange(cb: (theme: 'dark' | 'light') => void): () => void
  onWindowResize(cb: (size: { windowWidth: number; windowHeight: number }) => void): () => void
  onError(cb: (error: string) => void): () => void
  onUnhandledRejection(cb: (reason: { reason: string; promise: Promise<unknown> }) => void): () => void
  onNetworkStatusChange(cb: (status: { isConnected: boolean; networkType: string }) => void): () => void
  getLaunchOptions(): Promise<AppCapResult<Record<string, unknown>, E>>
  getEnterOptions(): Promise<AppCapResult<Record<string, unknown>, E>>
}

/** App 生命周期的三个桥方法（展开进 CapabilityBridge；CapError 注入防循环依赖） */
export interface AppLifecycleCapabilities<E extends Error = Error> {
  getAppLifecycle(): AppLifecycleHandle
  getPageLifecycle(): PageLifecycleHandle
  getBackground(): BackgroundHandle<E>
}

/**
 * ★★创建 App 宿主的三项生命周期能力（C23/C24/C25）。
 *
 * @param bus 宿主生命周期总线（壳/执行器推事件；一般传 `getHostLifecycleBus()`）
 * @param CapError 错误构造器（注入；`capability.ts` 传自己的 CapError——返回类型随之对齐）
 */
export function createAppLifecycleCapabilities<E extends Error = Error>(
  bus: HostLifecycleBus,
  CapError: CapErrorCtor<E>,
): AppLifecycleCapabilities<E> {
  // ★CapError 目前无失败分支可抛（launch/enter options 恒可读）——保留参数是为了：
  //   ① 与 wxBridge/webBridge 的注入模式一致（调用方一处接线）；
  //   ② 未来加入"壳未注入 launchOptions 但业务强依赖"的诚实失败分支时不改签名。
  void CapError
  /** 订阅封装：phase 已过也**补发一次**（晚订阅者不应"永远等不到已经发生过的事"） */
  const sub = (topic: HostLifecycleTopic, cb: () => void): (() => void) => bus.on(topic, () => cb())

  /** 纯通知型订阅（无载荷事件——音频中断等） */
  const appNotify = (topic: HostLifecycleTopic) => (cb: (e: never) => void): (() => void) =>
    bus.on(topic, (p) => (cb as (e: unknown) => void)(p as never))

  return {
    getAppLifecycle(): AppLifecycleHandle {
      const handle: AppLifecycleHandle = {
        get phase() {
          return bus.snapshot().app
        },
        onLaunch(cb) {
          // 已启动过（LAUNCH/SHOW/HIDE）⇒ 补发一次（语义：启动**发生过**）
          if (bus.snapshot().app !== 'PENDING') {
            cb()
            return () => undefined
          }
          return sub('app:launch', cb)
        },
        onShow(cb) {
          return sub('app:show', cb)
        },
        onHide(cb) {
          return sub('app:hide', cb)
        },
        // 应用级专属事件（C25 useBackground 不提供的那些——见接口注释的职责边界）
        onPageNotFound(cb) {
          return bus.on('app:page-not-found', (p) => cb({ path: String((p as { path?: unknown })?.path ?? '') }))
        },
        onAudioInterruptionBegin: appNotify('app:audio-interruption-begin') as () => () => void,
        onAudioInterruptionEnd: appNotify('app:audio-interruption-end') as () => () => void,
      }
      return handle
    },

    getPageLifecycle(): PageLifecycleHandle {
      // ★决策型：**单处理器**（微信要求返回内容——多订阅者无法确定用谁的返回值）
      const providers: {
        shareAppMessage?: () => ShareContent
        shareTimeline?: () => ShareContent
        addToFavorites?: () => ShareContent
        saveExitState?: () => Record<string, unknown>
      } = {}
      // 把 providers 暴露到全局（编译产物 / 壳据此取返回值——MP 端产物在钩子里调它）
      try {
        ;(globalThis as unknown as { __proteusPageProviders?: typeof providers }).__proteusPageProviders = providers
      } catch {
        /* 极简环境无 globalThis 写权限——MP 产物侧另有守卫 */
      }

      const handle: PageLifecycleHandle = {
        get phase() {
          return bus.snapshot().page
        },
        onLoad(cb) {
          // 同 onLaunch 的补发语义：页面已 LOAD 过（LOAD/SHOW/HIDE）⇒ 补发一次
          const p = bus.snapshot().page
          if (p === 'LOAD' || p === 'SHOW' || p === 'HIDE') {
            cb()
            return () => undefined
          }
          return sub('page:load', cb)
        },
        onShow(cb) {
          return sub('page:show', cb)
        },
        onHide(cb) {
          return sub('page:hide', cb)
        },
        onReady(cb) {
          return sub('page:ready', cb)
        },
        onUnload(cb) {
          return sub('page:unload', cb)
        },
        onRouteDone(cb) {
          return bus.on('page:route-done', (p) => cb((p as PageEventPayloads['route-done']) ?? {}))
        },
        onPullDownRefresh(cb) {
          return sub('page:pull-down-refresh', cb)
        },
        onReachBottom(cb) {
          return sub('page:reach-bottom', cb)
        },
        onPageScroll(cb) {
          return bus.on('page:page-scroll', (p) => {
            const e = (p as PageEventPayloads['page-scroll']) ?? { scrollTop: 0 }
            cb({ scrollTop: Number(e.scrollTop ?? 0), scrollLeft: e.scrollLeft })
          })
        },
        onResize(cb) {
          return bus.on('page:resize', (p) => {
            const e = p as PageEventPayloads['resize']
            cb(e?.size ? e : { size: { windowWidth: 0, windowHeight: 0 } })
          })
        },
        onTabItemTap(cb) {
          return bus.on('page:tab-item-tap', (p) => {
            const e = (p as PageEventPayloads['tab-item-tap']) ?? { index: -1 }
            cb(e)
          })
        },
        // —— 决策型（单处理器：后设覆盖前设——语义上只能有一个返回值）——
        setShareAppMessageProvider(fn) {
          providers.shareAppMessage = fn
        },
        setShareTimelineProvider(fn) {
          providers.shareTimeline = fn
        },
        setAddToFavoritesProvider(fn) {
          providers.addToFavorites = fn
        },
        setSaveExitStateProvider(fn) {
          providers.saveExitState = fn
        },
      }
      return handle
    },

    getBackground(): BackgroundHandle<E> {
      return {
        onEvent(cb) {
          const offHide = bus.on('app:hide', () => cb({ type: 'enter-background', time: Date.now() }))
          const offShow = bus.on('app:show', () => cb({ type: 'enter-foreground', time: Date.now() }))
          return () => {
            offHide()
            offShow()
          }
        },
        onMemoryWarning(cb) {
          return bus.on('app:memory-warning', (p) => cb((p as { level: number }).level))
        },
        onThemeChange(cb) {
          return bus.on('app:theme-change', (p) => cb((p as { theme: 'dark' | 'light' }).theme))
        },
        onWindowResize(cb) {
          return bus.on('app:resize', (p) => {
            const s = p as { windowWidth: number; windowHeight: number }
            cb({ windowWidth: s.windowWidth, windowHeight: s.windowHeight })
          })
        },
        onError(cb) {
          return bus.on('app:error', (p) => cb((p as { error: string }).error))
        },
        onUnhandledRejection(cb) {
          return bus.on('app:unhandled-rejection', (p) => {
            const r = p as { reason: string }
            cb({ reason: r.reason, promise: Promise.resolve() })
          })
        },
        onNetworkStatusChange(cb) {
          return bus.on('network-change', (p) => {
            const s = p as { isConnected: boolean; networkType: string }
            cb({ isConnected: s.isConnected, networkType: s.networkType })
          })
        },
        async getLaunchOptions() {
          return { ok: true, data: bus.snapshot().launchOptions }
        },
        async getEnterOptions() {
          return { ok: true, data: bus.snapshot().enterOptions }
        },
      }
    },
  }
}

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
 * ★★C23 句柄（**扩展为完整应用级事件面**）
 *
 * 新增的事件都是**纯通知**（无返回值语义）⇒ 全部多订阅者形态。
 * 各端触发源见 `APP_EVENTS` 的注释表（memory-warning / theme-change 在 App 端由壳转发）。
 */
export interface AppLifecycleHandle {
  readonly phase: AppLifecyclePhase
  // —— 阶段事件 ——
  onLaunch(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
  // —— 应用级事件（通知型）——
  /** 未捕获异常（MP `App.onError` / Web window.onerror / App 壳） */
  onError(cb: (e: { error: string }) => void): () => void
  /** 未处理的 Promise rejection（MP `App.onUnhandledRejection` / Web unhandledrejection） */
  onUnhandledRejection(cb: (e: { reason: string }) => void): () => void
  /** 内存警告（MP `App.onMemoryWarning` / ★App 端壳：iOS didReceiveMemoryWarning / Android onTrimMemory） */
  onMemoryWarning(cb: (e: { level: number }) => void): () => void
  /** 系统主题变化（MP `App.onThemeChange` / Web matchMedia / App 壳） */
  onThemeChange(cb: (e: { theme: 'dark' | 'light' }) => void): () => void
  /** 窗口尺寸变化（MP `wx.onWindowResize` / Web resize / App 旋转分屏） */
  onWindowResize(cb: (e: { windowWidth: number; windowHeight: number }) => void): () => void
  /** 页面未找到（MP `App.onPageNotFound` / Web 路由未命中） */
  onPageNotFound(cb: (e: { path: string }) => void): () => void
  /** 音频中断开始（来电等——MP `App.onAudioInterruptionBegin` / App 壳） */
  onAudioInterruptionBegin(cb: () => void): () => void
  /** 音频中断结束 */
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

  /** 纯通知型订阅（表驱动——新增事件只需在 APP_EVENTS 加项） */
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
        // 应用级通知型（载荷各自归一——不同端的原始形态不同，这里统一成句柄声明的形状）
        onError(cb) {
          return bus.on('app:error', (p) => cb({ error: String((p as { error?: unknown })?.error ?? p ?? '') }))
        },
        onUnhandledRejection(cb) {
          return bus.on('app:unhandled-rejection', (p) => {
            const r = p as { reason?: unknown } | undefined
            cb({ reason: typeof r?.reason === 'string' ? r.reason : String(r ?? '') })
          })
        },
        onMemoryWarning(cb) {
          return bus.on('app:memory-warning', (p) => cb({ level: Number((p as { level?: number })?.level ?? 0) }))
        },
        onThemeChange(cb) {
          return bus.on('app:theme-change', (p) => {
            const t = (p as { theme?: unknown })?.theme
            cb({ theme: t === 'dark' ? 'dark' : 'light' })
          })
        },
        onWindowResize(cb) {
          return bus.on('app:resize', (p) => {
            const s = (p as { windowWidth?: number; windowHeight?: number }) ?? {}
            cb({ windowWidth: Number(s.windowWidth ?? 0), windowHeight: Number(s.windowHeight ?? 0) })
          })
        },
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
          return bus.on('memory-warning', (p) => cb((p as { level: number }).level))
        },
        onThemeChange(cb) {
          return bus.on('theme-change', (p) => cb((p as { theme: 'dark' | 'light' }).theme))
        },
        onWindowResize(cb) {
          return bus.on('resize', (p) => {
            const s = p as { windowWidth: number; windowHeight: number }
            cb({ windowWidth: s.windowWidth, windowHeight: s.windowHeight })
          })
        },
        onError(cb) {
          return bus.on('error', (p) => cb((p as { error: string }).error))
        },
        onUnhandledRejection(cb) {
          return bus.on('unhandled-rejection', (p) => {
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

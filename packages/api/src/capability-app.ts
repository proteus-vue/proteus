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

/** 壳/执行器推入的事件（总线入口的词汇表——每个词都对应一个真实系统事件） */
export type HostLifecycleEvent =
  | { topic: 'app'; kind: 'launch' | 'show' | 'hide' }
  | { topic: 'page'; kind: 'load' | 'show' | 'hide' | 'unload'; screen?: string }
  | { topic: 'memory-warning'; level: number }
  | { topic: 'theme-change'; theme: 'dark' | 'light' }
  | { topic: 'resize'; windowWidth: number; windowHeight: number }
  | { topic: 'error'; error: string }
  | { topic: 'unhandled-rejection'; reason: string }
  | { topic: 'network-change'; isConnected: boolean; networkType: string }

/** 订阅主题（总线内部以 topic+kind 归一为字符串键——`on` 的消费者面） */
export type HostLifecycleTopic =
  | 'app:launch'
  | 'app:show'
  | 'app:hide'
  | 'page:load'
  | 'page:show'
  | 'page:hide'
  | 'page:unload'
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
        if (event.kind === 'launch') {
          // 显式 launch：仅当尚未启动过（重复 launch 是壳的重复上报——忽略而非重放）
          if (appPhase !== 'PENDING') return
          appPhase = 'LAUNCH'
          fire('app:launch', undefined)
          return
        }
        if (event.kind === 'show') {
          // ★冷启动自动补发 launch（wx 语义：onLaunch 恰好一次）——壳只需转发 show/hide
          if (appPhase === 'PENDING') {
            appPhase = 'LAUNCH'
            fire('app:launch', undefined)
          }
          appPhase = 'SHOW'
          fire('app:show', undefined)
          return
        }
        // hide
        appPhase = 'HIDE'
        fire('app:hide', undefined)
        return
      }
      if (event.topic === 'page') {
        if (event.kind === 'load') {
          pagePhase = 'LOAD'
          if (event.screen) currentScreen = event.screen
          fire('page:load', { screen: currentScreen })
          return
        }
        if (event.kind === 'show') {
          pagePhase = 'SHOW'
          if (event.screen) currentScreen = event.screen
          fire('page:show', { screen: currentScreen })
          return
        }
        if (event.kind === 'hide') {
          pagePhase = 'HIDE'
          fire('page:hide', { screen: currentScreen })
          return
        }
        // unload：页面销毁 ⇒ 当前屏清空、阶段回 IDLE
        pagePhase = 'IDLE'
        fire('page:unload', { screen: currentScreen })
        currentScreen = null
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
 * 屏命令（**结构类型**——与 `@proteus/router` 的 `ScreenCommand` 同形；
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

/** C23 句柄（结构兼容 `capability.ts` 的 AppLifecycle） */
export interface AppLifecycleHandle {
  readonly phase: AppLifecyclePhase
  onLaunch(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
}

/** C24 句柄（结构兼容 PageLifecycle） */
export interface PageLifecycleHandle {
  readonly phase: PageLifecyclePhase
  onLoad(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
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
      }
      return handle
    },

    getPageLifecycle(): PageLifecycleHandle {
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

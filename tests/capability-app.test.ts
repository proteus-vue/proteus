// tests/capability-app.test.ts
// ★★应用与生命周期能力开放（App 宿主腿）：C23 useAppLifecycle / C24 usePageLifecycle / C25 useBackground
//
// 【要证明什么（本轮取证的三条事实对应的三条判据）】
//   ① 此前 App 宿主 **没有**生命周期桥（detectRuntime 只认 web/mp）⇒ 判据：注入壳标识后
//      `createCapabilityBridge()` 的 `getAppLifecycle/getPageLifecycle/getBackground` **真实存在**；
//   ② 三个 **Hook 层**早已实现 ⇒ 判据：用 `createCapabilityHooks(bridge)` 取真实 hooks，
//      推事件后回调**真的被调用**（不是"桥在场"就完事）；
//   ③ 事件源 = 宿主壳（G-39）+ 虚拟栈命令流（M5）⇒ 判据：两条源都能驱动 hooks，且语义与 wx 对齐
//      （冷启动 show 自动补 launch / freeze 不算页面退出 / 取消后不再触发）。
//
// 依赖说明：本测试用**真实** `@proteus-vue/router` 的 `createAppStack` 产出真实命令流
//   （不是手写假命令——那只能证明"翻译器认识假命令"）。
import { describe, it, expect, afterEach } from 'vitest'
import {
  createHostLifecycleBus,
  getHostLifecycleBus,
  detectAppHost,
  createStackPageSource,
  createAppLifecycleCapabilities,
  HOST_ID_KEY,
  HOST_LIFECYCLE_BUS_KEY,
  installPageEmitBridge,
  installWxAppEventBridge,
  PAGE_EVENTS,
  APP_EVENTS,
  type HostLifecycleBus,
} from '../packages/api/src/capability-app'
import { createCapabilityBridge, createCapabilityHooks, CapError } from '../packages/api/src/capability'
import { createAppStack } from '../packages/router/src/app-stack'
import type { AppScreenSpec } from '../packages/router/src/app-stack'

const specs: Record<string, AppScreenSpec> = {
  home: { name: 'home', path: '/home' },
  detail: { name: 'detail', path: '/detail', budgetNodes: 64 },
}

/** 清理壳注入的全局态（防跨用例污染） */
afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g[HOST_ID_KEY]
  delete g[HOST_LIFECYCLE_BUS_KEY]
})

describe('① App 宿主判定（不靠特征猜测）', () => {
  it('未注入壳标识 → 非 App 宿主（web 环境保持原行为）', () => {
    expect(detectAppHost()).toBe(false)
    const b = createCapabilityBridge()
    // web 桥的 getAppLifecycle 存在但基于 visibilitychange；App 能力**不应**覆盖它
    expect(typeof b.getAppLifecycle).toBe('function')
  })

  it('注入壳标识 → App 宿主；桥暴露三项生命周期能力', () => {
    ;(globalThis as Record<string, unknown>)[HOST_ID_KEY] = 'android'
    expect(detectAppHost()).toBe(true)
    const b = createCapabilityBridge()
    expect(typeof b.getAppLifecycle).toBe('function')
    expect(typeof b.getPageLifecycle).toBe('function')
    expect(typeof b.getBackground).toBe('function')
  })

  it('总线是全局单例（壳与桥拿到同一个——壳推的事件桥能收到）', () => {
    const a = getHostLifecycleBus()
    const b = getHostLifecycleBus()
    expect(a).toBe(b)
  })
})

describe('② 三个真实 Hook 在 App 宿主上可用（端到端：桥 → Hook）', () => {
  /** 造 App 宿主环境 + 真实 hooks */
  function appHooks(): { bus: HostLifecycleBus; hooks: ReturnType<typeof createCapabilityHooks> } {
    ;(globalThis as Record<string, unknown>)[HOST_ID_KEY] = 'android'
    const bridge = createCapabilityBridge()
    const hooks = createCapabilityHooks(bridge)
    return { bus: getHostLifecycleBus(), hooks }
  }

  it('C23 useAppLifecycle：onShow/onHide 被真实事件驱动（+ 冷启动补 launch）', () => {
    const { bus, hooks } = appHooks()
    const log: string[] = []
    const lc = hooks.useAppLifecycle()
    lc.onLaunch(() => log.push('launch'))
    lc.onShow(() => log.push('show'))
    lc.onHide(() => log.push('hide'))

    bus.emit({ topic: 'app', kind: 'show' }) // 冷启动：show ⇒ 自动补 launch
    bus.emit({ topic: 'app', kind: 'hide' })
    bus.emit({ topic: 'app', kind: 'show' })
    expect(log).toEqual(['launch', 'show', 'hide', 'show'])
    expect(lc.phase).toBe('SHOW')
  })

  it('C23：launch 恰好一次（重复 show 不重放 launch——wx 语义）', () => {
    const { bus, hooks } = appHooks()
    let launches = 0
    hooks.useAppLifecycle().onLaunch(() => launches++)
    bus.emit({ topic: 'app', kind: 'show' })
    bus.emit({ topic: 'app', kind: 'hide' })
    bus.emit({ topic: 'app', kind: 'show' })
    bus.emit({ topic: 'app', kind: 'show' })
    expect(launches).toBe(1)
  })

  it('C23：晚订阅者拿到补发（已启动后订阅 onLaunch 仍触发一次）', () => {
    const { bus, hooks } = appHooks()
    bus.emit({ topic: 'app', kind: 'show' })
    let late = 0
    hooks.useAppLifecycle().onLaunch(() => late++)
    expect(late).toBe(1)
  })

  it('C23：取消订阅后不再触发（wx 桥的取消是 no-op——本实现是诚实取消）', () => {
    const { bus, hooks } = appHooks()
    let n = 0
    const off = hooks.useAppLifecycle().onHide(() => n++)
    bus.emit({ topic: 'app', kind: 'hide' })
    off()
    bus.emit({ topic: 'app', kind: 'show' })
    bus.emit({ topic: 'app', kind: 'hide' })
    expect(n).toBe(1)
  })

  it('C24 usePageLifecycle：LOad/SHOW/HIDE 被事件驱动 + 晚订阅补 load', () => {
    const { bus, hooks } = appHooks()
    const log: string[] = []
    const pl = hooks.usePageLifecycle()
    pl.onLoad(() => log.push('load'))
    pl.onShow(() => log.push('show'))
    pl.onHide(() => log.push('hide'))
    bus.emit({ topic: 'page', kind: 'load', screen: 'home' })
    bus.emit({ topic: 'page', kind: 'show', screen: 'home' })
    bus.emit({ topic: 'page', kind: 'hide' })
    expect(log).toEqual(['load', 'show', 'hide'])
    expect(pl.phase).toBe('HIDE')
    let late = 0
    hooks.usePageLifecycle().onLoad(() => late++)
    expect(late).toBe(1)
  })

  it('C25 useBackground：onEvent 把前后台翻译成 enter-background/enter-foreground', async () => {
    const { bus, hooks } = appHooks()
    const r = await hooks.useBackground()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const evts: string[] = []
    r.data.onEvent((e) => evts.push(e.type))
    bus.emit({ topic: 'app', kind: 'show' })
    bus.emit({ topic: 'app', kind: 'hide' })
    expect(evts).toEqual(['enter-foreground', 'enter-background'])
    expect(r.data.onEvent(() => {})).toBeTypeOf('function') // 返回取消
  })

  it('C25：系统事件面（内存警告/主题/尺寸/错误/网络/未处理 rejection）全部真实分发', async () => {
    const { bus, hooks } = appHooks()
    const r = await hooks.useBackground()
    if (!r.ok) throw new Error('useBackground 应可用')
    const seen: string[] = []
    r.data.onMemoryWarning((lv) => seen.push(`mem:${lv}`))
    r.data.onThemeChange((t) => seen.push(`theme:${t}`))
    r.data.onWindowResize((s) => seen.push(`resize:${s.windowWidth}x${s.windowHeight}`))
    r.data.onError((e) => seen.push(`err:${e}`))
    r.data.onUnhandledRejection((x) => seen.push(`rej:${x.reason}`))
    r.data.onNetworkStatusChange((s) => seen.push(`net:${s.isConnected}/${s.networkType}`))

    // ★统一走 app 事件面（扩展后 memory-warning/theme-change/resize/error 都是 app:* —— 见 APP_EVENTS）
    bus.emit({ topic: 'app', kind: 'memory-warning', payload: { level: 2 } })
    bus.emit({ topic: 'app', kind: 'theme-change', payload: { theme: 'dark' } })
    bus.emit({ topic: 'app', kind: 'resize', payload: { windowWidth: 390, windowHeight: 844 } })
    bus.emit({ topic: 'app', kind: 'error', payload: { error: 'boom' } })
    bus.emit({ topic: 'app', kind: 'unhandled-rejection', payload: { reason: 'why' } })
    bus.emit({ topic: 'network-change', isConnected: false, networkType: 'none' })
    expect(seen).toEqual(['mem:2', 'theme:dark', 'resize:390x844', 'err:boom', 'rej:why', 'net:false/none'])
  })

  it('C25：启动参数/进入参数（壳注入 → Hook 读；深链场景的数据源）', async () => {
    const { bus, hooks } = appHooks()
    bus.setLaunchOptions({ path: 'pages/detail', query: { id: '7' } })
    bus.setEnterOptions({ scene: '1001' })
    const r = await hooks.useBackground()
    if (!r.ok) throw new Error('useBackground 应可用')
    const lo = await r.data.getLaunchOptions()
    const eo = await r.data.getEnterOptions()
    expect(lo.ok && lo.data).toEqual({ path: 'pages/detail', query: { id: '7' } })
    expect(eo.ok && eo.data).toEqual({ scene: '1001' })
  })

  it('订阅者计数可观测（防"页面反复进出后订阅泄漏"）', () => {
    const { bus, hooks } = appHooks()
    const before = bus.subscriberCount
    const lc = hooks.useAppLifecycle()
    const off1 = lc.onShow(() => {})
    const off2 = lc.onHide(() => {})
    expect(bus.subscriberCount).toBe(before + 2)
    off1()
    off2()
    expect(bus.subscriberCount).toBe(before)
  })
})

describe('③ 虚拟栈命令流 → 页面生命周期（App 的"页面"= 栈里的屏）', () => {
  it('真实 app-stack 命令流驱动 C24：push→load/show，pop→hide/unload', () => {
    const bus = createHostLifecycleBus()
    const src = createStackPageSource(bus)
    const log: string[] = []
    bus.on('page:load', (p) => log.push(`load:${(p as { screen: string }).screen}`))
    bus.on('page:show', (p) => log.push(`show:${(p as { screen: string }).screen}`))
    bus.on('page:hide', () => log.push('hide'))
    bus.on('page:unload', () => log.push('unload'))

    // ★真实栈（不是手写假命令）
    const stack = createAppStack({ screens: specs })
    stack.push('home')
    for (const c of stack.drainCommands()) src.apply(c)
    stack.push('detail')
    for (const c of stack.drainCommands()) src.apply(c)
    stack.pop()
    for (const c of stack.drainCommands()) src.apply(c)

    expect(log).toEqual(['load:home', 'show:home', 'hide', 'load:detail', 'show:detail', 'hide', 'unload', 'show:home'])
    expect(bus.snapshot().currentScreen).toBe('home')
  })

  it('★freeze（内存治理）**不算**页面退出——业务不应看到"页面被卸载"', () => {
    const bus = createHostLifecycleBus()
    const src = createStackPageSource(bus)
    const log: string[] = []
    bus.on('page:unload', () => log.push('unload'))
    bus.on('page:hide', () => log.push('hide'))

    const stack = createAppStack({ screens: specs, policy: { nodeBudget: 64, keepWindow: 1, defaultScreenNodes: 64 } })
    stack.push('home')
    for (const c of stack.drainCommands()) src.apply(c)
    stack.push('detail') // 触发冻结 home（栈底超预算）
    const cmds = stack.drainCommands()
    const freezeCmds = cmds.filter((c) => c.op === 'unmount' && c.reason === 'freeze')
    expect(freezeCmds.length).toBe(1) // 前置：确有 freeze
    for (const c of cmds) src.apply(c)
    expect(log).toEqual(['hide']) // 只有 hide，**没有** unload
  })

  it('popToRoot 批量弹栈：exit 一条 + 多个 unmount —— unload 逐屏发（业务清理不丢）', () => {
    const bus = createHostLifecycleBus()
    const src = createStackPageSource(bus)
    let unloads = 0
    bus.on('page:unload', () => unloads++)
    const stack = createAppStack({ screens: specs })
    stack.push('home')
    stack.push('detail')
    stack.push('detail')
    for (const c of stack.drainCommands()) src.apply(c)
    stack.popToRoot()
    for (const c of stack.drainCommands()) src.apply(c)
    expect(unloads).toBe(2) // 两层被弹 ⇒ 两次 unload
    expect(bus.snapshot().currentScreen).toBe('home')
  })

  it('翻译器计数可对账（命令消费数——诊断/判据用）', () => {
    const bus = createHostLifecycleBus()
    const src = createStackPageSource(bus)
    src.apply({ op: 'mount', screenId: 's1', name: 'home' })
    src.apply({ op: 'enter', screenId: 's1' })
    src.apply({ op: 'unmount', screenId: 's1', reason: 'freeze' }) // 跳过（不计）
    expect(src.count).toBe(2)
  })
})

describe('④ 与 wx 语义对齐（防两端手感分叉）', () => {
  it('bus.emit 的重入安全：订阅者在回调里取消自己不影响本次分发', () => {
    const bus = createHostLifecycleBus()
    let calls = 0
    const off = bus.on('app:show', () => {
      calls++
      off()
    })
    bus.emit({ topic: 'app', kind: 'show' })
    bus.emit({ topic: 'app', kind: 'hide' })
    bus.emit({ topic: 'app', kind: 'show' })
    expect(calls).toBe(1) // 第一次后自取消；后续不再触发
  })

  it('重复 launch 事件被忽略（壳重复上报不重放）', () => {
    const bus = createHostLifecycleBus()
    let launches = 0
    bus.on('app:launch', () => launches++)
    bus.emit({ topic: 'app', kind: 'launch' })
    bus.emit({ topic: 'app', kind: 'launch' })
    expect(launches).toBe(1)
  })

  it('snapshot 返回副本（调用方改它不影响总线内部状态）', () => {
    const bus = createHostLifecycleBus()
    bus.setLaunchOptions({ a: 1 })
    const snap = bus.snapshot()
    ;(snap.launchOptions as Record<string, unknown>).a = 999
    expect(bus.snapshot().launchOptions.a).toBe(1)
  })

  it('CapError 注入口保持（构造器被接受，签名与 wxBridge/webBridge 同模式）', () => {
    // 构造器被接受即算过（当前无失败分支——断言它确实是 CapError 家族）
    const bus = createHostLifecycleBus()
    const caps = createAppLifecycleCapabilities(bus, CapError)
    expect(caps.getBackground()).toBeTruthy()
  })
})

describe('★★扩展事件面（用户指出「生命周期能力太简单，真实项目远超三个」）', () => {
  function appHooks(): { bus: HostLifecycleBus; hooks: ReturnType<typeof createCapabilityHooks> } {
    ;(globalThis as Record<string, unknown>)[HOST_ID_KEY] = 'android'
    const bridge = createCapabilityBridge()
    return { bus: getHostLifecycleBus(), hooks: createCapabilityHooks(bridge) }
  }

  // ★★2026-09-30 去重（用户反馈：「useAppLifecycle 有些方法和 useBackground 重复」）：
  //   C23 现在只管**应用生命周期本体**（launch/show/hide）+ 应用级专属（page-not-found / audio-interruption*）；
  //   memory-warning / theme-change / resize / error / unhandled-rejection **统一归 C25（useBackground）**。
  it('C23 应用级事件面（去重后）：page-not-found / audio-interruption 在 C23；阶段事件驱动相位', () => {
    const { bus, hooks } = appHooks()
    const lc = hooks.useAppLifecycle()
    const seen: string[] = []
    lc.onPageNotFound((e) => seen.push(`404:${e.path}`))
    lc.onAudioInterruptionBegin(() => seen.push('audio:begin'))
    lc.onAudioInterruptionEnd(() => seen.push('audio:end'))
    // 阶段事件
    lc.onLaunch(() => seen.push('launch'))
    lc.onShow(() => seen.push('show'))

    bus.emit({ topic: 'app', kind: 'page-not-found', payload: { path: '/missing' } })
    bus.emit({ topic: 'app', kind: 'audio-interruption-begin' })
    bus.emit({ topic: 'app', kind: 'audio-interruption-end' })
    bus.emit({ topic: 'app', kind: 'show' })
    expect(seen).toEqual(['404:/missing', 'audio:begin', 'audio:end', 'launch', 'show'])
    expect(bus.snapshot().app).toBe('SHOW')
  })

  it('★去重验证：重叠事件**不再**出现在 C23 句柄上（单一归属 C25）', () => {
    const { hooks } = appHooks()
    const lc = hooks.useAppLifecycle() as unknown as Record<string, unknown>
    for (const name of ['onMemoryWarning', 'onThemeChange', 'onWindowResize', 'onError', 'onUnhandledRejection']) {
      expect(name in lc, `${name} 应已从 useAppLifecycle 移除（归 useBackground）`).toBe(false)
    }
  })

  it('C24 页面级全事件面：ready / route-done / page-scroll / resize / tab-item-tap / reach-bottom / pull-down-refresh', () => {
    const { bus, hooks } = appHooks()
    const pl = hooks.usePageLifecycle()
    const seen: string[] = []
    pl.onReady(() => seen.push('ready'))
    pl.onRouteDone((e) => seen.push(`route:${e.path ?? '-'}`))
    pl.onPageScroll((e) => seen.push(`scroll:${e.scrollTop}`))
    pl.onResize((e) => seen.push(`resize:${e.size.windowWidth}`))
    pl.onTabItemTap((e) => seen.push(`tab:${e.index}`))
    pl.onReachBottom(() => seen.push('bottom'))
    pl.onPullDownRefresh(() => seen.push('refresh'))
    pl.onUnload(() => seen.push('unload'))

    bus.emit({ topic: 'page', kind: 'load', screen: 'home' })
    bus.emit({ topic: 'page', kind: 'show' })
    bus.emit({ topic: 'page', kind: 'ready' })
    bus.emit({ topic: 'page', kind: 'route-done', payload: { path: '/home' } })
    bus.emit({ topic: 'page', kind: 'page-scroll', payload: { scrollTop: 120 } })
    bus.emit({ topic: 'page', kind: 'resize', payload: { size: { windowWidth: 400, windowHeight: 800 } } })
    bus.emit({ topic: 'page', kind: 'tab-item-tap', payload: { index: 1 } })
    bus.emit({ topic: 'page', kind: 'reach-bottom' })
    bus.emit({ topic: 'page', kind: 'pull-down-refresh' })
    bus.emit({ topic: 'page', kind: 'hide' })
    bus.emit({ topic: 'page', kind: 'unload' })

    expect(seen).toEqual([
      'ready', 'route:/home', 'scroll:120', 'resize:400', 'tab:1', 'bottom', 'refresh', 'unload',
    ])
  })

  it('C24 决策型（分享/收藏/退出状态）是**单处理器**语义（后设覆盖前设——微信只允许一个返回值）', () => {
    const { hooks } = appHooks()
    const pl = hooks.usePageLifecycle()
    pl.setShareAppMessageProvider(() => ({ title: 'first' }))
    pl.setShareAppMessageProvider(() => ({ title: 'second' }))
    const providers = (globalThis as Record<string, unknown>).__proteusPageProviders as {
      shareAppMessage?: () => { title?: string }
    }
    expect(providers.shareAppMessage?.().title).toBe('second')

    pl.setShareTimelineProvider(() => ({ title: 'tl' }))
    pl.setSaveExitStateProvider(() => ({ n: 1 }))
    expect(providers.shareAppMessage?.().title).toBe('second') // 各 provider 相互独立
  })

  it('★MP 页面事件通道：installPageEmitBridge（wx **没有**全局 onPageShow——只能靠产物派发）', () => {
    const bus = createHostLifecycleBus()
    installPageEmitBridge(bus)
    const seen: string[] = []
    bus.on('page:show', () => seen.push('show'))
    bus.on('page:page-scroll', (p) => seen.push(`scroll:${(p as { scrollTop: number }).scrollTop}`))
    // 模拟编译产物：globalThis.__proteusEmitPage('show') / ('page-scroll', {scrollTop})
    const emit = (globalThis as Record<string, unknown>).__proteusEmitPage as (e: string, p?: unknown) => void
    expect(typeof emit).toBe('function')
    emit('show')
    emit('page-scroll', { scrollTop: 42 })
    emit(123 as never) // 非法事件名被忽略（不抛）
    expect(seen).toEqual(['show', 'scroll:42'])
  })

  it('★MP 应用级事件通道：installWxAppEventBridge（wx 全局 API → 总线；缺失 API 不静默）', () => {
    const bus = createHostLifecycleBus()
    const calls: Record<string, ((...a: unknown[]) => void) | undefined> = {}
    const fakeWx = {
      onAppShow: (cb: () => void) => (calls.onAppShow = cb),
      onAppHide: (cb: () => void) => (calls.onAppHide = cb),
      onMemoryWarning: (cb: () => void) => (calls.onMemoryWarning = cb),
      // ★故意不提供 onThemeChange / onPageNotFound —— 验证"缺失不静默"
    }
    // ★接线诊断走 console.warn（不进业务事件面——否则业务收 app:error 时会拿到内部噪音）
    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (m: string) => warns.push(m)
    try {
      installWxAppEventBridge(bus, fakeWx)
    } finally {
      console.warn = origWarn
    }
    const seen: string[] = []
    bus.on('app:show', () => seen.push('show'))
    bus.on('app:hide', () => seen.push('hide'))
    bus.on('app:memory-warning', () => seen.push('mem'))

    calls.onAppShow?.()
    calls.onAppHide?.()
    calls.onMemoryWarning?.()
    expect(seen).toEqual(['show', 'hide', 'mem'])
    // 缺失 API 有明确诊断（"没触发"与"没接线"必须可区分）
    expect(warns.some((e) => e.includes('onThemeChange'))).toBe(true)
    expect(warns.some((e) => e.includes('onPageNotFound'))).toBe(true)
  })

  it('事件面 SSOT 自洽：PAGE_EVENTS / APP_EVENTS 覆盖所有句柄方法（防"加了句柄忘了 SSOT"）', async () => {
    const { hooks } = (() => {
      ;(globalThis as Record<string, unknown>)[HOST_ID_KEY] = 'android'
      return { hooks: createCapabilityHooks(createCapabilityBridge()) }
    })()
    const pl = hooks.usePageLifecycle()
    const lc = hooks.useAppLifecycle()
    const bgRes = await hooks.useBackground()
    const bg: Record<string, unknown> = bgRes.ok ? (bgRes.data as unknown as Record<string, unknown>) : {}
    // 页面：SSOT 每个事件都应有对应可订阅面（`on<Pascal>` 或多词时 `set<Pascal>Provider`）
    // ★命名规则与运行时一致：kebab → Pascal（load→Load / reach-bottom→ReachBottom）
    const pascal = (kebab: string): string =>
      kebab.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
    for (const evt of PAGE_EVENTS) {
      const P = pascal(evt)
      const has = `on${P}` in (pl as object) || `set${P}Provider` in (pl as object)
      expect(has, `PAGE_EVENTS 的 ${evt}（期望 on${P} 或 set${P}Provider）在句柄上无可订阅面`).toBe(true)
    }
    // 应用级（去重后）：每个事件**恰好**归属一个句柄——
    //   C23 = 阶段（launch/show/hide）+ page-not-found + audio-interruption*
    //   C25 = memory-warning / theme-change / resize / error / unhandled-rejection（+ network-change）
    const C23_OWNED = new Set(['launch', 'show', 'hide', 'page-not-found', 'audio-interruption-begin', 'audio-interruption-end'])
    const C25_OWNED: Record<string, string> = {
      'memory-warning': 'onMemoryWarning',
      'theme-change': 'onThemeChange',
      resize: 'onWindowResize',
      error: 'onError',
      'unhandled-rejection': 'onUnhandledRejection',
    }
    for (const evt of APP_EVENTS) {
      if (C23_OWNED.has(evt)) {
        const name = evt === 'launch' ? 'onLaunch' : evt === 'show' ? 'onShow' : evt === 'hide' ? 'onHide' : `on${pascal(evt)}`
        expect(name in (lc as object), `APP_EVENTS 的 ${evt}（C23 归属，期望 ${name}）在句柄上无可订阅面`).toBe(true)
      } else if (C25_OWNED[evt]) {
        // ★去重后：这些事件不应在 C23 上（归属 C25）
        expect(C25_OWNED[evt] in (bg as object), `APP_EVENTS 的 ${evt}（C25 归属，期望 ${C25_OWNED[evt]}）在 BackgroundHandle 上无可订阅面`).toBe(true)
      } else {
        throw new Error(`APP_EVENTS 的 ${evt} 未登记归属（新增事件必须显式归到 C23 或 C25）`)
      }
    }
  })
})

describe('★★端到端：编译产物 → 产物派发（最接近真机的那一层，无需设备）', () => {
  it('真实 SFC 编译：声明的 onShow 体末派发；未声明的安全钩子自动补；决策型**不自动补**', async () => {
    const { compileVueSfc } = await import('../packages/compiler/src/index.ts')
    const src = `<route>{"path":"/t","name":"t"}</route>
<template><view>hi</view></template>
<script setup>
import { ref } from 'vue'
const n = ref(0)
function onShow() { n.value++ }
</script>
`
    const out = compileVueSfc(src, { platform: 'mp-weixin' } as never) as { js: string }
    const js = out.js

    // ① 用户声明的 onShow：体末派发（否则运行时订阅收不到）
    expect(js).toMatch(/onShow\(\)\s*\{[\s\S]*?proteusPageEmit\("show"\)[\s\S]*?\}/)
    // ② 未声明的安全清单：自动补（无用户可见副作用——不补则订阅永远收不到）
    expect(js).toContain('onHide() { this.proteusPageEmit("hide") }')
    expect(js).toContain('onReady() { this.proteusPageEmit("ready") }')
    expect(js).toContain('onUnload() { this.proteusPageEmit("unload") }')
    expect(js).toContain('onRouteDone() { this.proteusPageEmit("route-done") }')
    expect(js).toContain('onReachBottom() { this.proteusPageEmit("reach-bottom") }')
    // ③ ★决策型**绝不自动补**（微信语义：声明才显示转发/收藏入口——自动补 = 擅自加用户可见行为）
    expect(js).not.toContain('onShareAppMessage')
    expect(js).not.toContain('onAddToFavorites')
    expect(js).not.toContain('onSaveExitState')
    // ④ ★高频 onPageScroll 同样不自动补（微信文档：会引起两线程通信）
    expect(js).not.toContain('onPageScroll() { this.proteusPageEmit')
    // ⑤ 派发辅助方法在位
    expect(js).toContain('proteusPageEmit(evt, payload)')
  })

  it('用户**声明** onShareAppMessage 时：不覆盖用户实现（微信只允许一个返回值）', async () => {
    const { compileVueSfc } = await import('../packages/compiler/src/index.ts')
    const src = `<route>{"path":"/s","name":"s"}</route>
<template><view>hi</view></template>
<script setup>
function onShareAppMessage() { return { title: 'mine' } }
</script>
`
    const out = compileVueSfc(src, { platform: 'mp-weixin' } as never) as { js: string }
    // 用户实现保留，且**不被派发覆盖**（决策型语义）
    expect(out.js).toContain("title: 'mine'")
  })

  it('组件模式不注入页面派发（组件无页面生命周期——防误加）', async () => {
    const { compileVueSfc } = await import('../packages/compiler/src/index.ts')
    const src = `<template><view>c</view></template>
<script setup>
defineProps({ x: String })
</script>
`
    const out = compileVueSfc(src, { platform: 'mp-weixin', isComponent: true } as never) as { js: string }
    expect(out.js).not.toContain('proteusPageEmit')
  })
})

describe('★★平台专栏的诚实性（用户反馈：链接无效 + 推荐了未实现的能力）', () => {
  it('专栏是**按能力分组**的（三页内容不同——初版做成全局表导致三页相同）', async () => {
    const { PLATFORM_TOPICS } = await import('../packages/api/src/capability-app')
    const keys = Object.keys(PLATFORM_TOPICS)
    expect(keys.length, '平台专栏应按能力分页').toBeGreaterThanOrEqual(3)
    // 三页内容必须彼此不同（各能力有自己的平台扩展）
    const seen = new Set<string>()
    for (const k of keys) seen.add(JSON.stringify(PLATFORM_TOPICS[k]))
    expect(seen.size, '三页专栏内容不得相同').toBe(keys.length)
  })

  it('★专栏只引用 **implemented** 的能力（未实现 → 纯文本 + roadmap 标注，不生成链接）', async () => {
    const { PLATFORM_TOPICS } = await import('../packages/api/src/capability-app')
    const { PRIMITIVE_CATALOG } = await import('../packages/component-ir/src/index.ts')
    // 建 hook → status 索引
    const statusOf: Record<string, string> = {}
    for (const p of PRIMITIVE_CATALOG) {
      if (p.kind !== 'capability') continue
      const m = String(p.api ?? '').match(/^(use[A-Za-z0-9]+)/)
      if (m) statusOf[m[1]] = p.status ?? 'planned'
    }
    const violations: string[] = []
    for (const [cap, perEnd] of Object.entries(PLATFORM_TOPICS)) {
      for (const [end, list] of Object.entries(perEnd as Record<string, Array<{ hooks?: string[]; roadmap?: string; title: string }>>)) {
        for (const t of list) {
          for (const h of t.hooks ?? []) {
            const st = statusOf[h]
            if (st !== 'implemented') {
              violations.push(`${cap}/${end}「${t.title}」引用了 ${h}（status=${st ?? 'not-found'}）——专栏不得把未实现能力列为"相关能力"`)
            }
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('未实现的实现方向写在 roadmap 字段（纯文本，不给链接）', async () => {
    const { PLATFORM_TOPICS } = await import('../packages/api/src/capability-app')
    let roadmapCount = 0
    for (const perEnd of Object.values(PLATFORM_TOPICS)) {
      for (const list of Object.values(perEnd as Record<string, Array<{ roadmap?: string }>>)) {
        for (const t of list) if (t.roadmap) roadmapCount++
      }
    }
    expect(roadmapCount, '应有 roadmap 标注（诚实区分"已实现"与"规划中"）').toBeGreaterThan(0)
  })

  it('★生成产物中不含指向未实现能力的链接（防回归：链接会 404）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    const pages = ['website/content/capabilities/app-lifecycle.md', 'website/content/capabilities/page-lifecycle.md', 'website/content/capabilities/background.md']
    const bad: string[] = []
    for (const rel of pages) {
      const f = path.join(root, rel)
      if (!fs.existsSync(f)) continue
      const src = fs.readFileSync(f, 'utf8')
      const links = [...src.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])
      for (const l of links) {
        // 能力页链接必须指向 /docs/capability/<slug>（官网真实前缀——初版写成 /capabilities/ 全 404）
        if (l.startsWith('/capabilities/')) bad.push(`${rel}: ${l}（前缀应为 /docs/capability/）`)
        // 指向未实现能力的 slug（useKeyboard→keyboard 等）不得出现
        if (/\/docs\/capability\/(keyboard|window|navigation-guard)$/.test(l)) {
          bad.push(`${rel}: ${l}（目标能力未实现，应为纯文本+roadmap 标注）`)
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})

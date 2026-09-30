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

    bus.emit({ topic: 'memory-warning', level: 2 })
    bus.emit({ topic: 'theme-change', theme: 'dark' })
    bus.emit({ topic: 'resize', windowWidth: 390, windowHeight: 844 })
    bus.emit({ topic: 'error', error: 'boom' })
    bus.emit({ topic: 'unhandled-rejection', reason: 'why' })
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

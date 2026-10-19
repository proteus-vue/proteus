// tests/capability-resource-governance.test.ts
// ★★★决策 #1094（2026-10-19）：能力层边界资源的 **G-43 所有权治理**。
//
// 【为什么（用户提问「G-43 现在能不能做了？能力里可能已经涉及所有权治理」）】
//   查证结论：确实已涉及，且完全没被治理。G-43 语义层 B1-B5 已落地，但挂在 G-42 容器上，
//   而**能力层零接入**——能力层的边界资源（GC 管不到的原生句柄/观察者/连接）全是无主的：
//     · `conns`/`happened`（WebSocket 连接表）：只有测试用 reset，生产无清理入口
//     · `keyboardSubs`/`sensorSubs`/`recordingSubs`/`userCaptureSubs`：只能靠订阅者自己 off
//     · `screenTrees`（元素索引）：有 clearScreenElements() 但生产零调用
//   这直接违反铁律 G-43.1「边界资源必须归属某个 Owner……禁止无主资源」。
//
// 【本决策的落点（只做"框架代管 + 确定性释放"这一档）】
//   新增 `capability-resources.ts`：资源账本（登记/释放/接 OwnershipGraph）。
//   ★为什么不用 `Owned<T>`：它的语义是「唯一所有权 + Move + Borrow」，而能力资源是**多订阅者共享**的
//     （同一连接可被多处 on('message')）；套上去会迫使业务理解 Move，违背 G-43.4
//     「默认路径框架代管，业务零心智负担」。Move/Borrow 留给真正需要的业务资源。
//
// 【判据】
//   ① 账本语义：登记/释放幂等/批量释放/按类型计数/单个抛错不阻断其余；
//   ② 接图：登记与释放都反映到 OwnershipGraph（G-43.5 可观测）；
//   ③ **WebSocket 真登记**：`createAppWebSocket({ resources })` 建立连接后账本里有 `ws-connection`；
//      释放后连接表归零、且向宿主发了 close；
//   ④ **dispose 真释放**：`createCapabilityHooks(bridge, { resources })` 的 dispose 会清空账本；
//      不传 resources ⇒ 行为与从前一致（零回归）；
//   ⑤ **G-43.1 反证**：未登记的连接不会被账本"假装"管到（releaseAll 不会误报）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createCapabilityResourceRegistry,
  type CapabilityOwnershipGraph,
} from '../packages/api/src/capability-resources'
import {
  createAppWebSocket,
  dispatchWsPush,
  resetWsConnections,
  wsConnectionCount,
} from '../packages/api/src/capability-websocket'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

function installFakeHost(handler: (method: string, args: unknown) => unknown) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  ;(globalThis as Record<string, unknown>)[HOST_INVOKE_KEY] = (method: string, argsJson: string) => {
    const args = argsJson ? JSON.parse(argsJson) : {}
    calls.push({ method, args })
    const r = handler(method, args)
    if (r === undefined) return JSON.stringify({ ok: false, missing: true, reason: `未实现 ${method}` })
    return JSON.stringify({ ok: true, data: r })
  }
  return calls
}

function clearHost() {
  delete (globalThis as Record<string, unknown>)[HOST_INVOKE_KEY]
}

describe('★#1094 ① 账本语义', () => {
  it('登记 → 存活计数 + 按类型统计', () => {
    const reg = createCapabilityResourceRegistry()
    reg.register({ type: 'ws-connection', release: () => {} })
    reg.register({ type: 'ws-connection', release: () => {} })
    reg.register({ type: 'sensor-stream', release: () => {} })
    expect(reg.size()).toBe(3)
    expect(reg.countsByType()).toEqual({ 'ws-connection': 2, 'sensor-stream': 1 })
  })

  it('释放幂等：重复 release 返回 false，计数不重复减', () => {
    const reg = createCapabilityResourceRegistry()
    const r = reg.register({ type: 'x', release: () => {} })
    expect(r.release()).toBe(true)
    expect(r.release()).toBe(false)
    expect(reg.size()).toBe(0)
  })

  it('releaseAll 不抛；单个钩子抛错不阻断其余（资源不能因别人的 bug 泄漏）', () => {
    const reg = createCapabilityResourceRegistry()
    const ok1 = reg.register({ type: 'ok', release: () => {} })
    const boom = reg.register({ type: 'boom', release: () => { throw new Error('boom') } })
    const ok2 = reg.register({ type: 'ok2', release: () => {} })
    const r = reg.releaseAll()
    // ★语义：releaseAll **聚合失败而不中断**——把错误收进 failed 清单，其余照常释放。
    //   （初版我以为它会抛；实测是聚合，这个语义更好：一个坏钩子不该让别的资源泄漏。）
    expect(r.released).toEqual(expect.arrayContaining([ok1.id, ok2.id]))
    expect(r.failed.map((f) => f.id)).toEqual([boom.id])
    expect(r.failed[0].error).toContain('boom')
    expect(ok1.state).toBe('dropped')
    expect(ok2.state).toBe('dropped')
    expect(boom.state).toBe('dropped') // 状态先改后跑钩子：即便抛错也不留"看似存活"
    expect(reg.size()).toBe(0)
  })

  it('资源状态随释放变为 dropped', () => {
    const reg = createCapabilityResourceRegistry()
    const r = reg.register({ type: 'x', release: () => {} })
    expect(r.state).toBe('alive')
    r.release()
    expect(r.state).toBe('dropped')
  })
})

describe('★#1094 ② 接 G-43 所有权图（可观测）', () => {
  it('登记与释放都反映到图', () => {
    const reg = createCapabilityResourceRegistry()
    const registered: string[] = []
    const dropped: string[] = []
    const graph: CapabilityOwnershipGraph = {
      register(opts) { registered.push(opts.id); return opts },
      setState(id, state) { if (state === 'dropped') dropped.push(id) },
    }
    reg.attachGraph(graph)
    const r = reg.register({ type: 'ws-connection', release: () => {}, owner: 'page-1' })
    expect(registered).toEqual([r.id])
    r.release()
    expect(dropped).toEqual([r.id])
  })

  it('图侧抛错不阻断释放（释放是主职责）', () => {
    const reg = createCapabilityResourceRegistry()
    const graph: CapabilityOwnershipGraph = {
      register() { throw new Error('graph down') },
      setState() { throw new Error('graph down') },
    }
    expect(() => reg.attachGraph(graph)).not.toThrow()
    const released: string[] = []
    const r = reg.register({ type: 'x', release: () => released.push('ok') })
    expect(r.release()).toBe(true)
    expect(released).toEqual(['ok'])
  })
})

describe('★#1094 ③ WebSocket 连接真登记', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('建立连接后账本里有 ws-connection；释放后连接表归零且向宿主发 close', async () => {
    const calls = installFakeHost((m) => (m === 'ws.open' ? { id: 41 } : {}))
    const reg = createCapabilityResourceRegistry({ owner: 'page-1' })
    const connect = createAppWebSocket({ resources: reg, owner: 'page-1' })
    await connect('ws://example.com/echo')
    expect(wsConnectionCount()).toBe(1)
    expect(reg.countsByType()).toEqual({ 'ws-connection': 1 })

    const r = reg.releaseAll()
    expect(r.released.length).toBe(1)
    expect(wsConnectionCount()).toBe(0)
    // ★释放必须真的通知宿主关连接（只清本地表会让宿主 socket 泄漏）
    const closeCall = calls.find((c) => c.method === 'ws.close')
    expect(closeCall, '释放资源时必须调 ws.close').toBeTruthy()
    expect(closeCall!.args).toMatchObject({ id: 41, code: 1001 })
  })

  it('连接被对端关闭（close 事件）时账本同步销账（不把已关连接当泄漏）', async () => {
    installFakeHost((m) => (m === 'ws.open' ? { id: 42 } : {}))
    const reg = createCapabilityResourceRegistry()
    const connect = createAppWebSocket({ resources: reg })
    await connect('ws://x')
    expect(reg.size()).toBe(1)
    dispatchWsPush({ id: 42, event: 'close', code: 1000, reason: 'bye' })
    expect(reg.size(), 'close 后账本应销账').toBe(0)
  })

  it('不传 resources ⇒ 行为与从前完全一致（零回归）', async () => {
    installFakeHost((m) => (m === 'ws.open' ? { id: 43 } : {}))
    const connect = createAppWebSocket()
    await connect('ws://x')
    expect(wsConnectionCount()).toBe(1)
    resetWsConnections()
  })
})

describe('★#1094 ④ 键盘 / 传感器订阅也登记（同类边界资源）', () => {
  it('键盘订阅登记为 keyboard-subscription；off 时同步销账', async () => {
    const { createAppDeviceCapabilities } = await import('../packages/api/src/capability-app-device')
    const reg = createCapabilityResourceRegistry()
    // ★CapError 用最小构造器桩：本判据只关心"登记与销账"，不关心错误类型
    const cap = createAppDeviceCapabilities(Error, { resources: reg, owner: 'page-7' })
    const kb = cap.getKeyboard()
    const off = kb.onChange(() => {})
    expect(reg.countsByType()).toEqual({ 'keyboard-subscription': 1 })
    off()
    expect(reg.size(), '显式 off 后账本应同步销账').toBe(0)
  })

  it('dispose（releaseAll）能在业务忘记 off 时兜底退订', async () => {
    const { createAppDeviceCapabilities } = await import('../packages/api/src/capability-app-device')
    const reg = createCapabilityResourceRegistry()
    const cap = createAppDeviceCapabilities(Error, { resources: reg })
    cap.getKeyboard().onChange(() => {})
    expect(reg.size()).toBe(1)
    reg.releaseAll()
    expect(reg.size(), 'releaseAll 必须兜底退订（G-43.4 框架代管）').toBe(0)
  })

  it('传感器流订阅同样登记', async () => {
    const { createAppDeviceCapabilities } = await import('../packages/api/src/capability-app-device')
    const reg = createCapabilityResourceRegistry()
    const cap = createAppDeviceCapabilities(Error, { resources: reg })
    const off = cap.subscribeSensor('accelerometer', () => {})
    expect(reg.countsByType()).toEqual({ 'sensor-stream': 1 })
    off()
    expect(reg.size()).toBe(0)
  })

  it('不传 resources ⇒ 订阅行为不变（零回归）', async () => {
    const { createAppDeviceCapabilities } = await import('../packages/api/src/capability-app-device')
    const cap = createAppDeviceCapabilities(Error)
    const off = cap.getKeyboard().onChange(() => {})
    expect(typeof off).toBe('function')
    off()
  })
})

describe('★#1094 ⑤ dispose 真释放 + 零回归', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('createCapabilityHooks 的 dispose 会清空传入的账本', async () => {
    installFakeHost((m) => (m === 'ws.open' ? { id: 51 } : {}))
    const { createCapabilityHooks } = await import('../packages/api/src/capability')
    const reg = createCapabilityResourceRegistry()
    // ★直接登记一条（不依赖 App 宿主探测：单测里没有 __PROTEUS_HOST_ID__）
    reg.register({ type: 'ws-connection', release: () => {} })
    const hooks = createCapabilityHooks(undefined as never, { resources: reg })
    expect(reg.size()).toBe(1)
    hooks.dispose()
    expect(reg.size(), 'dispose 后账本必须归零').toBe(0)
  })

  it('不传 resources 时 dispose 仍可用（只清订阅）', async () => {
    const { createCapabilityHooks } = await import('../packages/api/src/capability')
    const hooks = createCapabilityHooks()
    expect(() => hooks.dispose()).not.toThrow()
  })
})

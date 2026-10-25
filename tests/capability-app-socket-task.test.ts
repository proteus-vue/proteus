// tests/capability-app-socket-task.test.ts
// ★★★决策 #1096（2026-10-19）：App 端 C28 `useSocketTask` —— **复用已验证的 WebSocket 腿**。
//
// 【为什么能复用】`SocketTaskBridge`（wx `SocketTask` 语义）与本仓 `WebSocketConnection`（C27）是
//   同一件事的两种形状：App 端底层都是同一条 WebSocket（Android 手写 RFC 6455 / iOS URLSessionWebSocketTask）。
//   ⇒ 只做形状适配，不新增网络栈、不新增宿主方法。
//
// 【★形态差异（本判据的核心）】`createSocketTask(url)` **同步返回句柄**（wx 语义），
//   而 `connect(url)` 是 async ⇒ 句柄立即返回（`isConnected()` 先 false），内部异步 connect。
//   这与浏览器 `new WebSocket()` 的"同步返回 + 异步 open"同形。
//
// 【判据】
//   ① 同步返回句柄，且初始 `isConnected() === false`（**不假装已连**）；
//   ② open 事件到达后 `isConnected() === true`；
//   ③ connecting 期间 `send` 排队，open 后**按序补发**（wx 语义允许先发后连）；
//   ④ 服务端消息按订阅转发给 `onMessage`；取消订阅后不再收到；
//   ⑤ 连接失败 ⇒ `send` reject 且 `isConnected()` 恒 false（不伪造已连接）；
//   ⑥ `close` 后状态变 closed，后续 `send` reject；
//   ⑦ 复用底层 ws：**只有一个** ws 连接（不额外开第二条）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createAppSocketTask,
  SOCKET_TASK_MAX_PENDING_SENDS, SOCKET_TASK_MAX_MESSAGE_BYTES, SOCKET_TASK_MAX_TASKS,
  socketTaskStats, __resetSocketTaskStats, socketTaskLive, __resetSocketTaskLive,
} from '../packages/api/src/capability-socket-task'
import { createCapabilityResourceRegistry } from '../packages/api/src/capability-resources'
import { createAppWebSocket, dispatchWsPush, resetWsConnections, wsConnectionCount } from '../packages/api/src/capability-websocket'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

type Call = { method: string; args: Record<string, unknown> }

function installFakeHost(handler: (method: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = []
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

/** 装一个 fake host（回预置 id），返回记录用的 calls。 */
function makeFactory(id = 100): Call[] {
  return installFakeHost((m) => (m === 'ws.open' ? { id } : {}))
}

describe('★#1096 ① 同步返回句柄 + 初始未连接', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('createSocketTask 同步返回，isConnected() 初始为 false', () => {
    makeFactory(100)
    const task = createAppSocketTask(createAppWebSocket())('ws://example.com/x')
    expect(task, '必须同步返回句柄（wx SocketTask 语义）').toBeTruthy()
    expect(task.isConnected(), '连接尚未建立时不得报已连接').toBe(false)
  })

  it('open 事件到达后 isConnected() 变 true', async () => {
    makeFactory(101)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    // 等内部 connect 的微任务落定（拿 id）
    await Promise.resolve()
    await Promise.resolve()
    dispatchWsPush({ id: 101, event: 'open' })
    expect(task.isConnected()).toBe(true)
  })
})

describe('★#1096 ② connecting 期间 send 排队，open 后按序补发', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('先 send 两条（未连上）→ open 后按序发出', async () => {
    const calls = makeFactory(102)
    const factory = createAppWebSocket()
    const task = createAppSocketTask(factory)('ws://x')
    await Promise.resolve(); await Promise.resolve()
    // connecting 期间发送（应排队、不 reject）
    await expect(task.send('m1')).resolves.toBeUndefined()
    await expect(task.send('m2')).resolves.toBeUndefined()
    expect(calls.filter((c) => c.method === 'ws.send').length, 'open 之前不应真的发出').toBe(0)
    // open ⇒ 补发
    dispatchWsPush({ id: 102, event: 'open' })
    const sends = calls.filter((c) => c.method === 'ws.send').map((c) => c.args.data)
    expect(sends).toEqual(['m1', 'm2'])
  })

  it('open 之后 send 直接发出', async () => {
    const calls = makeFactory(103)
    const factory = createAppWebSocket()
    const task = createAppSocketTask(factory)('ws://x')
    await Promise.resolve(); await Promise.resolve()
    dispatchWsPush({ id: 103, event: 'open' })
    await task.send('direct')
    expect(calls.filter((c) => c.method === 'ws.send').map((c) => c.args.data)).toEqual(['direct'])
  })
})

describe('★#1096 ③ 消息转发与订阅取消', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('服务端消息转发给 onMessage；取消后不再收到', async () => {
    makeFactory(104)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve()
    dispatchWsPush({ id: 104, event: 'open' })
    const got: string[] = []
    const off = task.onMessage((d) => got.push(d))
    dispatchWsPush({ id: 104, event: 'message', data: 'hi-1' })
    off()
    dispatchWsPush({ id: 104, event: 'message', data: 'hi-2' })
    expect(got).toEqual(['hi-1'])
  })

  it('多个订阅者都收到同一条消息', async () => {
    makeFactory(105)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve()
    dispatchWsPush({ id: 105, event: 'open' })
    const a: string[] = []
    const b: string[] = []
    task.onMessage((d) => a.push(d))
    task.onMessage((d) => b.push(d))
    dispatchWsPush({ id: 105, event: 'message', data: 'x' })
    expect(a).toEqual(['x'])
    expect(b).toEqual(['x'])
  })

  it('二进制消息不进 onMessage（契约是文本；不静默当文本处理）', async () => {
    makeFactory(106)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve()
    dispatchWsPush({ id: 106, event: 'open' })
    const got: string[] = []
    task.onMessage((d) => got.push(d))
    dispatchWsPush({ id: 106, event: 'message', binary: [1, 2, 3] })
    expect(got, '二进制不应被当作文本转发').toEqual([])
  })
})

describe('★#1096 ④ 失败与关闭不伪造状态', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('宿主不支持 ws.open ⇒ send reject，isConnected 恒 false', async () => {
    installFakeHost(() => undefined)   // 所有方法 missing
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(task.isConnected()).toBe(false)
    await expect(task.send('x')).rejects.toMatchObject({ code: 'socket-task.failed' })
  })

  it('close 后 send reject，isConnected false', async () => {
    makeFactory(107)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve()
    dispatchWsPush({ id: 107, event: 'open' })
    expect(task.isConnected()).toBe(true)
    await task.close(1000, 'done')
    expect(task.isConnected()).toBe(false)
    await expect(task.send('after-close')).rejects.toMatchObject({ code: 'socket-task.failed' })
  })
})

describe('★#1096 ⑤ 复用底层 ws（不额外开连接）', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('创建一个 socket-task 只占一个 ws 连接', async () => {
    const calls = makeFactory(108)
    const task = createAppSocketTask(createAppWebSocket())('ws://x')
    await Promise.resolve(); await Promise.resolve()
    expect(calls.filter((c) => c.method === 'ws.open').length, '只应调一次 ws.open').toBe(1)
    expect(wsConnectionCount()).toBe(1)
    dispatchWsPush({ id: 108, event: 'open' })
    expect(task.isConnected()).toBe(true)
  })
})

// ══════════════ ★★★#1245 §1.0 四项必答（socket-task 此前无上界）══════════════

describe('⑤ 规模承载：socket-task 的四项必答', () => {
  // ★读数与存活计数都是**模块级** ⇒ 用例间必须归零（否则前一个用例的 128 个任务会顶到上界）
  beforeEach(() => { __resetSocketTaskStats(); __resetSocketTaskLive(); resetWsConnections() })
  it('① 积压上界：连接未建立时狂发 ⇒ 丢最旧 + 计数（原实现是无界数组 ⇒ OOM）', () => {
    // ★造一个"永远不 open"的 ws 工厂 ⇒ 所有 send 都进 pendingSends
    const neverOpen = (() => new Promise(() => undefined)) as unknown as ReturnType<typeof createAppWebSocket>
    const mk = createAppSocketTask(neverOpen)
    const t = mk('wss://x.test')
    for (let i = 0; i < SOCKET_TASK_MAX_PENDING_SENDS + 10; i++) void t.send('m' + i)
    const st = socketTaskStats()
    expect(st.pendingSends, '★积压被上界钉住').toBe(SOCKET_TASK_MAX_PENDING_SENDS)
    expect(st.droppedBeforeOpen, '★丢弃了最旧的 10 条并计数').toBe(10)
    expect(st.peakPendingSends, '峰值 = 上界（真的逼近过）').toBe(SOCKET_TASK_MAX_PENDING_SENDS)
  })

  it('② 上限·单条：超过 SOCKET_TASK_MAX_MESSAGE_BYTES ⇒ reject socket-task.tooLarge', async () => {
    const neverOpen = (() => new Promise(() => undefined)) as unknown as ReturnType<typeof createAppWebSocket>
    const t = createAppSocketTask(neverOpen)('wss://x.test')
    const e = await t.send('x'.repeat(SOCKET_TASK_MAX_MESSAGE_BYTES + 1)).catch((x: { code?: string }) => x)
    expect((e as { code?: string }).code, '★超限必须显式报错').toBe('socket-task.tooLarge')
    expect(socketTaskStats().rejectedTooLarge).toBe(1)
  })

  it('③ 并发·任务数上界：超过 SOCKET_TASK_MAX_TASKS ⇒ 显式抛 socket-task.tooManyTasks', () => {
    const neverOpen = (() => new Promise(() => undefined)) as unknown as ReturnType<typeof createAppWebSocket>
    const mk = createAppSocketTask(neverOpen)
    const tasks: unknown[] = []
    for (let i = 0; i < SOCKET_TASK_MAX_TASKS; i++) tasks.push(mk(`wss://x.test/${i}`))
    expect(socketTaskLive().live).toBe(SOCKET_TASK_MAX_TASKS)
    let code = ''
    try {
      mk('wss://x.test/overflow')
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code, '★超限必须显式拒绝（不淘汰现有连接——那会掐断用户正在用的 socket）').toBe(
      'socket-task.tooManyTasks',
    )
    expect(socketTaskLive().rejected).toBe(1)
    void tasks
  })

  it('④ 回收：账本登记任务，release 清积压 + 清订阅', () => {
    const neverOpen = (() => new Promise(() => undefined)) as unknown as ReturnType<typeof createAppWebSocket>
    // ★用文件顶部的静态 import（ESM 下没有 require —— 第一版写成 require 直接 module-not-found）
    const registry = createCapabilityResourceRegistry({ owner: 'page' })
    const mk = createAppSocketTask(neverOpen, registry, 'page')
    const t = mk('wss://x.test')
    void t.send('a')
    void t.send('b')
    expect(registry.countsByType()['socket-task'], '★任务已登记为边界资源').toBe(1)
    registry.releaseAll()
    expect(registry.size(), '账本归零').toBe(0)
    expect(socketTaskStats().pendingSends, '★release ⇒ 积压被清空（消息正文不再驻留）').toBe(0)
  })
})

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
import { createAppSocketTask } from '../packages/api/src/capability-socket-task'
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

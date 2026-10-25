// tests/capability-app-websocket.test.ts
// ★★★决策 #1093（2026-10-19）：App 端 `useWebSocket`（C27）桥的**通道语义**判据。
//
// 【为什么（能力总览矩阵点名的第二大空白）】
//   「网络与通信」在 App 端 11 项里只有 `fetch` 可用，WebSocket 全 🟡。两端平台 API 都现成
//   （Android 手写 RFC 6455 / iOS `URLSessionWebSocketTask`），缺的是**通道形态**：
//   `invoke` 是一问一答，而 WebSocket 连上以后是**持续双向流**。
//
// 【通道设计（本判据要锁住的就是这个契约）】
//   ① `ws.open` **受理即返** `{ id }`——**不等握手**（G-39「invokeNative 统一异步」；
//      在 JS 线程上等网络 = 把 UI 与 JS 一起冻住，本仓红线）；
//   ② 握手结果经壳推 `__proteusHostWs({id,event:'open'|'error'})` 到达；
//   ③ 消息 / 关闭同样是壳推——**不把每条消息做成一次 invoke 往返**（高频场景会把成本翻倍）；
//   ④ `close` 事件后该连接的订阅表被清理（防泄漏）。
//
// 【判据】
//   ① `open` 缺失 ⇒ `websocket.unsupported`（不伪造连接）；
//   ② `open` 回无效 id ⇒ `websocket.failed`；
//   ③ 事件按 id 精确路由（不会串到别的连接）；
//   ④ `close` / `error` 后订阅表清理，迟到消息不抛；
//   ⑤ `send` 失败经 `error` 事件回报（**不抛**——签名是 void，与浏览器一致）；
//   ⑥ 卸载订阅函数后不再收到该事件。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createAppWebSocket, dispatchWsPush, installWsChannel, resetWsConnections,
  wsConnectionCount, APP_WS_PUSH_KEY, APP_WS_METHODS,
  WS_MAX_CONNECTIONS, WS_MAX_SEND_BYTES, WS_MAX_HANDLERS_PER_EVENT,
  WS_SLOW_DISPATCH_MS, WS_MAX_DISPATCH_PER_PUSH,
  wsStatsSnapshot, __resetWsStats, __setWsClock,
} from '../packages/api/src/capability-websocket'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

type Call = { method: string, args: unknown }

/** 装一个假宿主：按 method 返回预置结果，并记录调用序列 */
function installFakeHost(handler: (method: string, args: unknown) => unknown) {
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
  delete (globalThis as Record<string, unknown>)[APP_WS_PUSH_KEY]
}

describe('★#1093 ① 通道契约：open 受理即返 + 事件经壳推', () => {
  beforeEach(() => { resetWsConnections(); clearHost(); __resetWsStats() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('ws.open 返回 id，且**不等待握手**（open 事件由壳推）', async () => {
    const calls = installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 7 } : {}))
    const connect = createAppWebSocket()
    let opened = false
    const ws = await connect('ws://example.com/echo')
    ws.on('open', () => { opened = true })
    // 桥返回时还没 open（握手由宿主推）——这是设计的核心
    expect(opened).toBe(false)
    expect(calls[0]).toEqual({ method: 'ws.open', args: { url: 'ws://example.com/echo', protocols: [] } })
    // 壳推 open 之后才变为已连接
    dispatchWsPush({ id: 7, event: 'open', protocol: 'chat' })
    expect(opened).toBe(true)
  })

  it('宿主未实现 ws.open ⇒ websocket.unsupported（不伪造连接）', async () => {
    installFakeHost(() => undefined) // 所有方法都 missing
    const connect = createAppWebSocket()
    await expect(connect('ws://x')).rejects.toMatchObject({ code: 'websocket.unsupported' })
    expect(wsConnectionCount()).toBe(0)
  })

  it('ws.open 回无效 id ⇒ websocket.failed', async () => {
    installFakeHost(() => ({ id: 'nope' }))
    const connect = createAppWebSocket()
    await expect(connect('ws://x')).rejects.toMatchObject({ code: 'websocket.failed' })
  })
})

describe('★#1093 ② 事件路由与清理', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('按 id 精确路由：连接 A 的消息不会到 B', async () => {
    let next = 1
    installFakeHost(() => ({ id: next++ }))
    const connect = createAppWebSocket()
    const a = await connect('ws://a')
    const b = await connect('ws://b')
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    a.on('message', (p) => gotA.push(p))
    b.on('message', (p) => gotB.push(p))
    dispatchWsPush({ id: 1, event: 'message', data: 'to-a' })
    dispatchWsPush({ id: 2, event: 'message', data: 'to-b' })
    expect(gotA).toEqual([{ data: 'to-a' }])
    expect(gotB).toEqual([{ data: 'to-b' }])
  })

  it('close 事件后连接被清理，迟到消息不抛', async () => {
    installFakeHost(() => ({ id: 9 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const closed: unknown[] = []
    ws.on('close', (p) => closed.push(p))
    dispatchWsPush({ id: 9, event: 'close', code: 1000, reason: 'bye' })
    expect(closed).toEqual([{ code: 1000, reason: 'bye' }])
    expect(wsConnectionCount()).toBe(0)
    expect(() => dispatchWsPush({ id: 9, event: 'message', data: 'late' })).not.toThrow()
  })

  it('★open 早于订阅到达时，晚订阅仍能补感知（真机抓出的 bug）', async () => {
    // 真机形态：宿主在 ws.open 受理后立刻连上并推 open，而调用方还在 await ⇒
    //   等它 on('open', ...) 时事件已分发过。若不补感知，回调永远不触发（探针等超时）。
    installFakeHost(() => ({ id: 21 }))
    const connect = createAppWebSocket()
    dispatchWsPush({ id: 21, event: 'open', protocol: 'chat' }) // ★先到（句柄还没拿到）
    const ws = await connect('ws://x')
    let got: unknown = null
    ws.on('open', (p) => { got = p })
    expect(got).toEqual({ protocol: 'chat' })
  })

  it('message 不缓存（流式事件重复投递是错误语义）', async () => {
    installFakeHost(() => ({ id: 22 }))
    dispatchWsPush({ id: 22, event: 'message', data: 'before' })
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const got: unknown[] = []
    ws.on('message', (p) => got.push(p))
    expect(got).toEqual([]) // 订阅前的消息不补发
  })

  it('取消订阅后不再收到事件', async () => {
    installFakeHost(() => ({ id: 3 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const got: unknown[] = []
    const off = ws.on('message', (p) => got.push(p))
    dispatchWsPush({ id: 3, event: 'message', data: '1' })
    off()
    dispatchWsPush({ id: 3, event: 'message', data: '2' })
    expect(got).toEqual([{ data: '1' }])
  })

  it('多个订阅者都收到同一条消息（不互相吞）', async () => {
    installFakeHost(() => ({ id: 4 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const a: unknown[] = []
    const b: unknown[] = []
    ws.on('message', (p) => a.push(p))
    ws.on('message', (p) => b.push(p))
    dispatchWsPush({ id: 4, event: 'message', data: 'hi' })
    expect(a.length).toBe(1)
    expect(b.length).toBe(1)
  })
})

describe('★#1093 ③ 发送与关闭', () => {
  beforeEach(() => { resetWsConnections(); clearHost() })
  afterEach(() => { resetWsConnections(); clearHost() })

  it('文本发送走 ws.send，参数含 id 与 data', async () => {
    const calls = installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 5 } : {}))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    ws.send('hello')
    const send = calls.find((c) => c.method === 'ws.send')
    expect(send).toEqual({ method: 'ws.send', args: { id: 5, data: 'hello' } })
  })

  it('二进制发送带 binaryFlag（宿主据此走二进制帧）', async () => {
    const calls = installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 6 } : {}))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    ws.send(new Uint8Array([1, 2, 255]).buffer)
    const send = calls.find((c) => c.method === 'ws.send')!
    expect((send.args as { binaryFlag: boolean }).binaryFlag).toBe(true)
    expect((send.args as { binary: number[] }).binary).toEqual([1, 2, 255])
  })

  it('发送失败**经 error 事件回报**（不抛，与浏览器 send 语义一致）', async () => {
    installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 8 } : undefined))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const errors: unknown[] = []
    ws.on('error', (p) => errors.push(p))
    expect(() => ws.send('boom')).not.toThrow()
    expect(errors.length).toBe(1)
    expect((errors[0] as { missing?: boolean }).missing).toBe(true)
  })

  it('close 走 ws.close 并带 code/reason', async () => {
    const calls = installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 10 } : {}))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    ws.close(1001, 'going away')
    const c = calls.find((x) => x.method === 'ws.close')!
    expect(c.args).toEqual({ id: 10, code: 1001, reason: 'going away' })
  })
})

describe('★#1093 ④ 通道安装幂等 + 推送载荷容错', () => {
  // ★★#1244：本块此前**没有** beforeEach/afterEach ⇒ 用例间状态串联（新增的 S3 判据会建 64 条连接、
  //   累计 sendFailures，导致后面的用例假红）。状态型判据必须自带隔离。
  beforeEach(() => { resetWsConnections(); clearHost(); __resetWsStats() })
  afterEach(() => { resetWsConnections(); clearHost(); __setWsClock(null) })

  it('installWsChannel 幂等（重复调用不覆盖已有函数）', () => {
    resetWsConnections()
    installWsChannel()
    const first = (globalThis as Record<string, unknown>)[APP_WS_PUSH_KEY]
    installWsChannel()
    expect((globalThis as Record<string, unknown>)[APP_WS_PUSH_KEY]).toBe(first)
    expect(typeof first).toBe('function')
  })

  it('★宿主推的是 JSON **字符串**（不是对象）——必须能解析（真机抓出的根因）', async () => {
    // 真机形态：宿主用 JSONObject.quote 把载荷包成字符串再调 __proteusHostWs(...)。
    //   首版 normalizeWsPush 只接受对象 ⇒ 返回 null ⇒ dispatchWsPush 恒 0 ⇒
    //   连接建好了、事件永远到不了业务（探针卡在 connected 46 秒）。
    resetWsConnections()
    installFakeHost(() => ({ id: 31 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const got: unknown[] = []
    ws.on('open', (p) => got.push(p))
    // ★传字符串（与宿主行为一致）
    expect(dispatchWsPush(JSON.stringify({ id: 31, event: 'open', protocol: 'chat' }))).toBe(1)
    expect(got).toEqual([{ protocol: 'chat' }])
  })

  it('字符串载荷也能分发 message（id 相同才路由）', async () => {
    resetWsConnections()
    installFakeHost(() => ({ id: 32 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const got: unknown[] = []
    ws.on('message', (p) => got.push(p))
    dispatchWsPush(JSON.stringify({ id: 32, event: 'message', data: 'hi' }))
    expect(got).toEqual([{ data: 'hi' }])
  })

  it('畸形推送载荷返回 0 而不是抛错', () => {
    resetWsConnections()
    expect(dispatchWsPush(null)).toBe(0)
    expect(dispatchWsPush({})).toBe(0)
    expect(dispatchWsPush({ id: 1, event: 'nonsense' })).toBe(0)
    expect(dispatchWsPush('string')).toBe(0)
  })

  it('三端字段习惯都接受（data / text / binary）', async () => {
    resetWsConnections()
    installFakeHost(() => ({ id: 11 }))
    const connect = createAppWebSocket()
    const ws = await connect('ws://x')
    const got: unknown[] = []
    ws.on('message', (p) => got.push(p))
    dispatchWsPush({ id: 11, event: 'message', text: 'from-ios' })
    dispatchWsPush({ id: 11, event: 'message', binary: [1, 2] })
    expect(got).toEqual([{ data: 'from-ios' }, { data: [1, 2] }])
  })

  // ══════════════ ★★★#1244 §1.0 S3 四项必答（ws 此前是 S1）══════════════
  // ★判据口径与 fetch 一致：不只看"读数存在"，而是**造出条件**后断言读数变了。
  //   慢分发用**注入时钟**制造（不用真实耗时——本仓红线：禁止任何形式的盲等）。

  it('⑦ 上限·单条发送：超过 WS_MAX_SEND_BYTES ⇒ 经 error 事件回报、不发、连接保留', async () => {
    installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 1 } : {}))
    const ws = await createAppWebSocket()('wss://x.test')
    const errs: unknown[] = []
    ws.on('error', (p) => errs.push(p))
    ws.send('x'.repeat(WS_MAX_SEND_BYTES + 1))
    expect(errs.length, '★超限经 error 事件回报（send 签名是 void，不能抛）').toBe(1)
    expect((errs[0] as { tooLarge?: boolean }).tooLarge, '带可辨识标记').toBe(true)
    expect(wsStatsSnapshot().sendFailures, '发送失败被计数').toBe(1)
    expect(wsConnectionCount(), '★连接保留（不因单条过大而断）').toBe(1)
  })

  it('⑧ 背压·慢分发：注入时钟造出 >WS_SLOW_DISPATCH_MS ⇒ 计 slowDispatches', async () => {
    const fake = installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 1 } : {}))
    const ws = await createAppWebSocket()('wss://x.test')
    ws.on('message', () => undefined)
    // ★假时钟：每次读 +10ms ⇒ 一次分发必然记到 10ms（> 8ms 阈值），零真实等待
    let t = 0
    __setWsClock(() => (t += 10))
    dispatchWsPush({ id: 1, event: 'message', data: 'x' })
    __setWsClock(null)
    const st = wsStatsSnapshot()
    expect(st.slowDispatches, '★慢分发被计数（ws 的背压形态：宿主线程被占）').toBe(1)
    expect(st.dispatchMs, '累计耗时也记了').toBeGreaterThanOrEqual(WS_SLOW_DISPATCH_MS)
    expect(fake.length, '宿主真的被调用过（不是空跑）').toBeGreaterThan(0)
  })

  it('⑨ 背压·单次分发上界：订阅者超过 WS_MAX_DISPATCH_PER_PUSH ⇒ 截断并计数', async () => {
    installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 1 } : {}))
    const ws = await createAppWebSocket()('wss://x.test')
    let calls = 0
    for (let i = 0; i < WS_MAX_DISPATCH_PER_PUSH + 5; i++) ws.on('message', () => { calls++ })
    dispatchWsPush({ id: 1, event: 'message', data: 'y' })
    expect(calls, '★单次最多调 WS_MAX_DISPATCH_PER_PUSH 个（防一条消息卡死整条通道）').toBe(WS_MAX_DISPATCH_PER_PUSH)
    expect(wsStatsSnapshot().dispatchTruncated, '截断被计数').toBe(1)
  })

  it('⑩ 并发·连接数上界：超过 WS_MAX_CONNECTIONS ⇒ 显式拒绝 websocket.tooManyConnections', async () => {
    installFakeHost((m, a) => (m === APP_WS_METHODS.open ? { id: Number((a as { url?: string }).url?.split('/n/')[1] ?? 1) } : {}))
    const connect = createAppWebSocket()
    // ★直接用可辨识的 id 批量连（避免 id 重复覆盖 conns 条目）
    let n = 0
    installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: ++n } : {}))
    for (let i = 0; i < WS_MAX_CONNECTIONS; i++) await connect(`wss://x.test/${i}`)
    expect(wsConnectionCount()).toBe(WS_MAX_CONNECTIONS)
    await expect(connect('wss://x.test/overflow'), '★超限必须显式拒绝').rejects.toThrow(
      /websocket\.tooManyConnections/,
    )
    expect(wsStatsSnapshot().rejectedConnections).toBe(1)
    expect(wsStatsSnapshot().peakConnections, '峰值被记录（上界真的被逼近过）').toBe(WS_MAX_CONNECTIONS)
  })

  it('⑪ 订阅者上界：单事件超过 WS_MAX_HANDLERS_PER_EVENT ⇒ 显式抛（不静默不挂）', async () => {
    installFakeHost((m) => (m === APP_WS_METHODS.open ? { id: 1 } : {}))
    const ws = await createAppWebSocket()('wss://x.test')
    for (let i = 0; i < WS_MAX_HANDLERS_PER_EVENT; i++) ws.on('message', () => undefined)
    expect(() => ws.on('message', () => undefined), '★超限如实抛（静默不挂会让业务以为订阅成功）').toThrow(
      /websocket\.tooManyHandlers/,
    )
    expect(wsStatsSnapshot().rejectedHandlers).toBe(1)
  })

  it('⑫ 读数·无主消息计入 messagesDropped（"消息丢了"必须可查）', async () => {
    installFakeHost(() => ({}))
    resetWsConnections()
    __resetWsStats()
    const hit = dispatchWsPush({ id: 9999, event: 'message', data: 'orphan' })
    expect(hit, '无订阅者 ⇒ 命中 0').toBe(0)
    const st = wsStatsSnapshot()
    expect(st.messagesDropped, '★丢弃被计数').toBe(1)
    expect(st.messagesReceived, '收到计数也 +1（两者能对上）').toBe(1)
  })
})

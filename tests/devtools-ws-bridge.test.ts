// tests/devtools-ws-bridge.test.ts —— devtools 远程查看桥（createTraceBusWsBridge：TraceBus → WS 上行）
// 协议：上行 Proteus.event（TraceEvent 重组）；响应 Proteus.enable / Proteus.appInfo
// @vitest-environment happy-dom（WebSocket 全局）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import { createTraceBusWsBridge } from '@proteus-vue/devtools'

function mockWs() {
  const sent: string[] = []
  return {
    sent,
    send: vi.fn((d: string) => sent.push(d)),
    close: vi.fn(),
    readyState: 1,
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    onopen: null as (() => void) | null,
  }
}

/** ★先 stub 全局 WebSocket 再创建 bridge（构造时 new WebSocket 返回 mock）；补静态 OPEN 常量 */
function setupBridge() {
  const ws = mockWs()
  const Fake = vi.fn(() => ws) as unknown as typeof WebSocket
  Fake.OPEN = 1
  Fake.CLOSED = 3
  vi.stubGlobal('WebSocket', Fake)
  const bus = createTraceBus({ enabled: true })
  const bridge = createTraceBusWsBridge(bus, { url: 'ws://host/proteus-source', appInfo: () => ({ routes: [{ name: 'index', path: 'pages/index' }] }) })
  return { bus, bridge, ws }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createTraceBusWsBridge', () => {
  it('TraceBus 事件 → WS 上行 Proteus.event（TraceEvent 字段重组）', () => {
    const { bus, bridge, ws } = setupBridge()
    bus.emit('api', 'start', 'fetchOrder', { url: '/x' }, 't1')
    expect(ws.sent.length).toBe(1)
    const msg = JSON.parse(ws.sent[0])
    expect(msg).toMatchObject({ method: 'Proteus.event', params: { source: 'api', phase: 'start', name: 'fetchOrder', traceId: 't1' } })
    bridge.close()
    expect(ws.close).toHaveBeenCalled()
  })

  it('响应 Proteus.enable / Proteus.appInfo 命令（appInfo 数据源注入）', () => {
    const { bridge, ws } = setupBridge()
    ws.onmessage?.({ data: JSON.stringify({ id: 1, method: 'Proteus.enable' }) })
    ws.onmessage?.({ data: JSON.stringify({ id: 2, method: 'Proteus.appInfo' }) })
    const sent = ws.sent.map((s) => JSON.parse(s))
    expect(sent).toContainEqual({ id: 1, result: {} })
    expect(sent).toContainEqual({ id: 2, result: { routes: [{ name: 'index', path: 'pages/index' }] } })
    bridge.close()
  })

  it('★远程时间旅行：Proteus.restoreStores 命令 → onRestoreStores 回调（逐 store $patch）+ result 响应', () => {
    const ws = mockWs()
    const Fake = vi.fn(() => ws) as unknown as typeof WebSocket
    Fake.OPEN = 1
    vi.stubGlobal('WebSocket', Fake)
    const bus = createTraceBus({ enabled: true })
    const restore = vi.fn()
    const bridge = createTraceBusWsBridge(bus, { url: 'ws://host/proteus-source', onRestoreStores: restore })
    ws.onmessage?.({
      data: JSON.stringify({ id: 7, method: 'Proteus.restoreStores', params: { stores: [{ id: 'player', state: { playing: false, volume: 0.8 } }] } }),
    })
    expect(restore).toHaveBeenCalledWith([{ id: 'player', state: { playing: false, volume: 0.8 } }])
    expect(ws.sent.map((s) => JSON.parse(s))).toContainEqual({ id: 7, result: {} })
    bridge.close()
  })

  it('★Proteus.enable → 回放缓冲历史事件（面板后开/重连立即有数据：生命周期等早已 emit）', () => {
    const ws = mockWs()
    ws.readyState = 0 // CONNECTING：on 回调丢弃、事件进缓冲（应用 bootstrap/coreReady 阶段）
    const Fake = vi.fn(() => ws) as unknown as typeof WebSocket
    Fake.OPEN = 1
    vi.stubGlobal('WebSocket', Fake)
    const bus = createTraceBus({ enabled: true })
    const bridge = createTraceBusWsBridge(bus, { url: 'ws://host/proteus-source' })
    bus.emit('lifecycle', 'start', 'bootstrap')
    bus.emit('lifecycle', 'end', 'bootstrap')
    expect(ws.sent.length).toBe(0) // 未 OPEN：不上行，进缓冲
    // 面板连接（WS OPEN）→ Proteus.enable → 缓冲回放上行
    ws.readyState = 1
    ws.onmessage?.({ data: JSON.stringify({ id: 7, method: 'Proteus.enable' }) })
    const events = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.method === 'Proteus.event')
    expect(events.map((m) => m.params.name)).toEqual(['bootstrap', 'bootstrap'])
    // enable 响应仍在
    expect(ws.sent.map((s) => JSON.parse(s))).toContainEqual({ id: 7, result: {} })
    // 回放后缓冲已清空：再次 enable 不重复
    ws.sent.length = 0
    ws.onmessage?.({ data: JSON.stringify({ id: 8, method: 'Proteus.enable' }) })
    expect(ws.sent.map((s) => JSON.parse(s)).filter((m) => m.method === 'Proteus.event').length).toBe(0)
    bridge.close()
  })

  it('bus 未开启 → 无上行（门控零开销）', () => {
    const ws = mockWs()
    const Fake = vi.fn(() => ws) as unknown as typeof WebSocket
    Fake.OPEN = 1
    vi.stubGlobal('WebSocket', Fake)
    const bus = createTraceBus({ enabled: false })
    const bridge = createTraceBusWsBridge(bus, { url: 'ws://host/proteus-source' })
    bus.emit('api', 'point', 'x')
    expect(ws.sent.length).toBe(0)
    bridge.close()
  })
})

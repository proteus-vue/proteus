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

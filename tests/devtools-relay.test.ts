// tests/devtools-relay.test.ts —— devtools 远程查看中转（devtoolsRelayPlugin / createProteusRelay）
// 双通道路由：panel 命令（Proteus.enable/appInfo）→ source；source 响应按 id 路由回；source 事件广播 panels
import { describe, it, expect } from 'vitest'
import { createProteusRelay, isOriginAllowed } from '@proteus-vue/plugin-vite'

/** mock socket（ws 库 WebSocket 结构子集：send/close/readyState/on） */
function mockSocket() {
  const sent: string[] = []
  const handlers: Record<string, (data: unknown) => void> = {}
  return {
    sent,
    send: (data: string) => sent.push(data),
    close: () => {},
    readyState: 1,
    on: (event: string, cb: (data: unknown) => void) => {
      handlers[event] = cb
    },
    emit: (event: string, data: unknown) => handlers[event]?.(data),
  }
}

describe('★M10 权限最小化（M7.3：Origin 白名单 isOriginAllowed）', () => {
  it('allowFrom 空 → 全放（dev 工具默认信任本机）；非空 → 精确匹配；无 Origin 拒绝', () => {
    expect(isOriginAllowed('http://localhost:5173', [])).toBe(true) // 缺省全放
    expect(isOriginAllowed(undefined, [])).toBe(true)
    expect(isOriginAllowed('http://localhost:5173', ['http://localhost:5173', 'http://127.0.0.1:5173'])).toBe(true)
    expect(isOriginAllowed('https://evil.example.com', ['http://localhost:5173'])).toBe(false) // 非白名单拒绝
    expect(isOriginAllowed('http://localhost:5173', ['http://localhost:5173/'])).toBe(false) // 精确匹配（无尾斜杠归一）
    expect(isOriginAllowed(undefined, ['http://localhost:5173'])).toBe(false) // 无 Origin（非浏览器来源）拒绝
  })
})

describe('createProteusRelay 路由', () => {
  it('source 的 Proteus.event → 广播所有 panel', () => {
    const relay = createProteusRelay()
    const source = mockSocket()
    const panelA = mockSocket()
    const panelB = mockSocket()
    relay.handleConnection('source', source as never)
    relay.handleConnection('panel', panelA as never)
    relay.handleConnection('panel', panelB as never)
    source.emit('message', JSON.stringify({ method: 'Proteus.event', params: { source: 'api', name: 'req' } }))
    expect(panelA.sent.length).toBe(1)
    expect(panelB.sent.length).toBe(1)
    expect(JSON.parse(panelA.sent[0]).method).toBe('Proteus.event')
  })

  it('panel 命令（Proteus.enable/appInfo）→ 转发 source；source 响应按 id 路由回原 panel', () => {
    const relay = createProteusRelay()
    const source = mockSocket()
    const panelA = mockSocket()
    const panelB = mockSocket()
    relay.handleConnection('source', source as never)
    relay.handleConnection('panel', panelA as never)
    relay.handleConnection('panel', panelB as never)
    // 两个 panel 同时发命令（不同 id）
    panelA.emit('message', JSON.stringify({ id: 1, method: 'Proteus.enable' }))
    panelB.emit('message', JSON.stringify({ id: 2, method: 'Proteus.appInfo' }))
    expect(source.sent.length).toBe(2)
    // source 按 id 响应 → 各自路由回
    source.emit('message', JSON.stringify({ id: 2, result: { routes: [] } }))
    source.emit('message', JSON.stringify({ id: 1, result: {} }))
    expect(panelA.sent.length).toBe(1)
    expect(panelB.sent.length).toBe(1)
    expect(JSON.parse(panelB.sent[0])).toEqual({ id: 2, result: { routes: [] } })
    expect(JSON.parse(panelA.sent[0])).toEqual({ id: 1, result: {} })
  })

  it('无 source 连接 → panel 命令不转发（不抛错）；source 断开后 counts 归零', () => {
    const relay = createProteusRelay()
    const panel = mockSocket()
    relay.handleConnection('panel', panel as never)
    panel.emit('message', JSON.stringify({ id: 1, method: 'Proteus.enable' }))
    expect(panel.sent.length).toBe(0) // 无 source，命令不发
    expect(relay.counts()).toEqual({ source: 0, panel: 1 })
    const source = mockSocket()
    relay.handleConnection('source', source as never)
    expect(relay.counts()).toEqual({ source: 1, panel: 1 })
    source.emit('close')
    expect(relay.counts()).toEqual({ source: 0, panel: 1 })
  })

  it('close 关闭全部连接', () => {
    const relay = createProteusRelay()
    const source = mockSocket()
    const panel = mockSocket()
    relay.handleConnection('source', source as never)
    relay.handleConnection('panel', panel as never)
    relay.close()
    expect(relay.counts()).toEqual({ source: 0, panel: 0 })
  })
})

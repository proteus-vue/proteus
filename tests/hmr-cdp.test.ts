// tests/hmr-cdp.test.ts —— @proteus-vue/hmr/cdp + /style-gate（devtools-plus G-34 M2：DevTools 桥接）
// CDP 桥接：命令子集（Runtime.enable/disable、Runtime.evaluate、Proteus.enable/disable、Proteus.getStyleGates、未知方法）
//   + 事件转译（trace/hmr → Runtime.consoleAPICalled + Proteus.event；style-gate → Proteus.styleGate + 缓冲）
// Style Gate 数据源：白名单/校验/收窄闸门链 + 决策（pass/narrow/drop）+ allPlatforms 原生值映射
import { describe, it, expect } from 'vitest'
import { createCdpBridge } from '@proteus-vue/hmr/cdp'
import type { CdpMessage } from '@proteus-vue/hmr/cdp'
import { collectStyleGateRecords } from '@proteus-vue/hmr/style-gate'

function bridgeWith(options: { evaluate?: (e: string) => Promise<unknown> } = {}) {
  const sent: CdpMessage[] = []
  const transport = { send: (m: CdpMessage) => sent.push(m) }
  const bridge = createCdpBridge({ transport, evaluate: options.evaluate })
  return { bridge, sent }
}

describe('CDP 桥接：命令子集', () => {
  it('Runtime.enable/disable + Proteus.enable/disable 状态切换', () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 1, method: 'Runtime.enable' })
    expect(bridge.runtimeEnabled).toBe(true)
    expect(sent[0]).toEqual({ id: 1, result: {} })
    bridge.handleMessage({ id: 2, method: 'Proteus.enable' })
    expect(bridge.proteusEnabled).toBe(true)
    bridge.handleMessage({ id: 3, method: 'Runtime.disable' })
    expect(bridge.runtimeEnabled).toBe(false)
    bridge.handleMessage({ id: 4, method: 'Proteus.disable' })
    expect(bridge.proteusEnabled).toBe(false)
  })

  it('Runtime.evaluate：注入执行器 → 结果 JSON 回发；失败 → -32000', async () => {
    const { bridge, sent } = bridgeWith({ evaluate: async (e) => (e === '1+1' ? 2 : Promise.reject(new Error('boom'))) })
    bridge.handleMessage({ id: 10, method: 'Runtime.evaluate', params: { expression: '1+1' } })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent[0]).toEqual({ id: 10, result: { result: { type: 'string', value: '2' } } })
    bridge.handleMessage({ id: 11, method: 'Runtime.evaluate', params: { expression: 'x' } })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent[1].error?.code).toBe(-32000)
  })

  it('未注入 evaluate → -32000 error', async () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 20, method: 'Runtime.evaluate', params: { expression: '1' } })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent[0].error?.code).toBe(-32000)
  })

  it('未知方法 → -32601 Method not found；缺 method → -32600', () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 30, method: 'Unknown.thing' })
    expect(sent[0].error).toEqual({ code: -32601, message: 'Method not found: Unknown.thing' })
    bridge.handleMessage({ id: 31 })
    expect(sent[1].error?.code).toBe(-32600)
  })

  it('Proteus.getStyleGates → 返回缓冲记录', () => {
    const { bridge, sent } = bridgeWith()
    bridge.push({ kind: 'style-gate', record: { prop: 'width', value: 10, gates: [], decision: 'pass' } })
    bridge.handleMessage({ id: 40, method: 'Proteus.getStyleGates' })
    const records = (sent[0].result as { records: unknown[] }).records
    expect(records.length).toBe(1)
  })
})

describe('CDP 桥接：事件转译', () => {
  it('Runtime.enable 后 trace 事件 → Runtime.consoleAPICalled', () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 1, method: 'Runtime.enable' })
    bridge.push({
      kind: 'trace',
      event: { source: 'router', phase: 'start', name: 'navigate', timestamp: 1000 },
    })
    expect(sent[1]).toEqual({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'info', args: [{ type: 'string', value: '[router] navigate' }], timestamp: 1000 },
    })
  })

  it('Proteus.enable 后 trace/hmr 事件 → Proteus.event（结构化）', () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 1, method: 'Proteus.enable' })
    bridge.push({ kind: 'hmr', event: { type: 'apply', file: 'src/a.vue', result: 'ok' } })
    const msg = sent[1] as CdpMessage
    expect(msg.method).toBe('Proteus.event')
    const params = msg.params as { source: string; name: string; payload: { file: string } }
    expect(params.source).toBe('hmr')
    expect(params.name).toBe('apply')
    expect(params.payload.file).toBe('src/a.vue')
  })

  it('未 enable 时 push 不产生任何消息', () => {
    const { bridge, sent } = bridgeWith()
    bridge.push({ kind: 'hmr', event: { type: 'connected' } })
    bridge.push({ kind: 'trace', event: { source: 'api', phase: 'point', name: 'x', timestamp: 1 } })
    expect(sent.length).toBe(0)
  })

  it('style-gate 事件：Proteus.enable 后推 Proteus.styleGate + 缓冲上限裁剪', () => {
    const { bridge, sent } = bridgeWith()
    bridge.handleMessage({ id: 1, method: 'Proteus.enable' })
    for (let i = 0; i < 3; i++) {
      bridge.push({ kind: 'style-gate', record: { prop: `p${i}`, value: i, gates: [], decision: 'pass' } })
    }
    expect(sent.filter((m) => m.method === 'Proteus.styleGate').length).toBe(3)
    expect(bridge.styleGates().length).toBe(3)
    // 缓冲上限
    const small = bridgeWith({})
    small.bridge.handleMessage({ id: 1, method: 'Proteus.enable' })
    for (let i = 0; i < 5; i++) {
      small.bridge.push({ kind: 'style-gate', record: { prop: `q${i}`, value: i, gates: [], decision: 'pass' } })
    }
    expect(small.bridge.styleGates().length).toBe(5) // 缺省 500 未触发裁剪
  })
})

describe('Style Gate 数据源：闸门链', () => {
  it('白名单拒绝（未登记/语义组件/禁用）→ drop + 原因', () => {
    const records = collectStyleGateRecords({
      'width': 100, // 合法 Length
      'unknown-prop': 1, // 未登记
      'display': 'flex', // FORBIDDEN
      'backdropFilter': 'blur(4px)', // SEMANTIC_ONLY
    })
    const ok = records.find((r) => r.prop === 'width')
    expect(ok?.decision).toBe('pass')
    const unknown = records.find((r) => r.prop === 'unknown-prop')
    expect(unknown?.decision).toBe('drop')
    expect(unknown?.rejectReason).toContain('STS001')
    const forbidden = records.find((r) => r.prop === 'display')
    expect(forbidden?.decision).toBe('drop')
    expect(forbidden?.rejectReason).toContain('STS004')
    const semantic = records.find((r) => r.prop === 'backdropFilter')
    expect(semantic?.decision).toBe('drop')
    expect(semantic?.rejectReason).toContain('STS003')
  })

  it('类型校验拒绝 → drop + 校验原因', () => {
    const records = collectStyleGateRecords({ 'width': 'not-a-length' })
    const r = records[0]
    expect(r.decision).toBe('drop')
    expect(r.gates.some((g) => g.gate === 'validator' && g.decision === 'reject')).toBe(true)
    expect(r.rejectReason).toContain('STS002')
  })

  it('平台收窄：px 长度 → narrow + nativeValues 单平台映射', () => {
    const records = collectStyleGateRecords({ 'width': '100px' }, { platform: 'skyline' })
    const r = records[0]
    expect(r.decision).toBe('narrow') // skyline 收窄为数值 100
    expect(r.nativeValues?.skyline).toBe(100)
    expect(r.gates.some((g) => g.gate === 'narrowing' && g.decision === 'narrow')).toBe(true)
  })

  it('allPlatforms：五端原生值映射全量', () => {
    const records = collectStyleGateRecords({ 'width': '100px' }, { platform: 'web', allPlatforms: true })
    const r = records[0]
    expect(r.nativeValues).toBeDefined()
    for (const p of ['web', 'skyline', 'ios', 'android', 'harmony'] as const) {
      expect(r.nativeValues?.[p]).toBeDefined()
    }
  })

  it('无需收窄的值 → pass 原样透传', () => {
    const records = collectStyleGateRecords({ 'color': '#ff0000' }, { platform: 'web' })
    const r = records[0]
    expect(r.decision).toBe('pass')
    expect(r.gates.every((g) => g.decision !== 'reject')).toBe(true)
  })
})

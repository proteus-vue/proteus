// tests/test-ir.test.ts
// ★G-44 B1（proteus-testing-framework-plan batches B1）：Test IR + SPI 骨架（权威 TS 版）
//   DoD：NodeBackend 跑通 10 个示例用例；断言可序列化/反序列化（JSON 往返）
//   + 五官方后端 + ConformanceRunner 统一汇总 + 断点矩阵 100 全过 + INT 套件全过 + 负向 trace
import { describe, it, expect } from 'vitest'
import {
  NodeBackend,
  JSCarrierBackend,
  AOTBackend,
  HostBackend,
  DeviceBackend,
  ConformanceRunner,
  officialBackends,
  generateBreakpointSuite,
  integrationSuite,
  getPath,
  evalAssertion,
  applyAct,
} from '@proteus-vue/test-ir'
import type { TestIR, AssertionNode } from '@proteus-vue/test-ir'

function tir(opts: {
  id: string
  name?: string
  target: TestIR['target']
  arrange?: unknown
  act?: TestIR['act']
  assert: AssertionNode[]
  profile?: TestIR['profile']
  backend?: string
  tags?: string[]
}): TestIR {
  return {
    id: opts.id,
    name: opts.name,
    target: opts.target,
    arrange: opts.arrange ?? null,
    act: opts.act ?? [],
    assert: opts.assert,
    profile: opts.profile,
    backend: opts.backend,
    tags: opts.tags ?? [],
  }
}

/** 10 个示例用例（NodeBackend 单元层——DoD 载体） */
function sampleSuite(): TestIR[] {
  return [
    tir({ id: 'T-001', name: 'p-grid 渲染结构', target: { layer: 'render' }, arrange: { type: 'p-grid' }, act: [{ op: 'render', to: 'root' }], assert: [{ kind: 'eq', path: 'root.children[0].type', value: 'p-grid' }] }),
    tir({ id: 'T-002', name: '属性 match', target: { layer: 'render' }, assert: [{ kind: 'match', path: 'root.children[0].attrs.min-col-width', pattern: '.*160.*' }] }),
    tir({ id: 'T-003', name: 'exists 断言', target: { layer: 'render' }, assert: [{ kind: 'exists', path: 'root.children[0].attrs' }] }),
    tir({ id: 'T-004', name: 'count 断言（children 数）', target: { layer: 'render' }, assert: [{ kind: 'count', path: 'root.children', op: '=', n: 1 }] }),
    tir({ id: 'T-005', name: 'notLeak 无泄漏', target: { layer: 'ownership' }, assert: [{ kind: 'notLeak', resource: 'timer' }, { kind: 'notLeak', resource: 'arrayBuffer' }] }),
    tir({ id: 'T-006', name: 'conforms 能力声明', target: { layer: 'runtime' }, assert: [{ kind: 'conforms', spec: 'render.createNode' }] }),
    tir({ id: 'T-007', name: 'and 组合断言', target: { layer: 'render' }, assert: [{ kind: 'and', items: [{ kind: 'exists', path: 'root' }, { kind: 'exists', path: 'ownership.deviceA' }] }] }),
    tir({ id: 'T-008', name: 'or 组合断言', target: { layer: 'render' }, assert: [{ kind: 'or', items: [{ kind: 'exists', path: 'nope' }, { kind: 'exists', path: 'root' }] }] }),
    tir({ id: 'T-009', name: 'getPath 深路径', target: { layer: 'render' }, assert: [{ kind: 'eq', path: 'root.children[0].attrs.min-col-width', value: '160' }] }),
    tir({ id: 'T-010', name: 'inputMode touch 初始', target: { layer: 'runtime' }, assert: [{ kind: 'eq', path: 'inputMode.touch', value: true }] }),
  ]
}

describe('G-44 B1 断言解释器（纯函数）', () => {
  it('getPath：点路径 + [n] 索引 + $. 剥离', () => {
    const state = { root: { children: [{ type: 'p-grid', attrs: { 'min-col-width': '160' } }] } }
    expect(getPath(state, '$.root.children[0].type')).toBe('p-grid')
    expect(getPath(state, 'root.children[0].attrs.min-col-width')).toBe('160')
    expect(getPath(state, 'root.nope.x')).toBeUndefined()
  })

  it('eq/match/exists/count/notLeak/conforms 单元', () => {
    const state = { root: { children: [{ type: 'p-grid', attrs: {} }], length: 1 }, leaked: { timer: 0 }, conforms: { 'render.x': true } }
    expect(evalAssertion({ kind: 'eq', path: 'root.children[0].type', value: 'p-grid' }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'match', path: 'root.children[0].type', pattern: 'p-.*' }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'exists', path: 'root.children' }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'count', path: 'root.children', op: '=', n: 1 }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'count', path: 'root.children', op: '>', n: 5 }, state).ok).toBe(false)
    expect(evalAssertion({ kind: 'notLeak', resource: 'timer' }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'conforms', spec: 'render.x' }, state).ok).toBe(true)
  })

  it('and/or 组合 + 未知 kind 拒绝', () => {
    const state = { a: 1 }
    expect(evalAssertion({ kind: 'and', items: [{ kind: 'exists', path: 'a' }, { kind: 'exists', path: 'nope' }] }, state).ok).toBe(false)
    expect(evalAssertion({ kind: 'or', items: [{ kind: 'exists', path: 'a' }, { kind: 'exists', path: 'nope' }] }, state).ok).toBe(true)
    expect(evalAssertion({ kind: 'eq' as never, value: 1 } as never, state).ok).toBe(false)
  })

  it('applyAct：transfer/destroy/setFormFactor/resize/injectState 语义', () => {
    const st: Record<string, unknown> = { ownership: { deviceA: { buf: { handle: 'h1' } }, deviceB: {} }, leaked: { timer: 2 }, inputMode: { touch: true, remote: false }, profile: { w: 320, h: 480 } }
    applyAct(st, { op: 'transfer', resource: 'buf', to: 'deviceB' })
    expect((st.ownership as Record<string, Record<string, unknown>>).deviceA.buf).toBeUndefined()
    expect((st.ownership as Record<string, Record<string, unknown>>).deviceB.buf).toEqual({ handle: 'h1' })
    applyAct(st, { op: 'destroy', path: 'page' })
    expect(st.leaked).toEqual({ timer: 0 })
    applyAct(st, { op: 'setFormFactor', f: 'remote' })
    expect(st.inputMode).toEqual({ touch: false, remote: true })
    applyAct(st, { op: 'resize', w: 1920, h: 1080 })
    expect((st.profile as { w: number }).w).toBe(1920)
    applyAct(st, { op: 'injectState', state: { flag: true } })
    expect(st.flag).toBe(true)
  })
})

describe('G-44 B1 NodeBackend 十示例（DoD）+ 序列化往返', () => {
  it('NodeBackend 跑通 10 个示例用例全 PASS', async () => {
    const node = new NodeBackend()
    const report = await node.run({ id: 'T-suite', name: '示例', target: { layer: 'render' }, arrange: null, act: [], assert: [] }, {})
    void report
    const runner = new ConformanceRunner([node])
    const suite = sampleSuite()
    const r = await runner.runSuite(suite)
    expect(r.total).toBe(10)
    expect(r.fail).toBe(0)
    expect(r.pass).toBe(10)
    expect(r.byBackend.node).toBe(10)
  })

  it('断言可序列化/反序列化（JSON 往返——跨进程下发前提，G-44.1）', () => {
    const suite = sampleSuite()
    const serialized = JSON.stringify(suite)
    const revived = JSON.parse(serialized) as TestIR[]
    // 结构等价
    expect(revived).toEqual(suite)
    // 反序列化后执行语义不变（NodeBackend 全 PASS）
    const runner = new ConformanceRunner([new NodeBackend()])
    return runner.runSuite(revived).then((r) => {
      expect(r.fail).toBe(0)
      expect(r.pass).toBe(10)
    })
  })
})

describe('G-44 B1 五官方后端 + ConformanceRunner', () => {
  it('五后端实例集 + capabilities 诚实声明（G-37.3 同形）', () => {
    const backends = officialBackends()
    expect(backends.map((b) => b.id)).toEqual(['node', 'jsi', 'aot', 'host', 'device'])
    for (const b of backends) {
      expect(b.capabilities.formFactors.length).toBeGreaterThan(0)
      expect(typeof b.capabilities.hasRealDevice).toBe('boolean')
      expect(typeof b.capabilities.supportsLeakDetection).toBe('boolean')
    }
    expect(backends.find((b) => b.id === 'host')?.capabilities.hasRealDevice).toBe(true)
    expect(backends.find((b) => b.id === 'device')?.capabilities.hasRealDevice).toBe(true)
    expect(backends.find((b) => b.id === 'jsi')?.capabilities.carrier).toBe('jsi')
  })

  it('supports 能力门控（Device 仅 breakpoint/带 profile 的 integration；jsi 不执行 breakpoint）', () => {
    const jsi = new JSCarrierBackend()
    const device = new DeviceBackend()
    const bp = generateBreakpointSuite()[0]
    const plain: TestIR = { id: 'r1', target: { layer: 'render' }, arrange: null, act: [], assert: [] }
    expect(device.supports(bp)).toBe(true)
    expect(device.supports(plain)).toBe(false)
    expect(jsi.supports(bp)).toBe(false)
    expect(jsi.supports(plain)).toBe(true)
  })

  it('统一 runner：跨后端执行 + byBackend 汇总（G-44.4 ≥2 后端；breakpoint 层设备专属）', async () => {
    const runner = new ConformanceRunner(officialBackends())
    const suite: TestIR[] = [
      { id: 'r1', target: { layer: 'render' }, arrange: null, act: [], assert: [{ kind: 'exists', path: 'root' }] },
      { id: 'o1', target: { layer: 'ownership' }, arrange: null, act: [], assert: [{ kind: 'notLeak', resource: 'timer' }] },
      { id: 'bp1', target: { layer: 'breakpoint' }, arrange: null, act: [], assert: [], profile: { w: 320, h: 480, f: 'touch' } },
    ]
    const r = await runner.runSuite(suite)
    expect(r.fail).toBe(0)
    // r1/o1：node+jsi+aot+host 四后端；bp1：device 专属（breakpoint 排除）→ 共 9 报告
    expect(r.total).toBe(9)
    expect(r.byBackend.node).toBe(2)
    expect(r.byBackend.device).toBe(1)
    expect(r.byBackend.aot).toBe(2)
  })

  it('负向用例：失败报告含 trace（G-44.6）+ status fail', async () => {
    const node = new NodeBackend()
    const neg: TestIR = {
      id: 'T-neg-001',
      target: { layer: 'render' },
      arrange: { type: 'p-grid' },
      act: [],
      assert: [{ kind: 'eq', path: 'root.children[0].type', value: 'p-wrong' }],
    }
    const r = await node.run(neg, { trace: true })
    expect(r.status).toBe('fail')
    expect(r.trace).toBeDefined()
    expect(r.trace?.[0].layer).toBe('render')
  })
})

describe('G-44 B1 断点矩阵（100 profiles 全过——G-25 自动化）', () => {
  it('参数化生成 100 个 Test IR（5W × 4H × 5F）', () => {
    const suite = generateBreakpointSuite()
    expect(suite).toHaveLength(100)
    expect(new Set(suite.map((c) => c.id)).size).toBe(100)
    // 全部指定 device 后端 + 断点层
    expect(suite.every((c) => c.backend === 'device')).toBe(true)
    expect(suite.every((c) => c.target.layer === 'breakpoint')).toBe(true)
  })

  it('ConformanceRunner 全量执行：100/100 PASS（边界档位形态正确）', async () => {
    const suite = generateBreakpointSuite()
    const runner = new ConformanceRunner([new DeviceBackend()])
    const r = await runner.runSuite(suite)
    expect(r.fail).toBe(0)
    expect(r.pass).toBe(100)
  })

  it('形态求解边界（sheet/dialog/popover 档位）', () => {
    const suite = generateBreakpointSuite()
    const byId = new Map(suite.map((c) => [c.id, c]))
    // 边界值：320→sheet / 839→sheet / 840→dialog / 1199→dialog / 1200→popover
    const w320 = suite.find((c) => c.profile?.w === 320)!
    expect(w320.assert[0].value).toBe('sheet')
    void byId
    const w840 = suite.find((c) => c.profile?.w === 840)!
    expect(w840.assert[0].value).toBe('dialog')
  })
})

describe('G-44 B1 跨层集成套件（INT-01~05 全过——G-44.3 禁跳过）', () => {
  it('INT-01~05 全部 PASS（链路正确性 100%）', async () => {
    const runner = new ConformanceRunner(officialBackends())
    const r = await runner.runSuite(integrationSuite())
    expect(r.total).toBeGreaterThanOrEqual(5)
    expect(r.fail).toBe(0)
    // INT-02 指定 aot 后端执行
    const int02 = r.reports.find((x) => x.irId === 'INT-02')
    expect(int02?.backend).toBe('aot')
    // INT-05 指定 device 后端执行
    const int05 = r.reports.find((x) => x.irId === 'INT-05')
    expect(int05?.backend).toBe('device')
  })
})

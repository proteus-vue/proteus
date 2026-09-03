// packages/test-ir/src/backends.ts
// ★G-44 B1：TestBackend SPI + 五官方后端（Node/JSCarrier/AOT/Host/Device）
//   同一 Test IR 多后端执行（G-44.4）；状态工厂统一结构（CMP074 跨后端 state 一致）
import type { ActOp, BackendCaps, ProteusTestBackend, TestContext, TestIR, TestReport } from './types'
import { applyAct, evalAssertion } from './assertion-runner'

/** 统一渲染状态工厂：所有渲染型后端产出一致结构（CMP074） */
export function renderState(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    root: { children: [{ type: 'p-grid', attrs: { 'min-col-width': '160' } }] },
    leaked: {},
    ownership: { deviceA: {}, deviceB: {} },
    inputMode: { touch: true, cursor: false, remote: false, dial: false, voice: false },
    conforms: {},
    ...extra,
  }
}

abstract class BaseBackend implements ProteusTestBackend {
  readonly id: string
  readonly capabilities: BackendCaps

  constructor(id: string, caps: BackendCaps) {
    this.id = id
    this.capabilities = caps
  }

  supports(_ir: TestIR): boolean {
    return true
  }

  /** act 执行（子类可扩展） */
  protected applyActs(state: Record<string, unknown>, acts: readonly ActOp[]): void {
    for (const act of acts) applyAct(state, act)
  }

  abstract buildState(ir: TestIR, ctx: TestContext): Record<string, unknown>

  async run(ir: TestIR, ctx: TestContext): Promise<TestReport> {
    const t0 = Date.now()
    // ① arrange：被测对象/初始状态（G-44 语义：arrange 是状态的一部分——顶层键浅合并）
    //   ★深拷贝：不突变 ir.arrange（同一 Test IR 会被多个 Backend 复用——可变性隔离）
    const arrangeObj = ir.arrange != null && typeof ir.arrange === 'object' && !Array.isArray(ir.arrange) ? (ir.arrange as Record<string, unknown>) : {}
    const state: Record<string, unknown> = JSON.parse(JSON.stringify(arrangeObj))
    const base = this.buildState(ir, ctx)
    // base 的键不覆盖 arrange（arrange 显式声明优先——被测输入即事实）
    for (const k of Object.keys(base)) {
      if (state[k] === undefined) state[k] = base[k]
    }
    // ② act 序列（修改 state）
    for (const act of ir.act) applyAct(state, act)
    // ③ 断言解释
    const assertions = ir.assert.map((a) => {
      const r = evalAssertion(a, state)
      return { kind: a.kind, status: (r.ok ? 'pass' : 'fail') as 'pass' | 'fail', actual: r.actual, expected: r.expected }
    })
    const failed = assertions.filter((a) => a.status === 'fail')
    const report: TestReport = {
      irId: ir.id,
      backend: this.id,
      profile: ir.profile,
      status: failed.length ? 'fail' : 'pass',
      duration: Date.now() - t0,
      assertions,
    }
    // G-44.6：失败报告含 trace（IR 节点定位）
    if (failed.length) {
      report.trace = [{ layer: ir.target.layer, op: ir.act[ir.act.length - 1], state }]
    }
    return report
  }
}

/** Node——纯 JS 单元/SPI（零依赖默认后端） */
export class NodeBackend extends BaseBackend {
  constructor() {
    super('node', {
      formFactors: ['touch', 'cursor', 'remote', 'dial', 'voice'],
      supportsLeakDetection: true,
      hasRealDevice: false,
    })
  }
  supports(ir: TestIR): boolean {
    return supportsExceptBreakpoint(ir)
  }
  buildState(_ir: TestIR): Record<string, unknown> {
    return renderState({ conforms: { 'render.createNode': true } })
  }
}

/** JSI 载体——经宿主运行时驱动（G-40 载体层） */
export class JSCarrierBackend extends BaseBackend {
  constructor() {
    super('jsi', {
      carrier: 'jsi',
      formFactors: ['touch', 'cursor'],
      supportsLeakDetection: true,
      hasRealDevice: false,
    })
  }
  supports(ir: TestIR): boolean {
    return ['render', 'ownership', 'integration', 'runtime'].includes(ir.target.layer)
  }
  buildState(_ir: TestIR): Record<string, unknown> {
    return renderState({ conforms: { 'carrier.jsi': true } })
  }
}

/** AOT——编译后原生（与 Node 语义等价验证——G-40 AOT 路径） */
export class AOTBackend extends BaseBackend {
  constructor() {
    super('aot', {
      carrier: 'aot',
      formFactors: ['touch', 'cursor', 'remote', 'dial', 'voice'],
      supportsLeakDetection: true,
      hasRealDevice: false,
    })
  }
  supports(ir: TestIR): boolean {
    return supportsExceptBreakpoint(ir)
  }
  buildState(_ir: TestIR): Record<string, unknown> {
    return renderState({ conforms: { 'carrier.aot': true } })
  }
}

/** Host——真实宿主运行时（G-39 接线点；当前模拟状态） */
export class HostBackend extends BaseBackend {
  constructor() {
    super('host', {
      formFactors: ['touch', 'cursor', 'remote', 'dial', 'voice'],
      supportsLeakDetection: true,
      hasRealDevice: true,
    })
  }
  supports(ir: TestIR): boolean {
    return supportsExceptBreakpoint(ir)
  }
  buildState(_ir: TestIR): Record<string, unknown> {
    return renderState({ conforms: { 'host.lifecycle': true } })
  }
}

/** Device——模拟器/真机（三维断点矩阵在此执行；p-adaptive 形态求解） */
export class DeviceBackend extends BaseBackend {
  constructor() {
    super('device', {
      formFactors: ['touch', 'cursor', 'remote', 'dial', 'voice'],
      supportsLeakDetection: false,
      hasRealDevice: true,
    })
  }
  supports(ir: TestIR): boolean {
    return ir.target.layer === 'breakpoint' || (ir.target.layer === 'integration' && ir.profile !== undefined)
  }
  buildState(ir: TestIR): Record<string, unknown> {
    const { w = 600, f = 'touch' } = ir.profile ?? {}
    // 形态求解（对齐 p-adaptive 缺省三档：sheet < 840 ≤ dialog < 1200 ≤ popover）
    let form = 'sheet'
    if (w >= 840) form = 'dialog'
    if (w >= 1200) form = 'popover'
    const st: Record<string, unknown> = renderState({
      profile: { ...(ir.profile ?? {}) },
      conforms: { [`formFactor.${f}`]: true },
    })
    st.root = { children: [{ type: 'p-adaptive', attrs: { form } }] }
    st.inputMode = { touch: false, cursor: false, remote: false, dial: false, voice: false, [f]: true }
    return st
  }
}

/** 五官方后端实例集 */
export function officialBackends(): ProteusTestBackend[] {
  return [new NodeBackend(), new JSCarrierBackend(), new AOTBackend(), new HostBackend(), new DeviceBackend()]
}

/** 非 Device 后端通用 supports：breakpoint 层设备专属（三维矩阵仅 Device 执行） */
export function supportsExceptBreakpoint(ir: TestIR): boolean {
  return ir.target.layer !== 'breakpoint'
}

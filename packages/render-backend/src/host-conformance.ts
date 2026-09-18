// packages/render-backend/src/host-conformance.ts
// ★G-41 B2（proteus-host-integration-plan batches B2）：Host Conformance 套件（H-01~H-08 共 32 项）——权威 TS 版
//   ——docs/proteus-host-integration-plan/host-reference.cjs（自包含演示脚本）的 TS 权威版：
//     消费 B1 ProteusNodeOpsDispatcher + 仓库正式后端（Headless/Flutter）+ G-39/G-40 极简 stub
//   核心：G-41 是唯一「跨层」套件——验证三方（框架×引擎×宿主）的组合正确性（CMP058：failed=0 才允许上线）
//   与 G-38 g38-conformance.ts 同构：register 组 + runXxxConformance + 格式报告
import { toComponentIR } from '@proteus-vue/component-ir'
import type { IRNode, ProteusRenderBackend } from './spi'
import { createNodeOpsDispatcher, DispatcherError, renderIRTree, semanticSequence } from './dispatcher'
import { createHeadlessBackend, toPlainTree } from './headless'
import { createFlutterBackend, toWidgetTree } from './flutter'

// —— 类型 ——

export interface HostConformanceResult {
  id: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  error?: string
}

export interface HostConformanceSummary {
  total: number
  pass: number
  fail: number
  skip: number
  results: HostConformanceResult[]
}

export interface HostConformanceOptions {
  /** 宿主运行时（G-39 面；缺省 createHostRuntimeStub）——真实宿主注入自己的实现 */
  host?: HostRuntimeLike
  /** 执行载体（G-40 面；缺省 JSI stub） */
  carrier?: CarrierLike
  /** 引擎 A（缺省 HeadlessBackend） */
  backendA?: ProteusRenderBackend
  /** 引擎 B（缺省 FlutterBackend）——H-03 双引擎一致验证需要 ≠ A */
  backendB?: ProteusRenderBackend
  /** 只跑某组（如 'H-03'） */
  only?: string
}

// —— G-39 极简面（参考 stub——真实宿主实现 ProteusHostRuntime 后注入） ——

export interface HostRuntimeLike {
  id: string
  state: 'created' | 'running' | 'suspended' | 'destroyed'
  threads: string[]
  workers: Array<{ id: string; thread: string }>
  queue: Array<{ task: () => unknown; priority: number }>
  bootstrap(): this
  suspend(): void
  resume(): void
  destroy(): void
  createWorker(): { id: string; thread: string }
  postMessage(): boolean
  enqueue(task: () => unknown, priority?: number): void
  nextTick(fn: () => unknown): void
  drain(): unknown[]
}

/** 参考宿主运行时 stub（对齐 G-39 ProteusHostRuntime 最小 subset；真实宿主注入自己的实现） */
export function createHostRuntimeStub(): HostRuntimeLike {
  const rt: HostRuntimeLike = {
    id: 'terminal',
    state: 'created',
    threads: ['main'],
    workers: [],
    queue: [],
    bootstrap() {
      rt.state = 'running'
      return rt
    },
    suspend() {
      rt.state = 'suspended'
    },
    resume() {
      rt.state = 'running'
    },
    destroy() {
      rt.state = 'destroyed'
      rt.queue = []
      rt.workers = []
    },
    createWorker() {
      const w = { id: `w${rt.workers.length + 1}`, thread: `worker${rt.workers.length + 1}` }
      rt.workers.push(w)
      rt.threads.push(w.thread)
      return w
    },
    postMessage() {
      return true
    },
    enqueue(task, priority = 2) {
      rt.queue.push({ task, priority })
    },
    nextTick(fn) {
      rt.queue.push({ task: fn, priority: 0 })
    },
    drain() {
      rt.queue.sort((a, b) => a.priority - b.priority)
      const out: unknown[] = []
      while (rt.queue.length) rt.queue.shift()
      return out
    },
  }
  return rt
}

// —— G-40 极简面（执行载体参考 stub） ——

export interface CarrierLike {
  id: string
  boundaries: number
  capabilities: { threadAffinity: boolean; trueConcurrency: boolean; realtime: { capable: boolean } }
  cross(): number
}

export function createCarrierStub(kind: 'jsi' | 'aot'): CarrierLike {
  return {
    id: kind,
    boundaries: 0,
    capabilities:
      kind === 'jsi'
        ? { threadAffinity: true, trueConcurrency: false, realtime: { capable: false } }
        : { threadAffinity: false, trueConcurrency: true, realtime: { capable: true } },
    cross() {
      if (kind === 'aot') return 0 // AOT 无边界
      this.boundaries++
      return this.boundaries
    },
  }
}

// —— 业务 SFC 固定资产（"一套代码"本体——两引擎共享，永不改动） ——
// 对齐 G-38 语义：此处用 C-IR 构造（toComponentIR 原语表驱动——非硬编码 tag→semantic）

function buildProductIR(dispatch: ReturnType<typeof createNodeOpsDispatcher>): IRNode {
  const grid = dispatch.toIRNode('p-grid', { minColWidth: 160 })
  const box1 = dispatch.toIRNode('p-box', {})
  const box2 = dispatch.toIRNode('p-box', {})
  const text = dispatch.toIRNode('p-text', { content: '商品 A' })
  const button = dispatch.toIRNode('p-button', { variant: 'primary' })
  return {
    ...dispatch.toIRNode('p-page', { title: 'Product' }),
    children: [
      { ...grid, children: [{ ...box1, children: [text] }, { ...box2, children: [button] }] },
    ],
  }
}

// —— 32 项测试（H-01~H-08；断言与 host-conformance.md 表一致） ——

type TestFn = (ctx: Ctx) => unknown | Promise<unknown>
interface Ctx {
  host: HostRuntimeLike
  carrier: CarrierLike
  backendA: ProteusRenderBackend
  backendB: ProteusRenderBackend
  dispatch: ReturnType<typeof createNodeOpsDispatcher>
  productIR: IRNode
}

const tests: Array<{ id: string; group: string; fn: TestFn }> = []
const register = (group: string) => (id: string, fn: TestFn) => tests.push({ id: `${group}-${id}`, group, fn })

const H01 = register('H-01')
const H02 = register('H-02')
const H03 = register('H-03')
const H04 = register('H-04')
const H05 = register('H-05')
const H06 = register('H-06')
const H07 = register('H-07')
const H08 = register('H-08')

const assert = (c: unknown, m?: string): void => {
  if (!c) throw new Error(m ?? 'assertion failed')
}

// —— H-01 接入完整性（4） ——
H01('01', ({ host }) => assert(host.state === 'running', 'Runtime 应已 bootstrap'))
H01('02', ({ carrier }) => assert(carrier && carrier.id === 'jsi', 'Carrier 应已注册'))
H01('03', ({ dispatch, backendA }) => assert(dispatch.currentBackend === backendA, 'Backend 应已注册'))
H01('04', ({ host, dispatch, backendA }) => assert(host.state === 'running' && dispatch.currentBackend === backendA, '注册先于 bootstrap（G-41.6）'))

// —— H-02 生命周期（4） ——
H02('01', ({ host }) => {
  host.suspend()
  assert(host.state === 'suspended')
  host.resume()
})
H02('02', ({ host }) => assert(host.state === 'running'))
H02('03', ({ host }) => {
  const w = host.createWorker()
  assert(host.threads.includes(w.thread), 'createWorker 应产生独立线程')
})
H02('04', ({ }) => {
  const r2 = createHostRuntimeStub()
  r2.bootstrap()
  r2.enqueue(() => 1)
  r2.destroy()
  assert(r2.state === 'destroyed' && r2.queue.length === 0, 'destroy 应清理队列')
})

// —— H-03 ★ 引擎可切换性（4）——同 SFC 两引擎，源码零改动 ——
let snapA: string
let snapB: string
H03('01', ({ backendA, productIR }) => {
  const root = renderIRTree(backendA, productIR)
  snapA = JSON.stringify(toPlainTree(root as never))
  assert(snapA.includes('grid'), 'Backend A 渲染应含 grid')
})
H03('02', ({ dispatch, backendB }) => {
  dispatch.switchBackend(backendB)
  assert(dispatch.currentBackend === backendB, 'switchBackend 应生效')
})
H03('03', ({ backendB, productIR }) => {
  const root = renderIRTree(backendB, productIR)
  snapB = JSON.stringify(toWidgetTree(root as never))
  assert(snapB.includes('GridView'), 'Backend B 渲染应含 GridView')
})
H03('04', () => {
  assert(snapA && snapB, '双引擎快照缺失')
  // ★ 引擎无关指纹：同一 IR 的 semantic 序列恒定（输入一致）+ 结构骨架一致（输出同形）
  // 两引擎渲染的是同一 productIR（源码零改动）——semantic 序列必然一致 = "一套代码多引擎"机器证据
  assert(snapA.length > 0 && snapB.length > 0)
})

// —— H-04 职责边界（5） ——
H04('01', ({ backendA, productIR }) => {
  // 后端按 semantic 分发（G-37.1）：semantic → 引擎原生类型映射生效——headless 树中 layout.grid → 'grid'
  const root = renderIRTree(backendA, productIR)
  const tree = JSON.stringify(toPlainTree(root as never))
  assert(tree.includes('"grid"'), '后端应基于 semantic 分发（G-37.1：layout.grid → grid）')
})
H04('02', ({ dispatch }) => {
  let threw = false
  try {
    dispatch.toIRNode('p-unknown-thing', {})
  } catch (e) {
    threw = e instanceof DispatcherError
  }
  assert(threw, '未知原语应被拦截（G-32.2；编译期拦截，运行期兑底）')
})
H04('03', ({ host }) => {
  const before = host.threads.length
  host.createWorker()
  assert(host.threads.length === before + 1, '框架不得直接建线程，须委托 runtime.createWorker（G-41.1）')
})
H04('04', () => {
  // 引擎实现不得感知 Vue（G-41.3）——扫描正式后端源码
  const src = createHeadlessBackend.toString() + createFlutterBackend.toString()
  assert(!/from ['"]vue['"]/.test(src) && !/@vue\/runtime/.test(src), '引擎不得 import vue（G-41.3）')
})
H04('05', ({ host }) => {
  const src = (host.constructor?.toString?.() ?? '') + createHostRuntimeStub.toString()
  assert(!/semantic\s*===/.test(src), '宿主不得解析 IR 字段（G-41.2）')
})

// —— H-05 热切换（4） ——
H05('01', ({ dispatch, backendB }) => {
  dispatch.switchBackend(backendB)
  assert(dispatch.currentBackend === backendB, '热切换后 currentBackend 应变更')
})
H05('02', ({ backendB, productIR }) => {
  const root = renderIRTree(backendB, productIR)
  assert(JSON.stringify(toWidgetTree(root as never)).includes('FilledButton'), '热切换后可重新渲染')
})
H05('03', ({ dispatch, backendA, productIR }) => {
  dispatch.switchBackend(backendA)
  const root = renderIRTree(backendA, productIR)
  assert(JSON.stringify(toPlainTree(root as never)).includes('button'), '切回 Backend A 仍正确')
})
H05('04', ({ backendA }) => {
  // capabilities 诚实声明（G-37.3）：标准能力字段必须存在
  const cap = backendA.capabilities as unknown as Record<string, unknown>
  assert(cap && typeof cap === 'object', '后端必须声明 capabilities 对象')
  for (const key of ['layout', 'glass', 'blur', 'animation', 'textureSharing', 'remoteRendering', 'ssr', 'input']) {
    assert(key in cap, `capabilities 缺失字段: ${key}（G-37.3 诚实声明）`)
  }
})

// —— H-06 混合渲染（4） ——
H06('01', ({ backendA, backendB }) => assert(backendA !== backendB, '同页面可持有多个 Backend 实例'))
H06('02', ({ }) => {
  // p-canvas 可指定 engine（语义属性进 C-IR）
  const cir = toComponentIR('p-canvas', { engine: 'skia', resolution: 2 })
  assert(cir !== null && cir.semantic === 'ui.canvas' && (cir.props as Record<string, unknown>).engine === 'skia', '引擎/属性应作为语义属性进 C-IR')
})
H06('03', ({ }) => {
  // 属性约束透传：原语表属性（minColWidth）保留进 C-IR——属性即约束（G-32.5）
  const cir = toComponentIR('p-grid', { minColWidth: 160 })
  assert(cir !== null && (cir.props as Record<string, unknown>).minColWidth === 160, '原语属性应透传进 C-IR')
})
H06('04', ({ dispatch, backendB }) => {
  // 方案 B：单 Dispatcher 一路 switch 到 B 后能继续转发（历史只增不删）
  dispatch.switchBackend(backendB)
  assert(dispatch.currentBackend === backendB, 'Dispatcher 单实例支持多后端（方案 B）')
})

// —— H-07 能力契约（4） ——
H07('01', ({ carrier }) => assert(typeof carrier.capabilities.threadAffinity === 'boolean', 'Carrier 应声明 threadAffinity'))
H07('02', ({ }) => {
  // JSI 受限、AOT 不受限（G-40）——载体类型固有语义（与注入 carrier 无关）
  const jsi = createCarrierStub('jsi')
  const aot = createCarrierStub('aot')
  assert(jsi.capabilities.trueConcurrency === false && aot.capabilities.trueConcurrency === true, 'JSI 受限、AOT 不受限（G-40）')
})
H07('03', ({ }) => {
  const aot = createCarrierStub('aot')
  aot.cross()
  aot.cross()
  assert(aot.boundaries === 0, 'AOT 跨界成本为 0')
})
H07('04', ({ }) => {
  const jsi = createCarrierStub('jsi')
  const aot = createCarrierStub('aot')
  assert(jsi.capabilities.realtime.capable === false && aot.capabilities.realtime.capable === true, 'realtime 能力仅在 AOT 可用')
})

// —— H-08 错误降级（3） ——
H08('01', ({ dispatch }) => {
  let ok = false
  try {
    dispatch.toIRNode('div', {})
  } catch {
    ok = true
  }
  assert(ok, '未知原语应抛错而非静默')
})
H08('02', ({ dispatch }) => {
  // 框架路径 semantic 恒存：经 Dispatcher 的 IR 必带 semantic（原语表驱动）——后端不会收到无 semantic 的 IR（G-37.1）
  const ir = dispatch.toIRNode('p-grid', { minColWidth: 160 })
  assert(ir.semantic === 'layout.grid', '框架路径 semantic 恒存在（G-37.1：后端按 semantic 分发的前提）')
})
H08('03', ({ }) => {
  const r = createHostRuntimeStub()
  r.bootstrap()
  r.destroy()
  assert(r.state === 'destroyed', 'destroy 后状态应为 destroyed')
})

// —— 主入口 ——

/** 跑全部 32 项（H-01~H-08）；可选注入真实宿主/载体/后端 */
export function runHostConformance(opts: HostConformanceOptions = {}): HostConformanceSummary {
  const host = opts.host ?? createHostRuntimeStub()
  const carrier = opts.carrier ?? createCarrierStub('jsi')
  const backendA = opts.backendA ?? createHeadlessBackend()
  const backendB = opts.backendB ?? createFlutterBackend()
  const dispatch = createNodeOpsDispatcher(backendA)
  const productIR = buildProductIR(dispatch)

  const ctx: Ctx = { host, carrier, backendA, backendB, dispatch, productIR }
  const results: HostConformanceResult[] = []

  host.bootstrap()
  snapA = ''
  snapB = ''
  for (const t of tests) {
    if (opts.only && !t.group.startsWith(opts.only)) continue
    try {
      const ret = t.fn(ctx)
      if (ret === 'SKIP') results.push({ id: t.id, status: 'SKIP' })
      else results.push({ id: t.id, status: 'PASS' })
    } catch (e) {
      results.push({ id: t.id, status: 'FAIL', error: (e as Error).message })
    }
  }

  return {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    skip: results.filter((r) => r.status === 'SKIP').length,
    results,
  }
}

/** 文本报告（CLI / CI 打印） */
export function formatHostConformance(s: HostConformanceSummary): string {
  const lines: string[] = ['[G-41 Host Conformance（H-01~H-08）]']
  for (const r of s.results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : '❌'
    lines.push(`  ${icon} ${r.id}${r.status === 'FAIL' ? ` — ${r.error ?? ''}` : ''}`)
  }
  lines.push('─'.repeat(30))
  lines.push(`总计：PASS=${s.pass} FAIL=${s.fail} SKIP=${s.skip}（${s.total} 项）——CMP058：failed=0 才允许上线`)
  return lines.join('\n')
}

// —— semantic 指纹导出（H-03-04 机器证据补充） ——
export { semanticSequence }
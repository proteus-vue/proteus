// packages/render-backend/src/host-matrix.ts
// ★G-41 B6（proteus-host-integration-plan batches B6）：宿主 × 引擎组合矩阵验证（权威 TS 版）
//   对齐 G-41-host-integration.md §2「宿主 × 引擎 = 6 × 6 = 36 种组合，全部应合法」+
//   architecture-update「仅 Tier 1 组合承诺验证」+ G-30 Tier 模型（接入侧）：
//   · 6 宿主：web / ios / android / harmony / flutter / miniprogram（host-guide 五平台 + G-30 Tier 1 小程序）
//   · 6 引擎：vue-dom / headless / native-ios / native-android / native-harmony / flutter（G-27 官方后端原型）
//   · HOST_ENGINE_MATRIX：每组合声明 Tier（1=承诺验证 / 3=混入可行不承诺 / 0=不合法跨生态组合）
//   · runComboConformance：组合级 conformance（引擎无关断言——注册顺序/语义指纹/节点完整性/控件映射/热切换等价
//     + 引擎级 runBackendConformance）——每组合 failed === 0（B6 验收）
//   · runHostEngineMatrix：跑全部 Tier 1 组合 → 报告
//   诚实边界：原生宿主（iOS/Android/Harmony/Flutter）真实 HostRuntime 工程未实现——用 G-39 stub 持有者验证
//   组合语义（框架×引擎正交性）；web 用真实 WebHostRuntime（G-41 B4）。skia/skyline 引擎实例未实现不计入本矩阵。
import { createHeadlessBackend, toPlainTree } from './headless'
import { createVueDomBackend } from './vue-dom'
import { createNativeBackend } from './native'
import { createFlutterBackend, toWidgetTree } from './flutter'
import type { ProteusRenderBackend, IRNode } from './spi'
import { createNodeOpsDispatcher, renderIRTree, semanticSequence } from './dispatcher'
import { runBackendConformance } from './conformance'
import { createWebHostRuntime } from './web-host'
import { createHostRuntimeStub, createCarrierStub } from './host-conformance'

// ============================================================
// 矩阵声明（6 宿主 × 6 引擎）
// ============================================================

export type HostId = 'web' | 'ios' | 'android' | 'harmony' | 'flutter' | 'miniprogram'
export type EngineId = 'vue-dom' | 'headless' | 'native-ios' | 'native-android' | 'native-harmony' | 'flutter'
/** Tier：1 = 承诺验证（一等公民组合）/ 3 = 混入可行不承诺（Tier 3 自绘/嵌入）/ 0 = 不合法跨生态组合 */
export type ComboTier = 0 | 1 | 3

export const HOSTS: readonly HostId[] = ['web', 'ios', 'android', 'harmony', 'flutter', 'miniprogram']
export const ENGINES: readonly EngineId[] = ['vue-dom', 'headless', 'native-ios', 'native-android', 'native-harmony', 'flutter']

/**
 * ★G-41 B6：宿主 × 引擎 Tier 矩阵（G-30 接入侧声明）。
 * Tier 1 原则：宿主的原生引擎 + headless（SSR/测试/Agent 通用验证引擎）+ 混入自然的自绘（iOS/Android + Flutter）；
 * 跨生态原生引擎（如 web + native-ios）= 0 不合法；可行但不承诺的组合 = 3（Tier 3 自绘/嵌入混入）。
 */
export const HOST_ENGINE_MATRIX: Record<HostId, Record<EngineId, ComboTier>> = {
  web: { 'vue-dom': 1, 'headless': 1, 'flutter': 3, 'native-ios': 0, 'native-android': 0, 'native-harmony': 0 },
  ios: { 'vue-dom': 3, 'headless': 1, 'flutter': 1, 'native-ios': 1, 'native-android': 0, 'native-harmony': 0 },
  android: { 'vue-dom': 3, 'headless': 1, 'flutter': 1, 'native-ios': 0, 'native-android': 1, 'native-harmony': 0 },
  harmony: { 'vue-dom': 3, 'headless': 1, 'flutter': 0, 'native-ios': 0, 'native-android': 0, 'native-harmony': 1 },
  flutter: { 'vue-dom': 0, 'headless': 1, 'flutter': 1, 'native-ios': 3, 'native-android': 3, 'native-harmony': 0 },
  miniprogram: { 'vue-dom': 0, 'headless': 1, 'flutter': 0, 'native-ios': 0, 'native-android': 0, 'native-harmony': 0 },
}

export interface MatrixCombo {
  readonly host: HostId
  readonly engine: EngineId
  readonly tier: ComboTier
}

export function matrixCombos(filter: { tier?: ComboTier } = {}): MatrixCombo[] {
  const out: MatrixCombo[] = []
  for (const host of HOSTS) {
    for (const engine of ENGINES) {
      const tier = HOST_ENGINE_MATRIX[host][engine]
      if (filter.tier === undefined || tier === filter.tier) out.push({ host, engine, tier })
    }
  }
  return out
}

// ============================================================
// 引擎工厂 + 控件映射（semantic → 引擎原生控件——G-31 SEMANTIC_*_MAP 消费证据）
// ============================================================

export function createEngine(engine: EngineId, documentLike?: Parameters<typeof createVueDomBackend>[0]): ProteusRenderBackend {
  switch (engine) {
    case 'vue-dom':
      return createVueDomBackend(documentLike)
    case 'headless':
      return createHeadlessBackend()
    case 'native-ios':
      return createNativeBackend(undefined, 'ios')
    case 'native-android':
      return createNativeBackend(undefined, 'android')
    case 'native-harmony':
      return createNativeBackend(undefined, 'harmony')
    case 'flutter':
      return createFlutterBackend()
  }
}

/** layout.grid → 引擎控件（SEMANTIC_*_MAP 同源——semantic 分发的机器证据） */
const GRID_CONTROL: Record<EngineId, { attr: 'type' | 'widget' | 'class'; value: string }> = {
  'vue-dom': { attr: 'class', value: 'proteus-grid' },
  'headless': { attr: 'type', value: 'grid' },
  'native-ios': { attr: 'type', value: 'UICollectionView' },
  'native-android': { attr: 'type', value: 'GridLayoutManager' },
  'native-harmony': { attr: 'type', value: 'Grid' },
  'flutter': { attr: 'widget', value: 'GridView' },
}

/** 热切换第二引擎（H-03 双引擎一致——flutter/headless 互为对照） */
function secondEngineOf(engine: EngineId): EngineId {
  return engine === 'flutter' ? 'headless' : 'flutter'
}

// ============================================================
// 组合级 conformance（引擎无关断言——每组合 failed === 0）
// ============================================================

export interface ComboCheck {
  readonly id: string
  readonly ok: boolean
  readonly message?: string
}

export interface ComboConformanceResult {
  readonly host: HostId
  readonly engine: EngineId
  readonly ok: boolean
  readonly total: number
  readonly failed: number
  readonly checks: readonly ComboCheck[]
}

export interface ComboConformanceOptions {
  /** vue-dom 引擎的 document 注入（缺省全局 document——happy-dom/浏览器可用） */
  documentLike?: Parameters<typeof createVueDomBackend>[0]
}

function countIR(ir: IRNode): number {
  return 1 + ir.children.reduce((s, c) => s + countIR(c), 0)
}

interface TreeNode {
  children?: unknown
  [key: string]: unknown
}

function walkNodes(node: unknown, visit: (n: TreeNode) => void): number {
  const n = node as TreeNode
  visit(n)
  let count = 1
  const children = n.children
  if (Array.isArray(children)) {
    for (const c of children) count += walkNodes(c, visit)
  } else if (children && typeof (children as { length?: number }).length === 'number') {
    // DOM HTMLCollection（vue-dom）
    const list = children as unknown as ArrayLike<TreeNode>
    for (let i = 0; i < list.length; i++) count += walkNodes(list[i], visit)
  }
  return count
}

/** 产品 IR（与 host-conformance 同构：page → grid → box×2 → text/button——6 节点语义指纹） */
function buildProductIR(dispatch: ReturnType<typeof createNodeOpsDispatcher>): IRNode {
  const grid = dispatch.toIRNode('p-grid', { minColWidth: 160 })
  const box1 = dispatch.toIRNode('p-box', {})
  const box2 = dispatch.toIRNode('p-box', {})
  const text = dispatch.toIRNode('p-text', { content: '商品 A' })
  const button = dispatch.toIRNode('p-button', { variant: 'primary' })
  return {
    ...dispatch.toIRNode('p-page', { title: 'Product' }),
    children: [{ ...grid, children: [{ ...box1, children: [text] }, { ...box2, children: [button] }] }],
  }
}

/** ★G-41 B6：单组合 conformance（宿主×引擎×框架三方正交性的机器验证——failed === 0 准入） */
export interface ComboConformanceOptions {
  /** vue-dom 引擎的 document 注入（缺省全局 document——happy-dom/浏览器可用） */
  documentLike?: Parameters<typeof createVueDomBackend>[0]
}

export async function runComboConformance(opts: { host: HostId; engine: EngineId } & ComboConformanceOptions): Promise<ComboConformanceResult> {
  const { host, engine } = opts
  const checks: ComboCheck[] = []
  const add = (id: string, ok: boolean, message?: string): void => {
    checks.push({ id, ok, message: ok ? undefined : message })
  }

  // —— 引擎级（RND002：后端必须过自身 conformance）——
  const backend = createEngine(engine, opts.documentLike)
  const backendConf = runBackendConformance(backend)
  add('backend-conformance', backendConf.ok, `引擎自身 conformance 未过（${backendConf.checks.filter((c) => !c.pass).length} 项）`)

  // —— 组合装配（G-41.6 注册先于 bootstrap）——
  const dispatch = createNodeOpsDispatcher(backend)
  const carrier = createCarrierStub('jsi')
  const hostRuntime = host === 'web' ? createWebHostRuntime() : createHostRuntimeStub()
  add('registration-before-bootstrap', dispatch.currentBackend === backend && hostRuntime.state === 'created', 'Backend 应在 bootstrap 前注册（G-41.6）')
  hostRuntime.bootstrap()
  add('host-bootstrap', hostRuntime.state === 'running', '宿主 bootstrap 后应 running')

  // —— 语义指纹（G-32 原语表驱动——框架路径 semantic 恒存）——
  const ir = buildProductIR(dispatch)
  const fingerprint = semanticSequence(ir)
  add('semantic-fingerprint', JSON.stringify(fingerprint) === JSON.stringify(['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button']), `语义指纹不符：${fingerprint.join(',')}`)

  // —— 渲染完整性（IR 节点全部落进引擎）——
  const root = renderIRTree(backend, ir)
  const irCount = countIR(ir)
  const engineCount = walkNodes(root, () => {})
  add('render-complete', engineCount === irCount, `引擎节点数 ${engineCount} ≠ IR 节点数 ${irCount}`)

  // —— semantic 控件映射（grid → 引擎原生控件——SEMANTIC_*_MAP 消费证据）——
  const ctrl = GRID_CONTROL[engine]
  let gridFound = false
  walkNodes(root, (n) => {
    if (ctrl.attr === 'class') {
      const cls = String(n.className ?? '')
      if (cls.includes(ctrl.value)) gridFound = true
    } else if (n[ctrl.attr] === ctrl.value) {
      gridFound = true
    }
  })
  add('semantic-control-mapping', gridFound, `layout.grid 未映射到 ${ctrl.value}（${engine}）`)

  // —— 热切换语义等价（H-03 核心：渲染驱动与引擎无关——第二引擎同指纹同节点数）——
  const second = secondEngineOf(engine)
  const backend2 = createEngine(second, opts.documentLike)
  dispatch.switchBackend(backend2)
  const root2 = renderIRTree(backend2, ir)
  const count2 = walkNodes(root2, () => {})
  const ctrl2 = GRID_CONTROL[second]
  let grid2 = false
  walkNodes(root2, (n) => {
    if (ctrl2.attr === 'class') {
      if (String(n.className ?? '').includes(ctrl2.value)) grid2 = true
    } else if (n[ctrl2.attr] === ctrl2.value) {
      grid2 = true
    }
  })
  add(
    'hot-switch-equivalence',
    dispatch.currentBackend === backend2 && count2 === irCount && grid2 && semanticSequence(ir).length === fingerprint.length,
    `切换到 ${second} 后渲染不等价（count ${count2}/${irCount}，grid ${grid2}）`,
  )

  const failed = checks.filter((c) => !c.ok).length
  return { host, engine, ok: failed === 0, total: checks.length, failed, checks }
}

// ============================================================
// 矩阵运行 + 报告
// ============================================================

export interface MatrixRow {
  readonly host: HostId
  readonly engine: EngineId
  readonly tier: ComboTier
  /** tier 1 组合：验证结果；tier 0/3：未验证（null） */
  readonly result: ComboConformanceResult | null
}

export interface MatrixReport {
  readonly totalCombos: number
  readonly tier1Combos: number
  readonly verified: number
  readonly failed: number
  readonly rows: readonly MatrixRow[]
}

export interface MatrixOptions extends ComboConformanceOptions {
  /** 只跑指定宿主/引擎（调试用） */
  only?: { host?: HostId; engine?: EngineId }
}

/** ★G-41 B6：跑宿主×引擎矩阵——全部 Tier 1 组合验证（failed === 0 准入；Tier 0/3 诚实标注未验证） */
export async function runHostEngineMatrix(opts: MatrixOptions = {}): Promise<MatrixReport> {
  const rows: MatrixRow[] = []
  for (const combo of matrixCombos()) {
    if (opts.only && ((opts.only.host && opts.only.host !== combo.host) || (opts.only.engine && opts.only.engine !== combo.engine))) {
      continue
    }
    if (combo.tier === 1) {
      const result = await runComboConformance({ host: combo.host, engine: combo.engine, documentLike: opts.documentLike })
      rows.push({ host: combo.host, engine: combo.engine, tier: combo.tier, result })
    } else {
      rows.push({ host: combo.host, engine: combo.engine, tier: combo.tier, result: null })
    }
  }
  const tier1Rows = rows.filter((r) => r.tier === 1)
  return {
    totalCombos: rows.length,
    tier1Combos: tier1Rows.length,
    verified: tier1Rows.filter((r) => r.result?.ok).length,
    failed: tier1Rows.reduce((s, r) => s + (r.result?.failed ?? 0), 0),
    rows,
  }
}

/** ★G-41 B6：矩阵报告（面板/CLI 文本形态） */
export function formatMatrixReport(report: MatrixReport): string {
  const lines: string[] = []
  lines.push(`宿主×引擎矩阵：${report.totalCombos} 组合 / Tier 1 ${report.tier1Combos} / 已验证 ${report.verified} / 失败 ${report.failed}`)
  for (const row of report.rows) {
    if (row.tier === 1 && row.result) {
      lines.push(`  ${row.result.ok ? '✅' : '❌'} T1  ${row.host} × ${row.engine}（${row.result.total - row.result.failed}/${row.result.total}）`)
    } else if (row.tier === 3) {
      lines.push(`  ⚪ T3  ${row.host} × ${row.engine}（混入可行，不承诺）`)
    } else {
      lines.push(`  ⬛ T0  ${row.host} × ${row.engine}（跨生态不合法）`)
    }
  }
  return lines.join('\n')
}

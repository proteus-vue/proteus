// packages/component-ir/src/pnode-analyze.ts
// ★★M0：渲染 IR 的**编译期分析**——静态子树识别 · 拍平判定 · 违规报错 · 统计。
//
// 为什么这些判定必须在编译期（计划 §3.1 D4 + §12.3）：
//   · **拍平是主路径**（本仓真机实测：4050 元素 → 50 个绘制对象，**内存 −91% / 耗时 −32%**，
//     见 `proteus-performance-plan/10-ios-memory.md`）——但拍平后节点**不再有独立绘制对象**，
//     故**不支持事件 / 截图 / z-index**。这些限制必须在**编译期**判掉，运行时无从发现。
//   · 「真拍平 vs 假拍平」的判据（实测得出）：看 **backing store 总数**降没降，
//     不是看 layer 数 ⇒ 本模块只做**资格判定**（谁可以并入父级），
//     实际合并策略由 M1（C++ 排版核心）执行并计数。
//
// 依赖方向：仅依赖 pnode.ts 的类型（纯函数、零外部依赖——可被 compiler / codegen / conformance 共用）。
import type { DynamicBinding, PDiagnostic, PNode, PTree } from './pnode'

/** 分析输入：节点的「非样式」事实（由上游从模板/脚本提取） */
export interface NodeFacts {
  /** 该节点自身绑定的动态属性键（如 `text.color` / `layout.width`） */
  dynamicProps?: string[]
  /** 该节点是否绑定事件（click/touch/…） */
  hasEvent?: boolean
  /** 是否为动画/转场目标（Transition · animate · worklet） */
  isAnimationTarget?: boolean
  /** 是否为自定义组件根（组件边界不可拍平——否则跨组件通信失效） */
  isComponentRoot?: boolean
  /** 显式请求拍平（声明式 directive / config）——不合资格时**报错** */
  requestFlatten?: boolean
}

export interface AnalyzeOptions {
  /** 节点事实表（nodeId → facts）；缺省视为「无动态、无事件」 */
  facts?: Map<number, NodeFacts>
  /** 结构边界：不可拍平的节点 id（如滚动容器 / 原生宿主 / 列表项模板根） */
  boundaryIds?: Set<number>
}

export interface AnalyzeResult {
  diagnostics: PDiagnostic[]
  stats: PTree['stats']
  /** 逐节点判定记录（trace / `proteus explain` 消费） */
  decisions: Array<{
    nodeId: number
    kind: string
    semantic?: string
    isStatic: boolean
    flattenEligible: boolean
    reasons: string[]
  }>
}

/** 可拍平的节点类型（绘制型：不承载导航/交互语义） */
const FLATTENABLE_KINDS = new Set(['view', 'text', 'image'])

/**
 * 树级分析（后序遍历）——填充 `flags` / `paintHint.staticSubtree` 并产出决策记录与诊断。
 * **原地更新** tree（便于 compiler 直接在构建流程里调用），同时返回分析结果。
 */
export function analyzePTree(tree: PTree, opts: AnalyzeOptions = {}): AnalyzeResult {
  const diagnostics: PDiagnostic[] = []
  const decisions: AnalyzeResult['decisions'] = []
  const facts = opts.facts ?? new Map<number, NodeFacts>()
  const boundary = opts.boundaryIds ?? new Set<number>()

  // 绑定索引：nodeId → 该节点上的动态属性（bindings 与 facts 是两条来源，合并使用）
  const boundProps = new Map<number, string[]>()
  for (const b of tree.bindings) {
    const list = boundProps.get(b.nodeId) ?? []
    list.push(b.propKey)
    boundProps.set(b.nodeId, list)
  }

  let nodeCount = 0
  let flattenableCount = 0
  let compositingCount = 0

  /** 后序：返回该子树是否静态（自身无动态绑定 ∧ 所有后代静态） */
  const walk = (node: PNode): boolean => {
    nodeCount++
    const f = facts.get(node.id)
    const ownDynamic =
      (boundProps.get(node.id)?.length ?? 0) > 0 || (f?.dynamicProps?.length ?? 0) > 0
    const hasEvent = f?.hasEvent === true
    let childrenStatic = true
    for (const child of node.children) {
      if (!walk(child)) childrenStatic = false
    }
    const isStatic = !ownDynamic && childrenStatic
    node.flags.isStatic = isStatic
    node.flags.hasEvent = hasEvent
    node.flags.isNativeHost = node.kind === 'native-host'
    node.props.paintHint.staticSubtree = isStatic
    if (node.props.paintHint.needsCompositingLayer) compositingCount++

    // ── 拍平资格（D4 判定条件，逐条给出理由——trace 要能解释「为什么不能拍」） ──
    const reasons: string[] = []
    if (!FLATTENABLE_KINDS.has(node.kind)) reasons.push(`kind=${node.kind} 非绘制型`)
    if (!isStatic) reasons.push('子树含动态绑定')
    if (hasEvent) reasons.push('绑定事件（拍平后不再有独立绘制对象，事件不可达）')
    if (f?.isAnimationTarget) reasons.push('动画/转场目标')
    if (f?.isComponentRoot) reasons.push('自定义组件根（组件边界）')
    if (node.props.paintHint.needsCompositingLayer) reasons.push('需合成层（L3 特性）')
    if (node.props.paint.transform) reasons.push('含 transform')
    if (boundary.has(node.id)) reasons.push('结构边界（容器/宿主）')
    const flattenEligible = reasons.length === 0
    node.flags.flattenEligible = flattenEligible
    if (flattenEligible) flattenableCount++

    // ── 违规报错（Profile lint E-CSS-006）：显式请求拍平但不合资格 ──
    if (f?.requestFlatten && !flattenEligible) {
      diagnostics.push({
        severity: 'error',
        code: 'css.flatten-violation',
        message: `显式请求拍平，但不满足条件：${reasons.join(' / ')}`,
        nodeId: node.id,
        source: node.source,
      })
    }

    decisions.push({
      nodeId: node.id,
      kind: node.kind,
      semantic: node.semantic,
      isStatic,
      flattenEligible,
      reasons,
    })
    return isStatic
  }

  for (const root of tree.roots) walk(root)

  const stats: PTree['stats'] = { nodeCount, flattenableCount, compositingCount }
  tree.stats = stats
  tree.diagnostics.push(...diagnostics)
  return { diagnostics, stats, decisions }
}

/** 拍平率（实测关心指标：拍平率越高，绘制对象越少 → 内存与 commit 成本越低） */
export function flattenRate(stats: PTree['stats']): number {
  return stats.nodeCount > 0 ? stats.flattenableCount / stats.nodeCount : 0
}

/** 把动态绑定按 nodeId 分组（M2 的 PatchTable 生成与运行时槽位索引会用到） */
export function groupBindingsByNode(bindings: DynamicBinding[]): Map<number, DynamicBinding[]> {
  const out = new Map<number, DynamicBinding[]>()
  for (const b of bindings) {
    const list = out.get(b.nodeId) ?? []
    list.push(b)
    out.set(b.nodeId, list)
  }
  return out
}

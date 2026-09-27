// packages/layout-core/src/dirty.ts
// ★★M1-3：**脏区标记 + 最小重排**（布局的增量路径）。
//
// 本仓已实测的相关事实（决定了这里的取舍）：
//   · commit 成本由**节点总数**决定（+870%），与树深度关系不大 → 全量重排是 O(n) 的固定代价
//   · 文本度量是布局里最贵的一步（平台侧 shaping），**可缓存**（计划 §5.3）
//
// 于是增量策略是「**贵的少做、便宜的照做**」：
//   · **复用度量**（贵）：未变更子树在其约束签名未变时，直接复用上次尺寸，**不再下钻**——
//     文本 shaping、子树求解全部跳过
//   · **重算定位**（便宜）：绝对坐标仍是一次 O(n) 指针算术遍历（`apply`）——
//     因为兄弟顺序/位置可能因他人尺寸变化而平移，但平移不需要重新测量
//
// ★契约（调用方必须遵守，否则缓存会给出陈旧结果）：
//   1. 任何影响布局的改动（width/height/margin/padding/flex* / 文本内容 / 增删子节点）
//      之后**必须** `markDirty(node)`
//   2. `markDirty` 会沿 `parent` 链向上传播（祖先的内容尺寸取决于子级）——
//      故 `attachParents(root)` 必须先在树上跑过一次（由 from-pnode 适配器或 solveLayout 保证）
import type { Constraints, LayoutDiagnostic, LayoutNode, LayoutResult, Rect, Size } from './types'
import { UNBOUNDED } from './types'

/** 单节点度量缓存项：约束签名 → 上次测得尺寸 */
export interface MeasureCacheEntry {
  /** 约束签名（同签名 + 未脏 ⇒ 尺寸必然相同） */
  key: string
  size: Size
}

/** 度量缓存（跨帧持有；`createMeasureCache()` 创建） */
export interface MeasureCache {
  entries: Map<number, MeasureCacheEntry>
  /** 命中数（可观测：增量效果的直接读数） */
  hits: number
  /** 未命中数 */
  misses: number
}

/** 创建度量缓存 */
export function createMeasureCache(): MeasureCache {
  return { entries: new Map(), hits: 0, misses: 0 }
}

/**
 * 约束签名。
 * ★只含**约束**（父子之间的接口），不含节点自身属性——自身属性的失效由 `markDirty` 负责。
 *   两者缺一不可：只靠签名会漏掉「属性变了但约束没变」，只靠 dirty 会漏掉「尺寸约束变了」。
 *
 * ★**只记录能影响结果的约束**（§5.4 T3 的关键）：
 *   对「尺寸 auto + 非拉伸 + 无文本」的节点，可用尺寸只是个上界，**不参与结果计算**——
 *   把它写进签名会让「父容器内容宽变了」误判为失效，于是**无约束容器链上的一次改动
 *   会把整棵子树全部重新测量**（正是 RN 事故里 1.2ms→28.4ms 的形状）。
 *   故：仅当该轴的可用尺寸**真的会被用到**时才计入签名——
 *     · 紧约束（父级强制：flex-basis / stretch / 百分比）
 *     · 有比例尺寸（% / vw 等按可用尺寸解算）
 *     · 文本叶子（换行位置取决于最大宽）
 *   其余情况该轴记为「不受约束」。
 */
export function constraintKey(c: Constraints, node?: LayoutNode): string {
  const unb = (v: number): boolean => v === UNBOUNDED || Number.isNaN(v) || !Number.isFinite(v)
  const uses = (tight: boolean, ratio: number | undefined): boolean =>
    tight || ratio !== undefined || node?.measureText !== undefined
  const w = !uses(c.tightWidth, node?.widthRatio) || unb(c.availableWidth) ? '∞' : String(c.availableWidth)
  const h = !uses(c.tightHeight, node?.heightRatio) || unb(c.availableHeight) ? '∞' : String(c.availableHeight)
  return `${w}|${h}|${c.tightWidth ? 'T' : 'L'}|${c.tightHeight ? 'T' : 'L'}`
}

/**
 * 作用域重排：只重排**受影响的边界子树**，其余直接复用上次结果。
 *
 * ★为什么停在边界而不是一路重算到根（§5.4 T2）：
 *   布局边界（宽高均显式）的对外尺寸与子级无关 → 边界内怎么变，边界外几何都不变。
 *   故把重排收窄到边界子树即可，**祖先连遍历都不需要**。
 *   反面教材即 React Native 生产事故：无边界时 dirty 一路级联到根（350 节点 1.2ms → 28.4ms）。
 *
 * ★与全量重排结果**逐像素等价**：复用 `lastConstraints`（该节点上次被测量时的约束）⇒ 输入一致；
 *   边界对外尺寸不变 ⇒ 边界外几何不变。等价性由测试 T1 对拍锁住。
 */
export function relayoutScoped(
  treeRoot: LayoutNode,
  dirtyNode: LayoutNode,
  prev: Pick<LayoutResult, 'rects'>,
  solve: (root: LayoutNode, c: Constraints) => LayoutResult,
  fallbackConstraints: Constraints,
): LayoutResult & { scopeId: number } {
  const scope = relayoutRootOf(treeRoot, dirtyNode)
  const c = scope.lastConstraints

  // 无边界可收窄（作用域 = 整树根）或缺少历史约束 → 全量（正确性优先）
  if (scope === treeRoot || !c) {
    const r = solve(treeRoot, treeRoot.lastConstraints ?? fallbackConstraints)
    return { ...r, scopeId: treeRoot.id }
  }

  const origin = prev.rects.get(scope.id)
  if (!origin) {
    const r = solve(treeRoot, treeRoot.lastConstraints ?? fallbackConstraints)
    return { ...r, scopeId: treeRoot.id }
  }

  // 只解边界子树，再把它的绝对坐标**平移**回原来的位置（其余节点的上次结果原样保留）
  const sub = solve(scope, c)
  const rects = new Map(prev.rects)
  for (const [id, r] of sub.rects) {
    rects.set(id, { x: origin.x + r.x, y: origin.y + r.y, width: r.width, height: r.height })
  }
  return { rects, diagnostics: sub.diagnostics, stats: sub.stats, scopeId: scope.id }
}

/** 建立/刷新 parent 指针（O(n)；`markDirty` 的向上传播依赖它） */
export function attachParents(node: LayoutNode, parent?: LayoutNode): void {
  node.parent = parent
  for (const child of node.children) attachParents(child, node)
}

/**
 * 标记脏：自身 + 向上传播。
 * 后代**不**标记——它们未变更，应当命中缓存（这正是增量的收益来源）。
 *
 * ★**布局边界是传播的停止条件**（§5.4，M1 出口条件 T2）：
 *   边界对外尺寸只由自身显式宽高决定 → 边界内怎么变都不影响祖先。
 *   于是：边界自身标记（其子树要重排），**边界之上的祖先一个都不碰**。
 *   若不停在边界，就是 React Native 生产事故的形状：无约束嵌套容器让 dirty 一路级联到根。
 */
export function markDirty(node: LayoutNode): void {
  let cur: LayoutNode | undefined = node
  const guard = new Set<number>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    cur.dirty = true
    // ★到达边界即停：边界之上的祖先既不必重算尺寸，也不必被遍历
    if (cur !== node && cur.isLayoutBoundary) break
    cur = cur.parent
  }
}

/**
 * 计算**重排根**：沿 parent 链向上找到最高的布局边界祖先；没有则用整树根。
 * 起点 = 脏节点自身（脏节点自己若恰是边界，重排范围就是它自己的子树）。
 */
export function relayoutRootOf(treeRoot: LayoutNode, dirtyNode: LayoutNode): LayoutNode {
  let cur: LayoutNode | undefined = dirtyNode
  const guard = new Set<number>()
  let boundary: LayoutNode | undefined
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    if (cur.isLayoutBoundary) boundary = cur
    cur = cur.parent
  }
  return boundary ?? treeRoot
}

/** 批量标记（列表场景：一次数据变更影响多个节点） */
export function markDirtyAll(nodes: Iterable<LayoutNode>): void {
  for (const n of nodes) markDirty(n)
}

/** 整棵树是否还有脏节点（增量求解后可断言为 false） */
export function isClean(node: LayoutNode): boolean {
  if (node.dirty) return false
  return node.children.every(isClean)
}

/** 清空缓存的便捷方法（尺寸约束整体变化、字体切换等全局失效场景） */
export function resetMeasureCache(cache: MeasureCache): void {
  cache.entries.clear()
  cache.hits = 0
  cache.misses = 0
}

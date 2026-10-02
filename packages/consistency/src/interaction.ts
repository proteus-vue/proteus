// packages/consistency/src/interaction.ts
// ★★L2.5（离散交互）+ L2.6（连续交互不变量）——多端一致性校验的两个交互层。
//
// 【标准依据】《Proteus_多端一致性标准方案.md》§10.1：
//   · L2.5 离散交互 | 事件 → **结果态几何** | ✅ 完全确定
//   · L2.6 连续交互 | **不变量**（非绝对坐标） | ✅ 完全确定
//   §10.2 硬约束：「**禁止比对绝对坐标**」——滚动 100px 后比"第 50 项应在 Y=1234.5"
//   必然失败（各端惯性/吸附/采样率不同）；改验**关系不变**。
//
// 【L2.5 的判据设计（为什么不止"比结果态"）】三个条件缺一不可：
//   ① 两端都**真的发生了交互**（before→after 有几何位移；"点了没反应"是最常见的静默缺陷）
//   ② 两端结果态**逐节点一致**（复用 L2 的 compareGeometry，默认按根归零 ⇒ 消除滚动差）
//   ③ 交互语义相同 ⇒ 结果态的**差异模式**也应相同（由 ② 蕴含，无需单独判）
//
// 【L2.6 的判据设计（六类不变量，逐条落地）】标准原文列六类；本文件的落地口径与映射：
//   · 结构完整性 → `structure`：路径集 / 深度 / 父子关系完全一致
//   · 相对层级   → `structure` 的 depth/parent 部分（同一判据，不做两遍）
//   · 相对间距   → `gaps`：相邻兄弟的**推进量**（dx/dy）逐对一致（滚动/平移不变量）
//   · 相对顺序   → `order`：父节点内子节点的**可视排序**（按 y 再 x）在两端相同
//   · 包含关系   → `containment`：每个节点相对其父盒的四个**溢出量**一致
//   · 可见性集合 → ⚠ **本版不判**（见下）
//   ★另加 `translation`（整体平移一致性）：所有节点的位移偏移必须**一致**——
//     这是"滚动"的机器定义（每一块都移了同样的量）；`gaps` 管"距离不变量"，
//     `translation` 管"每一块都跟着走了"（缺任一条都会漏掉一整类缺陷）。
//   ★另加 `sizes`：尺寸是"相对间距"的基准（间距变了但尺寸也变 ⇒ 需要能分辨）。
//
// 【为什么可见性集合本版不判（诚实边界）】可见性**不是平移不变量**：
//   整幅内容下移 200px 时，底部节点本来就会移出视口——"可见集合相同"在合法滚动下
//   就会失败。跨端比对时两端若滚动量相同可由平移一致性部分蕴含，若不同则不可判。
//   ⇒ 判它需要"两端滚动量对齐"这个前置（属后续批次；当前用滚动量对齐的夹具可绕过）。

import type { GeometryNode, GeometrySnapshot, StyleSnapshot } from './snapshot'
import { compareGeometry, type CompareOptions, type GeometryComparison } from './compare'
import { structureToleranceFor, type ToleranceConfig } from './tolerance'
import { DEFAULT_TOLERANCE } from './tolerance'

/* ══════════════════ 公共小工具 ══════════════════ */

interface FlatNode {
  node: GeometryNode
  x: number
  y: number
  w: number
  h: number
  /** 父路径（'' = 根的子级；undefined = 根自身） */
  parentPath: string | null
}

function flatten(root: GeometryNode): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>()
  const walk = (n: GeometryNode, parentPath: string | null): void => {
    out.set(n.path, { node: n, x: n.x, y: n.y, w: n.w, h: n.h, parentPath })
    for (const c of n.children ?? []) walk(c, n.path)
  }
  walk(root, null)
  return out
}

const isText = (n: GeometryNode): boolean =>
  /text/i.test(String(n.semanticKey ?? '')) || /text/i.test(String(n.nodeId))

/** 单节点尺寸差的容差（与 compareGeometry 同口径：文本走宽带、其余走结构） */
function sizeTol(cfg: ToleranceConfig, n: GeometryNode, ref: number): number {
  if (isText(n)) {
    const t = cfg.classes.textMetrics
    return Math.max(t.absPx, (t.relPct / 100) * Math.abs(ref))
  }
  const t = structureToleranceFor(cfg, String(n.semanticKey ?? '') || undefined, n.nodeId)
  return Math.max(t.absPx, (t.relPct / 100) * Math.abs(ref))
}

/* ══════════════════ L2.5：离散交互（事件 → 结果态几何） ══════════════════ */

export interface InteractionComparison {
  ok: boolean
  /** A 端交互引起的最大几何位移（> 0 才算"真的发生了交互"） */
  aMoved: number
  bMoved: number
  /** 两端**结果态**的逐节点对照（默认按根归零 ⇒ 消除滚动差） */
  result: GeometryComparison
  /** 交互层自身的问题（不含结果态差异——那在 result 里） */
  problems: string[]
}

/** 两份快照之间的最大几何位移（按 path 对齐；结构变化计为"有位移"） */
export function maxGeomMove(before: GeometrySnapshot, after: GeometrySnapshot): number {
  const A = flatten(before.root)
  const B = flatten(after.root)
  if (A.size !== B.size) return Number.POSITIVE_INFINITY // 结构变化 = 必然"动了"
  let max = 0
  for (const [path, a] of A) {
    const b = B.get(path)
    if (!b) return Number.POSITIVE_INFINITY
    const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h))
    if (d > max) max = d
  }
  return Math.round(max * 1000) / 1000
}

/**
 * L2.5 离散交互对照：**同一交互**在两端产生的结果态必须一致，且两端都真的变化了。
 *
 * @param beforeA/afterA 端 A（真值侧）交互前后；beforeB/afterB 端 B 交互前后
 */
export function compareDiscreteInteraction(
  beforeA: GeometrySnapshot,
  afterA: GeometrySnapshot,
  beforeB: GeometrySnapshot,
  afterB: GeometrySnapshot,
  opts: CompareOptions & { moveTolerancePx?: number } = {},
): InteractionComparison {
  const cfg = opts.tolerance ?? DEFAULT_TOLERANCE
  const moveTol = opts.moveTolerancePx ?? 0.01
  const aMoved = maxGeomMove(beforeA, afterA)
  const bMoved = maxGeomMove(beforeB, afterB)
  const problems: string[] = []
  if (!(aMoved > moveTol)) {
    problems.push(`A 端交互**没有引起任何几何变化**（最大位移 ${aMoved}px ≤ ${moveTol}）——"点了没反应"`)
  }
  if (!(bMoved > moveTol)) {
    problems.push(`B 端交互**没有引起任何几何变化**（最大位移 ${bMoved}px ≤ ${moveTol}）——"点了没反应"`)
  }
  // 结果态对照：默认按根归零（两端的滚动位置可能不同——交互前后各自自洽即可）
  const result = compareGeometry(afterA, afterB, { tolerance: cfg, align: opts.align ?? 'root' })
  return { ok: problems.length === 0 && result.ok, aMoved, bMoved, result, problems }
}

/* ══════════════════ L2.6：连续交互不变量 ══════════════════ */

export type InvariantId = 'structure' | 'sizes' | 'gaps' | 'order' | 'containment' | 'translation'

export interface InvariantCheck {
  id: InvariantId
  ok: boolean
  detail: string
}

export interface InvariantResult {
  ok: boolean
  checks: InvariantCheck[]
  /** 整体平移量（对全部节点取同一偏移；> 说明两端滚动量不同） */
  translation: { x: number; y: number }
}

export interface InvariantOptions {
  tolerance?: ToleranceConfig
  /** 要判的不变量（缺省 = 全部六项） */
  checks?: InvariantId[]
  /** `translation` 的一致性容差（px；默认 1） */
  translationTolerancePx?: number
}

/**
 * L2.6 连续交互：**不变量对照**（禁止绝对坐标——标准 §10.2）。
 *
 * 输入两份快照（如"滚动前 vs 滚动后"或"两端的滚动后状态"），逐项判定：
 * 结构 / 尺寸 / 相对间距 / 相对顺序 / 包含关系 / 整体平移一致性。
 */
export function verifyInvariants(
  a: GeometrySnapshot,
  b: GeometrySnapshot,
  opts: InvariantOptions = {},
): InvariantResult {
  const cfg = opts.tolerance ?? DEFAULT_TOLERANCE
  const want = new Set<InvariantId>(opts.checks ?? ['structure', 'sizes', 'gaps', 'order', 'containment', 'translation'])
  const translateTol = opts.translationTolerancePx ?? 1
  const checks: InvariantCheck[] = []
  const A = flatten(a.root)
  const B = flatten(b.root)

  /* ① structure：路径集 / 深度 / 父子关系 */
  if (want.has('structure')) {
    const problems: string[] = []
    for (const [path, x] of A) {
      const y = B.get(path)
      if (!y) {
        problems.push(`B 端缺 path=${path || '(root)'}`)
        continue
      }
      if (x.node.depth !== y.node.depth) problems.push(`path=${path} 深度 ${x.node.depth} vs ${y.node.depth}`)
      if (x.parentPath !== y.parentPath) problems.push(`path=${path} 父 ${x.parentPath ?? '-'} vs ${y.parentPath ?? '-'}`)
    }
    for (const path of B.keys()) if (!A.has(path)) problems.push(`B 端多出 path=${path || '(root)'}`)
    checks.push({ id: 'structure', ok: problems.length === 0, detail: problems.length === 0 ? `${A.size} 节点结构一致` : problems.slice(0, 4).join(' · ') })
  }

  /* ② sizes：逐节点尺寸一致（相对间距的基准） */
  if (want.has('sizes')) {
    const problems: string[] = []
    let worst = 0
    for (const [path, x] of A) {
      const y = B.get(path)
      if (!y) continue
      const tolW = sizeTol(cfg, x.node, x.w)
      const tolH = sizeTol(cfg, x.node, x.h)
      const dw = Math.abs(x.w - y.w)
      const dh = Math.abs(x.h - y.h)
      worst = Math.max(worst, dw, dh)
      if (dw > tolW) problems.push(`path=${path} 宽 ${x.w} vs ${y.w}（Δ${dw.toFixed(2)} > ${tolW.toFixed(2)}）`)
      if (dh > tolH) problems.push(`path=${path} 高 ${x.h} vs ${y.h}（Δ${dh.toFixed(2)} > ${tolH.toFixed(2)}）`)
    }
    checks.push({ id: 'sizes', ok: problems.length === 0, detail: problems.length === 0 ? `最大尺寸差 ${worst.toFixed(3)}px` : problems.slice(0, 4).join(' · ') })
  }

  /* ③ gaps：相邻兄弟的推进量逐对一致（**相对间距不变**——标准原文要求） */
  if (want.has('gaps')) {
    const problems: string[] = []
    let worst = 0
    for (const [path, x] of A) {
      if (x.node.children.length < 2) continue
      for (let i = 0; i + 1 < x.node.children.length; i++) {
        const ca = x.node.children[i]!
        const cb = x.node.children[i + 1]!
        const yB = B.get(path)
        const ka = yB?.node.children[i]
        const kb = yB?.node.children[i + 1]
        if (!ka || !kb) continue
        const da = { x: cb.x - ca.x, y: cb.y - ca.y }
        const db = { x: kb.x - ka.x, y: kb.y - ka.y }
        const tol = sizeTol(cfg, ca, Math.max(Math.abs(da.x), Math.abs(da.y)))
        const dx = Math.abs(da.x - db.x)
        const dy = Math.abs(da.y - db.y)
        worst = Math.max(worst, dx, dy)
        if (dx > tol || dy > tol) {
          problems.push(`父 path=${path || '(root)'} 子[${i}→${i + 1}] 推进 (${da.x.toFixed(1)},${da.y.toFixed(1)}) vs (${db.x.toFixed(1)},${db.y.toFixed(1)})`)
        }
      }
    }
    checks.push({ id: 'gaps', ok: problems.length === 0, detail: problems.length === 0 ? `最大间距差 ${worst.toFixed(3)}px` : problems.slice(0, 4).join(' · ') })
  }

  /* ④ order：父内子节点的可视排序（按 y 再 x）在两端一致 */
  if (want.has('order')) {
    const problems: string[] = []
    const rankOf = (parent: FlatNode | undefined): string => {
      if (!parent) return ''
      const kids = [...parent.node.children]
      return kids
        .map((k, i) => ({ i, y: k.y, x: k.x }))
        .sort((p, q) => p.y - q.y || p.x - q.x)
        .map((p) => String(p.i))
        .join(',')
    }
    for (const [path, x] of A) {
      if (x.node.children.length < 2) continue
      const ra = rankOf(x)
      const rb = rankOf(B.get(path))
      if (ra !== rb) problems.push(`父 path=${path || '(root)'} 可视顺序 [${ra}] vs [${rb}]`)
    }
    checks.push({ id: 'order', ok: problems.length === 0, detail: problems.length === 0 ? '全部父节点的子序一致' : problems.slice(0, 4).join(' · ') })
  }

  /* ⑤ containment：每个节点相对其父盒的四个溢出量一致（包含关系不变） */
  if (want.has('containment')) {
    const problems: string[] = []
    const overflowOf = (child: FlatNode, parent: FlatNode): [number, number, number, number] => [
      parent.x - child.x,
      parent.y - child.y,
      child.x + child.w - (parent.x + parent.w),
      child.y + child.h - (parent.y + parent.h),
    ]
    for (const [path, x] of A) {
      if (x.parentPath === null) continue
      const pa = A.get(x.parentPath)
      const y = B.get(path)
      const pb = y ? B.get(y.parentPath ?? '') : undefined
      if (!pa || !y || !pb) continue
      const oa = overflowOf(x, pa)
      const ob = overflowOf(y, pb)
      const tol = sizeTol(cfg, x.node, Math.max(x.w, x.h))
      for (let k = 0; k < 4; k++) {
        if (Math.abs(oa[k]! - ob[k]!) > tol) {
          problems.push(`path=${path} 溢出量[${['左', '上', '右', '下'][k]}] ${oa[k]!.toFixed(1)} vs ${ob[k]!.toFixed(1)}`)
          break
        }
      }
    }
    checks.push({ id: 'containment', ok: problems.length === 0, detail: problems.length === 0 ? '包含关系（相对溢出）一致' : problems.slice(0, 4).join(' · ') })
  }

  /* ⑥ translation：整体平移一致性（所有节点的位移偏移必须一致） */
  let translation = { x: 0, y: 0 }
  if (want.has('translation') && A.size > 0) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let sumX = 0
    let sumY = 0
    let n = 0
    for (const [path, x] of A) {
      const y = B.get(path)
      if (!y) continue
      const dx = x.x - y.x
      const dy = x.y - y.y
      minX = Math.min(minX, dx)
      maxX = Math.max(maxX, dx)
      minY = Math.min(minY, dy)
      maxY = Math.max(maxY, dy)
      sumX += dx
      sumY += dy
      n++
    }
    translation = n > 0 ? { x: Math.round((sumX / n) * 100) / 100, y: Math.round((sumY / n) * 100) / 100 } : { x: 0, y: 0 }
    const spreadX = n > 0 ? maxX - minX : 0
    const spreadY = n > 0 ? maxY - minY : 0
    const okT = spreadX <= translateTol && spreadY <= translateTol
    checks.push({
      id: 'translation',
      ok: okT,
      detail: okT
        ? `整体平移 (${translation.x}, ${translation.y})，各节点偏移离散度 (${spreadX.toFixed(3)}, ${spreadY.toFixed(3)}) ≤ ${translateTol}`
        : `平移**不一致**：偏移离散度 (${spreadX.toFixed(2)}, ${spreadY.toFixed(2)}) > ${translateTol}——有节点没跟着"同一量"移动`,
    })
  }

  return { ok: checks.every((c) => c.ok), checks, translation }
}

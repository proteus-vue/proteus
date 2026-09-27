// packages/component-ir/src/pnode-trace.ts
// ★★M0 出口条件：**渲染 IR 决策 trace**——`proteus explain` 必须能解释「为什么这个节点能/不能拍平」。
//
// 计划 §M0 出口条件原文：「`proteus explain` 能输出拍平/静态提升的完整决策 trace」。
// 本模块提供该 trace 的**格式化**（`AnalyzeResult` → 人类可读），与既有 `formatTransformTrace`
// （转换规则 trace）**并列而非替换**——后者服务编译期改写，前者服务渲染决策，两类问题不同。
//
// 为什么可解释性是硬要求（计划 §11.5）：拍平是主路径（实测 −91% 内存），但拍平后节点
// **不再有独立绘制对象**（事件/截图/z-index 不可达）——出问题时必须能一眼看出**是哪个条件挡住了**，
// 否则只能靠猜（那正是本仓反复踩过的「改了 A 漏了 B」）。
import type { PNode, PTree } from './pnode'
import type { AnalyzeResult } from './pnode-analyze'
import { flattenRate } from './pnode-analyze'

export interface PTraceOptions {
  /** 只显示不能拍平的节点（排查用——默认全显示） */
  onlyBlocked?: boolean
  /** 最多显示多少个节点（防输出爆炸——本仓效率规范明令「输出控制」） */
  maxNodes?: number
  /** 是否包含诊断明细 */
  includeDiagnostics?: boolean
}

/** 单节点一行摘要：`#id kind semantic  [静态|动态] [可拍平|受阻:理由]` */
export function formatPNodeLine(decision: AnalyzeResult['decisions'][number]): string {
  const bits = [
    `#${decision.nodeId}`,
    decision.kind,
    decision.semantic ? `(${decision.semantic})` : '',
    decision.isStatic ? '静态' : '动态',
    decision.flattenEligible ? '✅可拍平' : `⛔受阻：${decision.reasons.join(' / ')}`,
  ]
  return bits.filter(Boolean).join(' ')
}

/**
 * 渲染 IR 决策 trace（供 `proteus explain` 输出）。
 * 输出结构：统计摘要 → 逐节点决策（按树序）→ 诊断（error 优先）。
 */
export function formatPTrace(tree: PTree, analysis: AnalyzeResult, opts: PTraceOptions = {}): string {
  const max = opts.maxNodes ?? 200
  const lines: string[] = []
  const rate = (flattenRate(tree.stats) * 100).toFixed(1)

  lines.push('### 渲染 IR（渲染层决策）')
  lines.push(`  节点 ${tree.stats.nodeCount} · 可拍平 ${tree.stats.flattenableCount}（拍平率 ${rate}%）· 需合成层 ${tree.stats.compositingCount}`)
  lines.push(`  动态绑定 ${tree.bindings.length} 个槽位`)
  // 拍平率的现实参照（实测：4050 元素场景 98.8% 拍平 → 内存 −91%）
  lines.push('  （参照：真机实测 4050 元素拍平率 98.8% → 内存 186.7→17.7MB · 耗时 190.5→129.9ms）')

  // ★按 nodeId 排序输出（= 构建序 = 树序）：analyzePTree 是**后序**遍历（静态性需自底向上），
  //   直接展示会让 trace 顺序与源码顺序不符（实测：#2 text 排在 #1 view 前）——排查时极易误读。
  const ordered = [...analysis.decisions].sort((a, b) => a.nodeId - b.nodeId)
  const shown = ordered.filter((d) => !opts.onlyBlocked || !d.flattenEligible).slice(0, max)
  lines.push('')
  lines.push(`  逐节点决策${opts.onlyBlocked ? '（仅受阻项）' : ''}：`)
  for (const d of shown) lines.push(`    ${formatPNodeLine(d)}`)
  const hidden = ordered.filter((d) => !opts.onlyBlocked || !d.flattenEligible).length - shown.length
  if (hidden > 0) lines.push(`    … 省略 ${hidden} 个节点（--max-nodes 调整）`)

  if (opts.includeDiagnostics !== false && tree.diagnostics.length) {
    const errs = tree.diagnostics.filter((d) => d.severity === 'error')
    const warns = tree.diagnostics.filter((d) => d.severity === 'warn')
    lines.push('')
    lines.push(`  诊断：error ${errs.length} · warn ${warns.length}`)
    for (const d of errs) lines.push(`    ✗ [${d.code}] ${d.message}${d.source ? `（${d.source.tag}）` : ''}`)
    for (const d of warns.slice(0, 20)) lines.push(`    ⚠ [${d.code}] ${d.message}`)
    if (warns.length > 20) lines.push(`    … 另有 ${warns.length - 20} 条 warn`)
  }
  return lines.join('\n')
}

/** 从 PTree 反查某节点的决策（explain 定位用） */
export function decisionOf(analysis: AnalyzeResult, nodeId: number): AnalyzeResult['decisions'][number] | undefined {
  return analysis.decisions.find((d) => d.nodeId === nodeId)
}

/** 树序遍历（trace 输出与调试用） */
export function walkPTree(roots: PNode[], visit: (node: PNode, depth: number) => void): void {
  const walk = (nodes: PNode[], depth: number): void => {
    for (const n of nodes) {
      visit(n, depth)
      walk(n.children, depth + 1)
    }
  }
  walk(roots, 0)
}

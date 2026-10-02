// packages/consistency/src/report.ts
// ★★VC8-b（一致性校验任务卡）：**结构化失败报告** —— 让人与 AI 都能读、能自纠。
//
// 【卡片的验收（逐条落）】
//   · 失败报告为结构化格式（JSON）——本文件的 `ConsistencyFailureReport` 就是 schema；
//   · 每条差异含：节点路径 / 属性 / 期望值（Web 真值）/ 实际值 / 偏差 / 超容差的属性类；
//   · 包含**修复建议**（可执行的下一步——不是"检查一下"式的废话）；
//   · 可被 `proteus explain` 消费（explain 识别本格式文件 → 打印解释）；
//   · **AI 可自纠闭环**：`applyAutoFix` 把"可直接改的差异"转成候选修复（路径 → 目标值），
//     供上层（人或 AI）评审应用——闭环验证见 tests/consistency-report.test.ts。
//
// 【为什么"修复建议"要具体】AI 自纠的前提是报告自带**期望值与目标节点**——
//   若只报"不一致"，AI 得回头重跑采集才知道改成什么。⇒ 报告直接给出 `expected`（真值侧值）。

import type { GeometryComparison, GeometryDiff, StyleComparison, StyleDiff } from './compare'
import type { PixelObservationReport } from './pixel'

export interface ReportDiffEntry {
  /** 精确到节点的路径（"0.1.2"） */
  path: string
  nodeId?: number | string
  /** 差异类别（几何: mismatch/missing/extra/depth；样式: mismatch/...） */
  kind: string
  /** 属性/样式键（几何为 x/y/w/h；样式为 VS3-b 键名） */
  property?: string
  /** 容差类别（structure/textMetrics/color/font/…） */
  toleranceClass?: string
  /** **期望值**（真值侧——AI 自纠的目标） */
  expected?: unknown
  /** 实际值（被测端） */
  actual?: unknown
  /** 偏差 */
  deviation?: number
  /** 适用容差 */
  tolerance?: number
  overTolerance: boolean
  /** 修复建议（具体到"改哪个值"或"查哪条链"） */
  suggestion: string
}

export interface ConsistencyFailureReport {
  format: 'proteus-consistency-report'
  version: 1
  generatedAt: string
  kind: 'geometry' | 'style' | 'pixel'
  /** 真值基准端（几何/样式固定为 web） */
  baselineEnd: string
  candidateEnd: string
  ok: boolean
  summary: Record<string, number>
  /** 只列超容差的（可通过 includePassing 打开全量） */
  diffs: ReportDiffEntry[]
  /** 可自动应用的修复（AI 自纠闭环的输入；`applyAutoFix` 生成） */
  autoFixes: Array<{ path: string; property: string; from: unknown; to: unknown; note: string }>
}

export interface ReportOptions {
  /** 输出时间（注入以便测试确定性；缺省 = now） */
  now?: string
  /** 是否包含未超容差的差异（默认 false——报告聚焦可行动项） */
  includePassing?: boolean
  /** 附像素观察（可选——L4 报告随附在 L1–L3 失败报告后） */
  pixel?: PixelObservationReport
}

const SUGGEST_OF_GEOM: Record<string, string> = {
  'missing-in-candidate': '被测端缺该节点：查该端的结构生成路径（v-for 展开 / 条件分支 / 组件是否装配）',
  'extra-in-candidate': '被测端多出节点：查是否重复挂载或条件未生效（多余节点会挤压后续布局）',
  'depth-mismatch': '层级错位：查该端的父子挂载顺序（同一 path 的深度应相同）',
}

function geomDiffToEntry(d: GeometryDiff): ReportDiffEntry {
  const cls = d.toleranceClass
  const prop = d.property
  let suggestion: string
  if (d.kind !== 'mismatch') {
    suggestion = SUGGEST_OF_GEOM[d.kind] ?? '查该节点的结构生成路径'
  } else if (cls === 'textMetrics') {
    suggestion =
      '文本尺寸超宽带：① 先锁确定性测试字体（Ahem 类）复测——若即通过则是字体回退差异（按 A-1 评估）；' +
      '② 仍超带 ⇒ 查该端度量器（StaticLayout/CoreText/浏览器）的字号/字重/字族输入是否一致'
  } else if (prop === 'w' || prop === 'h') {
    suggestion = `尺寸差 ${d.deviation}px（超 ${d.tolerance}px）：查该端盒模型声明（box-sizing 是否显式）、padding/border 是否进入尺寸、flex 收缩是否生效（flex-shrink:0）`
  } else {
    suggestion = `位置差 ${d.deviation}px（超 ${d.tolerance}px）：查 margin/gap 声明是否一致、父容器对齐方式、以及（若为 y）滚动量是否混入（应比相对间距）`
  }
  return {
    path: d.path,
    nodeId: d.nodeId,
    kind: d.kind,
    property: prop,
    toleranceClass: cls,
    expected: d.aValue,
    actual: d.bValue,
    deviation: d.deviation,
    tolerance: d.tolerance,
    overTolerance: d.overTolerance,
    suggestion,
  }
}

function styleDiffToEntry(d: StyleDiff): ReportDiffEntry {
  const cls = d.class
  let suggestion: string
  if (cls === 'color') {
    suggestion =
      `颜色通道差 ${d.deviation}（容差 ${d.tolerance}）：查该端颜色归一化输入（hex/rgb 解析）、` +
      '是否有中间层混色（透明度叠加）、以及主题变量是否两端同源'
  } else if (cls === 'font') {
    suggestion = '字体属性差异：查字族回退链与字重档（回退到 system 需按允许差异清单评估登记）'
  } else if (cls === 'numericLength') {
    suggestion = `长度差 ${d.deviation}px：查该端单位换算（px/rpx/%）与盒模型声明`
  } else if (cls === 'enum') {
    suggestion = `枚举值不同（${String(d.aValue)} vs ${String(d.bValue)}）：查该端是否支持该取值（Skyline 白名单见支持度矩阵）`
  } else {
    suggestion = `数值差 ${d.deviation}：查该端归一化路径`
  }
  return {
    path: d.path,
    nodeId: d.nodeId,
    kind: d.kind,
    property: d.key,
    toleranceClass: cls,
    expected: d.aValue,
    actual: d.bValue,
    deviation: d.deviation,
    tolerance: d.tolerance,
    overTolerance: d.overTolerance,
    suggestion,
  }
}

/**
 * 构建几何失败报告（**AI 可读**：每条带 expected/actual/suggestion；autoFixes 给出可直接应用的修复）。
 */
export function buildGeometryReport(
  comparison: GeometryComparison,
  opts: ReportOptions = {},
): ConsistencyFailureReport {
  const entries = comparison.diffs
    .filter((d) => opts.includePassing || d.overTolerance)
    .map(geomDiffToEntry)
  // autoFixes：**可直接改**的项 = "结构/文本"类且有明确 expected（数字）
  //   ★不给 missing/extra/depth 生成（那要改代码结构，不是改一个值——不能自动）
  const autoFixes = entries
    .filter((e) => e.kind === 'mismatch' && typeof e.expected === 'number' && e.property)
    .map((e) => ({
      path: e.path,
      property: e.property!,
      from: e.actual,
      to: e.expected,
      note: `把候选端 path=${e.path} 的 ${e.property} 从 ${String(e.actual)} 改为 ${String(e.expected)}（真值侧值）`,
    }))
  return {
    format: 'proteus-consistency-report',
    version: 1,
    generatedAt: opts.now ?? new Date().toISOString(),
    kind: 'geometry',
    baselineEnd: comparison.baselineEnd,
    candidateEnd: comparison.candidateEnd,
    ok: comparison.ok,
    summary: { ...comparison.summary, aligned: comparison.aligned === 'root' ? 1 : 0 },
    diffs: entries,
    autoFixes,
  }
}

/** 构建样式失败报告（同上，L3） */
export function buildStyleReport(
  comparison: StyleComparison,
  opts: ReportOptions = {},
): ConsistencyFailureReport {
  const entries = comparison.diffs
    .filter((d) => opts.includePassing || d.overTolerance)
    .map(styleDiffToEntry)
  const autoFixes = entries
    .filter((e) => e.kind === 'mismatch' && e.property && e.expected !== undefined)
    .map((e) => ({
      path: e.path,
      property: e.property!,
      from: e.actual,
      to: e.expected,
      note: `把候选端 path=${e.path} 的样式 ${e.property} 改为真值侧值（${JSON.stringify(e.expected)}）`,
    }))
  return {
    format: 'proteus-consistency-report',
    version: 1,
    generatedAt: opts.now ?? new Date().toISOString(),
    kind: 'style',
    baselineEnd: comparison.baselineEnd,
    candidateEnd: comparison.candidateEnd,
    ok: comparison.ok,
    summary: { ...comparison.summary },
    diffs: entries,
    autoFixes,
  }
}

/** 报告 → 人类可读文本（`proteus explain <报告文件>` 的渲染；也给 CI 日志用） */
export function formatReport(report: ConsistencyFailureReport): string {
  const L: string[] = []
  L.push(`── 一致性失败报告（${report.kind} · ${report.baselineEnd} ⇄ ${report.candidateEnd}）──`)
  L.push(`状态：${report.ok ? '✅ 通过' : `❌ 失败（${report.diffs.filter((d) => d.overTolerance).length} 条超容差）`}`)
  const s = report.summary
  L.push(
    `摘要：对比 ${s.compared ?? '-'} 节点 · 不一致 ${s.mismatched ?? '-'} · 缺失 ${s.missing ?? '-'} · 多余 ${s.extra ?? '-'} · 层级 ${s.hierarchy ?? '-'}${report.kind === 'geometry' ? ` · 对齐=${report.summary.aligned === 1 ? 'root' : 'none'}` : ''}`,
  )
  if (report.diffs.length === 0) {
    L.push('（无差异）')
  } else {
    L.push('差异明细（含修复建议）：')
    for (const [i, d] of report.diffs.entries()) {
      const mark = d.overTolerance ? '✗' : '·'
      L.push(
        `  ${mark} [${i + 1}] path=${d.path || '(root)'}${d.property ? ` · ${d.property}` : ''}${d.toleranceClass ? ` · 类=${d.toleranceClass}` : ''}` +
          `${d.expected !== undefined ? ` · 期望=${JSON.stringify(d.expected)}` : ''}` +
          `${d.actual !== undefined ? ` · 实际=${JSON.stringify(d.actual)}` : ''}` +
          `${d.deviation !== undefined ? ` · 偏差=${d.deviation}` : ''}${d.tolerance !== undefined ? `（容差 ${d.tolerance}）` : ''}`,
      )
      L.push(`      修复：${d.suggestion}`)
    }
  }
  if (report.autoFixes.length > 0) {
    L.push(`可自动应用修复 ${report.autoFixes.length} 条（AI 自纠闭环输入）：`)
    for (const f of report.autoFixes.slice(0, 8)) L.push(`  → ${f.note}`)
  }
  return L.join('\n')
}

/** 识别"报告 JSON"（`proteus explain <file>` 据此分流） */
export function isConsistencyReport(value: unknown): value is ConsistencyFailureReport {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { format?: unknown }).format === 'proteus-consistency-report'
  )
}

/* ══════════════════ AI 自纠闭环（把 autoFixes 应用到候选快照，复比通过） ══════════════════ */

/**
 * 把报告的 autoFixes 应用到**候选快照**（几何）副本上——AI 自纠闭环的"执行"半步。
 *
 * 【为什么对快照而不是源码】本函数的定位是**验证闭环可闭合**（报告信息是否足够让"读者"
 *   直接改正）——真正改源码是消费方（人或 AI）的事。若快照改完复比即通过，说明报告
 *   携带的信息**足以定位并修正**（闭环成立）；否则说明报告缺字段（判据会红）。
 *
 * @returns `{ applied, skipped, next }`——applied 是实际改掉的、skipped 是 autoFixes 里
 *   指向不存在节点/path 的项（如实计数，不静默）
 */
export function applyAutoFixToGeometry<T extends { root: unknown }>(
  candidate: T,
  report: ConsistencyFailureReport,
): { applied: number; skipped: number; next: T } {
  const next = JSON.parse(JSON.stringify(candidate)) as { root: Record<string, unknown> }
  const byPath = new Map<string, Record<string, unknown>>()
  const walk = (n: Record<string, unknown>): void => {
    byPath.set(String(n.path), n)
    for (const c of (n.children as Array<Record<string, unknown>>) ?? []) walk(c)
  }
  walk(next.root)
  let applied = 0
  let skipped = 0
  for (const f of report.autoFixes) {
    const node = byPath.get(f.path)
    if (!node || typeof f.to !== 'number') {
      skipped++
      continue
    }
    node[f.property] = f.to
    applied++
  }
  return { applied, skipped, next: next as T }
}

// packages/consistency/src/compare.ts
// ★★VC5-b（L2 几何比对引擎）+ VC6（L3 计算样式比对）——**可定位、可解释**的差异报告。
//
// 【判据纪律（卡片硬性）】
//   · 每条差异包含：nodeId / path / 属性 / 端 A 值 / 端 B 值 / 偏差 / 是否超容差；
//   · **单项失败即整体失败**（`ok = 每条 diff 的 overTolerance === false`）——
//     🔴 本文件**不存在**任何"全页差异率 ≤ X% 即通过"的判定（卡 VC5-a 核心约束）；
//   · 支持节点缺失 / 多余 / 层级错位的检测（按 path 对齐，缺/多/深度不符各自成类）；
//   · **失败即可定位**：给出精确到节点的 path（+ 属性 + 偏差 + 依据）；
//   · Web 为真值基准：`compareAgainstWeb(web, candidate)` 强制校验 baseline.end === 'web'。
//
// 【坐标对齐（★真机实测抓出的必要口径）】跨页面/跨模式采集时，**页面滚动量**会平移全部
//   视口坐标（滚动是容器状态，不是节点几何）。⇒ 默认 `align: 'root'`（各端按自身根节点原点
//   归零后比较形状）；绝对坐标比对需显式 `align: 'none'`。这不是"格式适配"（VC3-a 禁止的那个）——
//   快照**字节**仍是同一格式、同一原点定义；对齐只发生在比较语义层且**两侧同等施加**。
//
// 【文本度量（唯一允许宽带）】文本节点的 w/h 走 textMetrics 类（宽带）；
//   其余节点走 structure 类。节点是否为"文本"由 `isTextNode` 判定
//   （默认：semanticKey 或 nodeId 含 'text'——两端探针都往 semanticKey 写组件 pid）。

import type { GeometryNode, GeometrySnapshot, NormalizedStyle, Rgba, StyleSnapshot } from './snapshot'
import {
  structureToleranceFor,
  textMetricsToleranceFor,
  type ToleranceConfig,
} from './tolerance'
import { DEFAULT_TOLERANCE } from './tolerance'

/* ══════════════════ 差异条目（VC5-b / VC8-b 的共同形态：结构化、可定位、含依据） ══════════════════ */

export type GeometryDiffKind = 'mismatch' | 'missing-in-candidate' | 'extra-in-candidate' | 'depth-mismatch'

export interface GeometryDiff {
  kind: GeometryDiffKind
  /** 精确到节点的路径（"0.1.2"；"" = 根） */
  path: string
  nodeId?: number | string
  /** 属性名（mismatch 才有） */
  property?: 'x' | 'y' | 'w' | 'h'
  /** 基线（真值，通常 Web）值 */
  aValue?: number
  /** 被测端值 */
  bValue?: number
  /** 绝对偏差（px） */
  deviation?: number
  /** 适用容差（px；结构/文本对应类别） */
  tolerance?: number
  /** 容差类别（structure / textMetrics） */
  toleranceClass?: 'structure' | 'textMetrics'
  /** 是否超容差（false = 记录但不判失败） */
  overTolerance: boolean
  /** 容差依据（可解释——卡片要求"每条差异含偏差与属性类"） */
  rationale?: string
  /** 修复建议方向（VC8-b；本批给通用提示，专项建议随 L3/L4 完善） */
  hint?: string
}

export interface GeometryComparison {
  ok: boolean
  diffs: GeometryDiff[]
  summary: {
    nodesA: number
    nodesB: number
    compared: number
    mismatched: number
    missing: number
    extra: number
    hierarchy: number
  }
  /** 坐标对齐口径（如实记录——报告里要能看出"是否归零比较"） */
  aligned: 'root' | 'none'
  baselineEnd: string
  candidateEnd: string
}

export interface CompareOptions {
  tolerance?: ToleranceConfig
  /** 坐标对齐：'root'（默认，按各自根节点归零）| 'none'（绝对坐标） */
  align?: 'root' | 'none'
  /** 文本节点判定（默认 semanticKey/nodeId 含 'text'） */
  isTextNode?: (node: GeometryNode) => boolean
  /**
   * ★**允许差异豁免**（《多端一致性标准方案》§9 / CS2 清单）：命中的差异**不判失败**，
   *   但在报告里标注 `allowedBy`（留痕——"清单内差异不判失败；清单外一律当 bug"）。
   *   证据：docs/allow-differences.json（每条带 reason/scope/evidence，schema 门禁）。
   */
  allowDifferences?: Array<{ id: string; prop?: string; key?: string }>
}

const defaultIsTextNode = (n: GeometryNode): boolean =>
  /text/i.test(String(n.semanticKey ?? '')) || /text/i.test(String(n.nodeId))

/** 把树按 path 拍平（含路径→节点映射） */
function flatten(root: GeometryNode, origin: { x: number; y: number } | null): Map<string, { node: GeometryNode; x: number; y: number }> {
  const out = new Map<string, { node: GeometryNode; x: number; y: number }>()
  const walk = (n: GeometryNode): void => {
    const ox = origin ? origin.x : 0
    const oy = origin ? origin.y : 0
    out.set(n.path, { node: n, x: n.x - ox, y: n.y - oy })
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return out
}

/**
 * L2 几何比对（VC5-b）：基线（端 A，真值）⇄ 被测端（端 B）。
 *
 * 对齐口径见文件头注；容差按 `ToleranceConfig` 分级（structure / textMetrics），
 * 组件级 override 经 `semanticKey` 匹配（卡片：支持 override 但不放宽全局）。
 */
export function compareGeometry(
  baseline: GeometrySnapshot,
  candidate: GeometrySnapshot,
  opts: CompareOptions = {},
): GeometryComparison {
  const cfg = opts.tolerance ?? DEFAULT_TOLERANCE
  const align = opts.align ?? 'root'
  const isText = opts.isTextNode ?? defaultIsTextNode
  const origin = align === 'root' ? { a: { x: baseline.root.x, y: baseline.root.y }, b: { x: candidate.root.x, y: candidate.root.y } } : null
  const A = flatten(baseline.root, origin ? origin.a : null)
  const B = flatten(candidate.root, origin ? origin.b : null)

  const diffs: GeometryDiff[] = []
  let compared = 0
  let mismatched = 0
  let missing = 0
  let extra = 0
  let hierarchy = 0

  for (const [path, a] of A) {
    const b = B.get(path)
    if (!b) {
      missing++
      diffs.push({
        kind: 'missing-in-candidate',
        path,
        nodeId: a.node.nodeId,
        overTolerance: true,
        rationale: '基线存在而被测端缺失——节点丢失是结构级缺陷（不可容差）',
      })
      continue
    }
    if (a.node.depth !== b.node.depth) {
      hierarchy++
      diffs.push({
        kind: 'depth-mismatch',
        path,
        nodeId: b.node.nodeId,
        aValue: a.node.depth,
        bValue: b.node.depth,
        deviation: Math.abs(a.node.depth - b.node.depth),
        overTolerance: true,
        rationale: '同一路径的深度不一致——层级错位（不可容差）',
      })
    }
    compared++
    const text = isText(a.node) || isText(b.node)
    for (const prop of ['x', 'y', 'w', 'h'] as const) {
      // x/y 用**对齐口径**的值（flatten 产出）；w/h 直接用节点值（对齐平移不影响尺寸）
      const avRaw = prop === 'x' ? a.x : prop === 'y' ? a.y : (a.node[prop] as number)
      const bvRaw = prop === 'x' ? b.x : prop === 'y' ? b.y : (b.node[prop] as number)
      // 内核在 display:none 时如实回 null（类型上声明为 number，运行时需容 null）
      const av = avRaw as number | null
      const bv = bvRaw as number | null
      // 两侧都可能为 null（display:none 如实缺席）：null ⇄ null = 一致；单侧 null = 缺陷
      if (av === null || bv === null || av === undefined || bv === undefined) {
        if ((av ?? null) !== (bv ?? null)) {
          mismatched++
          diffs.push({
            kind: 'mismatch',
            path,
            nodeId: b.node.nodeId,
            property: prop,
            overTolerance: true,
            rationale: '一侧节点缺席（null）而另一侧存在——"看起来还在"与"真的不在"必须判定',
          })
        }
        continue
      }
      const dev = Math.abs(av - bv)
      const cls = text ? 'textMetrics' : 'structure'
      const pid = String(a.node.semanticKey ?? b.node.semanticKey ?? '') || undefined
      const tol = text
        ? (() => {
            const t = textMetricsToleranceFor(cfg, pid, a.node.nodeId)
            return { v: Math.max(t.absPx, (t.relPct / 100) * Math.abs(av)), rationale: t.rationale }
          })()
        : (() => {
            const t = structureToleranceFor(cfg, pid, a.node.nodeId)
            return { v: Math.max(t.absPx, (t.relPct / 100) * Math.abs(av)), rationale: t.rationale }
          })()
      const over = dev > tol.v
      if (over) mismatched++
      diffs.push({
        kind: 'mismatch',
        path,
        nodeId: b.node.nodeId,
        property: prop,
        aValue: av,
        bValue: bv,
        deviation: Math.round(dev * 1000) / 1000,
        tolerance: Math.round(tol.v * 1000) / 1000,
        toleranceClass: cls,
        overTolerance: over,
        rationale: tol.rationale,
        hint: over
          ? text
            ? '文本尺寸差异：先锁确定性测试字体重测；仍超带则按 A-1 允许差异评估（标准 §9.3）'
            : '结构差异：查该端布局声明/换算路径（几何吸附只应发生在内核 pixel-snap）'
          : undefined,
      })
    }
  }
  for (const [path, b] of B) {
    if (!A.has(path)) {
      extra++
      diffs.push({
        kind: 'extra-in-candidate',
        path,
        nodeId: b.node.nodeId,
        overTolerance: true,
        rationale: '被测端多出节点——多余节点是结构级缺陷（不可容差）',
      })
    }
  }

  // ★单项失败即整体失败（不存在任何"比例阈值"判定——卡 VC5-a 核心约束）
  const ok = !diffs.some((d) => d.overTolerance)
  return {
    ok,
    diffs,
    summary: { nodesA: A.size, nodesB: B.size, compared, mismatched, missing, extra, hierarchy },
    aligned: align,
    baselineEnd: baseline.end,
    candidateEnd: candidate.end,
  }
}

/** Web 为真值基准的比对（卡片：支持指定 Web 为真值基准——基线端必须是 web） */
export function compareAgainstWeb(web: GeometrySnapshot, candidate: GeometrySnapshot, opts: CompareOptions = {}): GeometryComparison {
  if (web.end !== 'web') {
    throw new Error(`compareAgainstWeb：基线端必须是 web，实际 ${web.end}（真值基准不可替换）`)
  }
  return compareGeometry(web, candidate, opts)
}

/* ══════════════════ L3 计算样式比对（VC6：按 VC3-b 归一化后的值比对） ══════════════════ */

export type StyleDiffClass = 'color' | 'font' | 'numericLength' | 'scalar' | 'enum'

export interface StyleDiff {
  kind: 'mismatch' | 'missing-in-candidate' | 'extra-in-candidate'
  path: string
  nodeId?: number | string
  key?: string
  class?: StyleDiffClass
  aValue?: unknown
  bValue?: unknown
  deviation?: number
  tolerance?: number
  overTolerance: boolean
  rationale?: string
  hint?: string
  /** ★命中的"允许差异"条目 id（清单内 ⇒ overTolerance=false + 本字段留痕） */
  allowedBy?: string
}

export interface StyleComparison {
  ok: boolean
  diffs: StyleDiff[]
  summary: {
    nodesA: number
    nodesB: number
    compared: number
    mismatched: number
    /** 被 nonDeterministic 规则跳过的键数（如实计数——不是"没比"而是"按规则不比"） */
    skipped: number
    /** 只在某一侧出现的键数（交集比对；计数可见，不静默） */
    keysOnlyInA: number
    keysOnlyInB: number
  }
  baselineEnd: string
  candidateEnd: string
}

/** 样式键 → 容差类别（**单一实现**：比对与 M1 覆盖统计都从这里取） */
export function classifyStyleKey(key: string, cfg: ToleranceConfig = DEFAULT_TOLERANCE): StyleDiffClass | 'skip' {
  const lower = key.toLowerCase()
  for (const s of cfg.classes.nonDeterministic.skipped) {
    if (lower.includes(s.toLowerCase())) return 'skip'
  }
  if (key === 'color' || key === 'backgroundColor' || /color$/i.test(key)) return 'color'
  if (key === 'fontSize' || key === 'fontWeight' || key === 'fontFamily') return 'font'
  if (/^(padding|margin|border.*Width)$/i.test(key)) return 'numericLength'
  if (key === 'opacity') return 'scalar'
  return 'enum'
}

const channelDelta = (a: Rgba, b: Rgba): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a) * 255)

function compareStyleValue(
  key: string,
  a: unknown,
  b: unknown,
  cfg: ToleranceConfig,
): { over: boolean; deviation?: number; tolerance?: number; cls: StyleDiffClass; rationale: string; hint?: string } {
  const cls = classifyStyleKey(key, cfg) as StyleDiffClass
  if (cls === 'color') {
    const delta = channelDelta(a as Rgba, b as Rgba)
    const tol = cfg.classes.color.channelDelta
    return {
      over: delta > tol,
      deviation: Math.round(delta * 1000) / 1000,
      tolerance: tol,
      cls,
      rationale: cfg.classes.color.rationale,
      hint: delta > tol ? '颜色通道差异：查该端颜色归一化路径（hex/rgb 解析一致性）；1/255 级偏移即真实缺陷' : undefined,
    }
  }
  if (cls === 'font') {
    if (key === 'fontFamily') {
      const same = String(a) === String(b)
      return { over: !same, cls, rationale: cfg.classes.font.rationale, hint: same ? undefined : '字族不一致：查字体回退链（标准 §9.3 允许差异需显式登记才放行）' }
    }
    const dev = Math.abs(Number(a) - Number(b))
    const eps = cfg.classes.font.epsilon
    return { over: dev > eps, deviation: dev, tolerance: eps, cls, rationale: cfg.classes.font.rationale }
  }
  if (cls === 'numericLength') {
    const dev = Math.abs(Number(a) - Number(b))
    const t = cfg.classes.structure
    const tol = Math.max(t.absPx, (t.relPct / 100) * Math.abs(Number(a)))
    return { over: dev > tol, deviation: Math.round(dev * 1000) / 1000, tolerance: Math.round(tol * 1000) / 1000, cls, rationale: t.rationale }
  }
  if (cls === 'scalar') {
    const dev = Math.abs(Number(a) - Number(b))
    const tol = 0.001
    return { over: dev > tol, deviation: dev, tolerance: tol, cls, rationale: '标量（透明度等）：确定性数值，仅留 round3 表示粒度（0.001）' }
  }
  const same = String(a) === String(b)
  return { over: !same, cls, rationale: '枚举类（display/position/visibility）：离散值，不等即缺陷' }
}

/**
 * L3 样式比对（VC6）：按 path 对齐 + VC3-b 归一化值 + 分级容差。
 * 键集按**交集**比对（各端闭集不同），只在单侧出现的键计入 `keysOnlyInA/B`（可见，不静默）。
 */
export function compareStyle(
  baseline: StyleSnapshot,
  candidate: StyleSnapshot,
  opts: { tolerance?: ToleranceConfig; allowDifferences?: Array<{ id: string; key?: string }> } = {},
): StyleComparison {
  const cfg = opts.tolerance ?? DEFAULT_TOLERANCE
  const A = new Map(baseline.nodes.map((n) => [n.path, n]))
  const B = new Map(candidate.nodes.map((n) => [n.path, n]))
  const diffs: StyleDiff[] = []
  let compared = 0
  let mismatched = 0
  let skipped = 0
  let keysOnlyInA = 0
  let keysOnlyInB = 0

  const allowKeys = new Map<string, string>()
  for (const ad of opts.allowDifferences ?? []) {
    if (ad.key) allowKeys.set(ad.key, ad.id)
  }
  for (const [path, a] of A) {
    const b = B.get(path)
    if (!b) {
      diffs.push({ kind: 'missing-in-candidate', path, nodeId: a.nodeId, overTolerance: true, rationale: '基线存在而被测端缺失（样式表未覆盖该节点）' })
      continue
    }
    compared++
    const keys = new Set([...Object.keys(a.styles), ...Object.keys(b.styles)])
    for (const key of keys) {
      const av = (a.styles as Record<string, unknown>)[key]
      const bv = (b.styles as Record<string, unknown>)[key]
      if (av === undefined || bv === undefined) {
        if (av === undefined) keysOnlyInB++
        else keysOnlyInA++
        continue
      }
      if (classifyStyleKey(key, cfg) === 'skip') {
        skipped++
        continue
      }
      const r = compareStyleValue(key, av, bv, cfg)
      // ★允许差异豁免（清单内不判失败，但留痕 allowedBy——§9 硬约束"清单内不判失败，清单外当 bug"）
      const allowedBy = r.over ? allowKeys.get(key) : undefined
      if (r.over && !allowedBy) mismatched++
      diffs.push({
        kind: 'mismatch',
        path,
        nodeId: b.nodeId,
        key,
        class: r.cls,
        aValue: av,
        bValue: bv,
        deviation: r.deviation,
        tolerance: r.tolerance,
        overTolerance: r.over && !allowedBy,
        rationale: r.rationale,
        hint: r.hint,
        ...(allowedBy ? { allowedBy } : {}),
      })
    }
  }
  for (const [path, b] of B) {
    if (!A.has(path)) {
      diffs.push({ kind: 'extra-in-candidate', path, nodeId: b.nodeId, overTolerance: true, rationale: '被测端多出节点（样式表多覆盖）' })
    }
  }
  const ok = !diffs.some((d) => d.overTolerance)
  return {
    ok,
    diffs,
    summary: { nodesA: A.size, nodesB: B.size, compared, mismatched, skipped, keysOnlyInA, keysOnlyInB },
    baselineEnd: baseline.end,
    candidateEnd: candidate.end,
  }
}

/** Web 为真值基准的样式比对 */
export function compareStyleAgainstWeb(
  web: StyleSnapshot,
  candidate: StyleSnapshot,
  opts: { tolerance?: ToleranceConfig; allowDifferences?: Array<{ id: string; key?: string }> } = {},
): StyleComparison {
  if (web.end !== 'web') {
    throw new Error(`compareStyleAgainstWeb：基线端必须是 web，实际 ${web.end}`)
  }
  return compareStyle(web, candidate, opts)
}

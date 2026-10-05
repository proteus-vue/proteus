// packages/compiler/src/cse/overlay.ts
// ★★★G-61 后批（2026-10-05）：**IR 值覆盖（切换执行 · plan §2.2 逐字段批次）**
//
// 【它做什么】把 CSE 算出的 **StyleIR 字段值**写回**旧折叠产物的节点样式**（`LayoutNode.style`）——
//   即"新通路接管某字段"的**切换执行器**。按**字段白名单**逐批切换（plan §2.2 纪律：禁一次性替换）。
//
// 【★为什么不是"新通路整体替换"（安全性论证）】
//   · 旧通路不只是"折叠器"——它**还做平台转换**（混合文本合成 `p-text` 叶 / 枚举封闭集过滤 /
//     App 适配如 `position:fixed→absolute` / 字体栈→角色）。整体替换会**丢掉这些转换**。
//   · ⇒ 切换粒度 = **逐字段覆盖**：旧通路继续跑（保结构转换），只在**白名单字段**上用 CSE 的值。
//   · ⇒ 每批白名单都可由**影子对账**（`check-app-ir-shadow`）预判影响：该字段在两路的差异分类
//     决定"切换是修漂移（cascade/rpx 类）还是改变行为（app-adaptation 类——**不进白名单**）"。
//
// 【对齐前提（不满足即**整体拒绝**）】两树必须可对齐（`align.ts`）——调用方须给 extract 传
//   **与旧通路相同的 statics**（否则树形态不同、错配比不切更危险）。
//
// 【值域安全（写回前的护栏）】写回的每个值都过 `APP_ENUM_VALUES`（内核封闭集——与旧通路同源）：
//   枚举不在集内 ⇒ **跳过该字段**（保留旧值）+ 记 note（不静默写坏内核树）。
//
// 【诚实边界（v1）】a) 只覆盖**绝对值与枚举/颜色**字段（比例/auto 的写回形态与旧通路不同——
//   留给后续批次）；b) 不覆盖 `boxShadow`/`transform`/`gridTemplate*`（IR v1 结构形态不同）；
//   c) 覆盖**只作用于 DOM 等价的节点**（对齐质量由 `unaligned` 如实报告——不为 0 时调用方应拒绝）。

import type { CseNode, CseComputedNode } from './types'
import { alignTrees, type AlignNode, type AlignResult } from './align'

/** 逐字段批次白名单（plan §2.2：每批一组字段 + IR 等价判据兜底） */
export const SWITCH_BATCHES: Readonly<Record<string, readonly string[]>> = {
  /**
   * 批次 1（本批）：**纯绘制值**（颜色/字号/字重/字距/透明度）。
   * 依据（影子对账数据）：这些字段在 superapp 全语料**零差异**（可安全首切）；
   *   在全语料层面差异分类为 `cascade-difference`（CSE 正确方——修层叠漂移）。
   */
  'paint-values': ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'letterSpacing', 'opacity'],
  /**
   * 批次 2（预留）：**文本排版值**（lineHeight/textAlign/textOverflow 等——差异含 rpx 语义修正）。
   */
  'text-layout': ['lineHeight', 'textAlign', 'textOverflow', 'textDecoration', 'whiteSpace'],
  /**
   * ★**永久排除**（app-adaptation 类：旧通路的有意转换——切换会让 App 端行为回退）：
   *   · `position`：旧通路把 `fixed` 适配成 `absolute`（内核无 fixed）
   *   · `fontFamily`：旧通路把字体栈折成**角色**（App 端只认角色）
   *   · `display`：旧通路做**枚举封闭集过滤**（内核只认 flex/grid/none）
   *   这些要"搬 applier"（G-61 B3 的 app.ts 里已就位）——**不是**本执行器的白名单成员。
   */
  'app-adaptation-excluded': ['position', 'fontFamily', 'display'],
}

/** 单个字段的写回结果 */
export interface OverlayFieldOp {
  nodeId: number
  field: string
  from: unknown
  to: unknown
  /** 跳过原因（写回被拦时） */
  skipped?: string
}

export interface OverlayResult {
  /** 实际写入的字段数 */
  applied: number
  /** 逐字段操作明细（含跳过——可审计） */
  ops: OverlayFieldOp[]
  /** 对齐未配对数（>0 ⇒ 调用方**不应**信任本次覆盖） */
  unaligned: number
  /** 整体拒绝原因（对齐失败时） */
  reason?: string
}

export interface OverlayOptions {
  /** 白名单字段（来自 `SWITCH_BATCHES`；缺省 ⇒ 不覆盖任何字段） */
  fields: readonly string[]
  /** 内核枚举封闭集（`APP_ENUM_VALUES` 形态——不在集内 ⇒ 跳过；缺省 ⇒ 不校验） */
  enumValues?: Record<string, readonly string[]>
  /** 干跑（只产出 ops、不写回——对账/审计用） */
  dryRun?: boolean
}

/** 长度/枚举值的可比归一（`{kind:'absolute',dp}` → dp；其余原样） */
function rawOf(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && (v as { kind?: string }).kind === 'absolute') {
    return (v as { dp?: number }).dp
  }
  return v
}

/** 把 CseNode 树映射为 AlignNode 形态（id = key） */
function cseAlignRoots(roots: CseNode[]): AlignNode[] {
  const conv = (n: CseNode): AlignNode => ({ id: n.key, tag: n.tag, children: n.children.map(conv) })
  return roots.map(conv)
}

/**
 * **执行覆盖**：把白名单字段的 IR 值写回旧产物节点。
 *
 * @param oldRoots 旧产物的根节点（须带 children 引用——调用方用 parentId 构树后传入；
 *                 合成叶（p-text）**保留**在树里——对齐器会跳过它们）
 * @param oldStyleOf 取某旧节点的 style 对象（可写引用）
 * @param cseRoots CSE 提取的根（与旧树**同 statics 口径**）
 * @param computed computeTree 的 byKey（CSE 计算结果）
 */
export function overlayIrValues(
  oldRoots: AlignNode[],
  oldStyleOf: (oldId: number) => Record<string, unknown>,
  cseRoots: CseNode[],
  computed: Record<string, CseComputedNode>,
  opts: OverlayOptions,
): OverlayResult {
  const aligned: AlignResult = alignTrees(oldRoots, cseAlignRoots(cseRoots))
  if (aligned.reason) {
    return { applied: 0, ops: [], unaligned: aligned.unaligned, reason: aligned.reason }
  }
  const ops: OverlayFieldOp[] = []
  let applied = 0
  const fieldSet = new Set(opts.fields)
  for (const { old, cse } of aligned.pairs) {
    const oldStyle = oldStyleOf(old.id as number)
    const comp = computed[cse.id as string]
    if (!comp) continue
    for (const field of fieldSet) {
      const nextRaw = comp.fields[field]
      if (nextRaw === undefined || nextRaw === null) continue // IR 未声明 ⇒ 保留旧值（不让 CSE 的"缺省"抹掉旧通路的值）
      const next = rawOf(nextRaw)
      const prev = oldStyle[field]
      if (JSON.stringify(prev) === JSON.stringify(next)) continue // 已相同（零操作——不记账）
      // ★★护栏（切换批次 1 实测逼出）：**只在旧通路已声明该字段时覆盖**——
      //   旧通路**不折叠 CSS 继承**（只有 9 个可继承字段的显式子集），CSE 按标准**传播继承** ⇒
      //   若允许"从无到有"，CSE 会把父值写进**每个**节点（实测 superapp：fontSize 16 被写到全部
      //   节点 = 产物显著膨胀 + 与宿主默认值语义重叠）。⇒ 切换期语义 = **"旧有值 → CSE 值"**
      //   （修正旧值），**不引入**旧通路没有的字段（继承增强是独立议题，随宿主默认值一并评估）。
      if (prev === undefined) {
        ops.push({ nodeId: old.id as number, field, from: prev, to: next, skipped: '旧通路未声明该字段（继承新增——批 1 不引入）' })
        continue
      }
      // ★枚举封闭集护栏（内核只认封闭值——写坏会让 `RustLayout.create` 失败/静默丢）
      const allowed = opts.enumValues?.[field]
      if (allowed && typeof next === 'string' && !allowed.includes(next)) {
        ops.push({ nodeId: old.id as number, field, from: prev, to: next, skipped: `值 \`${next}\` 不在内核封闭集（${allowed.join('/')}）` })
        continue
      }
      ops.push({ nodeId: old.id as number, field, from: prev, to: next })
      if (!opts.dryRun) oldStyle[field] = next
      applied++
    }
  }
  return { applied, ops, unaligned: aligned.unaligned }
}

// packages/compiler/src/cse/degrade.ts
// ★★★G-61 B4（2026-10-05）：**`degradeTo` 配方执行器**（Profile P5 · plan B4 行）
//
// 【它做什么（plan §1 L-D 的能力协商）】当某端**不原生支持**某个字段取值时，Capability Registry
//   给出 `degradeTo` 配方 ⇒ 本执行器把 IR **编译期**改写为等价形态（INV-CE-05：降级在编译期、
//   语义等价、**可观测**）。v1 配方：
//   · `grid→flex`：**单行网格**（grid-template 只有一行 / 未跨行）⇒ 容器改 flex(row) +
//     逐子项 flex 比例（fr 权重）+ gap；跨行/多行网格 ⇒ **拒绝**（如实 unsupported，不做错误近似）
//   · `gap→padding`（逐子项 margin）：无 gap 支持的端 ⇒ 子项加 margin（首/末项减半——缝隙等效）
//   · 其余（aspectRatio/boxShadow/transform）⇒ v1 无配方（如实 unsupported）
//
// 【★语义等价的判据（"配方"不是"模糊处理"）】每个配方函数返回 `{ fields, children?, note }`：
//   · `fields`：改写后的**容器**字段
//   · `children`：需要叠加到**子项**的字段（如 flex 比例 / margin）
//   · `note`：配方的等价性说明（进诊断——可观测）
//   ⇒ 调用方（各端 Applier / 构建链）应用后由 conformance 验证（`tests/degrade-conformance.test.ts`
//     会把"降级后的渲染"与"原 IR 在 Web 的渲染"对拍）。
//
// 【诚实边界（v1——不做"看起来差不多"的近似）】多行 / 跨行 / 命名线 / `grid-area` 的网格**不降级**
//   （记 `unsupported` 且给出原因）——错误降级会让版面静默错位，比"不支持"危险（本仓纪律）。

/** 配方执行结果 */
export interface DegradeResult {
  ok: boolean
  /** 改写后的容器字段（键 = IR 字段名） */
  fields: Record<string, unknown>
  /** 追加到子项的字段（数组序 = 子项序；null = 该子项无补充） */
  childFields?: Array<Record<string, unknown> | null>
  /** 等价性说明（进诊断；可观测） */
  note?: string
  /** 未降级原因（ok=false 时给——如实，不猜） */
  reason?: string
}

/** 配方名（Capability Registry 的 `degradeTo` 字段用） */
export type DegradeRecipe = 'grid-to-flex' | 'gap-to-margin' | 'none'

export interface DegradeContext {
  /** 子项数（grid 列数推导用；未给 ⇒ 从 gridTemplateColumns 的轨道数取） */
  childCount?: number
}

/** `grid-template-columns` 的轨道解析（`1fr 2fr 100px` / `repeat(n, x)` 已由 CSE 归一 ⇒ 只处理展开形态） */
function parseTracks(track: string): Array<{ kind: 'fr'; n: number } | { kind: 'px'; n: number } | { kind: 'auto' }> | null {
  const parts = track.trim().split(/\s+/)
  const out: Array<{ kind: 'fr'; n: number } | { kind: 'px'; n: number } | { kind: 'auto' }> = []
  for (const p of parts) {
    if (!p) continue
    const fr = /^([\d.]+)fr$/.exec(p)
    if (fr) {
      out.push({ kind: 'fr', n: Number(fr[1]) })
      continue
    }
    const px = /^([\d.]+)px$/.exec(p)
    if (px) {
      out.push({ kind: 'px', n: Number(px[1]) })
      continue
    }
    if (p === 'auto' || p === 'min-content' || p === 'max-content') {
      out.push({ kind: 'auto' })
      continue
    }
    return null // 未知轨道形态（如 `minmax()`）⇒ 不降级
  }
  return out.length > 0 ? out : null
}

/**
 * **配方执行**：把 `fields` 按配方改写。
 * @returns ok=false ⇒ 该配方**不适用**（调用方记 unsupported，附 reason）
 */
export function applyDegradeRecipe(
  recipe: DegradeRecipe,
  fields: Record<string, unknown>,
  ctx: DegradeContext = {},
): DegradeResult {
  switch (recipe) {
    case 'none':
      return { ok: false, fields, reason: '无配方（该字段在该端不可表达）' }
    case 'grid-to-flex': {
      // 前置条件（v1）：单行网格（无 gridTemplateRows 或只有一行）+ 有 gridTemplateColumns
      const colsRaw = fields['gridTemplateColumns']
      if (typeof colsRaw !== 'string') {
        return { ok: false, fields, reason: '无 grid-template-columns（无可降级的网格定义）' }
      }
      const rowsRaw = fields['gridTemplateRows']
      if (typeof rowsRaw === 'string') {
        const rowTracks = parseTracks(rowsRaw)
        if (!rowTracks) return { ok: false, fields, reason: `grid-template-rows 含不可解析轨道（${rowsRaw}）` }
        if (rowTracks.length > 1) {
          return { ok: false, fields, reason: `多行网格（${rowTracks.length} 行）⇒ v1 不降级（跨行放置语义无法用单层 flex 等价）` }
        }
      }
      const tracks = parseTracks(colsRaw)
      if (!tracks) return { ok: false, fields, reason: `grid-template-columns 含不可解析轨道（${colsRaw}）` }
      // 全部为 px/auto（无 fr）⇒ flex 无法等价（那需要固定宽度分配——用 width 表达更直接，但列宽会丢）
      const hasFr = tracks.some((t) => t.kind === 'fr')
      if (!hasFr) {
        return { ok: false, fields, reason: '列轨道无 fr（纯 px/auto 网格）——flex 无等价分配（如实不降级）' }
      }
      // 改写：容器 flex(row) + 子项 flex 比例
      const next: Record<string, unknown> = { ...fields }
      delete next['gridTemplateColumns']
      next['display'] = 'flex'
      next['flexDirection'] = 'row'
      // 保 gap（若该端支持）；不支持 gap 的端会拿到 gap→margin 的二次配方（调用方按序执行）
      const childFields = tracks.map((t) => {
        if (t.kind === 'fr') return { flexGrow: t.n, flexShrink: 1, flexBasis: { kind: 'absolute', dp: 0 } }
        if (t.kind === 'px') return { flexGrow: 0, flexShrink: 0, flexBasis: { kind: 'absolute', dp: t.n } }
        return { flexGrow: 1, flexShrink: 1 } // auto ⇒ 可伸缩（近似——note 里如实说明）
      })
      const note =
        `grid→flex 降级（单行）：容器 flex(row) + 子项 flex 比例（${tracks.map((t) => (t.kind === 'fr' ? `${t.n}fr` : t.kind === 'px' ? `${t.n}px` : 'auto')).join(' ')}）。` +
        (tracks.some((t) => t.kind === 'auto') ? '★auto 轨道按 flex:1 近似（与原语义有差异，已记录）。' : '') +
        '等价前提：单行、无跨行放置、无 minmax()'
      return { ok: true, fields: next, childFields, note }
    }
    case 'gap-to-margin': {
      const gap = fields['gap']
      const rowGap = fields['rowGap'] ?? gap
      const colGap = fields['columnGap'] ?? gap
      if (typeof rowGap !== 'number' && typeof colGap !== 'number') {
        return { ok: false, fields, reason: '无 gap/row-gap/column-gap（无可降级的间距）' }
      }
      const count = ctx.childCount ?? 0
      if (count <= 0) return { ok: false, fields, reason: '缺子项数（gap→margin 需要它来给首/末项做半距处理）' }
      const next: Record<string, unknown> = { ...fields }
      delete next['gap']
      delete next['rowGap']
      delete next['columnGap']
      // 子项 margin：中间项两侧半距（相邻两半距叠加 = 原 gap）；首/末项只一侧半距
      const halfCol = typeof colGap === 'number' ? colGap / 2 : 0
      const halfRow = typeof rowGap === 'number' ? rowGap / 2 : 0
      const childFields = Array.from({ length: count }, (_, i) => {
        const first = i === 0
        const last = i === count - 1
        const out: Record<string, unknown> = {}
        if (halfCol > 0) {
          out['marginLeft'] = { kind: 'absolute', dp: first ? 0 : halfCol }
          out['marginRight'] = { kind: 'absolute', dp: last ? 0 : halfCol }
        }
        if (halfRow > 0) {
          out['marginTop'] = { kind: 'absolute', dp: first ? 0 : halfRow }
          out['marginBottom'] = { kind: 'absolute', dp: last ? 0 : halfRow }
        }
        return Object.keys(out).length > 0 ? out : null
      })
      return {
        ok: true,
        fields: next,
        childFields,
        note: `gap→margin 降级：子项两侧半距（col ${halfCol}px / row ${halfRow}px；首末项单侧）——相邻半距叠加 = 原 gap`,
      }
    }
    default: {
      const _exhaustive: never = recipe
      return { ok: false, fields, reason: `未知配方：${String(_exhaustive)}` }
    }
  }
}

/** 配方可用性（Capability Registry 消费——某端某字段是否有配方） */
export const DEGRADE_RECIPES: Readonly<Record<DegradeRecipe, { description: string; applicability: string }>> = {
  'grid-to-flex': {
    description: '单行网格 → 容器 flex(row) + 子项 flex 比例',
    applicability: 'grid-template-columns 含 fr；grid-template-rows 缺省或单行；无 minmax()/命名线/跨行放置',
  },
  'gap-to-margin': {
    description: 'gap → 逐子项 margin（半距法）',
    applicability: '已知子项数；一维或两维 gap 均可',
  },
  none: {
    description: '无配方（该字段在该端不可表达）',
    applicability: '—',
  },
}

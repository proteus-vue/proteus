// packages/compiler/src/cse/cascade.ts
// ★★★G-61 B1：**CSE · 完整五级层叠**（Profile §4.2 Step 4 · 本模块是"引擎"与"折叠器"的分界之一）
//
// 【五级顺序（CSS 2.1/CSS Cascade 4 的 author 级子集）】
//   1. **Origin & Importance**：本仓只有 author 级；author 内 `!important` > 普通
//   2. **@layer 顺序**：层内声明按层序（`@layer a, b;` 声明的顺序）——**重要声明层序反转**（CSS 规则）
//   3. **Specificity (a, b, c)**
//   4. **Source order**（同层同特异性：后写胜）
//   5. （用户代理级不在本仓范围）
//
// 【★按长手竞争（本模块的核心正确性）】CSS 层叠逐**长手属性**判定：`margin: 0` 与后写
//   `margin-top: 5px` 竞争同一属性 `margin-top`（简写先展开成 4 条长手，字典序按展开后逐条）。
//   ⇒ 规则表在**解析期**已把简写展开为长手（parse.ts），本模块只做逐长手取胜者。
//   证据（本仓实测，旧折叠通路的缺陷）：旧通路在简写层 Object.assign ⇒ `margin` 结果整体覆盖
//   `margin.top`，"margin 覆盖 margin-top"的正确行为**做不到**。
//
// 【@layer 的反转规则（易错点，单测锁定）】普通声明：**后声明的层优先**；
//   `!important` 声明：**先声明的层优先**（层序反转）。无层（unlayered）声明：普通时**高于所有层**（CSS 规定），
//   important 时**低于所有层**。

import type { CseRule, CseWinner } from './types'

/** 层序上下文 */
export interface LayerContext {
  /** 层名 → 层序（parse.ts 的 layerOrder；无层 = null） */
  order: Map<string, number>
  /** 无层层序值（比所有命名层"更高"——普通声明用；important 用反向） */
  unlayered: number
}

export function layerContextOf(layerOrder: string[]): LayerContext {
  const order = new Map<string, number>()
  for (let i = 0; i < layerOrder.length; i++) order.set(layerOrder[i]!, i)
  return { order, unlayered: layerOrder.length }
}

/**
 * 逐长手层叠：对每一条命中规则的长手声明，选出唯一胜者。
 * @param declarations 命中的 (rule, decl) 对（顺序不敏感——比较字段自带）
 */
export interface CascadeInput {
  rule: CseRule
  decl: { prop: string; value: string; important: boolean; fromShorthand?: string }
}

/** 层序比较键：普通声明 = 层序升序（后层胜）；important = 层序**降序**（先层胜）；无层分别最高/最低 */
function layerRank(layer: string | null, ctx: LayerContext): number {
  if (layer === null) return ctx.unlayered
  return ctx.order.get(layer) ?? ctx.unlayered
}

/** 候选（带声明在规则内的序号——同规则内后者胜） */
export interface CascadeCandidate extends CascadeInput {
  declIdx: number
}

/** a 是否胜过 b（五级逐级比较；a 胜返回 true） */
function beats(a: CascadeCandidate, b: CascadeCandidate, ctx: LayerContext): boolean {
  const ra = a.rule
  const rb = b.rule
  // ① importance：普通 < important；同 importance 才继续
  if (a.decl.important !== b.decl.important) return a.decl.important
  const imp = a.decl.important
  // ①.5 inline style（`style="..."`）：CSS 中高于任何选择器**普通**声明（同为 important 时按层/特异性比较）
  if (ra.isInline !== rb.isInline && !imp) return Boolean(ra.isInline)
  // ② @layer：普通 → 层序大者胜；important → 层序**小**者胜（反转）。无层在普通时最大、important 时最小。
  const la = layerRank(ra.layer, ctx)
  const lb = layerRank(rb.layer, ctx)
  if (la !== lb) return imp ? la < lb : la > lb
  // ③ 特异性（字典序 a,b,c）
  for (let i = 0; i < 3; i++) {
    const d = ra.specificity[i]! - rb.specificity[i]!
    if (d !== 0) return d > 0
  }
  // ④ 源序（后写胜）
  if (ra.order !== rb.order) return ra.order > rb.order
  // 同规则内：**列表序**后写胜（同一规则里 `margin-top: 1px; margin-top: 2px`）
  return a.declIdx > b.declIdx
}

/**
 * 层叠主函数：对每个长手属性取唯一胜者。
 * @returns prop → 胜者（含 trace 元数据）
 */
export function cascade(candidates: CascadeCandidate[], ctx: LayerContext): Record<string, CseWinner> {
  const winners: Record<string, CseWinner> = {}
  const best: Record<string, CascadeCandidate> = {}
  for (const c of candidates) {
    const prop = c.decl.prop
    const cur = best[prop]
    if (!cur) {
      best[prop] = c
      continue
    }
    // ★同 importance 同层时按 CSS 逐级；importance 不同时 important 恒胜（beats 已处理）
    if (beats(c, cur, ctx)) best[prop] = c
  }
  for (const [prop, c] of Object.entries(best)) {
    const w: CseWinner = {
      prop,
      value: c.decl.value,
      important: c.decl.important,
      layer: c.rule.layer,
      layerIndex: c.rule.layerIndex,
      specificity: c.rule.specificity,
      order: c.rule.order,
      selector: c.rule.chain.raw,
    }
    if (c.decl.fromShorthand !== undefined) w.fromShorthand = c.decl.fromShorthand
    winners[prop] = w
  }
  return winners
}

/**
 * @layer 层序反转的**可读断言**（单测与 explain 消费；避免"反转规则"实现漂移无人发现）。
 */
export function explainLayerPrecedence(ctx: LayerContext, layers: Array<string | null>, important: boolean): Array<string | null> {
  const sorted = [...layers].sort((x, y) => {
    const lx = layerRank(x, ctx)
    const ly = layerRank(y, ctx)
    return important ? lx - ly : ly - lx // important：小者先（胜）；普通：大者先（胜）
  })
  return sorted
}

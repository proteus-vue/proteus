// packages/compiler/src/cse/match.ts
// ★★★G-61 B1：**CSE · 选择器匹配**（索引 + 右→左回溯验证）
//
// 【为什么右→左（Profile §4.2 Step 3）】CSS 匹配的标准策略：先用 **key selector（最右段）**快速筛候选，
//   再向左回溯验证祖先链。本仓编译期树有限 ⇒ 直接用节点自身做 key 过滤（O(节点 × 相关规则)）。
//
// 【索引（Step 2）】按最右段的"键"分桶：`#id` → id 桶 · `.class` → 逐类桶 · `tag` → tag 桶 ·
//   纯通配/伪类 → universal 桶。匹配时按 节点 id/类/标签 取桶并集（去重后逐条验证）。
//   ★桶的意义：整棵树的规则表可能上百条，而单节点相关规则通常个位数。

import type { CseNode, CseRule, CseSegment } from './types'

/** 匹配上下文（节点的 id/类/tag + 元素兄弟序） */
export interface MatchContext {
  id?: string
  classes: Set<string>
  tag: string
  /** 元素兄弟序（0-based）与总数（结构伪类） */
  index: number
  count: number
  /** ★`:root` 匹配用：是否**树根**（无父——CSE 的"文档根"语义） */
  isRoot?: boolean
}

/** 祖先链（根 → 父）——右→左回溯用 */
export type AncestorChain = MatchContext[]

/** 段匹配（id/类/标签/通配 + :root + 结构伪类 + :not） */
export function segmentMatches(seg: CseSegment, node: MatchContext): boolean {
  if (seg.root && node.isRoot !== true) return false
  if (seg.id !== undefined && seg.id !== node.id) return false
  if (seg.tag !== undefined && seg.tag !== node.tag) return false
  if (!seg.universal && seg.classes.length > 0) {
    for (const c of seg.classes) if (!node.classes.has(c)) return false
  }
  if (seg.pseudo) {
    const pos = node.index + 1 // 1-based
    if (seg.pseudo.kind === 'first-child') {
      if (node.index !== 0) return false
    } else if (seg.pseudo.kind === 'last-child') {
      if (node.index !== node.count - 1) return false
    } else {
      const { a, b } = seg.pseudo
      if (a === 0) {
        if (pos !== b) return false
      } else {
        const d = pos - b
        if (d % a !== 0 || d / a < 0) return false
      }
    }
  }
  if (seg.not && segmentMatches(seg.not, node)) return false
  return true
}

/** 右→左验证：key 段命中后，向左回溯祖先链 */
export function chainMatches(rule: CseRule, ancestors: AncestorChain, self: MatchContext): boolean {
  const { segments, combinators } = rule.chain
  const last = segments.length - 1
  if (!segmentMatches(segments[last]!, self)) return false
  let ai = ancestors.length - 1
  for (let i = last - 1; i >= 0; i--) {
    const comb = combinators[i] ?? ' '
    if (comb === '>') {
      if (ai < 0 || !segmentMatches(segments[i]!, ancestors[ai]!)) return false
      ai--
    } else {
      let found = false
      while (ai >= 0) {
        if (segmentMatches(segments[i]!, ancestors[ai]!)) {
          found = true
          ai--
          break
        }
        ai--
      }
      if (!found) return false
    }
  }
  return true
}

/**
 * 规则索引（Step 2）：按最右段分桶。
 * · 最右段有 id ⇒ 只进 id 桶（最精确，不再进类/标签桶——避免同一规则多次命中）
 * · 否则有类 ⇒ 逐类进类桶
 * · 否则有 tag ⇒ 标签桶
 * · 纯通配/纯伪类（如 `*` / `:first-child`）⇒ universal 桶（每个节点都要看）
 */
export interface RuleIndex {
  byId: Map<string, CseRule[]>
  byClass: Map<string, CseRule[]>
  byTag: Map<string, CseRule[]>
  universal: CseRule[]
}

export function buildIndex(rules: CseRule[]): RuleIndex {
  const byId = new Map<string, CseRule[]>()
  const byClass = new Map<string, CseRule[]>()
  const byTag = new Map<string, CseRule[]>()
  const universal: CseRule[] = []
  const push = (m: Map<string, CseRule[]>, k: string, r: CseRule): void => {
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  for (const r of rules) {
    const key = r.chain.segments[r.chain.segments.length - 1]!
    if (key.id !== undefined) {
      push(byId, key.id, r)
      continue
    }
    if (key.classes.length > 0) {
      for (const c of key.classes) push(byClass, c, r)
      continue
    }
    if (key.tag !== undefined) {
      push(byTag, key.tag, r)
      continue
    }
    universal.push(r)
  }
  return { byId, byClass, byTag, universal }
}

/** 取节点的候选规则（桶并集；按 order 去重排序——层叠需要稳定序） */
export function candidatesFor(index: RuleIndex, ctx: MatchContext): CseRule[] {
  const out: CseRule[] = []
  const seen = new Set<CseRule>()
  const add = (r: CseRule): void => {
    if (seen.has(r)) return
    seen.add(r)
    out.push(r)
  }
  if (ctx.id !== undefined) for (const r of index.byId.get(ctx.id) ?? []) add(r)
  for (const c of ctx.classes) for (const r of index.byClass.get(c) ?? []) add(r)
  for (const r of index.byTag.get(ctx.tag) ?? []) add(r)
  for (const r of index.universal) add(r)
  out.sort((a, b) => a.order - b.order)
  return out
}

/** 由 CseNode 生成匹配上下文（父级维护的兄弟序由调用方传入） */
export function contextOf(node: CseNode, index: number, count: number, isRoot = false): MatchContext {
  const ctx: MatchContext = { classes: new Set(node.classes), tag: node.tag, index, count }
  if (node.id !== undefined) ctx.id = node.id
  if (isRoot) ctx.isRoot = true
  return ctx
}

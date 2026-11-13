/**
 * packages/studio/ui/src/symbolMatch.ts —— 结构大纲的**匹配算法**单一真源（决策 #1499）
 *
 * 【承接 #1491 的诚实边界】原来只做 `name/kind` 连续子串，`useAutoSave` 搜 `uas`
 *   一个都搜不到。IDE 里查符号的标准手感是「打缩写也能命中」，所以补两类：
 *     · 词首缩写：`useAutoSave` → `uas`、`BridgeState` → `bs`、`MAX_BYTES` → `mb`；
 *     · 子序列：`Stats` 搜 `ss` 也能命中（按序、允许跳字符）。
 *
 * 【★★为什么必须「只取最高档」】连续子串命中存在时，子序列几乎一定能多命中一批
 *   —— 例如搜 `sym1`，`sym21` 是 `s,y,m,2,1` 的子序列却**不含** `sym1` 这个串。
 *   若把三档结果混在一起显示，用户搜一个明确存在的串反而被一堆不相干的项淹没，
 *   既有判据 ㊿t 的「过滤后全部含 sym1」也会立刻翻红。
 *   ⇒ 取全表最高档：有精确命中就只显示精确命中，没有才逐级放宽。
 *
 * 【为什么抽纯函数】匹配口径既要被面板用、又要被单测钉死；留在 .vue 的 computed 里
 *   只能靠浏览器门禁间接验，`uas` / `mb` 这类词形边界很难构造反例。
 */

export type SymbolLike = { name: string; kind: string }

/**
 * 分词：驼峰边界 + 连续大写词尾 + 非字母数字分隔符。
 * `XMLHttpRequest` → ['XML','Http','Request']；`MAX_BYTES` → ['MAX','BYTES']。
 */
export function symbolWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

/** 词首缩写（小写）：`useAutoSave` → 'uas'，`MAX_BYTES` → 'mb' */
export function symbolAbbr(name: string): string {
  return symbolWords(name)
    .map((w) => w[0])
    .join('')
    .toLowerCase()
}

/** needle 是否为 text 的子序列（按序、可跳字符） */
function isSubsequence(text: string, needle: string): boolean {
  if (!needle) return true
  let i = 0
  for (const ch of text) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

/** 0=不命中 · 1=子序列 · 2=词首缩写 · 3=连续子串（name 或 kind） */
export type MatchRank = 0 | 1 | 2 | 3

export function symbolMatchRank(row: SymbolLike, q: string): MatchRank {
  const needle = q.trim().toLowerCase()
  if (!needle) return 3
  const name = row.name.toLowerCase()
  if (name.includes(needle) || row.kind.toLowerCase().includes(needle)) return 3
  if (symbolAbbr(row.name).includes(needle)) return 2
  if (isSubsequence(name, needle)) return 1
  return 0
}

/**
 * 过滤：保持**输入顺序**（面板随后按 kind 分组、组内按行号排），只保留最高档命中项。
 * 空查询直接返回原数组，与 #1491 的「副标题显示总数 / 导出数」口径一致。
 */
export function filterSymbols<T extends SymbolLike>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  let best: MatchRank = 0
  const ranks = rows.map((r) => {
    const rank = symbolMatchRank(r, q)
    if (rank > best) best = rank
    return rank
  })
  if (best === 0) return []
  return rows.filter((_, i) => ranks[i] === best)
}

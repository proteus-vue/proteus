// website/scripts/lib/content-shrink.mjs
// ★★★#1125：**文档"内容缩水"门禁**——记录每页关键区块规模，下降即红。
//
// 【为什么需要（前几轮反复挖出同一形态）】
//   #1123 挖出 5 个生成器缺陷、#1124 挖出 2 个，**共同形态都是"文档静默变少或变空"**：
//     · 拆文件 ⇒ 源集合找不到 ⇒ 参数表整段消失（fetch.md 被删 38 行）
//     · 函数型属性被当方法跳过 ⇒ onChunk 消失
//     · 结果类型名写死 ⇒ `data` 类型变空
//     · readonly 不支持 ⇒ AbortSignalLike 属性表消失
//   ★而 `check:content` **只能比"文档与当前生成器是否一致"**——
//     生成器自己退化了，它照样说"一致"（两边都少）。
//     ⇒ 必须有一条**独立于生成器逻辑**的判据：记住"上次这些页有多大"，变小就红。
//
// 【判据设计（克制，避免假红）】
//   · 只统计**结构性规模**（表格行数 / h2-h4 小节数 / 代码块数 / 非空正文行数），不看具体文字
//     ⇒ 文案改写不触发，只有"结构变少"才触发；
//   · **只对"减少"敏感**：增长永远合法（补内容不该被拦）；
//   · 阈值：任一指标比基线少 **>10% 且绝对值 >2** 才判红 ⇒ 容忍个别行调整；
//   · 基线随生成**自动更新**（只在"没有减少"时写回），不需要人维护。
//
// 【★为什么基线要自动更新】84 个能力页 + 78 个组件页，手维护基线必然腐化（本仓"表腐化后静默失效"的教训）。

/** 统计一个 markdown 文档的结构性规模。 */
export function measureDoc(content) {
  let inFence = false
  let tableRows = 0
  let headings = 0
  let codeBlocks = 0
  let bodyLines = 0
  for (const line of String(content).split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      codeBlocks += 1
      continue
    }
    if (inFence) continue
    if (/^\s*\|/.test(line)) { tableRows += 1; continue }
    if (/^#{2,4}\s+/.test(line)) { headings += 1; continue }
    if (line.trim()) bodyLines += 1
  }
  return { tableRows, headings, codeBlocks, bodyLines }
}

/** 两个度量的差值（正数 = 缩水）。 */
export function shrinkOf(prev, now) {
  return {
    tableRows: (prev.tableRows ?? 0) - (now.tableRows ?? 0),
    headings: (prev.headings ?? 0) - (now.headings ?? 0),
    codeBlocks: (prev.codeBlocks ?? 0) - (now.codeBlocks ?? 0),
    bodyLines: (prev.bodyLines ?? 0) - (now.bodyLines ?? 0),
  }
}

/**
 * 是否构成"实质性缩水"。
 *
 * @param {object} prev 基线度量
 * @param {object} now  本次度量
 * @param {{minAbs?:number, ratio?:number}} [opts] 默认：绝对差 >2 且相对 >10%
 * @returns {{shrunk:boolean, fields:string[], detail:string}}
 */
export function judgeShrink(prev, now, opts = {}) {
  const minAbs = opts.minAbs ?? 2
  const ratio = opts.ratio ?? 0.10
  const d = shrinkOf(prev, now)
  const fields = []
  const parts = []
  for (const [k, v] of Object.entries(d)) {
    const base = prev[k] ?? 0
    if (v <= minAbs) continue          // 小幅波动容忍
    if (base > 0 && v / base <= ratio) continue   // 未超 10% 容忍
    fields.push(k)
    parts.push(`${k} ${base}→${now[k] ?? 0}（-${v}）`)
  }
  return { shrunk: fields.length > 0, fields, detail: parts.join('，') }
}

/** 合并基线：**只允许增长**（任一指标变小则保留旧值，避免把缩水写成新基线）。 */
export function mergeBaseline(prev, now) {
  if (!prev) return { ...now }
  const out = { ...prev }
  for (const k of Object.keys(now)) out[k] = Math.max(prev[k] ?? 0, now[k] ?? 0)
  return out
}

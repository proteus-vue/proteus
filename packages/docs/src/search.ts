// packages/docs/src/search.ts
// ★搜索索引：多文档 Docs IR → 扁平索引条目（heading 锚点条目 + 段落条目）
//   构建期产物（search-index.json），客户端懒加载 + 子串评分（免 Fuse 依赖也可用）
import type { MdBlock, DocsDocument, SearchIndexEntry, InlineNode } from './types'
import { inlineToText } from './inline'

function blocksOf(doc: DocsDocument | MdBlock[]): MdBlock[] {
  return Array.isArray(doc) ? doc : doc.blocks
}

/** 文本提取（段落取正文、标题取文字） */
function headingOf(blocks: MdBlock[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const b = blocks[i]
    if (b.type === 'heading') return b.text
  }
  return ''
}

function inlineText(nodes: InlineNode[]): string {
  return inlineToText(nodes)
}

/** ★构建搜索索引（cap 文本长度防超长条目；textCap 可配——站点按体积权衡） */
export function buildSearchIndex(pages: Array<{ path: string; doc: DocsDocument | MdBlock[] }>, opts: { textCap?: number } = {}): SearchIndexEntry[] {
  const textCap = opts.textCap ?? 200
  const entries: SearchIndexEntry[] = []
  for (const page of pages) {
    const blocks = blocksOf(page.doc)
    blocks.forEach((b, idx) => {
      if (b.type === 'heading') {
        entries.push({ path: page.path, anchor: b.id, heading: b.text, text: b.text })
      } else if (b.type === 'paragraph') {
        const text = inlineText(b.inline)
        if (text.trim() !== '') {
          entries.push({ path: page.path, anchor: '', heading: headingOf(blocks, idx), text: text.slice(0, textCap) })
        }
      }
    })
  }
  return entries
}

/** 客户端检索（★#442：多词 AND 分词 + 命中加权；免依赖——对齐 VitePress 本地搜索语义）
 *   query 空格分词：每词必须在标题或正文命中（AND）；分数 = Σ(词命中次数 × 命中区权重)；
 *   标题命中词权重 2、正文 1；标题条目（anchor=='' 段落）基础分 1/2——标题命中优先于正文命中 */
export function searchDocs(index: readonly SearchIndexEntry[], query: string, cap = 20): SearchIndexEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const scored = index
    .map((e) => {
      const isHeadingEntry = e.anchor !== ''
      const heading = e.heading.toLowerCase()
      // 段落条目有正文（text 为 cap 摘要）；标题条目 text 即自身标题（不重复计）
      const body = isHeadingEntry ? '' : e.text.toLowerCase()
      let score = 0
      for (const term of terms) {
        // 每词必须在标题或正文命中（AND）——缺失任一 → 跳过
        const inHeading = countHits(heading, term) * 2
        const inBody = countHits(body, term)
        if (inHeading === 0 && inBody === 0) return null
        score += inHeading + inBody
      }
      // 标题条目本身命中（章节标题含词）——额外加权，搜索结果优先指向章节
      if (isHeadingEntry && terms.some((t) => heading.includes(t))) score += 2
      return { e, score }
    })
    .filter((x): x is { e: SearchIndexEntry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, cap).map((x) => x.e)
}

function countHits(haystack: string, term: string): number {
  let n = 0
  let pos = haystack.indexOf(term)
  while (pos >= 0) {
    n++
    pos = haystack.indexOf(term, pos + term.length)
  }
  return n
}

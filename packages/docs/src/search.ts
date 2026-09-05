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

/** 客户端检索（子串评分：命中数 × 权重；免依赖） */
export function searchDocs(index: readonly SearchIndexEntry[], query: string, cap = 20): SearchIndexEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const scored = index
    .map((e) => {
      const hay = `${e.heading} ${e.text}`.toLowerCase()
      let score = 0
      let pos = hay.indexOf(q)
      while (pos >= 0) {
        score += e.anchor === '' ? 1 : 2 // 标题条目权重高
        pos = hay.indexOf(q, pos + q.length)
      }
      if (e.heading.toLowerCase().includes(q)) score += 2
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, cap).map((x) => x.e)
}

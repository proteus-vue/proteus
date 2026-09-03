// packages/docs/src/blocks.ts
// ★块级解析（docs 子集）：标题/段落/代码围栏/列表（一层嵌套）/表格/引用/分隔线
//   零依赖行扫描——内容源为框架自有文档，子集可控（诚实边界：不覆盖 CommonMark 全集）
import type { MdBlock, ListItem, TableAlign, HeadingBlock, InlineNode } from './types'
import { parseInline, inlineToText } from './inline'

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const FENCE_OPEN_RE = /^```(\w+)?(?:\s+(.+))?$/
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,})\s*$/
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+\.)\s+(.+)$/
const TABLE_ROW_RE = /^\s*\|.+\|\s*$/
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/

/** 锚点 id：kebab 化（中文保留）+ 去重 */
export function slugify(text: string, taken: Set<string>): string {
  let base = text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[`*_[\]()#]/g, '')
    .replace(/[^\p{L}\p{N}-]/gu, '')
  if (base === '') base = 'section'
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function parseTableAlign(sepLine: string): TableAlign[] {
  return splitTableRow(sepLine).map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center' as const
    if (right) return 'right' as const
    if (left) return 'left' as const
    return null
  })
}

/** ★块级解析：Markdown 源 → Docs IR 块数组 */
export function parseBlocks(source: string): MdBlock[] {
  const lines = source.split('\n')
  const blocks: MdBlock[] = []
  const takenIds = new Set<string>()
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // —— 空行跳过 ——
    if (line.trim() === '') {
      i++
      continue
    }

    // —— 代码围栏 ——
    const fence = line.match(FENCE_OPEN_RE)
    if (fence) {
      const lang = fence[1] ?? ''
      const meta = (fence[2] ?? '').trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过闭合 ```
      blocks.push({ type: 'code', lang, meta, code: codeLines.join('\n') })
      continue
    }

    // —— 分隔线 ——
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // —— 标题 ——
    const heading = line.match(HEADING_RE)
    if (heading) {
      const depth = heading[1].length as HeadingBlock['depth']
      const text = heading[2].trim()
      const inline = parseInline(text)
      blocks.push({ type: 'heading', depth, id: slugify(inlineToText(inline), takenIds), text, inline })
      i++
      continue
    }

    // —— 表格（当前行含 | 且下一行是分隔行）——
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitTableRow(line).map((c) => parseInline(c))
      const align = parseTableAlign(lines[i + 1])
      i += 2
      const rows: InlineNode[][][] = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]).map((c) => parseInline(c)))
        i++
      }
      blocks.push({ type: 'table', header, align, rows })
      continue
    }

    // —— 引用 ——
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoteLines.join('\n')) })
      continue
    }

    // —— 列表（含一层嵌套）——
    const listItem = line.match(LIST_ITEM_RE)
    if (listItem) {
      const ordered = /\d+\./.test(listItem[2])
      const items: ListItem[] = []
      let baseIndent = listItem[1].length
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM_RE)
        if (m) {
          const indent = m[1].length
          if (indent <= baseIndent) {
            items.push({ inline: parseInline(m[3]), children: [] })
            baseIndent = Math.min(baseIndent, indent)
            i++
            continue
          }
          // 嵌套项（缩进更深）→ 归入上一 item 的 children
          if (items.length > 0) {
            items[items.length - 1].children.push({ inline: parseInline(m[3]), children: [] })
            i++
            continue
          }
        }
        // 嵌套列表块（缩进列表项续行——子列表的子项已在上方处理；空行后非列表 → 结束）
        if (lines[i].trim() === '' && i + 1 < lines.length && LIST_ITEM_RE.test(lines[i + 1])) {
          i++
          continue
        }
        break
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // —— 段落（累积至空行/块级起始）——
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (
        l.trim() === '' ||
        HEADING_RE.test(l) ||
        FENCE_OPEN_RE.test(l) ||
        HR_RE.test(l) ||
        LIST_ITEM_RE.test(l) ||
        (TABLE_ROW_RE.test(l) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) ||
        l.startsWith('>')
      ) {
        break
      }
      paraLines.push(l.trim())
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', inline: parseInline(paraLines.join(' ')) })
    } else {
      i++ // 防御：无法归类的行跳过（不卡死）
    }
  }

  return blocks
}

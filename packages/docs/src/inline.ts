// packages/docs/src/inline.ts
// ★行内解析（docs 子集）：`code` / **strong** / *em* / [link](href) / ![image](src) / 裸文本
//   零依赖手写 tokenizer（单遍扫描 + 优先级：code > image > link > strong > em）
import type { InlineNode } from './types'

interface TokenMatch {
  type: 'code' | 'image' | 'link' | 'strong' | 'em'
  start: number
  end: number
  value: string
  extra?: string
}

const CODE_RE = /`([^`]+)`/g
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g
const STRONG_RE = /\*\*([^*]+)\*\*/g
const EM_RE = /\*([^*\n]+)\*/g

function findFirst(text: string): TokenMatch | null {
  let best: TokenMatch | null = null
  const probe = (re: RegExp, type: TokenMatch['type'], build: (m: RegExpExecArray) => TokenMatch): void => {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m && (best === null || m.index < best.start)) best = build(m)
  }
  probe(CODE_RE, 'code', (m) => ({ type: 'code', start: m.index, end: m.index + m[0].length, value: m[1] }))
  probe(IMAGE_RE, 'image', (m) => ({ type: 'image', start: m.index, end: m.index + m[0].length, value: m[1], extra: m[2] }))
  probe(LINK_RE, 'link', (m) => ({ type: 'link', start: m.index, end: m.index + m[0].length, value: m[1], extra: m[2] }))
  probe(STRONG_RE, 'strong', (m) => ({ type: 'strong', start: m.index, end: m.index + m[0].length, value: m[1] }))
  probe(EM_RE, 'em', (m) => ({ type: 'em', start: m.index, end: m.index + m[0].length, value: m[1] }))
  return best
}

/** ★行内解析：mixed 文本 → InlineNode 树（嵌套 strong/em/link 内部递归） */
export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let rest = text
  while (rest.length > 0) {
    const m = findFirst(rest)
    if (!m) {
      out.push({ type: 'text', value: rest })
      break
    }
    if (m.start > 0) out.push({ type: 'text', value: rest.slice(0, m.start) })
    const after = rest.slice(m.end)
    if (m.type === 'code') {
      out.push({ type: 'code', value: m.value })
    } else if (m.type === 'image') {
      out.push({ type: 'image', alt: m.value, href: m.extra ?? '' })
    } else if (m.type === 'link') {
      out.push({ type: 'link', href: m.extra ?? '', children: parseInline(m.value) })
    } else if (m.type === 'strong') {
      out.push({ type: 'strong', children: parseInline(m.value) })
    } else {
      out.push({ type: 'em', children: parseInline(m.value) })
    }
    rest = after
  }
  return out
}

/** 纯文本提取（TOC/搜索用——剥掉行内标记只留文字） */
export function inlineToText(nodes: InlineNode[]): string {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text') out += n.value
    else if (n.type === 'code') out += n.value
    else if (n.type === 'image') out += n.alt
    else out += inlineToText(n.children)
  }
  return out
}

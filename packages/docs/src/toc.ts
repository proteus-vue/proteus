// packages/docs/src/toc.ts
// ★TOC 生成：标题块 → 平铺/嵌套目录（深度范围可配，缺省 h2-h3）
import type { MdBlock, TocEntry, TocFlatEntry, HeadingBlock } from './types'

function isHeading(b: MdBlock): b is HeadingBlock {
  return b.type === 'heading'
}

/** 平铺 TOC（depth 范围过滤） */
export function flatToc(blocks: MdBlock[], opts: { minDepth?: number; maxDepth?: number } = {}): TocFlatEntry[] {
  const min = opts.minDepth ?? 2
  const max = opts.maxDepth ?? 3
  return blocks
    .filter(isHeading)
    .filter((h) => h.depth >= min && h.depth <= max)
    .map((h) => ({ depth: h.depth, text: h.text, id: h.id }))
}

/** 嵌套 TOC 树（h2 为顶层节点，h3 挂其 children；更深层按最近上级归属） */
export function buildToc(blocks: MdBlock[], opts: { minDepth?: number; maxDepth?: number } = {}): TocEntry[] {
  const flat = flatToc(blocks, opts)
  const tree: TocEntry[] = []
  const stack: TocEntry[] = []

  for (const e of flat) {
    const node: TocEntry = { ...e, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].depth >= e.depth) stack.pop()
    if (stack.length === 0) tree.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return tree
}

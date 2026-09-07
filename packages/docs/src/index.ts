// packages/docs/src/index.ts —— @proteus-vue/docs 公共入口（文档引擎：Markdown → Docs IR → HTML/SFC）
// 第九次泛化叙事：文档内容语义化（Markdown → Docs IR → 渲染）与编译/渲染同构；产出 SFC 直喂框架编译器
import { parseFrontmatter } from './frontmatter'
import { parseBlocks } from './blocks'
import type { DocsDocument } from './types'

export { parseFrontmatter } from './frontmatter'
export { parseBlocks, slugify } from './blocks'
export { parseInline, inlineToText } from './inline'
export { highlight, escapeHtml } from './highlight'
export { flatToc, buildToc } from './toc'
export { renderDocHtml, toSfc } from './render'
export { buildSearchIndex, searchDocs } from './search'

/** ★一键解析：Markdown 源 → DocsDocument（frontmatter + blocks） */
export function parseMarkdown(source: string): DocsDocument {
  const { data, body } = parseFrontmatter(source)
  return { frontmatter: data, blocks: parseBlocks(body) }
}

export type {
  InlineNode,
  MdBlock,
  HeadingBlock,
  ParagraphBlock,
  CodeBlock,
  ListBlock,
  TableBlock,
  BlockquoteBlock,
  HrBlock,
  ListItem,
  TableAlign,
  TocEntry,
  TocFlatEntry,
  SearchIndexEntry,
} from './types'

// packages/docs/src/types.ts
// ★文档引擎核心类型（Docs IR——Markdown → 语义块 AST，可序列化）
// 零依赖纯逻辑（内容源为框架自有文档，解析覆盖 docs 子集——诚实边界）

// ============================================================
// 行内节点（Inline）
// ============================================================

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'image'; alt: string; href: string }

// ============================================================
// 块级节点（Block——Docs IR）
// ============================================================

export interface HeadingBlock {
  type: 'heading'
  depth: 1 | 2 | 3 | 4 | 5 | 6
  /** 锚点 id（kebab 化 + 去重——TOC/URL 定位） */
  id: string
  text: string
  inline: InlineNode[]
}

export interface ParagraphBlock {
  type: 'paragraph'
  inline: InlineNode[]
}

export interface CodeBlock {
  type: 'code'
  lang: string
  /** 围栏标注（```ts title=... 的 extra 部分） */
  meta: string
  code: string
}

export interface ListItem {
  inline: InlineNode[]
  /** 嵌套子列表（一层嵌套——docs 子集） */
  children: ListItem[]
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: ListItem[]
}

export type TableAlign = 'left' | 'center' | 'right' | null

export interface TableBlock {
  type: 'table'
  header: InlineNode[][]
  align: TableAlign[]
  rows: InlineNode[][][]
}

export interface BlockquoteBlock {
  type: 'blockquote'
  children: MdBlock[]
}

export interface HrBlock {
  type: 'hr'
}

export type MdBlock =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | ListBlock
  | TableBlock
  | BlockquoteBlock
  | HrBlock

// ============================================================
// 文档
// ============================================================

export interface DocsDocument {
  /** frontmatter 键值（YAML-lite：key: value / key: [a, b]，值做布尔/数字/去引号归一） */
  frontmatter: Record<string, string | number | boolean | string[]>
  blocks: MdBlock[]
}

// ============================================================
// TOC
// ============================================================

export interface TocEntry {
  readonly depth: number
  readonly text: string
  readonly id: string
  readonly children: TocEntry[]
}

export interface TocFlatEntry {
  readonly depth: number
  readonly text: string
  readonly id: string
}

// ============================================================
// 搜索索引
// ============================================================

export interface SearchIndexEntry {
  readonly path: string
  /** 锚点（heading 级）；段落为 '' */
  readonly anchor: string
  /** 标题（heading 级）或所属最近 heading 文本 */
  readonly heading: string
  readonly text: string
}

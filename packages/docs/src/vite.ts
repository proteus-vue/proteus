// packages/docs/src/vite.ts
// ★文档引擎 B2：vite 插件——.md import → Vue 组件虚拟模块
//   `import doc from './guide.md'` → { frontmatter, title, html, toc, tocFlat, searchEntries }
//   （构建期用文档引擎解析/渲染/建索引——站点组件侧只做 v-html + TOC 渲染，零运行时解析）
//   ?raw 后缀走 vite 原生 raw（不拦截）
import type { Plugin } from 'vite'
import { parseMarkdown } from './index'
import { buildSearchIndex } from './search'
import { renderDocHtml } from './render'
import { buildToc, flatToc } from './toc'

export interface DocsVitePluginOptions {
  /** TOC 深度范围（缺省 h2-h3） */
  tocMinDepth?: number
  tocMaxDepth?: number
  /** ★#415 端指令解析器：frontmatter.ends（机制名）→ 逐端表（端/状态来自端注册表 SSOT）；未注入则忽略 ends 指令 */
  resolveEnds?: (spec: string) => Array<{ id: string; name: string; status: string; note: string }> | undefined
}

export interface DocsModule {
  frontmatter: Record<string, string | number | boolean | string[]>
  title: string
  html: string
  toc: Array<{ depth: number; text: string; id: string; children: unknown[] }>
  tocFlat: Array<{ depth: number; text: string; id: string }>
  searchEntries: Array<{ anchor: string; text: string }>
  /** ★#440 全文搜索索引条目（段落级——客户端 searchDocs 消费；行内 code 与链接文本纳入） */
  searchIndex: Array<{ anchor: string; heading: string; text: string }>
  /** ★#415 端指令展开：ends 指令注入的端表（frontmatter.ends 存在时） */
  ends?: Array<{ id: string; name: string; status: string; note: string }>
}

/** md 源码 → 组件模块 JS 代码（transform 用） */
export function mdToModule(mdSource: string, id: string, options: DocsVitePluginOptions = {}): string {
  const doc = parseMarkdown(mdSource)
  const html = renderDocHtml(doc)
  const toc = buildToc(doc.blocks, { minDepth: options.tocMinDepth ?? 2, maxDepth: options.tocMaxDepth ?? 3 })
  const tocFlat = flatToc(doc.blocks, { minDepth: options.tocMinDepth ?? 2, maxDepth: options.tocMaxDepth ?? 3 })
  const title = typeof doc.frontmatter.title === 'string' ? doc.frontmatter.title : tocFlat[0]?.text ?? ''
  const searchEntries = tocFlat.map((t) => ({ anchor: t.id, text: t.text }))
  // ★#440 全文搜索：段落级索引（heading 锚点 + 归属标题 + 正文 cap 90——体积权衡，客户端 searchDocs 子串评分）
  const searchIndex = buildSearchIndex([{ path: id, doc }], { textCap: 90 }).map((e) => ({ anchor: e.anchor, heading: e.heading, text: e.text }))
  // ★#415 端指令展开：frontmatter.ends = 机制名 → 逐端说明（端/状态取 ends.ts SSOT，说明按机制注入）——
  //   手写页的端表与组件/能力页兼容表同构，且状态零漂移（SSOT 单源）
  const endsSpec = typeof doc.frontmatter.ends === 'string' ? doc.frontmatter.ends : ''
  const ends = options.resolveEnds && endsSpec ? options.resolveEnds(endsSpec) : undefined

  return [
    `// 由 @proteus-vue/docs vite 插件生成（源：${JSON.stringify(id)}）`,
    `const frontmatter = ${JSON.stringify(doc.frontmatter)}`,
    `const title = ${JSON.stringify(title)}`,
    `const html = ${JSON.stringify(html)}`,
    `const toc = ${JSON.stringify(toc)}`,
    `const tocFlat = ${JSON.stringify(tocFlat)}`,
    `const searchEntries = ${JSON.stringify(searchEntries)}`,
    `const searchIndex = ${JSON.stringify(searchIndex)}`,
    `const ends = ${JSON.stringify(ends)}`,
    `export { frontmatter, title, html, toc, tocFlat, searchEntries, searchIndex, ends }`,
    `export default { frontmatter, title, html, toc, tocFlat, searchEntries, searchIndex, ends }`,
    ``,
  ].join('\n')
}

/** ★@proteus-vue/docs vite 插件：.md → 组件虚拟模块（dev/build 通吃） */
export function docsMdPlugin(options: DocsVitePluginOptions = {}): Plugin {
  return {
    name: 'proteus-docs-md',
    enforce: 'pre',
    transform(code, id) {
      const [file, query] = id.split('?')
      if (!file.endsWith('.md') || query === 'raw') return null
      return {
        code: mdToModule(code, id, options),
        map: null,
      }
    },
  }
}

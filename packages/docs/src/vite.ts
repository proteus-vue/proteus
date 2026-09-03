// packages/docs/src/vite.ts
// ★文档引擎 B2：vite 插件——.md import → Vue 组件虚拟模块
//   `import doc from './guide.md'` → { frontmatter, title, html, toc, tocFlat, searchEntries }
//   （构建期用文档引擎解析/渲染/建索引——站点组件侧只做 v-html + TOC 渲染，零运行时解析）
//   ?raw 后缀走 vite 原生 raw（不拦截）
import type { Plugin } from 'vite'
import { parseMarkdown } from './index'
import { renderDocHtml } from './render'
import { buildToc, flatToc } from './toc'

export interface DocsVitePluginOptions {
  /** TOC 深度范围（缺省 h2-h3） */
  tocMinDepth?: number
  tocMaxDepth?: number
}

export interface DocsModule {
  frontmatter: Record<string, string | number | boolean | string[]>
  title: string
  html: string
  toc: Array<{ depth: number; text: string; id: string; children: unknown[] }>
  tocFlat: Array<{ depth: number; text: string; id: string }>
  searchEntries: Array<{ anchor: string; text: string }>
}

/** md 源码 → 组件模块 JS 代码（transform 用） */
export function mdToModule(mdSource: string, id: string, options: DocsVitePluginOptions = {}): string {
  const doc = parseMarkdown(mdSource)
  const html = renderDocHtml(doc)
  const toc = buildToc(doc.blocks, { minDepth: options.tocMinDepth ?? 2, maxDepth: options.tocMaxDepth ?? 3 })
  const tocFlat = flatToc(doc.blocks, { minDepth: options.tocMinDepth ?? 2, maxDepth: options.tocMaxDepth ?? 3 })
  const title = typeof doc.frontmatter.title === 'string' ? doc.frontmatter.title : tocFlat[0]?.text ?? ''
  const searchEntries = tocFlat.map((t) => ({ anchor: t.id, text: t.text }))

  return [
    `// 由 @proteus-vue/docs vite 插件生成（源：${JSON.stringify(id)}）`,
    `const frontmatter = ${JSON.stringify(doc.frontmatter)}`,
    `const title = ${JSON.stringify(title)}`,
    `const html = ${JSON.stringify(html)}`,
    `const toc = ${JSON.stringify(toc)}`,
    `const tocFlat = ${JSON.stringify(tocFlat)}`,
    `const searchEntries = ${JSON.stringify(searchEntries)}`,
    `export { frontmatter, title, html, toc, tocFlat, searchEntries }`,
    `export default { frontmatter, title, html, toc, tocFlat, searchEntries }`,
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

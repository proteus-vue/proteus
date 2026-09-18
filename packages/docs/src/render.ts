// packages/docs/src/render.ts
// ★渲染器：Docs IR → HTML（docs-* 语义类）/ → Vue SFC（可直接喂框架编译器 compileVueSfc）
//   转义铁律：所有文本节点先 escapeHtml；代码块高亮输出已转义 span；SFC 模式 v-pre 防插值误伤 + {{ }} 实体化
import type { DocsDocument, MdBlock, InlineNode } from './types'
import { escapeHtml, highlight } from './highlight'

function renderInline(nodes: InlineNode[], sfc: boolean): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += sfc ? escapeHtml(n.value).replace(/\{\{/g, '&#123;').replace(/\}\}/g, '&#125;') : escapeHtml(n.value)
        break
      case 'code':
        out += `<code class="docs-inline-code">${escapeHtml(n.value)}</code>`
        break
      case 'strong':
        out += `<strong>${renderInline(n.children, sfc)}</strong>`
        break
      case 'em':
        out += `<em>${renderInline(n.children, sfc)}</em>`
        break
      case 'link':
        out += `<a href="${escapeHtml(n.href)}">${renderInline(n.children, sfc)}</a>`
        break
      case 'image':
        out += `<img src="${escapeHtml(n.href)}" alt="${escapeHtml(n.alt)}" />`
        break
    }
  }
  return out
}

function renderBlock(block: MdBlock, sfc: boolean): string {
  switch (block.type) {
    case 'heading': {
      const text = renderInline(block.inline, sfc)
      return `<h${block.depth} id="${escapeHtml(block.id)}" class="docs-h docs-h${block.depth}">${text}</h${block.depth}>`
    }
    case 'paragraph':
      return `<p class="docs-p">${renderInline(block.inline, sfc)}</p>`
    case 'code': {
      // v-pre：Vue 模板编译跳过内部 {{ }}（md 代码示例常含模板语法）
      const pre = `<pre class="docs-code" data-lang="${escapeHtml(block.lang)}"${sfc ? ' v-pre' : ''}><code>${highlight(block.code, block.lang)}</code></pre>`
      return sfc ? `<DocsCode lang="${escapeHtml(block.lang)}" code="${escapeHtml(block.code)}">${pre}</DocsCode>` : pre
    }
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const items = block.items
        .map((item) => {
          const inner = `<span class="docs-li-text">${renderInline(item.inline, sfc)}</span>`
          const nested = item.children.length > 0 ? `<${tag} class="docs-sublist">${item.children.map((c) => `<li>${renderInline(c.inline, sfc)}</li>`).join('')}</${tag}>` : ''
          return `<li>${inner}${nested}</li>`
        })
        .join('')
      return `<${tag} class="docs-list">${items}</${tag}>`
    }
    case 'table': {
      const head = `<thead><tr>${block.header.map((c) => `<th>${renderInline(c, sfc)}</th>`).join('')}</tr></thead>`
      const body = `<tbody>${block.rows.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c, sfc)}</td>`).join('')}</tr>`).join('')}</tbody>`
      return `<table class="docs-table">${head}${body}</table>`
    }
    case 'blockquote':
      return `<blockquote class="docs-quote">${renderBlocks(block.children, sfc)}</blockquote>`
    case 'hr':
      return '<hr class="docs-hr" />'
  }
}

function renderBlocks(blocks: MdBlock[], sfc: boolean): string {
  return blocks.map((b) => renderBlock(b, sfc)).join('\n')
}

/** ★Docs IR → HTML（SPA 直接 v-html / 静态站直出；输出已转义防注入） */
export function renderDocHtml(doc: DocsDocument): string {
  return renderBlocks(doc.blocks, false)
}

/**
 * ★Docs IR → Vue SFC（官网文档页产物——直接喂框架编译器 compileVueSfc / mountWebComponent）
 * - 代码块包 <DocsCode lang code>（站点侧提供高亮组件；v-pre 防模板插值误伤）
 * - 段落文本 {{ }} 实体化（防 Vue 插值误解析）
 * - frontmatter.title 若存在 → 页面根 p-page 语义声明；★恒输出 <script setup>（SFC 合规——compileScript 必需）
 */
export function toSfc(doc: DocsDocument, opts: { componentName?: string } = {}): string {
  const name = opts.componentName ?? doc.frontmatter.title ?? 'DocsPage'
  const body = renderBlocks(doc.blocks, true)
  const title = typeof doc.frontmatter.title === 'string' ? doc.frontmatter.title : ''
  const open = title ? `  <p-page title="${escapeHtml(title)}">` : '  <div class="docs-page">'
  const close = title ? '  </p-page>' : '  </div>'
  return [
    `<!-- 由 @proteus-vue/docs generateSfc 生成（componentName: ${escapeHtml(typeof name === 'string' ? name : 'DocsPage')}） -->`,
    '<template>',
    open,
    body.replace(/^/gm, '  '),
    close,
    '</template>',
    '',
    '<script setup>',
    '// 文档页骨架（由文档引擎生成——交互区块由站点侧 DocsCode/组件注入）',
    '</script>',
    '',
  ].join('\n')
}

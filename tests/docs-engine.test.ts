// tests/docs-engine.test.ts
// ★官网 B2 文档引擎（@proteus-vue/docs）：Markdown → Docs IR → HTML/SFC
//   核心证据：md → toSfc → 框架编译器 compileVueSfc → mountWebComponent 真实渲染
//   「我们的文档是用我们自己的编译器编译的」（第九次泛化叙事——文档内容语义化）
// @vitest-environment happy-dom（mountWebComponent 真实渲染需要 DOM）
import { describe, it, expect } from 'vitest'
import {
  parseMarkdown,
  parseFrontmatter,
  parseBlocks,
  parseInline,
  inlineToText,
  highlight,
  escapeHtml,
  flatToc,
  buildToc,
  renderDocHtml,
  toSfc,
  buildSearchIndex,
  searchDocs,
  slugify,
} from '@proteus-vue/docs'
import { compileVueSfc } from '@proteus-vue/compiler'
import { mountWebComponent } from '@proteus-vue/test-core'

const SAMPLE_MD = [
  '---',
  'title: 快速开始',
  'tags:',
  '  - guide',
  '  - start',
  'version: 3',
  'published: true',
  '---',
  '',
  '# 快速开始',
  '',
  'Proteus 是**渲染引擎无关**的跨端框架，支持 `p-*` 语义组件。',
  '页面可写 {{ name }} 占位演示。',
  '',
  '## 安装',
  '',
  '```ts',
  'import { createApp } from "vue"',
  'const app = createApp({}) // 42 个组件',
  '```',
  '',
  '## 组件',
  '',
  '- p-grid 网格',
  '  - 支持 *自适应* 列数',
  '- p-stack 堆叠',
  '',
  '| 组件 | 说明 |',
  '| --- | --- |',
  '| [p-grid](/docs/grid) | 网格 |',
  '',
  '> 提示：先读 [原则](#原则) 再动手',
  '',
  '---',
  '',
  '完',
].join('\n')

describe('G-36/官网 B2 frontmatter（YAML-lite）', () => {
  it('键值归一（布尔/数字/去引号）+ 数组（块式/行内）', () => {
    const { data, body } = parseFrontmatter(SAMPLE_MD)
    expect(data.title).toBe('快速开始')
    expect(data.tags).toEqual(['guide', 'start'])
    expect(data.version).toBe(3)
    expect(data.published).toBe(true)
    expect(body.trim().startsWith('# 快速开始')).toBe(true) // frontmatter 结束围栏后的空行属正文

    const inline = parseFrontmatter('---\nlist: [a, b]\nflag: false\n---\nbody')
    expect(inline.data.list).toEqual(['a', 'b'])
    expect(inline.data.flag).toBe(false)
  })

  it('无 frontmatter → 空对象 + 原文；未闭合容错', () => {
    expect(parseFrontmatter('plain').data).toEqual({})
    expect(parseFrontmatter('---\ntitle: x').body).toBe('---\ntitle: x')
  })
})

describe('G-36/官网 B2 块级解析（Docs IR）', () => {
  const doc = parseMarkdown(SAMPLE_MD)

  it('标题块：深度/锚点 id（kebab + 中文保留）', () => {
    const headings = doc.blocks.filter((b) => b.type === 'heading')
    expect(headings.map((h) => (h as { id: string }).id)).toEqual(['快速开始', '安装', '组件'])
  })

  it('代码块：语言 + 原文保留（含引号/注释不丢失）', () => {
    const code = doc.blocks.find((b) => b.type === 'code') as { lang: string; code: string }
    expect(code.lang).toBe('ts')
    expect(code.code).toContain('createApp({}) // 42 个组件')
  })

  it('列表：ordered 检测 + 一层嵌套', () => {
    const list = doc.blocks.find((b) => b.type === 'list') as { ordered: boolean; items: Array<{ children: unknown[] }> }
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(2)
    expect(list.items[0].children).toHaveLength(1) // 嵌套项
  })

  it('表格：header/align/rows（含行内 link）', () => {
    const table = doc.blocks.find((b) => b.type === 'table') as { header: unknown[]; align: unknown[]; rows: Array<Array<Array<{ type: string; href?: string }>>> }
    expect(table.header).toHaveLength(2)
    expect(table.align).toEqual([null, null])
    expect(table.rows[0][0][0].type).toBe('link')
    expect(table.rows[0][0][0].href).toBe('/docs/grid')
  })

  it('引用 + 分隔线', () => {
    const quote = doc.blocks.find((b) => b.type === 'blockquote') as { children: Array<{ type: string }> }
    expect(quote.children[0].type).toBe('paragraph')
    expect(doc.blocks.some((b) => b.type === 'hr')).toBe(true)
  })

  it('行内解析：strong/code/link 嵌套 + 纯文本提取', () => {
    const nodes = parseInline('**加粗** 与 `代码` 以及 [链接](/x)')
    expect(nodes.map((n) => n.type)).toEqual(['strong', 'text', 'code', 'text', 'link'])
    expect(inlineToText(nodes)).toBe('加粗 与 代码 以及 链接')
  })

  it('slugify：去重后缀', () => {
    const taken = new Set<string>()
    expect(slugify('安装', taken)).toBe('安装')
    expect(slugify('安装', taken)).toBe('安装-2')
  })
})

describe('G-36/官网 B2 高亮器（零依赖 tokenizer）', () => {
  it('js/ts：关键字/字符串/注释/数字分类转义', () => {
    const html = highlight('const n = 42 // 注释\nconst s = "str"', 'ts')
    expect(html).toContain('<span class="docs-tok-keyword">const</span>')
    expect(html).toContain('<span class="docs-tok-number">42</span>')
    expect(html).toContain('<span class="docs-tok-comment">// 注释</span>')
    expect(html).toContain('<span class="docs-tok-string">&quot;str&quot;</span>')
  })

  it('bash + vue 标签 + 未知语言纯转义', () => {
    expect(highlight('npm run build', 'bash')).toContain('docs-tok-keyword')
    expect(highlight('<p-grid />', 'vue')).toContain('docs-tok-tag')
    expect(highlight('<script>alert(1)</script>', 'text')).toBe(escapeHtml('<script>alert(1)</script>'))
  })

  it('#386 vue/html 属性名 attr token + 闭合标签同 tag 色', () => {
    const html = highlight('<view wx:if="{{a}}" class="x">hi</view>', 'vue')
    // 属性名 → attr（wx:if / class）
    expect(html).toContain('<span class="docs-tok-attr">wx:if</span>')
    expect(html).toContain('<span class="docs-tok-attr">class</span>')
    // 属性值仍为 string
    expect(html).toContain('<span class="docs-tok-string">&quot;{{a}}&quot;</span>')
    // 开/闭合标签均为 tag（闭合含 /）
    expect(html).toContain('<span class="docs-tok-tag">&lt;view</span>')
    expect(html).toContain('<span class="docs-tok-tag">&lt;/view</span>')
    // 标签名后的 > 与文本保持 plain（hi 无任何 span 包裹）
    expect(html).toContain('&gt;hi<span')
    // class 等 JS 关键字在标签内不再误染 keyword 紫
    expect(html).not.toContain('<span class="docs-tok-keyword">class</span>')
  })

  it('#386 script 块内 JS 不受 attr 影响（inTag 已归位；script 上的 setup 本身是属性）', () => {
    const html = highlight('<script setup>\nconst visible = ref(true)\n</' + 'script>', 'vue')
    expect(html).toContain('<span class="docs-tok-keyword">const</span>')
    // 标签头上的 setup 是合法属性名 → attr；但 script 内容里（inTag 归位后）不得再产生 attr
    expect(html).toContain('<span class="docs-tok-attr">setup</span>')
    const rest = html.slice(html.indexOf('&gt;\n'))
    expect(rest).not.toContain('docs-tok-attr')
  })

  it('#386c 函数名 fn：非关键字 word 紧跟 "(" → fn；关键字/对象键不误染', () => {
    const html = highlight('const visible = ref(true)\nfunction handleTap() {\n  if (visible) console.log(handleTap)\n}', 'ts')
    expect(html).toContain('<span class="docs-tok-fn">ref</span>')
    expect(html).toContain('<span class="docs-tok-fn">handleTap</span>')
    expect(html).toContain('<span class="docs-tok-fn">log</span>')
    // 关键字不被 fn 抢走；可见 = 与对象属性不误染
    expect(html).toContain('<span class="docs-tok-keyword">const</span>')
    expect(html).toContain('<span class="docs-tok-keyword">function</span>')
    expect(html).toContain('<span class="docs-tok-keyword">if</span>')
    expect(html).not.toContain('<span class="docs-tok-fn">visible</span>')
  })

  it('#386c vue SFC 拆块：<style> 体按 css（选择器 fn / 属性名 attr / 数值带单位）', () => {
    const html = highlight('<style>\n.demo { padding: 24px 32px; color: #333; }\n</' + 'style>', 'vue')
    // 选择器 → fn；CSS 属性名（含 -）→ attr；数值连单位一体 number
    expect(html).toContain('<span class="docs-tok-fn">.demo</span>')
    expect(html).toContain('<span class="docs-tok-attr">padding</span>')
    expect(html).toContain('<span class="docs-tok-attr">color</span>')
    expect(html).toContain('<span class="docs-tok-number">24px</span>')
    expect(html).toContain('<span class="docs-tok-number">333</span>')
    // 开/闭合 style 标签仍为 tag
    expect(html).toContain('<span class="docs-tok-tag">&lt;style</span>')
    expect(html).toContain('<span class="docs-tok-tag">&lt;/style</span>')
  })

  it('#386d 成员属性 .word → attr（count.value / obj.class 不误紫；fn 优先）', () => {
    const html = highlight('const c = ref(0)\nc.value++\nx.class\nc.log(1)', 'ts')
    expect(html).toContain('<span class="docs-tok-attr">value</span>')
    expect(html).toContain('<span class="docs-tok-attr">class</span>')
    expect(html).toContain('<span class="docs-tok-fn">log</span>')
    expect(html).not.toContain('<span class="docs-tok-keyword">class</span>')
  })

  it('XSS 防护：恶意内容全转义', () => {
    const html = highlight('<img src=x onerror=alert(1)>', 'ts')
    expect(html).not.toContain('<img')
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
  })
})

describe('G-36/官网 B2 TOC + 渲染 + 搜索', () => {
  const doc = parseMarkdown(SAMPLE_MD)

  it('TOC：h2-h3 平铺 + 嵌套树（同层 h2 为兄弟顶层节点）', () => {
    const flat = flatToc(doc.blocks)
    expect(flat.map((t) => t.id)).toEqual(['安装', '组件'])
    const tree = buildToc(doc.blocks)
    expect(tree.map((t) => t.id)).toEqual(['安装', '组件']) // 两个 h2 兄弟 → 两个顶层节点
  })

  it('HTML 渲染：语义类 docs-* + 转义防注入', () => {
    const html = renderDocHtml(doc)
    expect(html).toContain('<h2 id="安装" class="docs-h docs-h2">')
    expect(html).toContain('<strong>渲染引擎无关</strong>')
    expect(html).toContain('<table class="docs-table">')
    expect(html).toContain('<blockquote class="docs-quote">')
    // XSS：md 中注入 script → 转义
    const xss = parseMarkdown('段落 <script>alert(1)</script> 尾')
    const xssHtml = renderDocHtml(xss)
    expect(xssHtml).not.toContain('<script>')
  })

  it('搜索索引 + 检索（标题加权）', () => {
    const index = buildSearchIndex([{ path: '/guide/start', doc }])
    expect(index.length).toBeGreaterThanOrEqual(3)
    const hits = searchDocs(index, '安装')
    expect(hits[0]?.path).toBe('/guide/start')
    expect(hits[0]?.anchor).toBe('安装')
    expect(searchDocs(index, '   ')).toHaveLength(0)
  })
})

describe('★核心证据：md → SFC → 框架编译器 → 真实渲染', () => {
  it('toSfc 产出 → compileVueSfc 编译通过（文档也是编译产物）', () => {
    const doc = parseMarkdown(SAMPLE_MD)
    const sfc = toSfc(doc, { componentName: 'GuideStart' })
    expect(sfc).toContain('<p-page title="快速开始">')
    expect(sfc).toContain('v-pre') // 代码块防插值误伤
    expect(sfc).toContain('&#123;') // {{ }} 实体化（段落插值误伤防护）
    expect(sfc).toContain('<script setup>')

    const result = compileVueSfc(sfc, { filename: 'guide-start.vue' })
    expect(result.js).toBeTruthy()
    expect(result.js.length).toBeGreaterThan(100)
  })

  it('mountWebComponent 真实渲染：md 内容出现在 DOM（docs-* 语义类）', async () => {
    const doc = parseMarkdown([
      '# 引擎演示',
      '',
      '这是 **Proteus 文档引擎** 渲染的段落。',
      '',
      '```ts',
      'const ok = true',
      '```',
    ].join('\n'))
    const sfc = toSfc(doc, { componentName: 'EngineDemo' })
    const wrapper = await mountWebComponent(sfc)
    const html = wrapper.html()
    expect(html).toContain('docs-h')
    expect(html).toContain('<strong>Proteus 文档引擎</strong>')
    expect(html).toContain('docs-code')
  })
})

# @proteus-vue/docs

**文档引擎**（官网 B2 核心件）——Markdown → Docs IR（语义块 AST）→ HTML / Vue SFC。零依赖手写 docs 子集解析器 + 轻量高亮器。

**核心叙事（第九次泛化）**：文档内容语义化（Markdown → Docs IR → 渲染）与编译/渲染同构；**产出的 SFC 直接喂框架编译器 `compileVueSfc`**——「我们的文档是用我们自己的编译器编译的」。

## 用法

```ts
import { parseMarkdown, renderDocHtml, toSfc, flatToc, buildSearchIndex } from '@proteus-vue/docs'

const doc = parseMarkdown(mdSource) // frontmatter + blocks（Docs IR）
const html = renderDocHtml(doc)     // docs-* 语义类 HTML（SPA v-html / 静态直出）
const sfc = toSfc(doc, { componentName: 'GuideStart' }) // → compileVueSfc 可编译
const toc = buildToc(doc.blocks)    // 嵌套目录（h2-h3 可配）
const index = buildSearchIndex([{ path: '/guide/start', doc }]) // 搜索索引
```

## 覆盖范围（docs 子集）

- **块**：标题（锚点 id kebab + 中文保留 + 去重）/ 段落 / 代码围栏（lang + meta）/ 列表（含一层嵌套）/ 表格（对齐声明）/ 引用 / 分隔线
- **行内**：`code` / **strong** / *em* / [link](href) / ![image](src)
- **frontmatter**：YAML-lite（key: value、块式数组、行内数组、布尔/数字/去引号归一）
- **高亮**：js/ts/vue/json/bash/css/html（comment/string/keyword/number/tag；内容全转义防注入）

## SFC 产出约定

- 代码块包 `<DocsCode lang code v-pre>`（站点侧提供高亮组件；v-pre 防 Vue 插值误伤）
- 段落文本 `{{ }}` 实体化为 `&#123;&#125;`（防模板插值误解析）
- frontmatter.title → 根 `<p-page title>` 语义声明；恒输出 `<script setup>`（SFC 合规）

## 诚实边界

- 解析器覆盖框架自有文档子集，非 CommonMark 全集（嵌套引用/多级嵌套列表等按需扩展）
- 高亮为轻量 tokenizer，复杂语言可换 shiki（接口兼容：code+lang → HTML）

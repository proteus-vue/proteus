// website/src/docs-registry.ts —— 文档内容注册表（四区：指南 / 组件 / 能力 / 柔性系统）
// ★#390ii IA 重构：全部内容堆一个侧边栏 → 分区各归其位（每区独立 glob + 分组 + 侧边栏）。
// 「内容即数据」不变：新增页面 = 放一个 md（frontmatter: title/order/group），注册表零改动。
// 组件/能力参考页由 website/scripts/gen-content.mjs 从源码 SSOT 生成（勿手改，重跑即刷新）。
import type { DocsModule } from '@proteus-vue/docs/vite'

export interface DocEntry {
  slug: string
  title: string
  order: number
  group: string
  doc: DocsModule
}

export interface DocGroup {
  name: string
  items: DocEntry[]
}

export interface DocSection {
  key: string
  name: string
  /** 路由前缀（/docs、/docs/component、/docs/capability、/docs/system） */
  base: string
  groups: DocGroup[]
  items: DocEntry[]
}

function buildSection(key: string, name: string, base: string, modules: Record<string, { default: DocsModule }>, defaultGroup: string): DocSection {
  const items: DocEntry[] = Object.entries(modules)
    .map(([file, mod]) => {
      const slug = file.split('/').pop()?.replace(/\.md$/, '') ?? file
      const fm = mod.default.frontmatter
      const order = typeof fm.order === 'number' ? fm.order : Number.MAX_SAFE_INTEGER
      const title = typeof fm.title === 'string' ? fm.title : mod.default.title
      const group = typeof fm.group === 'string' ? fm.group : defaultGroup
      return { slug, title, order, group, doc: mod.default }
    })
    .sort((a, b) => a.order - b.order)
  const groups = Object.values(
    items.reduce<Record<string, DocGroup>>((acc, g) => {
      const grp = (acc[g.group] ??= { name: g.group, items: [] })
      grp.items.push(g)
      return acc
    }, {}),
  ).sort((a, b) => Math.min(...a.items.map((i) => i.order)) - Math.min(...b.items.map((i) => i.order)))
  return { key, name, base, groups, items }
}

// —— 五区内容 ——（插件 API 参考页由 gen-plugin-docs.mjs 从 WIT SSOT 生成，勿手改）
const guideModules = import.meta.glob<{ default: DocsModule }>('../guides/*.md', { eager: true })
const componentModules = import.meta.glob<{ default: DocsModule }>('../content/components/*.md', { eager: true })
const capabilityModules = import.meta.glob<{ default: DocsModule }>('../content/capabilities/*.md', { eager: true })
const systemModules = import.meta.glob<{ default: DocsModule }>('../content/system/*.md', { eager: true })
const pluginModules = import.meta.glob<{ default: DocsModule }>('../content/plugins/*.md', { eager: true })

export const sections: DocSection[] = [
  buildSection('guide', '指南', '/docs', guideModules, '指南'),
  buildSection('components', '组件', '/docs/component', componentModules, '组件'),
  buildSection('capabilities', '能力', '/docs/capability', capabilityModules, '能力'),
  buildSection('system', '柔性系统', '/docs/system', systemModules, '柔性系统'),
  buildSection('plugins', '插件 API', '/docs/plugin', pluginModules, '插件 API'),
]

export function findDoc(base: string, slug: string): DocEntry | undefined {
  const section = sections.find((s) => s.base === base)
  return section?.items.find((i) => i.slug === slug)
}

export function sectionByKey(key: string): DocSection | undefined {
  return sections.find((s) => s.key === key)
}

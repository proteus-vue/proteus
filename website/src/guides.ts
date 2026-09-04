// website/src/guides.ts —— 指南清单（★B2 验收：侧边栏自动生成）
// guides/*.md 由 @proteus-vue/docs vite 插件在构建期编译为文档模块（frontmatter/title/html/toc）；
// 这里 import.meta.glob 收集全部模块 → 按 frontmatter.order 排序 → 按 frontmatter.group 分组 →
// 侧边栏/路由清单自动生成。新增指南 = 放一个 md 文件（frontmatter 写 title/order/group），侧边栏零改动——「内容即数据」。
import type { DocsModule } from '@proteus-vue/docs/vite'

export interface GuideEntry {
  slug: string
  title: string
  order: number
  group: string
  doc: DocsModule
}

export interface GuideGroup {
  name: string
  items: GuideEntry[]
}

const modules = import.meta.glob<{ default: DocsModule }>('../guides/*.md', { eager: true })

export const guides: GuideEntry[] = Object.entries(modules)
  .map(([file, mod]) => {
    const slug = file.split('/').pop()?.replace(/\.md$/, '') ?? file
    const fm = mod.default.frontmatter
    const order = typeof fm.order === 'number' ? fm.order : Number.MAX_SAFE_INTEGER
    const title = typeof fm.title === 'string' ? fm.title : mod.default.title
    const group = typeof fm.group === 'string' ? fm.group : '指南'
    return { slug, title, order, group, doc: mod.default }
  })
  .sort((a, b) => a.order - b.order)

// 分组清单（组序 = 组内最小 order——「入门」永远排最前；组内按 order 升序）
export const guideGroups: GuideGroup[] = Object.values(
  guides.reduce<Record<string, GuideGroup>>((acc, g) => {
    const group = (acc[g.group] ??= { name: g.group, items: [] })
    group.items.push(g)
    return acc
  }, {}),
).sort((a, b) => Math.min(...a.items.map((i) => i.order)) - Math.min(...b.items.map((i) => i.order)))

export function findGuide(slug: string): GuideEntry | undefined {
  return guides.find((g) => g.slug === slug)
}

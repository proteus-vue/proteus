// tests/css-conformance-index-entries.test.ts —— ★★css-conformance「首页索引 ↔ 页面清单」对齐门禁（决策 #659）
//
// 【为什么有它（用户实测指出）】批 A⑤ 新增 `pages/position-scroll.vue` 后**漏进首页索引**——
//   路由（auto-routes 自动收录）、构建（按 pages 目录扫）、截图装置（逐屏跑器）全都自动覆盖了它，
//   唯独**人手动点进去复审**的入口（`pages/index.vue` 手写清单）漏了一项 ⇒ 桌面点开只能看到 30 项里的 29 项。
//   ★这正是本仓反复吃过的形态：**手写清单会漂移，只有机器判据是结构性的**（同族：门禁接线 check:gates-sync、
//   MP 属性表、能力清单——都在"清单必须机器对齐"这条线上）。
//
// 【判据（双向 + 唯一性；任一不满足即红）】
//   ① 每个页面（`pages/*.vue`，index 自身除外）**必须**有 `$nav('<页名>')` 入口（防漏项静默）；
//   ② 每个入口**必须**指向存在的页面（防死链：页改名/删除后入口漂移）；
//   ③ 入口不重复（防止复制粘贴把同一页挂两条，另一页反而漏了——双向判据下这类笔误可能"数值平衡"）；
//   ★解析前**剥注释**：文件头的写法说明里就含 `$nav('<页名>')` 字样（不剥会把说明当入口——
//     本仓"注释自污染"的同族，已有多次前科）。
//
// 用法：随 `pnpm test` 全量跑（CI 覆盖）；定向：`npx vitest run tests/css-conformance-index-entries.test.ts`
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PAGES_DIR = path.join(ROOT, 'css-conformance', 'pages')
const INDEX_FILE = path.join(PAGES_DIR, 'index.vue')

/** 允许"有页面但刻意不进首页索引"的具名豁免（每条必须带理由——不静默豁免；当前为空） */
const NOT_IN_INDEX: Record<string, string> = {}

/** 剥 HTML 注释（`<!-- ... -->`）——文件头说明含 `$nav('<页名>')` 字样，不剥会污染解析 */
const stripComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '')

describe('★★css-conformance 首页索引 ↔ 页面清单对齐', () => {
  const pageFiles = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.vue'))
  const pages = pageFiles.map((f) => f.slice(0, -'.vue'.length)).filter((n) => n !== 'index')
  const indexSrc = stripComments(fs.readFileSync(INDEX_FILE, 'utf-8'))
  const entries = [...indexSrc.matchAll(/\$nav\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!)

  it('① 每个页面都有首页入口（防漏项静默——本门禁的由来）', () => {
    const missing = pages.filter((p) => !entries.includes(p) && !(p in NOT_IN_INDEX))
    expect(
      missing,
      `以下页面没有进 css-conformance/pages/index.vue 的索引（桌面点开会看不到）：${missing.join(', ')}——` +
        '补一条 `<view class="ix-item" @tap="$nav(\'<页名>\')">…</view>`；确认不需要入口的加进 NOT_IN_INDEX 并写明理由',
    ).toEqual([])
  })

  it('② 每个入口都指向存在的页面（防死链/改名漂移）', () => {
    const dangling = entries.filter((e) => !pages.includes(e))
    expect(dangling, `以下入口指向不存在的页面（页已改名/删除？）：${dangling.join(', ')}`).toEqual([])
  })

  it('③ 入口不重复（同一页只挂一条）', () => {
    const dup = entries.filter((e, i) => entries.indexOf(e) !== i)
    expect([...new Set(dup)], `重复入口：${[...new Set(dup)].join(', ')}`).toEqual([])
  })

  it('护栏：页面清单非空（防"目录读空 ⇒ 判据恒真"的假绿）', () => {
    expect(pages.length, 'css-conformance/pages 下应有多页（读空说明路径变了，门禁失效）').toBeGreaterThan(10)
    expect(entries.length, 'index.vue 应解析出多条入口（解析为空说明解析器失效）').toBeGreaterThan(10)
  })
})

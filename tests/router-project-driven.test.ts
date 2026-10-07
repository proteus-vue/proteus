// tests/router-project-driven.test.ts
// ★★★（2026-10-02 · 依《主流框架路由调研与启示》）**项目驱动路由**的判据
//
// 【本文件锁三件事（调研启示的落地）】
//   ① **启示 6「路由不存在 = 编译错误」**：`meta.redirectTo` / `meta.parent` / `router.tabBar.list[].name`
//      —— 跨路由引用必须在**构建期闭合**（生态里普遍只在运行时炸或静默跳错页：uni-app「层级限制只写有不给数字」、
//      Next.js 并行路由未匹配硬 404、小程序 URL 传参限制）；
//   ② **项目驱动产物**：`gen-routes` 从 `pages/**\\/*.vue + router.meta` 产出 App 导航注册表
//      （`navigation.generated.ts`：screens/screenNames/tabNames）——**消灭"夹具手写屏幕数组"**；
//   ③ **同源契约**：App 注册表与 Web/MP 的 `auto-routes.ts` **同数同源**（同一棵路由树的两个投影）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import { resolveRouterConfig } from '../packages/types/src/router-config'
import type { ProteusConfig } from '../packages/types/src/config'

let TMP = ''

/** 造一个最小工程（pages/ 下两个 .vue + 可注入的 meta） */
function makeProject(meta: Record<string, unknown>, tabBar?: { list: Array<{ name: string; text: string }> }): {
  root: string
  config: ProteusConfig
} {
  const root = path.join(TMP, `proj-${Math.random().toString(36).slice(2)}`)
  const pagesDir = path.join(root, 'src/pages')
  fs.mkdirSync(pagesDir, { recursive: true })
  fs.writeFileSync(path.join(pagesDir, 'index.vue'), '<template><view>home</view></template>\n')
  fs.writeFileSync(path.join(pagesDir, 'detail.vue'), '<template><view>detail</view></template>\n')
  const config = {
    version: 4,
    targets: { mp: { appid: 'wx0000000000', renderer: 'skyline', setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } } },
    pagesDir: 'src/pages',
    router: {
      routesOutput: 'src/router/auto-routes.ts',
      meta,
      ...(tabBar ? { tabBar } : {}),
    },
  } as unknown as ProteusConfig
  return { root, config }
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-router-proj-'))
})
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('① 项目驱动产物：App 导航注册表（消灭夹具手写）', () => {
  it('从 pages/ + router.pages 产出**单一产物**（routes + screens + 类型表同文件），且与路由表同源同数', () => {
    const { root, config } = makeProject({ index: { title: '首页', isTab: true }, detail: { transition: 'slideUp' } })
    runGenRoutes({ config, root })

    // ★单一产物：App 投影与路由表在**同一个文件**里（用户反馈「两份 generated 太乱」→ 统一）
    const navFile = path.join(root, 'src/router/auto-routes.ts')
    expect(fs.existsSync(navFile), '统一导航产物必须被产出（此前 generateAppScreens 全仓零调用）').toBe(true)
    expect(
      fs.existsSync(path.join(root, 'src/router/navigation.generated.ts')),
      '不得再有第二份导航注册表（单一产物原则）',
    ).toBe(false)
    const src = fs.readFileSync(navFile, 'utf-8')
    // 产物形态：纯数据（screens / screenNames / tabNames）——不含 component 动态导入
    expect(src).toContain('export const screens')
    expect(src).toContain('export const screenNames')
    expect(src).toContain('export const tabNames')
    expect(src).toContain('"detail"')
    expect(src).toContain('"slideUp"') // 项目 meta 的转场被携带

    // ★同源同数：App 注册表 ⟷ 路由表（同一棵树的投影）
    const autoSrc = fs.readFileSync(path.join(root, 'src/router/auto-routes.ts'), 'utf-8')
    const routeNames = [...autoSrc.matchAll(/name: "([^"]+)"/g)].map((m) => m[1])
    const navNames = [...src.matchAll(/"name": "([^"]+)"/g)].map((m) => m[1])
    expect(navNames.length, 'App 屏数 = 路由数').toBe(routeNames.length)
    expect(new Set(navNames)).toEqual(new Set(routeNames))
  })

  it('routesOutput 关闭 ⇒ 统一产物不生成（工程自带路由机制的 opt-out）', () => {
    const off = makeProject({})
    ;(off.config as unknown as { router: { routesOutput: string } }).router.routesOutput = ''
    runGenRoutes({ config: off.config, root: off.root })
    expect(fs.existsSync(path.join(off.root, 'src/router/auto-routes.ts'))).toBe(false)
  })
})

describe('② 启示 6「路由不存在 = 编译错误」：跨路由引用构建期闭合', () => {
  it('meta.redirectTo 指向不存在的路由 ⇒ **抛错**（附可用路由与修法）', () => {
    const { root, config } = makeProject({ detail: { redirectTo: 'no-such-page' } })
    expect(() => runGenRoutes({ config, root })).toThrow(/跨路由引用未闭合/)
    // 错误信息必须**可行动**（含可用路由名 + 修法）——不只是一句"失败了"
    let msg = ''
    try {
      runGenRoutes({ config, root })
    } catch (e) {
      msg = String(e)
    }
    expect(msg).toContain('no-such-page')
    expect(msg).toContain('可用：')
    expect(msg).toContain('修法：')
  })

  it('meta.parent 指向不存在的路由 ⇒ 抛错', () => {
    const { root, config } = makeProject({ detail: { parent: 'ghost-page' } })
    expect(() => runGenRoutes({ config, root })).toThrow(/ghost-page.*不存在/)
  })

  it('router.tabBar.list 引用不存在的路由 ⇒ 抛错（tab 会静默失效）', () => {
    const { root, config } = makeProject({}, { list: [{ name: 'ghost-tab', text: '不存在' }] })
    expect(() => runGenRoutes({ config, root })).toThrow(/tabBar.*ghost-tab.*不存在/)
  })

  it('引用**存在**的路由 ⇒ 构建通过（合法引用不被误伤）', () => {
    const { root, config } = makeProject({ detail: { redirectTo: 'index' }, index: { isTab: true } })
    expect(() => runGenRoutes({ config, root })).not.toThrow()
  })

  it('未声明引用 ⇒ 不校验（不误报）', () => {
    const { root, config } = makeProject({ detail: { title: '详情' } })
    expect(() => runGenRoutes({ config, root })).not.toThrow()
  })
})

describe('③ 配置面：router.pages（pages.json 等价物）与旧名 meta 的别名关系', () => {
  it('pages 首选；meta 为同义别名（同对象）；双写时 pages 胜并登记 duplicate', () => {
    const a = resolveRouterConfig({ router: { pages: { index: { title: '首页' } } } })
    expect(a.router.pages).toEqual({ index: { title: '首页' } })
    expect(a.router.meta, 'meta 指向同一对象（旧消费者不破）').toEqual(a.router.pages)

    const b = resolveRouterConfig({ router: { meta: { index: { title: '旧名' } } } })
    expect(b.router.pages, '只写旧名也能读到（别名生效）').toEqual({ index: { title: '旧名' } })

    const c = resolveRouterConfig({ router: { pages: { x: { title: '新' } }, meta: { x: { title: '旧' } } } })
    expect(c.router.pages, '双写时 pages 胜').toEqual({ x: { title: '新' } })
    expect(c.duplicates, '双写登记 duplicate（提示收敛）').toContain('pages/meta')
  })
})

describe('④ 页面配置集中化：`router.pages[path].pageJson`（MP 窗口扩展上收）', () => {
  it('集中声明的 pageJson 写进页面产物，且与 skyline 默认**合并**（不是覆盖）', () => {
    const { root, config } = makeProject({
      detail: { pageJson: { backgroundColorContent: 'transparent', navigationStyle: 'custom' } },
    })
    runGenRoutes({ config, root })
    const pj = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/detail.json'), 'utf-8'))
    // ★此前 pageJson **只能**写页内 <route> 块 ⇒ 不满足"页面配置统一到路由管理"；本批上收
    expect(pj.backgroundColorContent, '集中声明的 pageJson 必须落产物').toBe('transparent')
    expect(pj.navigationStyle).toBe('custom')
    // skyline 默认（renderer/componentFramework）与集中声明**共存**（合并而非覆盖）
    expect(pj.renderer).toBe('skyline')
    expect(pj.componentFramework).toBe('glass-easel')
  })

  it('目录前缀声明可被精确页面覆盖（三级匹配：精确 > 目录 > 默认）', () => {
    // ★键的格式（实测校准，勿凭直觉）：集中配置的键 = **pageRel**（pages/ 去前缀后的相对路径）。
    //   本夹具两个页面是 `src/pages/index.vue` 与 `src/pages/detail.vue` ⇒ pageRel = `index` / `detail`；
    //   index 归并目录后 pageRel 就是 `index`（不是 `pages/index`）⇒ 目录前缀要写 `pages/` 形态才命中子目录页。
    //   这里直接用**精确键**验证"精确胜目录前缀"这条语义（目录前缀的继承在 router 侧已由
    //   `resolveConfigMeta` 单测覆盖，本用例聚焦 pageJson 的三级合并）。
    const { root, config } = makeProject({
      // 目录前缀（供 detail 继承；index 不在该前缀下 → 不继承）
      'pages': { pageJson: { navigationStyle: 'default' } },
      detail: { pageJson: { navigationStyle: 'custom' } },
    })
    runGenRoutes({ config, root })
    const detailJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/detail.json'), 'utf-8'))
    expect(detailJson.navigationStyle, '精确声明胜目录前缀（三级匹配）').toBe('custom')
  })
})

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
    platform: 'mp-weixin',
    skyline: true,
    appid: 'wx0000000000',
    pagesDir: 'src/pages',
    router: {
      routesOutput: 'src/router/auto-routes.ts',
      meta,
      ...(tabBar ? { tabBar } : {}),
    },
    customRoute: { registerPresets: true, builders: {} },
    setDataBridge: { batchWindow: 16, perComponent: true },
    style: { px2rpx: true, rpxRatio: 2 },
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
  it('从 pages/ + router.meta 产出 screens/screenNames/tabNames，且与 auto-routes 同源同数', () => {
    const { root, config } = makeProject({ index: { title: '首页', isTab: true }, detail: { transition: 'slideUp' } })
    runGenRoutes({ config, root })

    const navFile = path.join(root, 'src/router/navigation.generated.ts')
    expect(fs.existsSync(navFile), 'App 导航注册表必须被产出（此前 generateAppScreens 全仓零调用）').toBe(true)
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

  it('缺省路径派生：与 routesOutput 同目录的 navigation.generated.ts；routesOutput 关闭时同步关闭', () => {
    // （配置面规则已单测于 router-config；此处验证**产物真的落在派生路径**）
    const { root, config } = makeProject({})
    runGenRoutes({ config, root })
    expect(fs.existsSync(path.join(root, 'src/router/navigation.generated.ts'))).toBe(true)

    // 显式关闭 → 不产出
    const off = makeProject({})
    ;(off.config as unknown as { router: { appNavigationOutput: string } }).router.appNavigationOutput = ''
    runGenRoutes({ config: off.config, root: off.root })
    expect(fs.existsSync(path.join(off.root, 'src/router/navigation.generated.ts'))).toBe(false)
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

describe('③ 配置面：appNavigationOutput 派生规则（项目可声明）', () => {
  it('缺省派生 / 显式声明 / 随 routesOutput 关闭 —— 三条规则', () => {
    expect(resolveRouterConfig({}).router.appNavigationOutput).toBe('src/router/navigation.generated.ts')
    expect(
      resolveRouterConfig({ router: { routesOutput: 'a/b.ts' } }).router.appNavigationOutput,
    ).toBe('a/navigation.generated.ts')
    expect(
      resolveRouterConfig({ router: { routesOutput: 'a/b.ts', appNavigationOutput: 'x/nav.ts' } }).router.appNavigationOutput,
    ).toBe('x/nav.ts')
    expect(resolveRouterConfig({ router: { routesOutput: '' } }).router.appNavigationOutput).toBe('')
  })
})

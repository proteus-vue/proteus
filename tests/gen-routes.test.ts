// tests/gen-routes.test.ts
// 路由表生成器冒烟测试（拆包步骤 5：gen-routes 归 @proteus/plugin-vite，改为 runGenRoutes 纯函数）
// 验证：auto-routes / app.json（主包+分包）/ page.json 全链路生成
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-genroutes-'))

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

/** 构造最小 config（指向临时工程） */
function makeConfig(extra: Partial<ProteusConfig> = {}): ProteusConfig {
  return {
    platform: 'mp-weixin',
    skyline: true,
    appid: 'wx0000000000',
    pagesDir: 'src/pages',
    routesOutput: 'src/router/auto-routes.ts',
    customRoute: { registerPresets: true, builders: {} },
    setDataBridge: { batchWindow: 16, perComponent: true },
    style: { px2rpx: true, rpxRatio: 2 },
    ...extra,
  }
}

function writeFixture(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

describe('runGenRoutes：路由表生成全链路', () => {
  it('主包页面 → auto-routes + app.json + page.json', () => {
    const root = path.join(TMP, 'basic')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页", "isTab": true }\n}\n</route>\n`)
    writeFixture(root, 'src/pages/user/profile.vue', `<template><view>资料</view></template>\n<route>\n{\n  "meta": { "title": "个人资料" },\n  "params": { "id": "string" }\n}\n</route>\n`)

    runGenRoutes({ config: makeConfig(), root })

    // auto-routes：路由记录 + RouteParamsByName 模块扩充
    const auto = fs.readFileSync(path.join(root, 'src/router/auto-routes.ts'), 'utf-8')
    expect(auto).toContain('name: "index"')
    expect(auto).toContain('name: "user-profile"')
    expect(auto).toContain("declare module '@proteus/router/types'")
    expect(auto).toContain("'user-profile': { id?: string }")

    // app.json：主包页面声明
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toEqual(['pages/index', 'pages/user/profile'])

    // page.json：每页生成
    expect(fs.existsSync(path.join(root, 'dist/mp-weixin/pages/user/profile.json'))).toBe(true)
  })

  it('分包页面 → app.json subPackages 分组', () => {
    const root = path.join(TMP, 'subpkg')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页", "isTab": true }\n}\n</route>\n`)
    writeFixture(root, 'src/subpackages/order/pages/list.vue', `<template><view>订单</view></template>\n<route>\n{\n  "meta": { "title": "订单列表" }\n}\n</route>\n`)

    runGenRoutes({ config: makeConfig({ subPackages: [{ root: 'src/subpackages/order', name: 'order' }] }), root })

    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toEqual(['pages/index'])
    expect(appJson.subPackages).toEqual([{ root: 'subpackages/order', name: 'order', pages: ['pages/list'] }])
  })

  it('<route> 块非法 JSON → 警告且不中断生成（页面仍收录，meta 丢失）', () => {
    const root = path.join(TMP, 'badjson')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页" }\n}\n</route>\n`)
    writeFixture(root, 'src/pages/broken.vue', `<template><view>坏</view></template>\n<route>\n{\n  "meta": {\n}\n</route>\n`)

    expect(() => runGenRoutes({ config: makeConfig(), root })).not.toThrow()
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toContain('pages/index') // 合法页照常收录
    expect(appJson.pages).toContain('pages/broken') // 坏 JSON 页仍收录（仅 meta 丢失，不中断）
  })
})

// tests/gen-routes.test.ts
// 路由表生成器冒烟测试（拆包步骤 5：gen-routes 归 @proteus/plugin-vite，改为 runGenRoutes 纯函数）
// 验证：auto-routes / app.json（主包+分包）/ page.json 全链路生成
import { describe, it, expect, afterAll, vi } from 'vitest'
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

  it('★module-plan B5：模块契约 → 分包依赖（dependencies）+ preloadRule 生成', () => {
    const root = path.join(TMP, 'module-sub')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页", "isTab": true }\n}\n</route>\n`)
    writeFixture(root, 'src/subpackages/trade/pages/list.vue', `<template><view>订单</view></template>\n<route>\n{\n  "meta": { "title": "订单列表" }\n}\n</route>\n`)
    writeFixture(root, 'src/subpackages/user/pages/profile.vue', `<template><view>资料</view></template>\n<route>\n{\n  "meta": { "title": "资料" }\n}\n</route>\n`)

    const moduleConfigs = [
      // trade 分包模块：依赖 user 分包 + 预加载 user
      { name: 'trade', chunk: 'trade', dependencies: { user: '^1.0.0', common: '^1.0.0' }, preload: ['user'] },
      { name: 'user', chunk: 'user' },
      // common 是主包模块（无分包）——不产生分包依赖
      { name: 'common', chunk: 'common' },
    ]
    runGenRoutes({
      config: makeConfig({ subPackages: [{ root: 'src/subpackages/trade', name: 'trade' }, { root: 'src/subpackages/user', name: 'user' }] }),
      root,
      moduleConfigs,
    })

    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    const trade = appJson.subPackages.find((sp: { name: string }) => sp.name === 'trade')
    // 依赖 user 分包；common 是主包模块不产生依赖
    expect(trade.dependencies).toEqual(['user'])
    // preloadRule：trade 分包入口页 → 预加载 user 分包
    expect(appJson.preloadRule).toEqual({ 'subpackages/trade/pages/list': { network: 'all', packages: ['user'] } })
    expect(appJson.subPackages.find((sp: { name: string }) => sp.name === 'user').dependencies).toBeUndefined()
  })

  it('★module-plan B5：模块依赖引用未知模块 → 警告（透明化）', () => {
    const root = path.join(TMP, 'module-missing')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页" }\n}\n</route>\n`)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      runGenRoutes({
        config: makeConfig(),
        root,
        moduleConfigs: [{ name: 'trade', chunk: 'trade', dependencies: { ghost: '^1.0.0' } }],
      })
      expect(warnSpy.mock.calls.some((c) => c[0].includes('ghost') && c[0].includes('未找到对应模块契约'))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('<route> 块非法 JSON → 报错（透明化：严格校验含 loc，不吞错——双管线统一后不再是警告跳过）', () => {
    const root = path.join(TMP, 'badjson')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页" }\n}\n</route>\n`)
    writeFixture(root, 'src/pages/broken.vue', `<template><view>坏</view></template>\n<route>\n{\n  "meta": {\n}\n</route>\n`)

    expect(() => runGenRoutes({ config: makeConfig(), root })).toThrow(/不是合法 JSON/)
  })

  it('★决策 #113 集中式 meta：页面零 <route> 声明也收录，meta 从 config router.meta 注入（精确路径 > 目录前缀）', () => {
    const root = path.join(TMP, 'config-meta')
    writeFixture(root, 'src/pages/index.vue', `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页", "isTab": true }\n}\n</route>\n`)
    writeFixture(root, 'src/pages/user/list.vue', `<template><view>列表</view></template>`)
    writeFixture(root, 'src/pages/user/profile.vue', `<template><view>资料</view></template>`)

    runGenRoutes({
      config: makeConfig({
        router: {
          meta: {
            // 目录级前缀：user 下全部页面
            'user': { requiresAuth: true, transition: 'slideUp' },
            // 精确路径覆盖目录级
            'user/profile': { title: '个人资料' },
          },
        },
      }),
      root,
    })

    const auto = fs.readFileSync(path.join(root, 'src/router/auto-routes.ts'), 'utf-8')
    // 无 <route> 块页面：path/name 推导 + 目录级 meta 注入
    expect(auto).toContain('name: "user-list"')
    expect(auto).toContain('"requiresAuth":true')
    // 精确路径覆盖目录级（meta 断言用 name 索引的 RouteParamsByName key）
    expect(auto).toContain("'user-profile': {  }") // 无 params
    const userProfile = auto.match(/name: "user-profile"[^}]*\}[^}]*\}/)?.[0] ?? ''
    expect(userProfile).toContain('"title":"个人资料"')
    expect(userProfile).toContain('"requiresAuth":true') // 目录级保留（精确只覆盖 title）
  })
})

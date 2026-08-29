// tests/router-rules.test.ts
// 路由生成规则注册表 + --trace-router 闭环（底线整改 P1b：消除路由层"第二黑盒"）
import { describe, it, expect } from 'vitest'
import { listRouteRules, getRouteRule, formatRouteRule } from '../packages/router/src/rules'
import { buildRouteTree } from '../packages/router/src/tree'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { RouteBlock } from '../packages/router/src/types'

/** 测试辅助：构造 RouteBlock */
function block(partial: Partial<RouteBlock> & { path: string }): RouteBlock {
  return { loc: { file: 'x.vue', line: 1, column: 1 }, meta: {}, componentPath: 'x.vue', ...partial }
}

describe('路由生成规则注册表（AI 说明书）', () => {
  it('规则齐全 + 字段完整（id/title/description/why/when/example/verify/source/decision）', () => {
    const rules = listRouteRules()
    expect(rules.length).toBeGreaterThanOrEqual(6)
    for (const r of rules) {
      expect(r.id).toMatch(/^route\//)
      expect(r.title).toBeTruthy()
      expect(r.description).toBeTruthy()
      expect(r.why).toBeTruthy()
      expect(r.when).toBeTruthy()
      expect(r.example.before).toBeTruthy()
      expect(r.example.after).toBeTruthy()
      expect(r.verify).toBeTruthy()
      expect(r.source).toBeTruthy()
      expect(r.decision).toBeTruthy()
    }
  })

  it('ID 唯一 + 按 ID 查询 + 渲染说明书', () => {
    const ids = listRouteRules().map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    const rule = getRouteRule('route/path-derive')
    expect(rule).toBeDefined()
    expect(formatRouteRule(rule!).length).toBeGreaterThan(100)
    expect(getRouteRule('route/not-exist')).toBeUndefined()
  })
})

describe('--trace-router 闭环（嵌套推导决策链）', () => {
  it('buildRouteTree trace 输出三种决策：显式 parent / path 推导 / 根', () => {
    const logs: string[] = []
    buildRouteTree(
      [
        block({ path: '/home', name: 'home' }),
        block({ path: '/home/profile', name: 'hp' }),
        block({ path: '/order/detail', name: 'od', parent: 'home' }),
        block({ path: '/standalone', name: 'sa' }),
      ],
      {},
      (msg) => logs.push(msg),
    )
    expect(logs.some((l) => l.includes('/home/profile') && l.includes('path 前缀推导'))).toBe(true)
    expect(logs.some((l) => l.includes('/order/detail') && l.includes('显式 parent'))).toBe(true)
    expect(logs.some((l) => l.includes('/standalone') && l.includes('根路由'))).toBe(true)
  })

  it('runGenRoutes trace 输出来源登记 + 父路由推导依据', () => {
    const logs: string[] = []
    runGenRoutes({
      config: {
        platform: 'mp-weixin',
        skyline: true,
        appid: 'wx0000000000',
        pagesDir: 'examples/pages',
        routesOutput: 'examples/router/auto-routes.ts',
        customRoute: { registerPresets: true, builders: {} },
        setDataBridge: { batchWindow: 16, perComponent: true },
        style: { px2rpx: true, rpxRatio: 2 },
      },
      root: process.cwd(),
      trace: (msg) => logs.push(msg),
    })
    expect(logs.some((l) => l.includes('来源登记'))).toBe(true)
    expect(logs.some((l) => l.includes('parent'))).toBe(true)
  })
})

// tests/router-plan.test.ts
// 路由管理透明化 M1/M2 单测（docs/proteus-router-plan 01/02）：
//   M1 scanRoutes（<route> 块解析 + schema 校验 + 报错定位）
//   M2 buildRouteTree（嵌套树：path 推导 + parent 显式 + 环检测）+ mergeMeta
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanRoutes } from '../packages/router/src/scan'
import { buildRouteTree, sortByPath } from '../packages/router/src/tree'
import { mergeMeta } from '../packages/router/src/merge'
import { RouteValidationError, checkDuplicates, validateParentRefs } from '../packages/router/src/schema'
import type { RouteBlock, RouteNode } from '../packages/router/src/types'

const FIX = fileURLToPath(new URL('./fixtures/router-plan', import.meta.url))

/** 测试辅助：构造 RouteBlock（tree/merge 直接喂数据，不依赖磁盘）；lazy 不预设，交给测试自己控制 */
function block(partial: Partial<RouteBlock> & { path: string }): RouteBlock {
  return {
    loc: { file: partial.name ?? partial.path, line: 1, column: 1 },
    meta: {},
    componentPath: partial.name ?? partial.path,
    ...partial,
  }
}

describe('M1 scanRoutes：<route> 块解析 + 校验', () => {
  it('提取 path/name/meta 并定位行号', () => {
    const routes = scanRoutes(path.join(FIX, 'pages'))
    expect(routes.map((r) => r.path).sort()).toEqual(['/home', '/home/profile', '/user', '/user/order'])
    expect(routes.find((r) => r.path === '/home')).toMatchObject({
      name: 'home',
      meta: { title: '首页', transition: 'slideUp' },
    })
    // loc 指向 <route> 块起始行（home.vue 第 5 行）
    const home = routes.find((r) => r.path === '/home')!
    expect(home.loc.file.endsWith('home.vue')).toBe(true)
    expect(home.loc.line).toBe(5)
  })

  it('页面无 <route> 块 → 跳过（不报错）', () => {
    const routes = scanRoutes(path.join(FIX, 'pages'))
    expect(routes.some((r) => r.path === '/private')).toBe(false)
  })

  it('path 缺失 → RouteValidationError + loc', () => {
    expect(() => scanRoutes(path.join(FIX, 'errors/missing-path'))).toThrow(RouteValidationError)
    try {
      scanRoutes(path.join(FIX, 'errors/missing-path'))
    } catch (err) {
      const e = err as RouteValidationError
      expect(e.message).toMatch(/缺少 path/)
      expect(e.loc.file.endsWith('missing-path/a.vue')).toBe(true)
    }
  })

  it('path 重复 → 报错并指向两个文件', () => {
    try {
      scanRoutes(path.join(FIX, 'errors/dup'))
      expect.unreachable('应抛错')
    } catch (err) {
      const e = err as RouteValidationError
      expect(e.message).toMatch(/重复/)
      expect(e.message).toMatch(/dup\/a\.vue/)
    }
  })

  it('name 不规范 → 报错', () => {
    expect(() => scanRoutes(path.join(FIX, 'errors/bad-name'))).toThrow(/name "Bad-Name" 不合法/)
  })

  it('meta.transition 非法 → 报错', () => {
    expect(() => scanRoutes(path.join(FIX, 'errors/bad-transition'))).toThrow(/transition "flip" 非法/)
  })

  it('一个文件多个 <route> 块 → 报错', () => {
    expect(() => scanRoutes(path.join(FIX, 'errors/multi-route'))).toThrow(/只允许一个 <route> 块/)
  })

  it('<route> 块非法 JSON → 报错', () => {
    expect(() => scanRoutes(path.join(FIX, 'errors/bad-json'))).toThrow(/不是合法 JSON/)
  })

  it('parent 引用不存在的 name → 报错', () => {
    const routes = [
      block({ path: '/x', name: 'x', parent: 'ghost' }),
      block({ path: '/y', name: 'y' }),
    ]
    expect(() => scanRoutesFromBlocks(routes)).toThrow(/parent "ghost" 未找到/)
  })
})

// scanRoutes 的收口校验（checkDuplicates / validateParentRefs）抽出来复用构造数据
function scanRoutesFromBlocks(routes: RouteBlock[]): RouteBlock[] {
  checkDuplicates(routes)
  validateParentRefs(routes)
  return routes
}

describe('M2 buildRouteTree：嵌套树构建', () => {
  it('规则 A：path 前缀推导父子（/a、/a/b、/a/c → /a 有 2 子）', () => {
    const tree = buildRouteTree([
      block({ path: '/a', name: 'a' }),
      block({ path: '/a/b', name: 'ab' }),
      block({ path: '/a/c', name: 'ac' }),
      block({ path: '/d', name: 'd' }),
    ])
    expect(tree.map((n) => n.path)).toEqual(['/a', '/d']) // 稳定排序：同级按字典序
    const a = tree[0]
    expect(a.children.map((c) => c.path).sort()).toEqual(['/a/b', '/a/c'])
  })

  it('规则 B：显式 parent 覆盖 path 前缀（路径不反映层级）', () => {
    const tree = buildRouteTree([
      block({ path: '/user', name: 'user' }),
      block({ path: '/order/detail', name: 'orderDetail', parent: 'user' }), // path 无 /user 前缀
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.name)).toEqual(['orderDetail'])
  })

  it('parent 找不到 → 报错 + loc', () => {
    expect(() =>
      buildRouteTree([block({ path: '/x', name: 'x' }), block({ path: '/y', name: 'y', parent: 'ghost' })]),
    ).toThrow(/parent "ghost" 未找到/)
  })

  it('parent 成环 → 报错', () => {
    expect(() =>
      buildRouteTree([
        block({ path: '/a', name: 'a', parent: 'b' }),
        block({ path: '/b', name: 'b', parent: 'a' }),
      ]),
    ).toThrow(/成环/)
  })

  it('默认值合并：defaults.meta / lazy 注入，页面 meta 胜', () => {
    const tree = buildRouteTree(
      [block({ path: '/a', name: 'a', meta: { title: 'A' } })],
      { meta: { transition: 'slideUp', needLogin: false }, lazy: false },
    )
    expect(tree[0].meta).toMatchObject({ title: 'A', transition: 'slideUp', needLogin: false })
    expect(tree[0].lazy).toBe(false)
  })

  it('sortByPath 稳定：同段数按字典序，同 path 保持原顺序', () => {
    const mk = (path: string): RouteNode => ({ ...block({ path }), children: [], lazy: true })
    const sorted = sortByPath([mk('/b/2'), mk('/a'), mk('/b/1'), mk('/b/2')])
    expect(sorted.map((n) => n.path)).toEqual(['/a', '/b/1', '/b/2', '/b/2']) // 两个 /b/2 稳定相邻
  })
})

describe('M2 mergeMeta：全局默认 < 页面', () => {
  it('浅合并：页面标量覆盖全局', () => {
    expect(mergeMeta({ title: '全局', transition: 'slideUp' }, { title: '页面' })).toEqual({
      title: '页面',
      transition: 'slideUp',
    })
  })

  it('嵌套对象深合并（页面字段并入全局嵌套对象）', () => {
    expect(mergeMeta({ nav: { color: 'red', size: 2 } }, { nav: { color: 'blue' } })).toEqual({
      nav: { color: 'blue', size: 2 },
    })
  })

  it('页面无 meta / 全局无 meta 均安全', () => {
    expect(mergeMeta(undefined, { title: 'A' })).toEqual({ title: 'A' })
    expect(mergeMeta({ title: 'G' }, undefined)).toEqual({ title: 'G' })
    expect(mergeMeta(undefined, undefined)).toEqual({})
  })
})

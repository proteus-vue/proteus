// tests/router-codegen.test.ts
// 路由规划 M3/M4：Web codegen（vue-router）+ MP codegen（app.json 平铺/routeType/合并）+ 三端共享转场映射
import { describe, it, expect } from 'vitest'
import {
  generateWebRoutes,
  generateMpConfig,
  mergeAppJson,
  flattenNodes,
  webTransitionName,
  mpRouteType,
} from '../packages/router/src/codegen'
import type { RouteNode } from '../packages/router/src/types'

/** 构造 RouteNode（scan/tree 管线产物） */
function node(partial: Partial<RouteNode> & { path: string }): RouteNode {
  return {
    loc: { file: 'x.vue', line: 1, column: 1 },
    meta: {},
    lazy: true,
    componentPath: `/abs${partial.path}.vue`,
    children: [],
    ...partial,
  }
}

describe('M3 Web codegen（vue-router）', () => {
  it('生成 routes 代码：lazy → () => import()，children 递归嵌套', () => {
    const tree = [
      node({ path: '/home', name: 'home', meta: { title: '首页', transition: 'slideUp' } }),
      node({ path: '/home/profile', name: 'homeProfile', children: [] }),
    ]
    tree[0].children = [tree[1]]
    const code = generateWebRoutes(tree)
    expect(code).toContain('() => import("/abs/home.vue")') // lazy 代码分割（JSON.stringify 双引号）
    expect(code).toContain('name: "home"')
    expect(code).toContain('children: [') // 嵌套
    expect(code).toContain('path: "/home/profile"')
    // transition 不直接映射进 vue-router meta（交给 RouterTransition），但 title 保留
    expect(code).toContain('title')
    expect(code).not.toContain('"transition"')
    // 产物头标注来源（决策链反查）
    expect(code).toContain('AUTO-GENERATED')
  })

  it('lazy=false → defineAsyncComponent 静态形态', () => {
    const code = generateWebRoutes([node({ path: '/x', name: 'x', lazy: false })])
    expect(code).toContain('defineAsyncComponent')
  })
})

describe('M4 MP codegen（app.json 平铺 + routeType + 合并）', () => {
  it('嵌套降级：children 平铺为 pages，meta.__parent 保留父链', () => {
    const tree = [node({ path: '/user', name: 'user' })]
    const profile = node({ path: '/user/profile', name: 'userProfile', meta: { transition: 'slideUp' } })
    tree[0].children = [profile]
    const cfg = generateMpConfig(tree)
    expect(cfg.pages).toHaveLength(2) // 平铺
    const user = cfg.pages.find((p) => p.path === 'user')
    expect(user).toBeDefined()
    expect(user!.__parent).toBeUndefined()
    const prof = cfg.pages.find((p) => p.path === 'user/profile')
    expect(prof!.__parent).toBe('user') // 嵌套降级
    expect(prof!.routeType).toBe('slideUp') // routeType 映射
  })

  it('routeType 映射全覆盖（slideUp/slideDown/halfScreen/scaleDown/none）', () => {
    expect(mpRouteType('slideUp')).toBe('slideUp')
    expect(mpRouteType('slideDown')).toBe('slideDown')
    expect(mpRouteType('halfScreen')).toBe('halfScreen')
    expect(mpRouteType('scaleDown')).toBe('scaleDown')
    expect(mpRouteType('none')).toBeUndefined() // 无动画不声明
    expect(mpRouteType(undefined)).toBeUndefined()
    expect(mpRouteType('weird' as never)).toBeUndefined() // 非法兜底
  })

  it('mergeAppJson：<route> 字段优先，用户手写自定义字段不被覆盖', () => {
    const existing = { window: { navigationStyle: 'custom' }, pages: ['old'] }
    const generated = { pages: ['new'], componentFramework: 'glass-easel' }
    const merged = mergeAppJson(existing, generated)
    expect(merged.pages).toEqual(['new']) // generated 优先
    expect(merged.componentFramework).toBe('glass-easel')
    expect(merged.window).toEqual({ navigationStyle: 'custom' }) // 用户自定义保留
  })
})

describe('三端共享转场映射（透明化：不再各端硬编码）', () => {
  it('webTransitionName：slideUp→slide-up / halfScreen→halfscreen / scaleDown→scale / 其他→fade', () => {
    expect(webTransitionName('slideUp')).toBe('slide-up')
    expect(webTransitionName('halfScreen')).toBe('halfscreen')
    expect(webTransitionName('scaleDown')).toBe('scale')
    expect(webTransitionName('slideDown')).toBe('slide-down')
    expect(webTransitionName('none')).toBe('fade')
    expect(webTransitionName(undefined)).toBe('fade')
    expect(webTransitionName('wx://bottom-sheet')).toBe('fade') // 非枚举兜底
  })
})

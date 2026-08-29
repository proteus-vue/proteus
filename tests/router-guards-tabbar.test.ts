// tests/router-guards-tabbar.test.ts
// 路由规划 M6（B6）：Router 实例守卫 API + 守卫 trace + redirect 跨端 + tabBar config 驱动
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@proteus/shared', () => ({
  adapter: {
    isMP: true,
    getCurrentPages: vi.fn(() => [{ route: 'pages/index' }]),
    navigateTo: vi.fn(async () => {}),
    redirectTo: vi.fn(async () => {}),
    reLaunch: vi.fn(async () => {}),
    switchTab: vi.fn(async () => {}),
    navigateBack: vi.fn(),
  },
}))

vi.mock('../packages/router/src/skyline', () => ({
  isSkyline: vi.fn(() => false),
  navigateWithCustomRoute: vi.fn(async () => {}),
}))

import { createRouter } from '../packages/router/src/index'
import { clearGuards } from '../packages/router/src/guards'
import { routes } from '../examples/router/auto-routes'
import { generateWebRoutes, generateMpConfig } from '../packages/router/src/codegen'
import type { RouteNode } from '../packages/router/src/types'

const router = createRouter(routes)

beforeEach(() => {
  vi.clearAllMocks()
  clearGuards() // 守卫是模块级注册表：测试间清理防累积
})

describe('M6 守卫：Router 实例 API + trace', () => {
  it('router.beforeEach 注册的守卫生效（返回 false 取消导航）', async () => {
    router.beforeEach((to) => to.name === 'index')
    await router.push({ name: 'user' })
    // 守卫返回 false（index 为 true 才放行）→ 导航取消
    const { adapter } = await import('@proteus/shared')
    expect(vi.mocked(adapter.navigateTo)).not.toHaveBeenCalled()
  })

  it('★B11：requiresAuth 自动守卫（createRouter auth 检查器——未登录拦截，onAuthFail 触发）', async () => {
    // 现有 auto-routes 中 user 相关页面 requiresAuth: true
    const authed = createRouter(routes, {
      auth: async () => false,
      onAuthFail: vi.fn(),
    })
    const { adapter } = await import('@proteus/shared')
    await authed.push({ name: 'user' })
    expect(vi.mocked(adapter.navigateTo)).not.toHaveBeenCalled() // 未登录拦截
    expect((authed as unknown as { options: { onAuthFail: ReturnType<typeof vi.fn> } }).options.onAuthFail).toHaveBeenCalled()

    // 已登录 → 放行
    const loggedIn = createRouter(routes, { auth: async () => true })
    await loggedIn.push({ name: 'user' })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
  })

  it('★B11：无 auth 检查器 / 非 requiresAuth 页面 → 放行（默认行为不变）', async () => {
    const { adapter } = await import('@proteus/shared')
    await router.push({ name: 'forms' }) // 非 tab 非 requiresAuth → navigateTo
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
    await router.push({ name: 'user' }) // requiresAuth 但无 auth 检查器 → 放行
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
  })

  it('守卫放行 → 正常导航；afterEach 执行', async () => {
    const afterSpy = vi.fn()
    router.afterEach((to) => void afterSpy(to.name))
    await router.push({ name: 'index' }) // beforeEach 放行（name === 'index'）
    const { adapter } = await import('@proteus/shared')
    expect(vi.mocked(adapter.switchTab)).toHaveBeenCalled()
    expect(afterSpy).toHaveBeenCalledWith('index')
  })

  it('守卫 trace：拦截/放行输出 [guard] 决策（--trace-router）', async () => {
    const logs: string[] = []
    const origLog = console.log
    // 注入构建期调试开关（trace 仅在 __PROTEUS_DEBUG__ 时输出，对齐 MP 构建 PROTEUS_DEBUG=1）
    ;(globalThis as { __PROTEUS_DEBUG__?: boolean }).__PROTEUS_DEBUG__ = true
    console.log = (...args: unknown[]) => void logs.push(String(args[0]))
    try {
      router.beforeEach((to) => to.name === 'user')
      await router.push({ name: 'user' })
      await router.push({ name: 'user-profile' }) // 被拦截
      const guardLogs = logs.filter((l) => l.startsWith('[guard]'))
      expect(guardLogs.length).toBeGreaterThanOrEqual(2)
      expect(guardLogs.some((l) => l.includes('放行'))).toBe(true)
      expect(guardLogs.some((l) => l.includes('被拦截'))).toBe(true)
    } finally {
      console.log = origLog
      delete (globalThis as { __PROTEUS_DEBUG__?: boolean }).__PROTEUS_DEBUG__
    }
  })
})

describe('M6 redirect 跨端', () => {
  it('Web codegen：redirect 字段映射进 vue-router record', () => {
    const nodes: RouteNode[] = [
      {
        loc: { file: 'a.vue', line: 1, column: 1 },
        path: '/old',
        name: 'old',
        redirect: '/new',
        meta: {},
        lazy: true,
        componentPath: '/a.vue',
        children: [],
      },
    ]
    const code = generateWebRoutes(nodes)
    expect(code).toContain('redirect: "/new"')
  })

  it('MP codegen：页配置带 redirect 标注（运行时 onLoad redirectTo 模拟）', () => {
    const nodes: RouteNode[] = [
      {
        loc: { file: 'a.vue', line: 1, column: 1 },
        path: '/old',
        name: 'old',
        redirect: '/new',
        meta: {},
        lazy: true,
        componentPath: '/a.vue',
        children: [],
      },
    ]
    const cfg = generateMpConfig(nodes)
    expect(cfg.pages[0].redirect).toBe('/new')
  })
})

describe('M6 tabBar：config 驱动 + 超限告警降级', () => {
  it('generateMpConfig 带 tabBar → app.json tabBar（pagePath 匹配路由 path）', () => {
    const nodes: RouteNode[] = [
      { loc: { file: 'h.vue', line: 1, column: 1 }, path: '/home', name: 'home', meta: {}, lazy: true, componentPath: '/h.vue', children: [] },
      { loc: { file: 'm.vue', line: 1, column: 1 }, path: '/mine', name: 'mine', meta: {}, lazy: true, componentPath: '/m.vue', children: [] },
    ]
    const cfg = generateMpConfig(nodes, {
      color: '#999',
      selectedColor: '#007AFF',
      list: [
        { name: 'home', text: '首页' },
        { name: 'mine', text: '我的' },
      ],
    })
    expect(cfg.tabBar).toEqual({
      color: '#999',
      selectedColor: '#007AFF',
      list: [
        { pagePath: 'home', text: '首页' },
        { pagePath: 'mine', text: '我的' },
      ],
    })
  })

  it('超过 5 项 → 告警降级（小程序原生上限）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nodes: RouteNode[] = [1, 2, 3, 4, 5, 6].map((i) => ({
      loc: { file: 'x.vue', line: 1, column: 1 },
      path: `/tab${i}`,
      name: `tab${i}`,
      meta: {},
      lazy: true,
      componentPath: `/x.vue`,
      children: [],
    }))
    generateMpConfig(nodes, { list: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `tab${i}`, text: `T${i}` })) })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超过小程序原生上限'))
    warnSpy.mockRestore()
  })
})

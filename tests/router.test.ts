// tests/router.test.ts
// router 单测（文档 P6-3）：mock platform/adapter + skyline，验证导航分发 / 守卫 / 栈深保护
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

vi.mock('../src/platform', () => ({
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

vi.mock('../src/router/skyline', () => ({
  isSkyline: vi.fn(() => false),
  navigateWithCustomRoute: vi.fn(async () => {}),
}))

import { adapter } from '../src/platform'
import { isSkyline, navigateWithCustomRoute } from '../src/router/skyline'
import { router } from '../src/router/index'
import { beforeEach as registerGuard } from '../src/router/guards'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adapter).isMP = true
  vi.mocked(adapter.getCurrentPages).mockReturnValue([{ route: 'pages/index' }])
  vi.mocked(isSkyline).mockReturnValue(false)
})

describe('router.push 导航分发', () => {
  it('命名路由 + params → navigateTo（URL 自动 encode）', async () => {
    await router.push({ name: 'user-profile', params: { id: 1, kw: 'a b' } })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalledWith({ url: '/pages/user/profile?id=1&kw=a%20b' })
  })

  it('params 与 query 合并', async () => {
    await router.push({ name: 'user-profile', params: { id: 1 }, query: { tab: 'info' } })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalledWith({ url: '/pages/user/profile?id=1&tab=info' })
  })

  it('undefined 参数被过滤', async () => {
    await router.push({ name: 'user-profile', params: { id: undefined } })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalledWith({ url: '/pages/user/profile' })
  })

  it('Tab 页面 → switchTab（不带 query）', async () => {
    await router.push({ name: 'index' })
    expect(vi.mocked(adapter.switchTab)).toHaveBeenCalledWith({ url: 'pages/index' })
  })

  it('replace → redirectTo', async () => {
    await router.replace({ name: 'user' })
    expect(vi.mocked(adapter.redirectTo)).toHaveBeenCalledWith({ url: '/pages/user/index' })
  })

  it('reLaunch → reLaunch', async () => {
    await router.push({ name: 'user', reLaunch: true })
    expect(vi.mocked(adapter.reLaunch)).toHaveBeenCalledWith({ url: '/pages/user/index' })
  })

  it('不存在的命名路由 → 抛错', async () => {
    await expect(router.push({ name: 'not-exist' })).rejects.toThrow('route not found')
  })

  it('back → navigateBack', () => {
    router.back(2)
    expect(vi.mocked(adapter.navigateBack)).toHaveBeenCalledWith({ delta: 2 })
  })

  it('stackDepth 读取页面栈', () => {
    expect(router.stackDepth).toBe(1)
  })
})

describe('栈深保护（仅 MP 生效）', () => {
  it('isMP 且栈深 ≥9 → 自动降级 redirectTo', async () => {
    vi.mocked(adapter.getCurrentPages).mockReturnValue(Array(9).fill({ route: 'pages/index' }))
    await router.push({ name: 'user-profile' })
    expect(vi.mocked(adapter.redirectTo)).toHaveBeenCalled()
    expect(vi.mocked(adapter.navigateTo)).not.toHaveBeenCalled()
  })

  it('Web（isMP=false）栈深恒 1 → 不降级', async () => {
    vi.mocked(adapter).isMP = false
    await router.push({ name: 'user-profile' })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
    expect(vi.mocked(adapter.redirectTo)).not.toHaveBeenCalled()
  })
})

describe('Skyline 自定义路由', () => {
  it('routeType + isSkyline → navigateWithCustomRoute', async () => {
    vi.mocked(isSkyline).mockReturnValue(true)
    await router.push({ name: 'user-profile', routeType: 'halfScreen' })
    expect(vi.mocked(navigateWithCustomRoute)).toHaveBeenCalledWith('/pages/user/profile', 'halfScreen')
    expect(vi.mocked(adapter.navigateTo)).not.toHaveBeenCalled()
  })

  it('非 Skyline 环境 → routeType 忽略，普通跳转', async () => {
    await router.push({ name: 'user-profile', routeType: 'halfScreen' })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
  })
})

describe('路由守卫', () => {
  let guardResult: boolean | void = true
  const guardSpy = vi.fn(() => guardResult)

  beforeAll(() => {
    registerGuard(guardSpy)
  })

  beforeEach(() => {
    guardResult = true
  })

  it('守卫返回 false → 取消导航', async () => {
    guardResult = false
    await router.push({ name: 'user-profile' })
    expect(vi.mocked(adapter.navigateTo)).not.toHaveBeenCalled()
    expect(guardSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'user-profile' }), expect.anything())
  })

  it('守卫放行 → 正常导航', async () => {
    await router.push({ name: 'user-profile' })
    expect(vi.mocked(adapter.navigateTo)).toHaveBeenCalled()
  })
})

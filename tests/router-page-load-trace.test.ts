// tests/router-page-load-trace.test.ts —— Web 端非 push 导航（站内 <a> 链接 / 浏览器前进后退）→ TraceBus 补发
// ★决策 #255：web adapter 的 click 拦截/popstate 直接改 URL + onPageLoad 通知，绕过 router.push →
//   补 trace 让 devtools route 回溯完整（from/to + 耗时）；push 内部导航去重（tracePending 消费）
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => {
  const handlers: Array<(route: string, query: Record<string, string>, routeType?: string, nav?: string) => void> = []
  return {
    handlers,
    /** 模拟 web adapter 导航 → onPageLoad 通知（a 链接/popstate 路径） */
    emit(route: string, nav = 'forward'): void {
      for (const h of [...handlers]) h(route, {}, undefined, nav)
    },
  }
})

vi.mock('@proteus-vue/shared', () => ({
  adapter: {
    isMP: false,
    getCurrentPages: vi.fn(() => [{ route: 'pages/index' }]),
    navigateTo: vi.fn(async (opts: { url: string }) => {
      mockState.emit(opts.url.replace(/^\//, ''), 'forward')
    }),
    redirectTo: vi.fn(async () => {}),
    reLaunch: vi.fn(async () => {}),
    switchTab: vi.fn(async () => {}),
    navigateBack: vi.fn(),
    onPageLoad: (cb: (route: string, query: Record<string, string>, routeType?: string, nav?: string) => void): void => {
      mockState.handlers.push(cb)
    },
  },
}))

vi.mock('../packages/router/src/skyline', () => ({
  isSkyline: vi.fn(() => false),
  navigateWithCustomRoute: vi.fn(async () => {}),
}))

import { createRouter } from '@proteus-vue/router'
import type { RouterTraceBus } from '@proteus-vue/router'
import { routes } from '../examples/router/auto-routes'

interface Recorded {
  source: string
  phase: string
  name: string
  payload: unknown
  traceId?: string
}

function mockBus() {
  const events: Recorded[] = []
  const emit = vi.fn((source: string, phase: string, name: string, payload?: unknown, traceId?: string) => {
    events.push({ source, phase, name, payload, traceId })
  })
  return { emit, events }
}

beforeEach(() => {
  mockState.handlers.length = 0
  vi.clearAllMocks()
})

describe('Web 非 push 导航 → TraceBus 补发', () => {
  it('站内 <a> 链接导航（onPageLoad forward）→ 补发 router start/end（from=初始路由 → to）', () => {
    const bus = mockBus()
    createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    mockState.emit('pages/forms', 'forward')
    expect(bus.events.map((e) => e.name)).toEqual(['navigate pages/forms', 'navigate pages/forms'])
    const start = bus.events[0]
    expect(start.phase).toBe('start')
    expect((start.payload as { from: { path: string }; to: { path: string } }).from.path).toBe('pages/index')
    expect((start.payload as { from: { path: string }; to: { path: string } }).to.path).toBe('pages/forms')
    expect(bus.events[1].phase).toBe('end')
  })

  it('浏览器后退（onPageLoad back）→ 同样补发（route 回溯覆盖真实导航路径）', () => {
    const bus = mockBus()
    createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    mockState.emit('pages/index', 'back')
    expect(bus.events.filter((e) => e.phase === 'start').length).toBe(1)
  })

  it('from 基准随导航维护（连续非 push 导航 → from = 上一次路由）', () => {
    const bus = mockBus()
    createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    mockState.emit('pages/forms', 'forward')
    mockState.emit('pages/config-demo', 'forward')
    const second = bus.events[2]
    expect((second.payload as { from: { path: string } }).from.path).toBe('pages/forms')
  })

  it('★push 内部导航去重：push → adapter navigateTo → onPageLoad 消费 tracePending → 不重复补发', async () => {
    const bus = mockBus()
    const router = createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    await router.push({ name: 'forms' })
    // mock 的 navigateTo 会触发 onPageLoad（模拟真实 web adapter）——push 的 tracePending 消费跳过
    expect(bus.events.map((e) => e.name)).toEqual(['navigate forms', 'guard beforeEach:next', 'navigate forms'])
    expect(bus.events.filter((e) => e.phase === 'start').length).toBe(1)
  })

  it('★根路径归一化：web adapter 把 / 归一化为空串 → 补发时统一回 index（后退到首页 from/to 可读）', () => {
    const bus = mockBus()
    createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    mockState.emit('', 'back') // 后退到根路径（location.pathname = '/'）
    const start = bus.events[0]
    expect(start.phase).toBe('start')
    expect((start.payload as { to: { path: string } }).to.path).toBe('index')
    expect(bus.events[1].phase).toBe('end')
  })
})

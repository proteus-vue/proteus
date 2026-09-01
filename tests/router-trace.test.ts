// tests/router-trace.test.ts —— devtools 打通：router → TraceBus → 面板 route 回溯
// 协议（RouterOptions.traceBus，结构类型注入零硬依赖）：
//   start `navigate <name|path>` payload { from, to } traceId 配对 → point `guard <name>:next|cancel` → end
// @vitest-environment happy-dom（面板集成断言）
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@proteus-vue/shared', () => ({
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

import { createRouter } from '@proteus-vue/router'
import type { RouterTraceBus } from '@proteus-vue/router'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import { createTraceBusSource, createDevtoolsPanel } from '@proteus-vue/devtools'
import { beforeEach as registerGuard, clearGuards } from '../packages/router/src/guards'
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
  clearGuards()
  vi.clearAllMocks()
})

describe('router → TraceBus 协议', () => {
  it('push 成功 → start(navigate + from/to payload) → guard beforeEach:next → end（traceId 配对）', async () => {
    const bus = mockBus()
    const router = createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    await router.push({ name: 'forms' })
    expect(bus.events.map((e) => e.name)).toEqual(['navigate forms', 'guard beforeEach:next', 'navigate forms'])
    const start = bus.events[0]
    expect(start.phase).toBe('start')
    expect((start.payload as { to: { path: string } }).to.path).toBe('pages/forms')
    expect((start.payload as { from: { path: string } }).from.path).toBe('pages/index') // adapter 栈顶
    expect(start.traceId).toBeDefined()
    expect(bus.events[2].phase).toBe('end')
    expect(bus.events[2].traceId).toBe(start.traceId) // start/end 配对
  })

  it('requiresAuth 拦截 → start → guard requiresAuth:cancel → end（被拦截导航也记录）', async () => {
    const bus = mockBus()
    const router = createRouter(routes, { traceBus: bus as unknown as RouterTraceBus, auth: () => false })
    await router.push({ name: 'user' })
    expect(bus.events.map((e) => e.name)).toEqual(['navigate user', 'guard requiresAuth:cancel', 'navigate user'])
    expect(bus.events[1].phase).toBe('point')
    expect(bus.events[2].phase).toBe('end')
    expect(router.stackDepth).toBe(1) // 未跳转（navigateTo 未被调用）
  })

  it('用户守卫返回 false → start → guard beforeEach:cancel → end', async () => {
    const bus = mockBus()
    const router = createRouter(routes, { traceBus: bus as unknown as RouterTraceBus })
    registerGuard(() => false)
    await router.push({ name: 'forms' })
    expect(bus.events.map((e) => e.name)).toEqual(['navigate forms', 'guard beforeEach:cancel', 'navigate forms'])
  })

  it('无 traceBus → 导航正常不抛错（缺省关闭）', async () => {
    const router = createRouter(routes)
    await expect(router.push({ name: 'forms' })).resolves.toBeUndefined()
  })
})

describe('router → 面板 route 回溯（集成）', () => {
  it('真实 TraceBus → createTraceBusSource → 面板 route 视图出导航记录 + 守卫徽章 + 耗时', async () => {
    const root = document.createElement('div')
    const bus = createTraceBus({ enabled: true })
    const panel = createDevtoolsPanel(root, { source: createTraceBusSource(bus) })
    const router = createRouter(routes, { traceBus: bus })
    await router.push({ name: 'forms' })
    await new Promise((r) => setTimeout(r, 40)) // 16ms 节流渲染
    panel.show('route')
    const routeView = root.querySelector('.pd-view[data-view="route"]') as HTMLElement
    expect(routeView.querySelectorAll('.pd-nav').length).toBe(1)
    // 导航链 from → to
    expect(routeView.querySelector('.pd-nav-path')?.textContent).toContain('pages/index')
    expect(routeView.querySelector('.pd-nav-path')?.textContent).toContain('pages/forms')
    // 守卫徽章（beforeEach:next → pd-guard-next）
    const guard = routeView.querySelector('.pd-guard') as HTMLElement
    expect(guard).not.toBeNull()
    expect(guard.textContent).toContain('beforeEach')
    expect(guard.classList.contains('pd-guard-next')).toBe(true)
    // 耗时元信息
    expect(routeView.querySelector('.pd-nav-meta')?.textContent).toContain('ms')
    panel.destroy()
  })

  it('requiresAuth 拦截 → 面板 route 视图展示守卫 cancel 徽章（红）', async () => {
    const root = document.createElement('div')
    const bus = createTraceBus({ enabled: true })
    const panel = createDevtoolsPanel(root, { source: createTraceBusSource(bus) })
    const router = createRouter(routes, { traceBus: bus, auth: () => false })
    await router.push({ name: 'user' })
    await new Promise((r) => setTimeout(r, 40))
    panel.show('route')
    const routeView = root.querySelector('.pd-view[data-view="route"]') as HTMLElement
    const guard = routeView.querySelector('.pd-guard') as HTMLElement
    expect(guard).not.toBeNull()
    expect(guard.textContent).toContain('requiresAuth')
    expect(guard.classList.contains('pd-guard-cancel')).toBe(true)
    panel.destroy()
  })
})

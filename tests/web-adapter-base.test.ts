// tests/web-adapter-base.test.ts
// @vitest-environment jsdom
// ★Web adapter 子路径部署回归锁（2026-09-26）：
//   官网 iframe 嵌 showcase 演示 → showcase 以 PROTEUS_BASE=/showcase/ 子路径部署 →
//   adapter 必须在「读路由时剥 base」（route 表按根路径注册）与「写地址时带 base」
//   （浏览器地址栏/刷新归属正确）两个方向都处理；缺省 BASE_URL='/' 时完全直通。
//   此前 location.pathname 裸读 → /showcase/pages/index 被当成 route
//   'showcase/pages/index' → 路由表查无此页（子路径部署即白屏）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWebAdapter } from '../packages/shared/src/platform/web-adapter'

describe('★Web adapter：vite base 子路径（strip 读 / withBase 写）', () => {
  beforeEach(() => {
    vi.stubEnv('BASE_URL', '/showcase/')
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('初始路由剥 base：/showcase/pages/index → route "pages/index"', () => {
    window.history.pushState(null, '', '/showcase/pages/index')
    const adapter = createWebAdapter()
    expect(adapter.getCurrentPages()[0]?.route).toBe('pages/index')
  })

  it('★目录式深链尾斜杠归一：/showcase/pages/a/ → route "pages/a"（GitHub Pages 目录 301 恒带尾斜杠）', () => {
    window.history.pushState(null, '', '/showcase/subpackages/components/pages/p-button/')
    const adapter = createWebAdapter()
    expect(adapter.getCurrentPages()[0]?.route).toBe('subpackages/components/pages/p-button')
  })

  it('navigateTo：route 按根路径解析 + 浏览器地址带 base 前缀', async () => {
    const adapter = createWebAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.navigateTo({ url: '/subpackages/components/pages/p-button' })
    expect(adapter.getCurrentPages()[0]?.route).toBe('subpackages/components/pages/p-button')
    expect(window.location.pathname, '★浏览器地址应带 /showcase/ 前缀（刷新归属正确）').toBe(
      '/showcase/subpackages/components/pages/p-button',
    )
  })

  it('popstate 后退：从带 base 地址剥回根路径 route', async () => {
    const adapter = createWebAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.navigateTo({ url: '/pages/a' })
    // jsdom 的 history.back() 异步派发 popstate——等事件而非固定 sleep
    const popped = new Promise<void>((r) => window.addEventListener('popstate', () => r(), { once: true }))
    window.history.back()
    await popped
    await new Promise((r) => setTimeout(r, 0))
    expect(adapter.getCurrentPages()[0]?.route).toBe('')
  })

  it('reLaunch 同样带 base 写地址、剥 base 读路由', async () => {
    const adapter = createWebAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.reLaunch({ url: '/subpackages/capabilities/pages/log' })
    expect(window.location.pathname).toBe('/showcase/subpackages/capabilities/pages/log')
    expect(adapter.getCurrentPages()[0]?.route).toBe('subpackages/capabilities/pages/log')
  })
})

describe('★Web adapter：缺省 base "/" 直通（既有行为防回归）', () => {
  beforeEach(() => {
    vi.stubEnv('BASE_URL', '/')
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('navigateTo 地址不加前缀，route 原样', async () => {
    const adapter = createWebAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.navigateTo({ url: '/pages/editor?id=41' })
    expect(window.location.pathname).toBe('/pages/editor')
    expect(adapter.getCurrentPages()[0]?.route).toBe('pages/editor')
    expect(adapter.getCurrentPages()[0]?.query).toMatchObject({ id: '41' })
  })
})

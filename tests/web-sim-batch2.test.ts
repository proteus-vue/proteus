// tests/web-sim-batch2.test.ts
// ★批次 2 组件「Web 模拟层」契约回归锁（2026-09-14 用户真机/浏览器复测驱动）：
//   ① 多词属性必须 kebab 键可读（父级 `:scroll-y` → attrs['scroll-y']）——只读 camel 会静默失效；
//   ② scroll-view 事件为**裸载荷**（{ scrollTop }，非 { detail }），父级读 e.scrollTop；
//   ③ scroll-top 受控：属性变化才写 DOM（不每次渲染拉回）；
//   ④ view hover-* 按压时延（hover-start-time / hover-stay-time）；
//   ⑤ image show-menu-by-longpress 长按/右键弹菜单。
// 这些是真机/浏览器「看不到效果」类问题的直接根因锁定。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { WebView } from '../packages/built-in-components/src/components/view'
import { WebScrollView } from '../packages/built-in-components/src/components/scroll-view'
import { WebImage } from '../packages/built-in-components/src/components/image'

describe('★批次2 Web 模拟层契约', () => {
  let app: ReturnType<typeof createApp> | null = null
  let host: HTMLElement | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    app?.unmount()
    app = null
    host = null
    vi.useRealTimers()
  })

  it('① WebView 读 kebab hover-class（父级 :hover-class 到达 attrs["hover-class"]）', async () => {
    // 用未经编译的对象属性名模拟「父级 :hover-class」→ kebab 键
    const root = { render: () => h(WebView, { 'hover-class': 'my-hover', 'hover-start-time': 0 }, () => 'x') }
    app = createApp(root as never)
    app.mount(host!)
    const el = host!.querySelector('.proteus-web-view') as HTMLElement
    expect(el, 'WebView 应渲染 div').toBeTruthy()
    vi.useFakeTimers()
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await Promise.resolve()
    // hover-start-time=0 → 立即加类
    expect(el.className, 'hover-start-time=0 应立即出现按压类').toContain('my-hover')
  })

  it('④ WebView hover-start-time>0 有延时，hover-stay-time 后移除', async () => {
    vi.useFakeTimers()
    const root = { render: () => h(WebView, { hoverClass: 'h', hoverStartTime: 100, hoverStayTime: 200 }, () => 'x') }
    app = createApp(root as never)
    app.mount(host!)
    const el = host!.querySelector('.proteus-web-view') as HTMLElement
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    vi.advanceTimersByTime(50)
    await nextTick()
    expect(el.className, '50ms 时未到 100ms，不应有按压类').not.toContain(' h')
    vi.advanceTimersByTime(60)
    await nextTick()
    expect(el.className, '100ms 后应出现按压类').toContain('h')
    el.dispatchEvent(new Event('pointerup', { bubbles: true }))
    vi.advanceTimersByTime(250)
    await nextTick()
    expect(el.className, 'stay 200ms 后应移除按压类').not.toContain('h')
  })

  it('② WebScrollView 发出裸载荷 { scrollTop }（非包装 detail）', async () => {
    const events: Array<Record<string, unknown>> = []
    const root = {
      render: () => h(WebScrollView, { 'scroll-y': true, onScroll: (e: Record<string, unknown>) => events.push(e) }, () => 'x'),
    }
    app = createApp(root as never)
    app.mount(host!)
    const el = host!.querySelector('.proteus-web-scroll-view') as HTMLElement
    // 模拟滚动：jsdom 中 scrollTop 可写
    Object.defineProperty(el, 'scrollTop', { value: 120, configurable: true })
    el.dispatchEvent(new Event('scroll'))
    expect(events.length, '应发出 scroll').toBeGreaterThan(0)
    expect(events[0], '载荷应为裸对象（含 scrollTop）').toHaveProperty('scrollTop', 120)
    expect(events[0], '不应再包一层 detail').not.toHaveProperty('detail')
  })

  it('① WebScrollView 读 kebab scroll-y（决定 overflowY）', async () => {
    const root = { render: () => h(WebScrollView, { 'scroll-y': true }, () => 'x') }
    app = createApp(root as never)
    app.mount(host!)
    const el = host!.querySelector('.proteus-web-scroll-view') as HTMLElement
    // jsdom 保留 inline style 源串
    expect(el.getAttribute('style') || '', 'scroll-y=true（kebab）应映射 overflow-y:auto').toContain('auto')
  })

  it('⑤ WebImage show-menu-by-longpress：右键弹菜单', async () => {
    const root = { render: () => h(WebImage, { src: 'a.png', 'show-menu-by-longpress': true }, () => null) }
    app = createApp(root as never)
    app.mount(host!)
    expect(host!.querySelector('.proteus-web-image-menu'), '初始无菜单').toBeNull()
    const img = host!.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(host!.querySelector('.proteus-web-image-menu'), '右键后应弹菜单').toBeTruthy()
  })
})

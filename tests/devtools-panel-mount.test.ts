// tests/devtools-panel-mount.test.ts —— Web 端本地面板挂载（installProteusDevtools 一键接入）
// ★一键接入收口：不再需要 devtools-bus.ts / devtools-panel-mount.ts / devtools-panel.css
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { installProteusDevtools } from '@proteus-vue/devtools'
import { createTraceBus } from '@proteus-vue/devtools-runtime'

describe('installProteusDevtools 一键接入', () => {
  it('挂载 ◈ 按钮 → 点击创建面板（8 视图 + pages 注入）→ 事件进面板 → 再点隐藏；destroy 清理', async () => {
    const app = createApp({})
    const bus = createTraceBus({ enabled: true })
    const devtools = installProteusDevtools(app, {
      traceBus: bus,
      pages: { routes: [{ name: 'index', path: 'pages/index', meta: { isTab: true } }] },
    })
    // ◈ 按钮出现（初始隐藏 host）
    const btn = document.querySelector('.pd-floating-toggle') as HTMLButtonElement
    expect(btn).not.toBeNull()
    const host = document.querySelector('.pd-floating-host') as HTMLElement
    expect(host.style.display).toBe('none')
    // 点击 → 显示 + 面板 8 视图 + pages 数据
    btn.click()
    expect(host.style.display).toBe('block')
    expect(document.querySelectorAll('.pd-nav-item').length).toBe(8)
    const pagesView = document.querySelector('.pd-view[data-view="pages"]') as HTMLElement
    expect(pagesView.querySelector('.pd-page-row')).not.toBeNull()
    // 事件流 → 面板 timeline（同源 TraceBus 独立消费）
    bus.emit('lifecycle', 'start', 'boot', undefined, 't1')
    bus.emit('lifecycle', 'end', 'boot', undefined, 't1')
    await new Promise((r) => setTimeout(r, 40))
    expect(document.querySelector('.pd-span')?.textContent).toContain('boot')
    // 再点 → 隐藏（复用面板）
    btn.click()
    expect(host.style.display).toBe('none')
    devtools.destroy()
    app.unmount()
  })

  it('hmr 选项：vite 热更新事件 → TraceBus（timeline 显示 vite:update/full-reload/error）', async () => {
    const app = createApp({})
    const bus = createTraceBus({ enabled: true })
    const hmrListeners: Array<{ event: string; cb: (...args: unknown[]) => void }> = []
    const devtools = installProteusDevtools(app, {
      traceBus: bus,
      mount: false,
      hmr: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          hmrListeners.push({ event, cb })
          return () => {
            const i = hmrListeners.findIndex((l) => l.event === event && l.cb === cb)
            if (i >= 0) hmrListeners.splice(i, 1)
          }
        },
      },
    })
    expect(hmrListeners.map((l) => l.event)).toEqual(['vite:beforeUpdate', 'vite:beforeFullReload', 'vite:error'])
    // 触发 HMR 事件 → bus 有 hmr 记录
    const seen: string[] = []
    const off = bus.on((e) => seen.push(e.source + ':' + e.phase + ':' + e.name))
    hmrListeners[0].cb({ updates: [{ type: 'js-update' }] }) // vite:beforeUpdate
    hmrListeners[1].cb() // vite:beforeFullReload
    hmrListeners[2].cb(new Error('编译失败')) // vite:error
    expect(seen).toEqual(['hmr:point:vite:update', 'hmr:point:vite:full-reload', 'hmr:error:vite:error'])
    // destroy 解绑监听
    devtools.destroy()
    expect(hmrListeners.length).toBe(0)
    app.unmount()
    off()
  })

  it('★P0 状态应用：时间旅行滑块 → pinia store $patch 真实恢复（install 接线 onApplyState）', async () => {
    // ★模块级 panelMounted 单次挂载 + happy-dom document 跨测试持久 → 清 DOM + resetModules 拿全新模块实例
    document.body.replaceChildren()
    vi.resetModules()
    const { installProteusDevtools: install2 } = await import('@proteus-vue/devtools')
    const app = createApp({})
    const pinia = createPinia()
    app.use(pinia)
    setActivePinia(pinia)
    const useCart = defineStore('cart', { state: () => ({ items: 0 }) })
    const cart = useCart()
    const bus = createTraceBus({ enabled: true })
    const devtools = install2(app, { traceBus: bus, pinia, mount: true })
    // ★先开面板（订阅 bus）再变更——TraceBus on 不自动回放缓冲（决策 #249）
    const btn = document.querySelector('.pd-floating-toggle') as HTMLButtonElement
    expect(btn).not.toBeNull()
    btn.click()
    const host = document.querySelector('.pd-floating-host') as HTMLElement
    // 变更 → storeTracer 上报 store.patch（面板快照；★面板打开时 install 已补发当前快照 items:0 = 可恢复起点）
    cart.items = 1
    await new Promise((r) => setTimeout(r, 60))
    const navItems = Array.from(host.querySelectorAll('.pd-nav-item'))
    ;(navItems.find((n) => (n as HTMLElement).dataset.view === 'state') as HTMLElement).click()
    const stateView = host.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const range = stateView.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    // ★拖到最左（0）→ 恢复面板打开时状态（install 补发快照 items:0）——时间旅行可恢复起点
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(cart.items).toBe(0)
    // 变更后再回放：items=2 → 拖 0 仍恢复面板打开时状态（items:0）；拖 1 恢复第一次变更后（items:1）
    cart.items = 2
    await new Promise((r) => setTimeout(r, 60))
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(cart.items).toBe(0)
    range.value = '1'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(cart.items).toBe(1)
    devtools.destroy()
    app.unmount()
  })

  it('★P1 组件高亮：面板选中组件 → 页面元素描边闪烁（install 侧 getElement + pd-cmp-highlight）', async () => {
    document.body.replaceChildren()
    vi.resetModules()
    const { installProteusDevtools: install2 } = await import('@proteus-vue/devtools')
    const { createApp: createApp2, defineComponent: defineComponent2 } = await import('vue')
    const app = createApp2(defineComponent2({ name: 'Root', template: '<div id="root-el"><span/></div>' }))
    const bus = createTraceBus({ enabled: true })
    const devtools = install2(app, { traceBus: bus, mount: true })
    // ★先开面板（订阅 bus）再挂载组件——component.mount 事件才能进面板（TraceBus on 不自动回放 #249）
    const btn = document.querySelector('.pd-floating-toggle') as HTMLButtonElement
    btn.click()
    const host = document.querySelector('.pd-floating-host') as HTMLElement
    const mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    app.mount(mountEl)
    await new Promise((r) => setTimeout(r, 60))
    const navItems = Array.from(host.querySelectorAll('.pd-nav-item'))
    ;(navItems.find((n) => (n as HTMLElement).dataset.view === 'components') as HTMLElement).click()
    const componentsView = host.querySelector('.pd-view[data-view="components"]') as HTMLElement
    expect(componentsView.querySelectorAll('.pd-cmp-row').length).toBeGreaterThanOrEqual(1)
    const row = componentsView.querySelector('.pd-cmp-row') as HTMLElement
    row.click()
    await new Promise((r) => setTimeout(r, 40))
    // ★页面根元素描边闪烁（registry getElement → classList.add）
    const rootEl = document.querySelector('#root-el') as HTMLElement
    expect(rootEl.classList.contains('pd-cmp-highlight')).toBe(true)
    // ★P1.5：inspect 事件下发 → 面板详情出现 DOM 树段（tag 行）
    const detail = componentsView.querySelector('.pd-cmp-detail') as HTMLElement
    expect(detail.textContent).toContain('DOM')
    expect(componentsView.querySelector('.pd-dom-tag')?.textContent).toBe('div')
    devtools.destroy()
    app.unmount()
    mountEl.remove()
  })

  it('★时间旅行可恢复起点（面板后开场景）：store 先建+操作 → 开面板（install 补发当前快照）→ 再操作 → 拖 0 恢复面板打开时状态', async () => {
    document.body.replaceChildren()
    vi.resetModules()
    const { installProteusDevtools: install2 } = await import('@proteus-vue/devtools')
    const app = createApp({})
    const pinia = createPinia()
    app.use(pinia)
    setActivePinia(pinia)
    const bus = createTraceBus({ enabled: true })
    const devtools = install2(app, { traceBus: bus, pinia, mount: true })
    // ★store 先建 + 操作（init/变更在面板订阅前发出 → TraceBus 不回放缓冲 → 丢）
    const usePlayer = defineStore('player', {
      state: () => ({ playing: false, volume: 0.8 }),
      actions: {
        play() { this.playing = true },
        setVolume(v: number) { this.volume = v },
      },
    })
    const player = usePlayer()
    player.play()
    player.setVolume(0.4)
    await new Promise((r) => setTimeout(r, 60))
    // ★面板后开 → install 补发当前 store 快照（可恢复起点 = 面板打开时刻）
    const btn = document.querySelector('.pd-floating-toggle') as HTMLButtonElement
    btn.click()
    const host = document.querySelector('.pd-floating-host') as HTMLElement
    await new Promise((r) => setTimeout(r, 40))
    // 面板开后再操作
    player.setVolume(0.5)
    await new Promise((r) => setTimeout(r, 80))
    const navItems = Array.from(host.querySelectorAll('.pd-nav-item'))
    ;(navItems.find((n) => (n as HTMLElement).dataset.view === 'state') as HTMLElement).click()
    const stateView = host.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const range = stateView.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    // 拖到最左 → 恢复面板打开时状态（volume 0.4）
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(player.playing).toBe(true)
    expect(player.volume).toBe(0.4)
    // 拖到最右 → 最新（volume 0.5）
    range.value = String(Number(range.max))
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(player.volume).toBe(0.5)
    devtools.destroy()
    app.unmount()
  })
})

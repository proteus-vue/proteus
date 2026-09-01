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
    // 变更 → storeTracer 上报 store.patch（面板快照）
    cart.items = 1
    await new Promise((r) => setTimeout(r, 60))
    const navItems = Array.from(host.querySelectorAll('.pd-nav-item'))
    ;(navItems.find((n) => (n as HTMLElement).dataset.view === 'state') as HTMLElement).click()
    const stateView = host.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const range = stateView.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    // 回放到步骤 0（初始快照前）→ 但 restoreAt(0) = cart.items:1（第一步 patch 状态）
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    // ★时间旅行应用：面板 restore 快照 → pinia.$patch 写回（items 仍为 1；再次回放同一步幂等）
    expect(cart.items).toBe(1)
    // 变更后再回放：items=2 → 回放到步骤 0 → items 恢复为 1
    cart.items = 2
    await new Promise((r) => setTimeout(r, 60))
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await new Promise((r) => setTimeout(r, 40))
    expect(cart.items).toBe(1)
    devtools.destroy()
    app.unmount()
  })
})

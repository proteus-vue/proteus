// tests/store-tracer.test.ts —— devtools 打通：pinia 变更 → store 事件 → 面板 state 视图
// createStoreTracer（devtools-runtime）：已注册 store 遍历 $subscribe + pinia.use 捕获未来 store
// @vitest-environment happy-dom（面板 state 集成断言）
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { createStoreTracer, createTraceBus } from '@proteus-vue/devtools-runtime'
import { createDevtoolsPanel, createTraceBusSource } from '@proteus-vue/devtools'

describe('createStoreTracer 发射端', () => {
  it('已注册 store 变更 → store.patch 事件（payload = { id, ...state 快照 }）+ dispose 卸载', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    // ★$subscribe 对 direct mutation 走 vue watch（异步 + 首触发吞事件）；$patch 同步触发 → 测试用 $patch
    const store = defineStore('cart', {
      state: () => ({ items: 1, label: 'cart' }),
      actions: { add() { this.$patch({ items: this.items + 1 }) } },
    })()
    const bus = createTraceBus({ enabled: true })
    const events: unknown[] = []
    const off = bus.on((e) => events.push(e))
    const tracer = createStoreTracer(pinia, bus)
    store.add()
    expect(events.length).toBe(1)
    expect(events[0]).toMatchObject({ source: 'store', phase: 'point', name: 'store.patch' })
    expect((events[0] as { payload: { id: string; items: number; label: string } }).payload).toMatchObject({ id: 'cart', items: 2, label: 'cart' })
    // dispose 后不再发射
    tracer.dispose()
    store.$patch({ items: 3 })
    expect(events.length).toBe(1)
    off()
  })

  it('pinia.use 插件捕获 tracer 之后创建的 store', () => {
    const pinia = createPinia()
    // ★use 插件在 pinia 未 install（_a 空）时进 toBeInstalled 延迟生效 → 模拟真实 app.use(pinia)
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const bus = createTraceBus({ enabled: true })
    const events: unknown[] = []
    const off = bus.on((e) => events.push(e))
    const tracer = createStoreTracer(pinia, bus)
    // tracer 之后再定义 + 实例化 store（use 插件在 store 创建时挂 $subscribe）
    const late = defineStore('late', { state: () => ({ n: 0 }) })()
    late.$patch({ n: 5 })
    expect(events.length).toBe(1)
    expect((events[0] as { payload: { id: string; n: number } }).payload).toMatchObject({ id: 'late', n: 5 })
    tracer.dispose()
    off()
  })
})

describe('store → 面板 state 视图（集成）', () => {
  it('真实 pinia → tracer → 面板 state 视图出 store 列表 + inspector + 步骤滑块', async () => {
    const root = document.createElement('div')
    const bus = createTraceBus({ enabled: true })
    const panel = createDevtoolsPanel(root, { source: createTraceBusSource(bus) })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = defineStore('cart', { state: () => ({ items: 1 }) })()
    const tracer = createStoreTracer(pinia, bus)
    store.$patch({ items: 2 })
    await new Promise((r) => setTimeout(r, 40)) // 16ms 节流渲染
    panel.show('state')
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    expect(stateView.querySelector('.pd-store summary')?.textContent).toBe('cart')
    const itemsRow = Array.from(stateView.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items')
    expect(itemsRow?.querySelector('.pd-kv-value')?.textContent).toContain('2')
    // 步骤 > 0 → 时间旅行滑块出现
    expect(stateView.querySelector('.pd-range')).not.toBeNull()
    tracer.dispose()
    panel.destroy()
  })
})

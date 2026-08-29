// tests/store.test.ts
// v0.4 框架级 store 桥：单例共享 + 广播订阅 + 页面连接（MP 端 Pinia 过渡方案）
import { describe, it, expect, vi } from 'vitest'
import { createStore, connectPageStore } from '../packages/runtime/src/store'

describe('createStore（框架级 store 桥，v0.4）', () => {
  it('同 id 单例：跨调用共享同一状态', () => {
    const a = createStore('single', { count: 0 })
    const b = createStore('single', { count: 0 })
    expect(a).toBe(b)
    a.set({ count: 5 })
    expect(b.get('count')).toBe(5)
  })

  it('set 触发订阅者（广播 patch）', () => {
    const store = createStore('broadcast', { count: 0, name: 'x' })
    const fn = vi.fn()
    const off = store.subscribe(fn)
    store.set({ count: 1 })
    expect(fn).toHaveBeenCalledWith({ count: 1 })
    store.set({ name: 'y' })
    expect(fn).toHaveBeenLastCalledWith({ name: 'y' })
    off()
    store.set({ count: 2 })
    expect(fn).toHaveBeenCalledTimes(2) // 取消后不再通知
  })

  it('connectPageStore：初始同步 + 变化 setData 到页面', () => {
    const store = createStore('page', { count: 0, flag: true })
    const page = { setData: vi.fn() }
    const off = connectPageStore(page, store)
    // 初始全量同步
    expect(page.setData).toHaveBeenCalledWith({ count: 0, flag: true })
    page.setData.mockClear()
    store.set({ count: 7 })
    expect(page.setData).toHaveBeenCalledWith({ count: 7 })
    off()
    page.setData.mockClear()
    store.set({ count: 8 })
    expect(page.setData).not.toHaveBeenCalled()
  })

  it('connectPageStore 带 map：store 字段映射为页面 data', () => {
    const store = createStore('mapped', { count: 1, flag: false })
    const page = { setData: vi.fn() }
    connectPageStore(page, store, (s) => ({ n: s.get('count') as number }))
    expect(page.setData).toHaveBeenCalledWith({ n: 1 })
    store.set({ count: 9, flag: true })
    expect(page.setData).toHaveBeenLastCalledWith({ n: 9 })
  })
})

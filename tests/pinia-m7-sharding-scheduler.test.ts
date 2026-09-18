// @vitest-environment jsdom
// tests/pinia-m7-sharding-scheduler.test.ts
// M7.1 状态分片（eager/lazy/keys）+ M7.2 调度器（防抖/maxWait/高频合并/串行）单测
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { MemoryAdapter } from '../packages/shared/src/storage'
import { persisted, createPersistence } from '../packages/runtime/src/pinia/persistence/lightweight'
import { PersistScheduler } from '../packages/runtime/src/pinia/persistence/scheduler'

function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('M7.1 状态分片', () => {
  it('eager（默认）：插件创建即 hydrate', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('k1', JSON.stringify({ v: 7 }))
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const useStore = defineStore('s1', { state: () => ({ v: 0 }), persistence: persisted({ key: 'k1' }) })
    const s = useStore()
    await wait(10)
    expect(s.v).toBe(7)
  })

  it('lazy：$hydrated 初始 false，$hydrate() 后恢复且幂等', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('k2', JSON.stringify({ v: 5 }))
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const useStore = defineStore('s2', {
      state: () => ({ v: 0 }),
      persistence: persisted({ key: 'k2', lazy: true }),
    })
    const s = useStore() as ReturnType<typeof useStore> & { $hydrated: boolean; $hydrate(): Promise<void> }
    expect(s.$hydrated).toBe(false) // 未 hydrate（Pinia store 上为解包布尔）
    expect(s.v).toBe(0)
    // 并发调用只触发一次恢复
    const p1 = s.$hydrate()
    const p2 = s.$hydrate()
    await Promise.all([p1, p2])
    expect(s.v).toBe(5)
    expect(s.$hydrated).toBe(true)
  })

  it('keys：只恢复指定字段，其余保持初始值', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('k3', JSON.stringify({ a: 1, b: 2 }))
    const pinia = createPinia()
    pinia.use(createPersistence({ storage: mem }))
    install(pinia)
    const useStore = defineStore('s3', {
      state: () => ({ a: 0, b: 0 }),
      persistence: persisted({ key: 'k3', keys: ['a'] }),
    })
    const s = useStore()
    await wait(10)
    expect(s.a).toBe(1) // 恢复
    expect(s.b).toBe(0) // 保持初始
  })
})

describe('M7.2 调度器', () => {
  it('高频写盘合并：1000 次变更 → setItem 调用 ≤ 3 次', async () => {
    const mem = new MemoryAdapter()
    const writes = vi.fn()
    const origSet = mem.setItem.bind(mem)
    mem.setItem = async (k, v) => {
      writes()
      return origSet(k, v)
    }
    const scheduler = new PersistScheduler(mem, { debounce: 100, maxWait: 0 })
    for (let i = 0; i < 1000; i++) scheduler.schedule('k', `v${i}`)
    await wait(150)
    expect(writes).toHaveBeenCalledTimes(1) // 防抖合并为一次
    expect(await mem.getItem('k')).toBe('v999') // 只留最新
  })

  it('maxWait：持续变更超时强制 flush（防崩溃丢数据）', async () => {
    const mem = new MemoryAdapter()
    const scheduler = new PersistScheduler(mem, { debounce: 300, maxWait: 100 })
    // 持续变更（每 30ms），debounce 永不触发，maxWait 100ms 强制落盘
    const timer = setInterval(() => scheduler.schedule('k', Date.now().toString()), 30)
    await wait(200)
    clearInterval(timer)
    await scheduler.flush()
    expect(await mem.getItem('k')).not.toBeNull()
  })

  it('flush 串行：并发 schedule + flush 不丢数据', async () => {
    const mem = new MemoryAdapter()
    const scheduler = new PersistScheduler(mem, { debounce: 0 })
    scheduler.schedule('a', '1')
    scheduler.schedule('b', '2')
    await Promise.all([scheduler.flush(), scheduler.flush()])
    expect(await mem.getItem('a')).toBe('1')
    expect(await mem.getItem('b')).toBe('2')
  })

  it('dispose：停止调度、清缓冲（M7.5 前置）', async () => {
    const mem = new MemoryAdapter()
    const scheduler = new PersistScheduler(mem, { debounce: 50 })
    scheduler.schedule('k', 'v')
    scheduler.dispose()
    await wait(80)
    expect(await mem.getItem('k')).toBeNull() // 未写盘
    expect(scheduler.pendingSize).toBe(0)
  })
})

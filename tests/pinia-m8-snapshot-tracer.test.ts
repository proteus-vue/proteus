// @vitest-environment jsdom
// tests/pinia-m8-snapshot-tracer.test.ts
// M8.2 快照/时间旅行 + M8.3 状态埋点单测
import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { createSnapshotManager } from '../packages/runtime/src/pinia/snapshot'
import { createStateTracer, type StateTraceEvent } from '../packages/runtime/src/pinia/tracer'
import { persisted } from '../packages/runtime/src/pinia/persistence/lightweight'

function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('M8.2 快照 / 时间旅行', () => {
  it('capture → mutate → restore → state 等于快照', () => {
    const pinia = createPinia()
    install(pinia)
    const useStore = defineStore('cart', { state: () => ({ items: [] as string[], qty: 0 }) })
    const s = useStore()
    s.qty = 5
    const snap = createSnapshotManager({ pinia, enableInProd: true }).capture()
    s.qty = 99
    s.items.push('x')
    const mgr = createSnapshotManager({ pinia, enableInProd: true })
    mgr.restore(snap)
    expect(s.qty).toBe(5)
    expect(s.items).toEqual([])
  })

  it('take 打点 + 恢复（label 标记）', () => {
    const pinia = createPinia()
    install(pinia)
    const useStore = defineStore('a', { state: () => ({ v: 0 }) })
    const s = useStore()
    const mgr = createSnapshotManager({ pinia, enableInProd: true })
    s.v = 1
    const snap = mgr.take('beforePay')
    expect(snap.label).toBe('beforePay')
    s.v = 2
    mgr.restore(snap)
    expect(s.v).toBe(1)
  })

  it('timeTravel：基于最近打点恢复（开发模式语义）', () => {
    const pinia = createPinia()
    install(pinia)
    const useStore = defineStore('b', { state: () => ({ v: 0 }) })
    const s = useStore()
    const mgr = createSnapshotManager({ pinia, enableInProd: true })
    s.v = 10
    mgr.take('t1')
    s.v = 20
    mgr.timeTravel(-1) // 回退到 t1
    expect(s.v).toBe(10)
  })
})

describe('M8.3 状态埋点', () => {
  it('mutation 触发 onTrace，批量节流上报', async () => {
    const events: StateTraceEvent[] = []
    const pinia = createPinia()
    pinia.use(createStateTracer({ onTrace: (e) => events.push(e), filter: ['cart'], batchMs: 50 }))
    install(pinia)
    const useCart = defineStore('cart', { state: () => ({ qty: 0 }) })
    const s = useCart()
    s.qty = 1
    s.qty = 2
    await wait(100) // 批量窗口后 flush
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].store).toBe('cart')
    expect(events[0].mutation).toBe('direct')
  })

  it('filter 默认空 → 不上报', async () => {
    const events: StateTraceEvent[] = []
    const pinia = createPinia()
    pinia.use(createStateTracer({ onTrace: (e) => events.push(e), batchMs: 20 }))
    install(pinia)
    const useStore = defineStore('noop', { state: () => ({ v: 0 }) })
    useStore().v = 1
    await wait(50)
    expect(events).toHaveLength(0) // 未在 filter 白名单
  })

  it('敏感字段（volatile/encrypted）从 trace 剔除', async () => {
    const events: StateTraceEvent[] = []
    const pinia = createPinia()
    pinia.use(createStateTracer({ onTrace: (e) => events.push(e), filter: ['user'], batchMs: 30 }))
    install(pinia)
    const useUser = defineStore('user', {
      state: () => ({ token: '', nickname: '' }),
      persistence: persisted({ volatile: ['token'] }),
    })
    const s = useUser()
    s.token = 'secret'
    s.nickname = 'alice'
    await wait(60)
    // token 明文从上报值中剔除（整 store 变更净化），nickname 保留
    expect(events.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(events.map((e) => e.value))
    expect(serialized).not.toContain('secret')
    expect(serialized).toContain('alice')
  })
})

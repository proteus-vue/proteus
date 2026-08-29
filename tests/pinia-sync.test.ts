// tests/pinia-sync.test.ts
// M8.1 多端协同引擎单测（LWW 最终一致 / 冲突兜底 / 离线重放 / excluded 跳过）
import { describe, it, expect } from 'vitest'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { createSyncEngine, type SyncOp, type SyncTransport } from '../packages/pinia-sync/src'

/** 内存双向传输（模拟两个端之间的通道） */
function makeChannel() {
  const endpoints: Array<(op: SyncOp) => void> = []
  const transports: SyncTransport[] = []
  for (let i = 0; i < 2; i++) {
    const t: SyncTransport = {
      send: (op) => {
        // 发给另一端
        for (let j = 0; j < endpoints.length; j++) {
          if (j !== i) endpoints[j](op)
        }
      },
      onReceive: (cb) => {
        endpoints[i] = cb
      },
    }
    transports.push(t)
  }
  return transports
}

function makeStore(pinia: ReturnType<typeof createPinia>) {
  const useCart = defineStore('cart', {
    state: () => ({ items: [] as string[], qty: 0 }),
    actions: {
      add(item: string) {
        this.items.push(item)
        this.qty += 1
      },
    },
  })
  return { useCart }
}

describe('M8.1 协同引擎（LWW）', () => {
  it('两端 mutation 互相同步 → 最终一致', async () => {
    const piniaA = createPinia()
    setActivePinia(piniaA)
    const { useCart } = makeStore(piniaA)
    useCart()
    const [tA, tB] = makeChannel()
    const engineA = createSyncEngine({ pinia: piniaA, transport: tA, stores: ['cart'], clientId: 'A' })
    engineA.mount()

    const piniaB = createPinia()
    setActivePinia(piniaB)
    const useCartB = makeStore(piniaB).useCart
    const storeB = useCartB()
    const engineB = createSyncEngine({ pinia: piniaB, transport: tB, stores: ['cart'], clientId: 'B' })
    engineB.mount()

    // A 端添加 → B 端收到
    piniaA._s.get('cart')!.qty = 5
    await new Promise((r) => setTimeout(r, 10))
    expect(storeB.qty).toBe(5)
  })

  it('LWW：旧 op 不覆盖新值（时间戳裁决）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useCart } = makeStore(pinia)
    const store = useCart()
    const t: SyncTransport = {
      send: () => {},
      onReceive: () => {},
    }
    const engine = createSyncEngine({ pinia, transport: t, stores: ['cart'], clientId: 'B' })
    engine.mount()
    store.qty = 10 // 本地最新
    await new Promise((r) => setTimeout(r, 5))
    // 模拟远端旧 op（timestamp 更早）→ 不应覆盖
    engine.applyRemote({ store: 'cart', path: 'qty', value: 1, timestamp: Date.now() - 1000, clientId: 'A', seq: 1 })
    expect(store.qty).toBe(10)
  })

  it('LWW 冲突兜底：时间戳相同 → clientId 字典序大者胜', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useCart } = makeStore(pinia)
    const store = useCart()
    const t: SyncTransport = { send: () => {}, onReceive: () => {} }
    const engine = createSyncEngine({ pinia, transport: t, stores: ['cart'], clientId: 'Z' })
    engine.mount()
    const ts = Date.now()
    // 相同时间戳：B < Z → Z 胜
    engine.applyRemote({ store: 'cart', path: 'qty', value: 1, timestamp: ts, clientId: 'B', seq: 1 })
    engine.applyRemote({ store: 'cart', path: 'qty', value: 2, timestamp: ts, clientId: 'Z', seq: 2 })
    expect(store.qty).toBe(2)
  })

  it('excluded 字段跳过（encrypted/volatile 不参与协同）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useCart } = makeStore(pinia)
    const store = useCart()
    const t: SyncTransport = { send: () => {}, onReceive: () => {} }
    const engine = createSyncEngine({ pinia, transport: t, stores: ['cart'], excludeFields: ['items'] })
    engine.mount()
    engine.applyRemote({ store: 'cart', path: 'items', value: ['hacked'], timestamp: Date.now(), clientId: 'A', seq: 1 })
    expect(store.items).toEqual([]) // 未应用
  })

  it('离线缓冲：断线时 op 入队，重连重放', async () => {
    const piniaA = createPinia()
    setActivePinia(piniaA)
    makeStore(piniaA).useCart()
    // A 离线（onStatus 捕获回调，状态变化时显式通知）
    let statusCb: ((online: boolean) => void) | null = null
    let onlineA = true
    const sentA: SyncOp[] = []
    const tA: SyncTransport = {
      send: (op) => {
        if (onlineA) sentA.push(op)
      },
      onReceive: () => {},
      onStatus: (cb) => {
        statusCb = cb
        cb(onlineA)
      },
    }
    const engineA = createSyncEngine({ pinia: piniaA, transport: tA, stores: ['cart'], clientId: 'A' })
    engineA.mount()

    const piniaB = createPinia()
    setActivePinia(piniaB)
    const storeB = makeStore(piniaB).useCart()
    const tB: SyncTransport = { send: () => {}, onReceive: (cb) => void cb }
    const engineB = createSyncEngine({ pinia: piniaB, transport: tB, stores: ['cart'], clientId: 'B' })
    engineB.mount()

    // A 离线：变更入队不发送
    onlineA = false
    if (statusCb) statusCb(false)
    piniaA._s.get('cart')!.qty = 7
    await new Promise((r) => setTimeout(r, 10))
    expect(sentA.length).toBe(0) // 离线未发送
    // 重连 → 重放
    onlineA = true
    if (statusCb) statusCb(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(sentA.length).toBeGreaterThan(0)
  })
})

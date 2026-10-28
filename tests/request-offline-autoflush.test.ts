// tests/request-offline-autoflush.test.ts
// ★★★#1344：**离线队列的自动重放**（痛点 #5 的最后一根驱动线）。
//
// 【这条判据为什么必须有（本轮取证发现）】
//   类型里写着"恢复后按序重放"，而 `flushOfflineQueue()` 此前**没有任何调用方** ——
//   业务必须自己记得在网络恢复时调它，而绝大多数不会
//   ⇒ 断网时入队的请求**永久躺在队列里**，"离线队列"变成"离线黑洞"。
//   ★这是本仓反复抓的同一形态：**类型/API 都在，缺的是最后一根驱动线**。
//   "接口存在"从来不是"功能生效"的证据。
//
// 【判据锁住什么】
//   ① `autoFlush: true` + 注入订阅 ⇒ 网络恢复事件**真的触发**重放（不是只订阅不做事）；
//   ② 未开 `autoFlush` ⇒ **不订阅**（默认不替业务在后台发请求）；
//   ③ 网络**断开**事件不触发重放（只在 `isConnected` 为真时跑）；
//   ④ 重放成功后条目出队；失败则**留在队列**（下次恢复再试，不丢数据）;
//   ⑤ 重放带**原幂等键**（服务端据此去重，防重复下单）；
//   ⑥ `dispose()` 后事件不再触发（订阅是副作用，必须有确定的释放点）；
//   ⑦ **网络抖动不并发重放**（防重入闸门）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRequestClient } from '../packages/api/src/request/client'
import type { OfflineQueueStore, OfflineQueueEntry } from '../packages/api/src/request/types'

/** 内存版持久层（判据不碰真实存储） */
function makeStore(initial: OfflineQueueEntry[] = []): OfflineQueueStore & { current: OfflineQueueEntry[] } {
  const s = {
    current: [...initial],
    async load() {
      return [...s.current]
    },
    async save(entries: OfflineQueueEntry[]) {
      s.current = [...entries]
    },
  }
  return s
}

/**
 * 假 hooks：让 `useFetch` 按脚本返回结果。
 * ★client 只通过 `hooks.useFetch` 发请求（它是唯一出口），所以替身只需实现这一条。
 */
function makeHooks(responder: (url: string) => { ok: boolean; status?: number; error?: { code: string; message: string } }) {
  const calls: Array<{ url: string; config: unknown }> = []
  return {
    calls,
    hooks: {
      useFetch: async (url: string, config: unknown) => {
        calls.push({ url, config })
        return responder(url)
      },
    } as never,
  }
}

/** 可手动触发的网络订阅器 */
function makeNetSub() {
  const subs: Array<(s: { isConnected: boolean }) => void> = []
  let unsubscribed = 0
  return {
    subscribe: (cb: (s: { isConnected: boolean }) => void) => {
      subs.push(cb)
      return () => {
        unsubscribed++
        const i = subs.indexOf(cb)
        if (i >= 0) subs.splice(i, 1)
      }
    },
    emit: (s: { isConnected: boolean }) => {
      for (const cb of [...subs]) cb(s)
    },
    get active() {
      return subs.length
    },
    get unsubscribed() {
      return unsubscribed
    },
  }
}

const ENTRY = (key: string, url = '/api/order'): OfflineQueueEntry => ({
  idempotencyKey: key,
  url,
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"a":1}',
  enqueuedAt: Date.now(),
})

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('★★★#1344 离线队列自动重放（痛点 #5：断网恢复自动按序重放）', () => {
  it('★★autoFlush + 网络恢复 ⇒ 真的重放（条目执行且出队）', async () => {
    const store = makeStore([ENTRY('k1'), ENTRY('k2', '/api/order/2')])
    const net = makeNetSub()
    const { calls, hooks } = makeHooks(() => ({ ok: true, status: 200 }))

    const client = createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    expect(net.active, '★开着 autoFlush 就必须订阅网络状态').toBe(1)

    net.emit({ isConnected: true })
    // 让 await 链跑完（doFlush 是 async；事件回调里是 void doFlush()）
    await vi.waitFor(() => expect(store.current.length).toBe(0), { timeout: 2000 })

    expect(calls.length, '★两条都该被重放').toBe(2)
    expect(client.stats().offlineQueueSize, '★重放后队列应清空').toBe(0)
  })

  it('★★重放必须带**原幂等键**（否则服务端无法去重 ⇒ 重复下单）', async () => {
    const store = makeStore([ENTRY('idem-abc')])
    const net = makeNetSub()
    const { calls, hooks } = makeHooks(() => ({ ok: true, status: 200 }))
    createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    net.emit({ isConnected: true })
    await vi.waitFor(() => expect(store.current.length).toBe(0), { timeout: 2000 })
    /**
     * ★幂等键**不进 FetchConfig 字段**，而是作为 `Idempotency-Key` **业务头**下发
     *   （见 client.ts 的 "幂等键作为业务头下发（服务端按此去重）"）。
     *   ⇒ 判据要看 header，不能看 config.idempotencyKey（那个字段在门面层就被 delete 掉了）。
     */
    const cfg = calls[0]?.config as { headers?: Record<string, string> } | undefined
    expect(
      cfg?.headers?.['Idempotency-Key'],
      '★重放必须带原幂等键（否则服务端无法去重 ⇒ 重复下单）',
    ).toBe('idem-abc')
  })

  it('★未开 autoFlush ⇒ **不订阅**（默认不在后台替业务发请求）', () => {
    const store = makeStore([])
    const net = makeNetSub()
    const { hooks } = makeHooks(() => ({ ok: true, status: 200 }))
    createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store },
      onNetworkStatusChange: net.subscribe,
    })
    expect(net.active, '★默认不该订阅（自动重放有副作用，必须显式开启）').toBe(0)
  })

  it('★网络**断开**事件不触发重放（只在 isConnected 时跑）', async () => {
    const store = makeStore([ENTRY('k1')])
    const net = makeNetSub()
    const { calls, hooks } = makeHooks(() => ({ ok: true, status: 200 }))
    createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    net.emit({ isConnected: false })
    // 给一点时间，确认确实没发
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.length, '★断开时不该重放').toBe(0)
    expect(store.current.length).toBe(1)
  })

  it('★重放失败 ⇒ 条目**留在队列**（不丢数据，下次恢复再试）', async () => {
    const store = makeStore([ENTRY('k1')])
    const net = makeNetSub()
    const { hooks } = makeHooks(() => ({ ok: false, error: { code: 'fetch.failed', message: 'boom' } }))
    createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    net.emit({ isConnected: true })
    await vi.waitFor(() => expect(net.active).toBe(1), { timeout: 1000 })
    await new Promise((r) => setTimeout(r, 100))
    expect(store.current.length, '★失败条目必须留在队列（静默丢弃 = 丢业务数据）').toBe(1)
  })

  it('★★dispose() 后不再触发（订阅是副作用，必须有确定的释放点）', async () => {
    const store = makeStore([ENTRY('k1')])
    const net = makeNetSub()
    const { calls, hooks } = makeHooks(() => ({ ok: true, status: 200 }))
    const client = createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    client.dispose()
    expect(net.active, '★dispose 后订阅必须解掉（否则页面销毁了回调还在跑）').toBe(0)
    net.emit({ isConnected: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.length, '★dispose 后不该再发请求').toBe(0)
  })

  it('★★网络抖动连发多次恢复 ⇒ **不并发重放**（防重入闸门）', async () => {
    const store = makeStore([ENTRY('k1')])
    const net = makeNetSub()
    let inFlight = 0
    let maxInFlight = 0
    const { hooks } = makeHooks(() => {
      return { ok: true, status: 200 }
    })
    // 包一层统计并发度
    const originalUseFetch = (hooks as unknown as { useFetch: (u: string, c: unknown) => Promise<unknown> }).useFetch
    ;(hooks as unknown as { useFetch: (u: string, c: unknown) => Promise<unknown> }).useFetch = async (u, c) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return originalUseFetch(u, c)
    }

    createRequestClient({
      hooks,
      offlineQueue: { enabled: true, store, autoFlush: true },
      onNetworkStatusChange: net.subscribe,
    })
    // 连发 5 次"已恢复"
    for (let i = 0; i < 5; i++) net.emit({ isConnected: true })
    await vi.waitFor(() => expect(store.current.length).toBe(0), { timeout: 3000 })
    expect(maxInFlight, '★同一队列不能被多轮重放并发处理（会造成重复发送）').toBe(1)
  })
})

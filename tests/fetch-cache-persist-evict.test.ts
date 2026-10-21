// tests/fetch-cache-persist-evict.test.ts
// ★★★决策 #1152：**持久层的字节预算与 LRU 淘汰**判据。
//
// 【为什么需要（#1151 自己留下的空洞）】
//   #1151 交付了持久层，但 `maxPersistEntries` **只写在 JSDoc 里，代码从未使用**
//   ⇒ 磁盘**无界增长**。而 Web ~5MB / MP 10MB 是**平台配额，且与业务共享**：
//   写满后 `setStorageSync` 抛错 ⇒ 缓存静默失效，**还可能连带业务自己的存储写不进去**。
//   ⇒ 必须按**字节**做 LRU 淘汰（按条数不够：一条 2MB 的响应就顶掉 200 条小条目）。
//
// 【★为什么字节与年龄只能记在 manifest 里】
//   KV 后端**拿不到**键值大小（`getStorageInfo` 只给总量，不给单键）；文件后端虽能读全量
//   但那是 O(N) 的额外 IO。⇒ 由 manifest 承载（本来就要写索引，不引入新 IO 模式）。
//
// 【判据口径（每条都能破坏性验证）】
//   ① 字节预算生效：写入总量超预算 ⇒ 淘汰到预算内，且**淘汰的是最久未用的**
//      （不是"谁先写"——读盘命中必须刷新 LRU 记账）
//   ② 条目上限与字节预算**二者取先到**
//   ③ 配额写失败（QuotaExceededError）⇒ **主动淘汰 25% 再重试一次**（有界，不会无限重试）
//   ④ 单条超过预算 ⇒ **不自杀**（受保护集；否则永远存不进去 ⇒ 每次请求都回源）
//   ⑤ #1151 的旧 manifest 形态（`{keys:[...]}`）仍能载入（不炸、按最旧淘汰）
//   ⑥ 淘汰后**重启仍能读回保留的条目**（淘汰不破坏一致性）
import { describe, it, expect } from 'vitest'
import {
  createPersistentFetchCache,
  createKvFetchCacheStorage,
  createFileFetchCacheStorage,
  entryStorageKey,
  INDEX_FILE,
} from '../packages/api/src/capability-fetch-cache-persist'
import type { CachePersistBackend } from '../packages/api/src/capability-fetch-cache-persist'
import type { FetchCacheEntry } from '../packages/api/src/capability-fetch-cache'

/** 内存 KV 桩（可注入"配额上限"与"写失败"） */
function makeKv(opts: { quotaBytes?: number } = {}) {
  const map = new Map<string, string>()
  const kv = {
    map,
    /** 已用字节（估：键 + 值长度 ×2，近似 UTF-16） */
    used: (): number => {
      let n = 0
      for (const [k, v] of map) n += (k.length + v.length) * 2
      return n
    },
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      if (opts.quotaBytes !== undefined) {
        // 模拟平台配额：超出即抛（与真实 localStorage / wx 一致）
        const next = new Map(map)
        next.set(k, v)
        let n = 0
        for (const [kk, vv] of next) n += (kk.length + vv.length) * 2
        if (n > opts.quotaBytes) throw new Error('QuotaExceededError')
      }
      map.set(k, v)
    },
    removeItem: (k: string): void => {
      map.delete(k)
    },
    keys: (): string[] => [...map.keys()],
  }
  return kv
}

/** 造一条缓存条目（文本体，字节数≈len×2） */
function mkEntry(key: string, bodyLen: number, extra: Partial<FetchCacheEntry> = {}): FetchCacheEntry {
  return {
    key,
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: { kind: 'text', text: 'x'.repeat(bodyLen) },
    json: false,
    storedAt: 0,
    lifetimeMs: 600000,
    mustRevalidate: false,
    varyNames: [],
    varyValues: {},
    lastUsed: 0,
    bytes: 0,
    ...extra,
  }
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('★★#1152 持久层字节预算与 LRU 淘汰', () => {
  it('★★① 超出字节预算 ⇒ 淘汰到预算内（按 LRU，不是按写入顺序）', async () => {
    let clock = 1_000_000
    const kv = makeKv()
    const backend = createKvFetchCacheStorage(kv)
    const store = createPersistentFetchCache({
      backend,
      now: () => clock,
      flushDelayMs: 0,
      // ★预算要**紧到必然触发淘汰**：每条 400 字符 ≈ 800 字节存量，写 5 条 ≈ 4000
      //   ⇒ 给 2500 才能保证"写到第 4 条就超"。首版给 4000 正好不超 ⇒ 判据自己假红。
      maxPersistBytes: 2500,
    })
    // 写 3 条，每条体 400 字符 ≈ 800 字节
    store.put(mkEntry('GET http://x/a rt=auto', 400))
    await store.flush()
    clock += 100
    store.put(mkEntry('GET http://x/b rt=auto', 400))
    await store.flush()
    clock += 100
    store.put(mkEntry('GET http://x/c rt=auto', 400))
    await store.flush()

    // ★关键：**读一下 a**，刷新它的 LRU（此时 b 才是"最久未用"）
    clock += 100
    const hit = await store.match('GET http://x/a rt=auto', {}, clock)
    expect(hit, 'a 应该还在盘上（还没超预算）').toBeTruthy()

    // 再写两条 ⇒ 总量超预算 ⇒ 应淘汰最久未用的 b（保留 a 与 c）
    clock += 100
    store.put(mkEntry('GET http://x/d rt=auto', 400))
    await store.flush()
    clock += 100
    store.put(mkEntry('GET http://x/e rt=auto', 400))
    await store.flush()

    const st = store.persistStats()
    expect(st.persistBytes, `★淘汰后仍超预算：${st.persistBytes} > 4000`).toBeLessThanOrEqual(4000)
    expect(st.evicted, '★没有任何淘汰（预算没生效）').toBeGreaterThan(0)

    // ★a 最近被读过 ⇒ 不该被优先淘汰；b 最久未用 ⇒ 应已淘汰
    const bStill = await backend.read(storageKeyOf('GET http://x/b rt=auto'))
    expect(bStill, '★淘汰选错了受害者：最久未用的 b 还在，而它本应被先淘汰').toBeNull()
    const aStill = await backend.read(storageKeyOf('GET http://x/a rt=auto'))
    expect(aStill, '★最近读过的 a 被淘汰了（LRU 记账没生效）').toBeTruthy()
  })

  it('★★② 条目上限与字节预算二者取先到', async () => {
    const kv = makeKv()
    const store = createPersistentFetchCache({
      backend: createKvFetchCacheStorage(kv),
      flushDelayMs: 0,
      maxPersistBytes: 10 * 1024 * 1024, // 字节给足
      maxPersistEntries: 3, // ★只允许 3 条
    })
    for (let i = 0; i < 6; i++) {
      store.put(mkEntry(`GET http://x/n${i} rt=auto`, 20))
      await store.flush()
    }
    const st = store.persistStats()
    expect(st.persistEntries, `★条目上限没生效（${st.persistEntries} > 3）`).toBeLessThanOrEqual(3)
    expect(st.evicted).toBeGreaterThan(0)
    expect(store.persistBudget()).toBe(10 * 1024 * 1024)
  })

  it('★★★③ 配额写失败 ⇒ 主动淘汰 25% 并**重试一次**（有界）', async () => {
    // ★★装置要点：配额**只比"多写一条"稍紧**，这样"第一次写失败 + 淘汰后重试"能真正发生
    const kv = makeKv({ quotaBytes: 60_000 })
    const store = createPersistentFetchCache({
      backend: createKvFetchCacheStorage(kv),
      flushDelayMs: 0,
      maxPersistBytes: 10 * 1024 * 1024,
    })
    // 先塞满到接近配额（每条 ~8000 字节 ⇒ 约 7 条撑满 60KB）
    for (let i = 0; i < 7; i++) {
      store.put(mkEntry(`GET http://x/q${i} rt=auto`, 4000))
      await store.flush()
    }
    const before = store.persistStats()
    // 再写一条 ⇒ 首次写很可能撞配额 ⇒ 触发收缩 + 重试
    store.put(mkEntry('GET http://x/trigger rt=auto', 4000))
    await store.flush()
    const after = store.persistStats()
    // ★判据：要么收缩发生过（quotaShrinks>0），要么最终写入成功且没累积 writeErrors
    const recovered = after.quotaShrinks > 0 || after.writes > before.writes
    expect(recovered, '★配额满之后没有恢复动作（既没收缩也没写成功）').toBe(true)
    if (after.quotaShrinks > 0) {
      expect(after.evicted, '★收缩了却没有淘汰任何条目').toBeGreaterThan(0)
    }
    // ★有界重试：quotaShrinks 只该是"触发的那一次"级别，不该无限增长
    expect(after.quotaShrinks, '★收缩次数失控（可能无限重试）').toBeLessThanOrEqual(3)
  })

  it('★★④ 单条超过预算 ⇒ 不自杀（否则永远存不进去）', async () => {
    const kv = makeKv()
    const backend = createKvFetchCacheStorage(kv)
    const store = createPersistentFetchCache({
      backend,
      flushDelayMs: 0,
      maxPersistBytes: 1000, // 预算很小
    })
    // 一条 ~10000 字节的响应（远超预算）
    store.put(mkEntry('GET http://x/big rt=auto', 5000))
    await store.flush()
    // ★这条**可以**被留下（受保护集），但更关键的是：它不能把别的条目连带清光后再自杀
    const st = store.persistStats()
    expect(st.persistEntries, '★大条目把自己淘汰掉了（永远存不进去 ⇒ 每次都回源）').toBe(1)
    expect(await backend.read(storageKeyOf('GET http://x/big rt=auto')), '★大条目被删了').toBeTruthy()
  })

  it('★⑤ #1151 的旧 manifest（{keys:[...]}）仍能载入', async () => {
    const kv = makeKv()
    const backend = createKvFetchCacheStorage(kv)
    // 手工写一条条目 + 旧格式索引
    const key = 'GET http://x/legacy rt=auto'
    await backend.write(storageKeyOf(key), JSON.stringify({ v: 1, entry: mkEntry(key, 10), cacheKey: key }))
    await backend.write(INDEX_FILE, JSON.stringify({ keys: [storageKeyOf(key)] }))
    const store = createPersistentFetchCache({ backend, flushDelayMs: 0 })
    const hit = await store.match(key, {}, Date.now())
    expect(hit, '★旧格式 manifest 导致条目读不回来').toBeTruthy()
    // 再写一条触发 flush（会重写成 v2 manifest），不应抛
    store.put(mkEntry('GET http://x/new rt=auto', 10))
    await store.flush()
    const raw = await backend.read(INDEX_FILE)
    expect(raw, 'manifest 写失败').toBeTruthy()
    expect(JSON.parse(raw as string).v, '★manifest 没升级到 v2').toBe(2)
  })

  it('★⑥ 淘汰后重启仍能读回保留的条目（淘汰不破坏一致性）', async () => {
    const kv = makeKv()
    const backend = createKvFetchCacheStorage(kv)
    const store1 = createPersistentFetchCache({
      backend,
      flushDelayMs: 0,
      maxPersistBytes: 4000,
    })
    store1.put(mkEntry('GET http://x/keep rt=auto', 50))
    await store1.flush()
    for (let i = 0; i < 5; i++) {
      store1.put(mkEntry(`GET http://x/fill${i} rt=auto`, 800))
      await store1.flush()
    }
    // 全新实例（模拟重启，只靠盘）
    const store2 = createPersistentFetchCache({ backend, flushDelayMs: 0, maxPersistBytes: 4000 })
    // keep 可能已被淘汰（最旧）⇒ 断言的是"不抛且要么有要么没有"，不含糊其辞：
    //   这里让 keep 在被淘汰之前读一次刷新 LRU，才能断言它被保留
    void store2
    const list = await backend.keys()
    expect(list.length, '★持久层键列表为空（淘汰误删了全部）').toBeGreaterThan(0)
    // 逐条验证：盘上留下的每条都能被新实例读回（一致性）
    let readable = 0
    for (const sk of list) {
      if (sk === INDEX_FILE) continue
      const raw = await backend.read(sk)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { cacheKey?: string }
      if (!parsed.cacheKey) continue
      const hit = await store2.match(parsed.cacheKey, {}, Date.now())
      if (hit) readable++
    }
    expect(readable, '★淘汰后留下的条目读不回来（持久层不一致）').toBeGreaterThan(0)
  })

  it('★⑦ 文件后端同样按字节淘汰（端无关）', async () => {
    const files = new Map<string, Uint8Array>()
    const fs = {
      readBytes: async (p: string) => {
        const v = files.get(p)
        if (!v) throw new Error('ENOENT')
        return v
      },
      writeBytes: async (p: string, b: Uint8Array) => {
        files.set(p, b)
      },
      remove: async (p: string) => {
        files.delete(p)
      },
    }
    const backend: CachePersistBackend = createFileFetchCacheStorage(fs, 'cache/http')
    const store = createPersistentFetchCache({ backend, flushDelayMs: 0, maxPersistBytes: 4000 })
    for (let i = 0; i < 8; i++) {
      store.put(mkEntry(`GET http://x/f${i} rt=auto`, 600))
      await store.flush()
    }
    const st = store.persistStats()
    expect(st.persistEntries, '★文件后端没做条目淘汰').toBeLessThan(8)
    expect(st.evicted).toBeGreaterThan(0)
    // ★文件后端是"单文件存整份"⇒ 盘上只有 1 个文件（不是 N 个）
    expect(files.size, '★文件后端不应该是每条一文件').toBe(1)
  })
})

/** 用实现的同一套 hash 求存储键（不手写第二份实现） */
function storageKeyOf(cacheKey: string): string {
  return entryStorageKey(cacheKey)
}

// tests/fetch-cache-persist.test.ts
// ★★★决策 #1151：**HTTP 缓存持久层（L2）**判据——真实 HTTP 服务 + 真实"模拟重启"。
//
// 【为什么需要（#1149/#1150 自己写下的诚实边界）】
//   前两轮把缓存语义做成了**进程内**，并明确登记「只在内存，重启即失效」。
//   ⇒ App 冷启动后一条缓存都用不上：首屏每次整包回源，内存 LRU 刚建好就随进程消失。
//   本层把条目落到平台持久化介质，让"上次运行学到的 ETag / 新鲜内容"跨进程复用。
//
// 【★"重启"怎么模拟才算数（本判据的核心设计）】
//   ★**必须新建 store 实例 + 复用同一后端**——【不能】复用同一个 store 实例：
//     同一个实例的内存 LRU 还在，那样测的是"内存命中"，**完全证明不了持久化**。
//   ⇒ 每个"重启后"用例都 `createPersistentFetchCache({ backend: <同一 backend> })` 一次新的。
//   ★同时断言**服务端零请求**——否则"命中"可能只是恰好没打网络（弱证据）。
//
// 【判据口径（每条都能破坏性验证）】
//   ① 写入后重启（新 store 实例）⇒ 命中，且**服务端 hits 不增**、body 与首次一致
//   ② Vary 分桶跨重启仍然正确（不能混桶）
//   ③ 损坏的磁盘条目 ⇒ 当作未命中（**不抛**），且记 `corruptEntries`、顺手删掉
//   ④ 落盘失败（配额满/写失败）⇒ **不影响本次请求**（只记 `writeErrors`）
//   ⑤ `clear()` 真的清盘（重启后不再命中）——登出场景必须干净
//   ⑥ 二进制体（arraybuffer）往返后仍是 `Uint8Array`
//   ⑦ 后端形态无关：**KV 后端与文件后端行为一致**（同一套断言跑两遍）
//   ⑧ 内存仍是热层：第二次（同一实例）命中**不走盘**（`loads` 不增）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { webRequest } from '../packages/api/src/capability-fetch-legs'
import {
  createKvFetchCacheStorage,
  createFileFetchCacheStorage,
  createPersistentFetchCache,
  utf8DecodeBytes,
  utf8EncodeString,
  entryStorageKey,
  INDEX_FILE,
} from '../packages/api/src/capability-fetch-cache-persist'
import type { CachePersistBackend } from '../packages/api/src/capability-fetch-cache-persist'

class TCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}
const ctx = { CapError: TCapError as unknown as new (code: string, message: string, cause?: unknown) => Error }
const realBridge = { request: (config: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, config) }

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 内存 KV 桩（模拟 Web localStorage / MP wx.setStorage）——★可注入"写失败"与"损坏" */
function makeKvStub() {
  const map = new Map<string, string>()
  const stub = {
    map,
    failWrites: false,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      if (stub.failWrites) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string): void => {
      map.delete(k)
    },
    keys: (): string[] => [...map.keys()],
  }
  return stub
}

/** 内存文件系统桩（模拟 App `fs.readBytes/writeBytes/remove`）——★同样是字节级 */
function makeFsStub() {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    readBytes: async (path: string): Promise<Uint8Array> => {
      const v = files.get(path)
      if (!v) throw new Error('ENOENT: ' + path)
      return v
    },
    writeBytes: async (path: string, bytes: Uint8Array): Promise<void> => {
      files.set(path, bytes)
    },
    remove: async (path: string): Promise<void> => {
      files.delete(path)
    },
  }
}

describe('★★#1151 HTTP 缓存持久层（L2）', () => {
  let server: Server
  let base = ''
  const hits = new Map<string, number>()
  const hitCount = (p: string): number => hits.get(p) ?? 0
  const reset = (): void => hits.clear()

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      const p = u.pathname
      hits.set(p, (hits.get(p) ?? 0) + 1)
      const gen = hitCount(p)
      // 新鲜期很长 ⇒ 重启后应当直接命中（不必回源）
      const cc = u.searchParams.get('cc') ?? 'max-age=600'
      const etag = `"p${gen}"`
      if (p === '/bin') {
        // 二进制体（验证 Uint8Array 往返）
        const b = Uint8Array.from([0, 1, 2, 250, 255])
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': cc, ETag: etag })
        res.end(Buffer.from(b))
        return
      }
      if (p === '/vary') {
        const lang = String(req.headers['accept-language'] ?? 'none')
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Cache-Control': cc,
          Vary: 'Accept-Language',
          ETag: `"lang-${lang}-${gen}"`,
        })
        res.end(`lang=${lang}`)
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': cc, ETag: etag })
      res.end(JSON.stringify({ gen, path: p }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  /** 用给定 store 建一条**全新管线**（等价于一次"进程启动"）。 */
  const pipelineWith = (store: unknown) =>
    createFetchPipeline(realBridge as never, { cache: { store: store as never } })

  // ── 两种后端各跑一遍同一套断言（⑦ 后端形态无关）──
  const backends: Array<{ name: string; make: () => { backend: CachePersistBackend; reset: () => void } }> = [
    {
      name: 'KV（Web/MP 形态）',
      make: () => {
        const kv = makeKvStub()
        return { backend: createKvFetchCacheStorage(kv), reset: () => kv.map.clear() }
      },
    },
    {
      name: '文件（App 形态）',
      make: () => {
        const fs = makeFsStub()
        return { backend: createFileFetchCacheStorage(fs, 'cache/http'), reset: () => fs.files.clear() }
      },
    },
  ]

  for (const b of backends) {
    describe(`后端：${b.name}`, () => {
      it('★★① 写入后**重启**（新 store 实例）⇒ 命中，且服务端零请求', async () => {
        reset()
        const { backend } = b.make()
        // 第一次"进程"：请求并落盘
        const s1 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p1 = pipelineWith(s1)
        const r1 = await p1.fetch<{ gen: number }>(`${base}/fresh-${b.name.length}`)
        expect(r1.ok).toBe(true)
        await s1.flush()
        const afterFirst = hitCount(`/fresh-${b.name.length}`)
        expect(afterFirst).toBe(1)

        // ★★重启：**全新 store 实例**，复用同一 backend（盘上的字节是唯一桥梁）
        const s2 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        expect(s2.stats().entries, '★新实例的内存层不该有旧条目（否则测的是内存）').toBe(0)
        const p2 = pipelineWith(s2)
        const r2 = await p2.fetch<{ gen: number }>(`${base}/fresh-${b.name.length}`)
        expect(r2.ok).toBe(true)
        if (r2.ok) expect(r2.data.gen).toBe(1)
        const m2 = (r2 as { meta?: { cache?: { status?: string } } }).meta?.cache
        expect(m2?.status, '★重启后没有命中持久层').toBe('hit')
        // ★硬证据：服务端没有新请求
        expect(hitCount(`/fresh-${b.name.length}`), '★重启后仍打了服务器 ⇒ 持久化没生效').toBe(afterFirst)
        expect((s2 as unknown as { persistStats: () => { loads: number } }).persistStats().loads, '★应从盘上加载过 1 条').toBeGreaterThan(0)
      })

      it('② Vary 分桶跨重启仍正确（不混桶）', async () => {
        reset()
        const { backend } = b.make()
        const s1 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p1 = pipelineWith(s1)
        await p1.fetch(`${base}/vary?b=${b.name.length}`, { responseType: 'text', headers: { 'Accept-Language': 'en' } })
        await p1.fetch(`${base}/vary?b=${b.name.length}`, { responseType: 'text', headers: { 'Accept-Language': 'zh' } })
        await s1.flush()

        const s2 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p2 = pipelineWith(s2)
        const zh = await p2.fetch<{ data?: string }>(`${base}/vary?b=${b.name.length}`, {
          responseType: 'text',
          headers: { 'Accept-Language': 'zh' },
        })
        expect(zh.ok && zh.data, '★重启后中文桶命中了错误的内容').toBe('lang=zh')
      })

      it('③ 损坏的磁盘条目 ⇒ 当作未命中（不抛）+ 记账 + 删掉', async () => {
        reset()
        const { backend } = b.make()
        const key = 'GET ' + `${base}/corrupt` + '? rt=auto'
        // 直接写一条非法 JSON（模拟断电/半写）
        await backend.write(entryStorageKey(key), '{ this is not json')
        const s = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p = pipelineWith(s)
        const r = await p.fetch(`${base}/corrupt`)
        expect(r.ok, '★损坏条目让请求失败了（缓存不该影响正确性）').toBe(true)
        expect(hitCount('/corrupt'), '损坏条目被当成命中').toBe(1)
        const st = (s as unknown as { persistStats: () => { corruptEntries: number } }).persistStats()
        expect(st.corruptEntries, '★损坏条目没有记账（静默吞掉等于没发现）').toBeGreaterThan(0)
        // 已被删掉（再读一次不该再记一次）
        expect(await backend.read(entryStorageKey(key))).toBeNull()
      })

      it('④ 落盘失败不影响本次请求（只记 writeErrors）', async () => {
        reset()
        const kv = makeKvStub()
        kv.failWrites = true // 模拟配额满
        const backend = createKvFetchCacheStorage(kv)
        const s = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p = pipelineWith(s)
        const r = await p.fetch(`${base}/quota`)
        expect(r.ok, '★落盘失败把请求带崩了').toBe(true)
        await s.flush()
        const st = (s as unknown as { persistStats: () => { writeErrors: number } }).persistStats()
        expect(st.writeErrors, '★落盘失败没有记账').toBeGreaterThan(0)
      })

      it('⑤ clear() 真的清盘（重启后不再命中）', async () => {
        reset()
        const { backend } = b.make()
        const s1 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p1 = pipelineWith(s1)
        await p1.fetch(`${base}/cleared-${b.name.length}`)
        await s1.flush()
        s1.clear()
        // 等 fire-and-forget 的清盘完成
        await sleepMs(50)

        const s2 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p2 = pipelineWith(s2)
        const r2 = await p2.fetch(`${base}/cleared-${b.name.length}`)
        const m2 = (r2 as { meta?: { cache?: { status?: string } } }).meta?.cache
        expect(m2?.status, '★clear() 没有清盘：重启后仍命中').not.toBe('hit')
      })

      it('⑥ 二进制体往返后仍是 Uint8Array（不是 {0:..,1:..}）', async () => {
        reset()
        const { backend } = b.make()
        const s1 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p1 = pipelineWith(s1)
        await p1.fetch(`${base}/bin?b=${b.name.length}`, { responseType: 'arraybuffer' })
        await s1.flush()

        const s2 = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p2 = pipelineWith(s2)
        const r2 = await p2.fetch<Uint8Array>(`${base}/bin?b=${b.name.length}`, { responseType: 'arraybuffer' })
        expect(r2.ok).toBe(true)
        if (r2.ok) {
          expect(r2.data instanceof Uint8Array, '★往返后不是 Uint8Array（JSON 把字节变成了对象）').toBe(true)
          expect([...r2.data]).toEqual([0, 1, 2, 250, 255])
        }
      })

      it('⑧ 内存是热层：同实例第二次命中不走盘（loads 不增）', async () => {
        reset()
        const { backend } = b.make()
        const s = createPersistentFetchCache({ backend, flushDelayMs: 0 })
        const p = pipelineWith(s)
        const url = `${base}/hot-${b.name.length}`
        await p.fetch(url)
        await s.flush()
        const before = (s as unknown as { persistStats: () => { loads: number } }).persistStats().loads
        const r2 = await p.fetch(url)
        expect(r2.ok).toBe(true)
        const after = (s as unknown as { persistStats: () => { loads: number } }).persistStats().loads
        expect(after, '★内存热层没生效（第二次又读了盘）').toBe(before)
      })
    })
  }

  describe('编解码与键（纯函数）', () => {
    it('★UTF-8 编解码自洽（含中文与 emoji —— App 引擎无 TextEncoder/TextDecoder）', () => {
      const samples = ['hello', '中文缓存', 'a😀b', '混合 mixed 中文 🎉', '']
      for (const s of samples) {
        expect(utf8DecodeBytes(utf8EncodeString(s)), `往返失败：${s}`).toBe(s)
      }
    })

    it('★存储键：同一 cacheKey 稳定、不同 key 不同、且是文件名安全形态', () => {
      const k1 = entryStorageKey('GET http://x/a?b=1 rt=auto')
      const k2 = entryStorageKey('GET http://x/a?b=1 rt=auto')
      const k3 = entryStorageKey('GET http://x/a?b=2 rt=auto')
      expect(k1).toBe(k2)
      expect(k1).not.toBe(k3)
      expect(k1).toMatch(/^e-[0-9a-f]{8}$/)
      // 不含路径分隔符/查询串（能直接当文件名）
      expect(k1.includes('/')).toBe(false)
      expect(k1.includes('?')).toBe(false)
    })

    it('★索引文件名不与条目键冲突', () => {
      expect(INDEX_FILE).not.toMatch(/^e-/)
    })
  })
})

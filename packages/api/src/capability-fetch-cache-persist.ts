// packages/api/src/capability-fetch-cache-persist.ts
// ★★★决策 #1151：**HTTP 缓存的持久层（L2）**——`04-cache-layers.md` 里 L2 的那一层。
//
// 【为什么需要（#1149/#1150 自己写下的诚实边界）】
//   前两轮把缓存语义做成了**进程内**：
//     · #1149 交付条件请求/304/`Vary`/LRU；#1150 交付 RFC 5861（SWR/SIE）+ `Age`。
//   但两者都明确登记「只在**内存**，重启即失效」⇒ App 冷启动后**一条都用不上**：
//   首屏每次都要整包回源，而内存 LRU 刚建好就随进程消失。
//   ⇒ 把缓存条目落到**平台持久化介质**，让"上次运行学到的 ETag / 新鲜内容"跨进程复用。
//
// 【★★动手前先取证：三端的持久化能力**形态不同**（这决定了契约必须是异步的）】
//   | 端 | 能力 | 形态 | 说明 |
//   |---|---|---|---|
//   | Web | `getStorage` → `localStorage` | KV，**同步** | 容量 ~5MB（配额）；JSON 序列化 |
//   | MP  | `getStorage` → `wx.setStorage` | KV，同步 + 异步 | 上限 10MB（Skyline 更紧） |
//   | App | **没有 `getStorage`**；只有 `fs.readBytes/writeBytes/remove` | 文件，**异步** | 三端宿主都实现 |
//   ⇒ App 端**只能异步**读写 ⇒ `FetchCacheStore.match` 的契约已改为可异步（#1151）。
//   ★如果按"Web 同步"去定契约，App 端就只能伪造同步阻塞（`Atomics.wait` 在 QuickJS 上没有），
//     或者干脆不支持持久层——那等于把最需要它的端（冷启动最贵的端）排除在外。
//
// 【落地：两种后端 + 一套共享逻辑】
//   · `createKvFetchCacheStorage(kv)`：Web / MP（KV 形态；一个 key 存整份索引 + 每条一个 key）；
//   · `createFileFetchCacheStorage(fs)`：App（文件形态；<dir>/index.json + <dir>/<hash>.json）；
//   · `createPersistentFetchCache(opts)`：**包装内存 LRU**——内存是热层（读零延迟），
//     持久层是冷层（启动时懒加载、写时异步落盘）。
//
// 【★★★关键设计取舍（每条都有理由，不是随手）】
//   ① **内存始终是权威热层**：`match` 先查内存；未命中才**按需**读盘并回填内存。
//      不搞"启动时全量载入"——那会让冷启动多读 N 个文件（首屏最贵的时候做最重的 IO）。
//   ② **写盘 fire-and-forget**：`put` 是同步签名（契约要求，见 `FetchCacheStore`），落盘异步。
//      ★写失败只影响"下次启动能否命中"，**绝不影响本次请求** ⇒ 不能让 IO 失败冒泡成请求失败。
//      但要**记账**（`writeErrors`）——静默失败的持久层等于没有持久层。
//   ③ **读盘失败/损坏 ⇒ 当作未命中**（不抛）：缓存是可选的加速层，
//      一条坏条目不该让整个请求失败。★但**不是静默**：计入 `corruptEntries` 供排障。
//   ④ **写入合并（debounce）**：同一 key 在 `flushDelayMs` 内多次写入只落最后一次——
//      SWR 后台校验 + 前台命中可能连续写同一条，逐次落盘纯属浪费 IO。
//   ⑤ **每条一个 key + 一份索引**（不是一个大 JSON）：避免"写一条要重写全部"。
//      ★代价：索引可能短暂与实际不一致 ⇒ 读时以**条目自身是否可解析**为准，索引只用来列候选。
//   ⑥ **`clear()` 也清盘**（登出场景必须真的删干净；只清内存会留下上一次用户的响应体）。
//
// 【诚实边界】
//   · 没有做跨进程**并发写**协调（多进程同时写同一 key ⇒ 后写覆盖；本仓 Shell 是单进程模型）；
//   · 没有做加密（缓存体是服务端的公开响应；敏感响应由 `Authorization` 规则挡在入库之外——见 #1149）；
//   · 索引损坏时**整层重建**（丢弃所有条目）而不是逐条抢救——简单且不会读到错配的条目；
//   · 不保证 `flush()` 在宿主被强杀时执行（那是平台限制；`flush` 只用于**显式**收尾/判据）。

import type { FetchCacheEntry, FetchCacheStore } from './capability-fetch-cache'
import { createMemoryFetchCache } from './capability-fetch-cache'

/**
 * 持久化后端的最小契约（KV 与文件两种实现都满足它）。
 * ★只暴露"整串读写"，编码/索引/淘汰全在上层 —— 这样两端实现不可能分叉。
 */
export interface CachePersistBackend {
  /** 读一个键的原始字符串；不存在返回 null（**不抛**） */
  read(key: string): Promise<string | null>
  /** 写一个键（覆盖）；失败返回 false（不抛） */
  write(key: string, value: string): Promise<boolean>
  /** 删一个键；不存在也算成功 */
  remove(key: string): Promise<void>
  /** 列出全部键（用于重建索引） */
  keys(): Promise<string[]>
  /**
   * ★★★#1151：**清掉本层的全部数据**（端无关）。
   * 【为什么需要单独一个方法，而不是"用 keys() 逐个删"】
   *   文件后端的 `keys()` 依赖**索引文件**；索引缺失/损坏/从未写过时 `keys()` 返回 `[]`
   *   ⇒ "靠索引清盘"会在最该清的场景（残留脏数据）**什么也清不掉**——真机实测就踩了这个：
   *     iOS 读到 `ageMs=91620`（前一天残留），而索引为空 ⇒ 清盘静默无效 ⇒ 判据假绿。
   *   ★实现约定：KV = 删掉前缀匹配的键；文件 = 删索引 + 删本层目录下的条目文件。
   */
  clearAll(): Promise<void>
  /** 后端标识（排障用：`kv` / `file`） */
  readonly kind: string
}

/**
 * **KV 后端**（Web `localStorage` / MP `wx.getStorage`）。
 * ★接口刻意做成"异步统一"——即使底层是同步 KV，也包成 Promise，
 *   这样上层永远不会因为"某端同步、某端异步"而出现两套分支。
 * ★★容量注意：MP 上限 10MB、Web ~5MB ⇒ 上层必须按字节预算主动淘汰（`maxBytes`），
 *   否则写满后平台会**静默丢弃**（Web）或抛错（MP）⇒ 缓存层变"时好时坏"。
 */
export function createKvFetchCacheStorage(kv: {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
  keys(): string[] | Promise<string[]>
}): CachePersistBackend {
  const run = async <T>(fn: () => T | Promise<T>): Promise<T> => fn()
  return {
    kind: 'kv',
    async read(key) {
      try {
        return await run(() => kv.getItem(key))
      } catch {
        return null
      }
    },
    async write(key, value) {
      try {
        await run(() => kv.setItem(key, value))
        return true
      } catch {
        // ★容量超限（QuotaExceededError / MP storage 满）会走到这里
        return false
      }
    },
    async remove(key) {
      try {
        await run(() => kv.removeItem(key))
      } catch {
        /* 删不掉不影响正确性（读时会校验可解析性） */
      }
    },
    async keys() {
      try {
        return await run(() => kv.keys())
      } catch {
        return []
      }
    },
    async clearAll() {
      // ★KV：删掉本层的键（`e-*` 条目 + 索引）。★不用索引列键——索引本身可能就是脏的。
      try {
        const all = await run(() => kv.keys())
        for (const k of all) {
          if (k === INDEX_FILE || k.startsWith('e-')) await run(() => kv.removeItem(k))
        }
      } catch {
        /* 清不掉时上层仍会重建索引（读时校验可解析性） */
      }
    },
  }
}

/**
 * **文件后端**（App 三端宿主的 `fs.writeBytes/readBytes/remove`）。
 *
 * ★为什么 App 端必须用文件而不是 KV：App **没有 `getStorage`**（取证于 `capability-bridges.ts`：
 *   只有 web/wx 桥实现它）⇒ 唯一可用的持久化通路是 `fs.*`。
 *
 * ★★★**为什么是"单文件"而不是"每条目一文件"（真机实测逼出来的）**
 *   宿主只开了 `fs.readBytes / writeBytes / remove` 三个方法，**没有 `readdir`**；
 *   而 Android 的 `fs.remove` 用 `File.delete()`——**非空目录删不掉**。
 *   ⇒ "每条一文件 + 按索引清盘"在索引缺失/损坏时**清不干净**（真机实测：
 *     iOS 读到 `ageMs=91620` 的前一天残留，而索引为空 ⇒ 清盘静默无效 ⇒ 判据假绿）。
 *   ⇒ 改成**一个文件存整份缓存**：清盘 = 删掉那一个固定文件名（一定成功），
 *     且天然原子（一次 `writeBytes` 落全部）。
 *   ★代价如实登记：写一条要重写整份文件（O(N) 不是 O(1)）。
 *     在本层预算（默认 5 MiB / 200 条）下可接受；若将来条目数上百且频繁写，
 *     应考虑换"每条一文件 + 宿主补 readdir"——那需要动宿主契约（独立批次）。
 */
export function createFileFetchCacheStorage(fs: {
  readBytes(path: string): Promise<Uint8Array>
  writeBytes(path: string, bytes: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
}, dir: string): CachePersistBackend {
  const prefix = dir.replace(/\/+$/, '') + '/'
  const filePath = prefix + FILE_STORE_NAME
  /** 进程内的"整份文件"缓存（避免每次读都打宿主往返；★写入时同步更新） */
  let doc: Record<string, string> | null = null
  let loading: Promise<Record<string, string>> | null = null

  async function loadDoc(): Promise<Record<string, string>> {
    if (doc) return doc
    if (loading) return loading
    loading = (async () => {
      try {
        const bytes = await fs.readBytes(filePath)
        const parsed = bytes && bytes.byteLength > 0 ? JSON.parse(utf8DecodeBytes(bytes)) : {}
        doc = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
      } catch {
        // 文件不存在 / 损坏 ⇒ 空文档（★损坏时上层读条目会发现非法并计入 corruptEntries）
        doc = {}
      }
      return doc!
    })()
    const out = await loading
    loading = null
    return out
  }

  async function saveDoc(next: Record<string, string>): Promise<boolean> {
    doc = next
    try {
      await fs.writeBytes(filePath, utf8EncodeString(JSON.stringify(next)))
      return true
    } catch {
      return false
    }
  }

  return {
    kind: 'file',
    async read(key) {
      const d = await loadDoc()
      return Object.prototype.hasOwnProperty.call(d, key) ? d[key]! : null
    },
    async write(key, value) {
      const d = await loadDoc()
      return saveDoc({ ...d, [key]: value })
    },
    async remove(key) {
      const d = await loadDoc()
      if (!Object.prototype.hasOwnProperty.call(d, key)) return
      const next = { ...d }
      delete next[key]
      await saveDoc(next)
    },
    async keys() {
      const d = await loadDoc()
      return Object.keys(d)
    },
    async clearAll() {
      // ★单文件 ⇒ 删一个文件即彻底清空（不依赖索引、不依赖 readdir）
      doc = {}
      try {
        await fs.remove(filePath)
      } catch {
        /* 不存在也算成功 */
      }
    },
  }
}

/** 文件后端的固定文件名（整份缓存存这一个文件；★单文件设计见下方说明） */
export const FILE_STORE_NAME = '__pf-http-cache.json'

/** 索引文件名（KV 与文件后端共用；`__` 前缀避免与内容的 hash 键冲突） */
export const INDEX_FILE = '__pf-cache-index.json'

/** 条目文件名/键名（用基站键的短 hash —— 键里可能有 `/`、`?`、空格，不能直接当文件名） */
export function entryStorageKey(cacheKey: string): string {
  // FNV-1a 32 位（够用且零依赖；碰撞概率在 200 条量级可忽略，且读时还会校验 key 字段）
  let h = 0x811c9dc5
  for (let i = 0; i < cacheKey.length; i++) {
    h ^= cacheKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `e-${h.toString(16).padStart(8, '0')}`
}

/** 落盘形态（★显式版本号：将来改结构时可识别旧格式并丢弃，而不是读出半懂的数据） */
interface StoredEntry {
  v: 1
  entry: FetchCacheEntry
  /** ★冗余存一份 key：hash 碰撞时用它判定"这条不是我要的"（不依赖索引可信） */
  cacheKey: string
}

/** 存储条目字节数估算（与内存 LRU 同口径：文本按 2 字节/字符） */
function entryBytesOf(e: FetchCacheEntry): number {
  return e.body.kind === 'bytes' ? e.body.bytes.byteLength : e.body.text.length * 2
}

/**
 * **持久化缓存 store**：内存热层 + 持久冷层。
 *
 * 读路径：内存命中 ⇒ 直接回（零 IO）；内存未命中 ⇒ 读盘一次并**回填内存**（下次零 IO）。
 * 写路径：写内存（同步，立即对同请求链可见）+ 异步落盘（合并同 key 的连续写）。
 *
 * @param opts.backend 持久后端（KV / 文件）
 * @param opts.maxBytes 内存预算（与内存 LRU 同义）
 * @param opts.maxPersistEntries 持久层的**条目上限**（★MP/Web 有平台配额，必须主动淘汰）
 * @param opts.flushDelayMs 同一 key 连续写的合并窗口（默认 120ms）
 */
export function createPersistentFetchCache(opts: {
  backend: CachePersistBackend
  maxBytes?: number
  maxEntries?: number
  now?: () => number
  flushDelayMs?: number
}): FetchCacheStore & {
  /** 持久层读数（判据/排障）：成功落盘数 / 失败数 / 损坏条目数 / 已加载条目数 */
  persistStats(): { writes: number; writeErrors: number; corruptEntries: number; loads: number }
  /** 后端形态（`kv` / `file`；排障用） */
  backendKind(): string
} {
  const now = opts.now ?? Date.now
  const memory = createMemoryFetchCache({ maxBytes: opts.maxBytes, maxEntries: opts.maxEntries, now })
  const backend = opts.backend
  const flushDelayMs = opts.flushDelayMs ?? 120
  const stats = { writes: 0, writeErrors: 0, corruptEntries: 0, loads: 0 }
  /** 已尝试从盘上加载过的键（避免同一 key 反复读盘） */
  const probed = new Set<string>()
  /** 待落盘的条目（key → entry；同 key 合并） */
  const pending = new Map<string, FetchCacheEntry>()
  /** 已写入的磁盘键集合（用于索引维护与 clear） */
  const diskKeys = new Set<string>()
  let flushTimer: { clear?: () => void } | undefined
  let flushing: Promise<void> | null = null

  /** 读盘并回填内存（只在内存未命中时调用）。 */
  async function loadFromDisk(cacheKey: string, requestHeaders: Record<string, string> | undefined): Promise<FetchCacheEntry | undefined> {
    if (probed.has(cacheKey)) return undefined
    probed.add(cacheKey)
    const storageKey = entryStorageKey(cacheKey)
    const raw = await backend.read(storageKey)
    if (!raw) return undefined
    let parsed: StoredEntry | null = null
    try {
      parsed = JSON.parse(raw) as StoredEntry
    } catch {
      // 损坏 ⇒ 当作未命中（不抛），但要记账 + 删掉这条以免每次都白读
      stats.corruptEntries++
      await backend.remove(storageKey)
      return undefined
    }
    if (!parsed || parsed.v !== 1 || !parsed.entry) {
      stats.corruptEntries++
      await backend.remove(storageKey)
      return undefined
    }
    // ★hash 碰撞保护：读到的不是我要的那条 ⇒ 当未命中（不覆盖、不误用）
    if (parsed.cacheKey !== cacheKey) return undefined
    const entry = parsed.entry
    // ★文件后端/JSON 往返会把 `Uint8Array` 变成 `{0:..,1:..}` ⇒ 字节体需要还原
    if (entry.body && (entry.body as { kind?: string }).kind === 'bytes') {
      const b = entry.body as unknown as { bytes: unknown }
      if (b.bytes && !(b.bytes instanceof Uint8Array)) {
        const obj = b.bytes as Record<string, number>
        entry.body = { kind: 'bytes', bytes: new Uint8Array(Object.keys(obj).sort((x, y) => Number(x) - Number(y)).map((k) => obj[k]!)) }
      }
    }
    stats.loads++
    // 回填内存（put 会再触发一次落盘 —— ★这是浪费，用 silent 标记避开）
    memory.put(entry)
    // ★Vary 校验交给上层内存匹配（内存里已按 entry.varyValues 存了同一份）
    void requestHeaders
    return memory.match(cacheKey, requestHeaders, now()) as FetchCacheEntry | undefined
  }

  function scheduleFlush(): void {
    if (pending.size === 0) return
    const st = (globalThis as { setTimeout?: (f: () => void, ms: number) => unknown }).setTimeout
    if (typeof st !== 'function') {
      // ★无定时器引擎（App）⇒ 立刻落盘（不"等一会儿"，避免条目永远停在内存里）
      void doFlush()
      return
    }
    flushTimer?.clear?.()
    const handle = st(() => {
      void doFlush()
    }, flushDelayMs)
    flushTimer = { clear: () => { const c = (handle as { cancel?: () => void }); c.cancel?.() } }
  }

  async function doFlush(): Promise<void> {
    if (flushing) return flushing
    const batch = [...pending.entries()]
    pending.clear()
    flushing = (async () => {
      for (const [storageKey, entry] of batch) {
        const payload: StoredEntry = { v: 1, entry, cacheKey: entry.key }
        const wrote = await backend.write(storageKey, JSON.stringify(payload))
        if (wrote) {
          stats.writes++
          diskKeys.add(storageKey)
        } else {
          stats.writeErrors++
        }
      }
      // 索引（文件后端靠它列键；KV 后端也有用——避免 `keys()` 扫到非缓存键）
      if (batch.length > 0) {
        await backend.write(INDEX_FILE, JSON.stringify({ keys: [...diskKeys] }))
      }
    })().finally(() => {
      flushing = null
    })
    return flushing
  }

  return {
    match(cacheKey, requestHeaders, at) {
      const hit = memory.match(cacheKey, requestHeaders, at)
      if (hit) return hit
      // 内存未命中 ⇒ 读盘（异步）。★返回 Promise 只在真的需要读盘时出现
      return loadFromDisk(cacheKey, requestHeaders)
    },
    put(entry) {
      memory.put(entry)
      // ★落盘用**存储键**（hash），不是基站键
      pending.set(entryStorageKey(entry.key), entry)
      scheduleFlush()
    },
    remove(cacheKey, entry) {
      memory.remove(cacheKey, entry)
      const storageKey = entryStorageKey(cacheKey)
      pending.delete(storageKey)
      void backend.remove(storageKey).then(() => {
        diskKeys.delete(storageKey)
      })
    },
    clear() {
      memory.clear()
      pending.clear()
      probed.clear()
      diskKeys.clear()
      // ★用 backend.clearAll()（端无关、不依赖索引/readdir）：文件后端删单文件、KV 删前缀键。
      //   ★首版用"索引里列出的键"逐个删 ⇒ 索引为空时**什么也清不掉**（真机假绿的根因之一）。
      void backend.clearAll()
    },
    stats() {
      return memory.stats()
    },
    async flush() {
      await doFlush()
      // 等正在进行的 flush 收尾（否则"模拟重启"可能读到一半）
      if (flushing) await flushing
    },
    persistStats() {
      return { ...stats }
    },
    backendKind() {
      return backend.kind
    },
  }
}

/* ─────────────────────── 最小 UTF-8 编解码（App 引擎无 TextEncoder/TextDecoder） ─────────────────────── */

/**
 * UTF-8 解码（最小实现）。
 * ★为什么自带：#1071 已证 App 精简引擎**没有 `TextDecoder`**、#1095 证**没有 `TextEncoder`**。
 *   本模块要在 App 上读写文件，不能依赖这两个构造器。
 */
export function utf8DecodeBytes(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      i += 1
    } else if (b0 < 0xe0) {
      const b1 = bytes[i + 1] ?? 0
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f))
      i += 2
    } else if (b0 < 0xf0) {
      const b1 = bytes[i + 1] ?? 0
      const b2 = bytes[i + 2] ?? 0
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f))
      i += 3
    } else {
      const b1 = bytes[i + 1] ?? 0
      const b2 = bytes[i + 2] ?? 0
      const b3 = bytes[i + 3] ?? 0
      let cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      i += 4
    }
  }
  return out
}

/** UTF-8 编码（最小实现；同上——App 引擎无 `TextEncoder`）。 */
export function utf8EncodeString(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i)
    // 代理对合并
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
        i++
      }
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return new Uint8Array(out)
}

/** 字节估算（导出给判据复用，避免两处口径不一致） */
export function persistentEntryBytes(e: FetchCacheEntry): number {
  return entryBytesOf(e)
}

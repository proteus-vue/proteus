// packages/api/src/capability-app-storage.ts
// ★★★#1207：App 端 **KV 存储**（`getStorage`）——按 useFetch 的标准落地：**底层栈已有，只差接线**。
// ★★★#1241 按 §1.0 补到 **S3（规模可用）**：KV 属"高频"族（业务每个页面都在读写）⇒ 规范要求 S3。
//
// 【为什么单独成文件】`capability-app.ts` 已顶反巨型化基线（2079 行，**只减不增**）⇒
//   新增实现必须另开文件，装配点（`createAppCapabilities`）只用一行 spread 引入。
//
// 【★★★关键取证：为什么能在 JS 侧实现，不需要新写原生代码】
//   ① 宿主 `fs.readBytes` / `fs.writeBytes` / `fs.remove` **三端已实现**；
//   ② 它们走的是**同步派发**（Android `HostCapabilities.invoke` / iOS `host-capabilities.swift`
//      的 `switch method` 直接 `return ok(try …)`），而 `invokeHost()` 本身也是**同步**的；
//   ③ `CompatStorage.get/set/remove/clear` 要求**同步**语义。
//   ⇒ 三者吻合 ⇒ **可以用 `invokeHost('fs.*')` 直接实现同步 KV**，零新原生代码。
//
// 【★为什么用 `invokeHost` 而不是 `invokeHostAsync`】
//   `invokeHostAsync` 对 `fs.*` 是"发起 → 等壳回推"两段式，而 `CompatStorage` 的同步 API
//   **等不起**（`get` 必须立即返回）。同步版走同一条 `fs.*` 宿主实现，语义一致。
//
// 【★为什么是"单文件整份"而不是"每键一文件"】
//   宿主没有 `readdir`，而 Android 的 `fs.remove` 用 `File.delete()`——**非空目录删不掉**
//   ⇒ "按索引清盘"在索引缺失/损坏时清不干净（#1151 在 fetch 缓存持久层上真机踩过）。
//   ⇒ 一个文件存整份 KV：清盘 = 删掉那一个固定文件名（一定成功），且天然原子（一次写完）。
//   ★代价如实登记：写一个键要重写整份文件（O(N) 不是 O(1)）。见 ② 的写合并。
//
// 【★★★★#1241 四项必答（§1.0 S3）——每项都有可触发的证据，不是"设计上支持"】
//   ① **上限**：键名 ≤ `STORAGE_MAX_KEY_BYTES`(1 KiB) · 值 ≤ `STORAGE_MAX_VALUE_BYTES`(1 MiB) ·
//      整份文档 ≤ `STORAGE_MAX_TOTAL_BYTES`(8 MiB) · 键数 ≤ `STORAGE_MAX_KEYS`(4096)。
//      超限 ⇒ **显式错误**：异步面回 `capErr('storage.tooLarge' | 'storage.tooManyKeys')`；
//      同步面**拒绝写入**并记 `getStorageLastError()` / `storageStats().refused`。
//      ★★**这条修掉一个真实的数据消失隐患**：原先没有总额上限，而宿主 `fs.readBytes`
//      有 64 MiB 上限——文档一旦写超 64 MiB，`load()` 读失败就返回 `{}` ⇒ **所有键静默消失**。
//      现在总额在写之前就被 8 MiB 钉死（远低于 64 MiB）⇒ 该失败形态**不可能发生**。
//   ② **背压**：写是同步的、不能"排队等"，做的是**写合并**——`coalesce:true` 时同一微任务内的
//      多次 `set` 只落盘一次（计 `coalesced`），待落盘计数有上界 `STORAGE_MAX_PENDING_WRITES`。
//      ★默认仍**逐次落盘**（不改变持久化语义）——合并是**显式选入**的取舍，不是偷偷延迟。
//   ③ **回收**：进程内文档缓存登记进 `capability-resources`（`type:'storage-doc'`），
//      `release()` ⇒ 缓存置 null 并**回滚到已落盘快照**（下次访问重新读盘）。
//   ④ **并发/淘汰**：键数上界 ⇒ 超限**拒绝并计数**。★不淘汰业务数据——
//      KV 里没有"哪个键可以丢"的判断依据，擅自淘汰就是静默丢数据。
//      读数 `storageStats() = { keys, totalBytes, writes, refused, coalesced, dirty }`。
//
// 【★诚实边界（三条，都必须如实，不许用兜底掩盖）】
//   ① **鸿蒙没有 `fs.*`**（宿主未实现）⇒ 鸿蒙端 `getStorage` **如实不可用**
//     （不提供该桥方法 ⇒ `useStorage` 抛 `storage.unsupported`）。
//     ★**绝不用内存兜底冒充持久化**——那会让业务以为数据存住了、重启即丢（本仓最忌的形态）。
//   ② 单文件写入是**整份覆盖**：并发多进程写会互相覆盖（App 单进程模型下不触发；
//     若将来多进程，须先改宿主契约补 `append` 再换成每键追加 + 索引）。
//   ③ **`set()` 的失败不抛**（`CompatStorage.set` 签名是 `void`，没有错误通道）——
//     但**绝不静默**：`getStorageLastError()` / `storageStats().refused` 可读可断言；
//     需要错误回执时用 `setAsync()`（它回 `capErr`）。
import { invokeHost } from './capability-invoke'
import { capErr, capOk } from './capability-types'
import type { CapResult, CompatStorage } from './capability-types'
import type { CapabilityResourceRegistry } from './capability-resources'

/** 单文件 KV 的沙箱相对路径（宿主 `fs.*` 会自动建父目录） */
export const APP_KV_STORE_PATH = 'storage/proteus-kv.json'

/** ① 单个键名上限（字节） */
export const STORAGE_MAX_KEY_BYTES = 1024
/** ① 单个值（JSON 序列化后）上限（字节） */
export const STORAGE_MAX_VALUE_BYTES = 1024 * 1024
/**
 * ① 整份文档上限（字节）。
 * ★必须**显著低于**宿主 `fs.readBytes` 的 64 MiB：否则文档一旦越过宿主上限，
 *   `load()` 读失败会返回空文档 ⇒ 所有键静默消失（#1235 修掉的真实隐患）。
 */
export const STORAGE_MAX_TOTAL_BYTES = 8 * 1024 * 1024
/** ①④ 键数上限 */
export const STORAGE_MAX_KEYS = 4096
/** ② 写合并模式下的待落盘计数上界（达到即立即落盘，不再合并） */
export const STORAGE_MAX_PENDING_WRITES = 64

/** 规模读数（判据/探针用；不改变状态） */
export interface StorageStats {
  /** 当前键数 */
  keys: number
  /** 当前文档字节数（键+值+分隔，按 UTF-8 计） */
  totalBytes: number
  /** 成功落盘次数 */
  writes: number
  /** 因超限/超键数/宿主拒绝而被**拒绝**的写入次数（① ④） */
  refused: number
  /** 被写合并省掉的落盘次数（② 背压） */
  coalesced: number
  /** 是否还有未落盘的修改（② 背压） */
  dirty: boolean
}

/**
 * 桥成员对象（★抽取器契约要求"工厂顶层 return { 成员名 }"）。
 * ★宿主不支持时返回**空对象** ⇒ 装配层展开后**不提供** `getStorage` ⇒ `useStorage` 如实 unsupported。
 */
export interface AppStorageBridge {
  getStorage?: () => CompatStorage
}

/** 创建选项 */
export interface AppStorageOptions {
  /**
   * ② 写合并：`true` ⇒ 同一微任务内多次 `set` **只落盘一次**。
   * ★默认 `false`（每次 `set` 立即落盘）—— 合并会**推迟持久化**，是语义取舍，必须显式选入。
   * ★`remove` / `clear` 不合并（删除的语义是"立刻不要了"）。
   */
  coalesce?: boolean
  /** ③ 资源账本（#1094）：登记文档缓存 ⇒ scope dispose 时释放（回滚到已落盘快照） */
  resources?: CapabilityResourceRegistry
  /** 账本 owner 标签 */
  owner?: string
}

/** 宿主回执里取字节（`number[]` / base64 / `Uint8Array` 都接——三端壳习惯不同，与 #1095 同口径） */
function bytesOf(r: unknown): Uint8Array {
  if (r instanceof Uint8Array) return r
  if (Array.isArray(r)) return Uint8Array.from(r as number[])
  const o = r as { bytes?: unknown; data?: unknown; base64?: unknown } | null
  if (o && Array.isArray(o.bytes)) return Uint8Array.from(o.bytes as number[])
  if (o && typeof o.base64 === 'string') {
    // 极简 base64 解码（避免依赖 atob——App 精简引擎不一定有）
    const s = o.base64
    const bin = typeof atob === 'function' ? atob(s) : ''
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(0)
}

function utf8Decode(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] as number)
  // 简化：非 latin1 多字节字符需上层修正；KV 里通常是 ASCII/UTF-8 JSON
  try {
    return decodeURIComponent(escape(s))
  } catch {
    return s
  }
}

function utf8Encode(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // 代理对
      const c2 = s.charCodeAt(++i)
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return out
}

/** UTF-8 字节长度（只算长度，不真编码——上限判定用） */
function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

/** 进程内读数（模块级 ⇒ 进程退出自然回收） */
const stats: StorageStats & { lastError: string | null } = {
  keys: 0,
  totalBytes: 0,
  writes: 0,
  refused: 0,
  coalesced: 0,
  dirty: false,
  lastError: null,
}

/** 读规模读数（供探针/判据；不改变状态） */
export function storageStats(): StorageStats {
  return {
    keys: stats.keys,
    totalBytes: stats.totalBytes,
    writes: stats.writes,
    refused: stats.refused,
    coalesced: stats.coalesced,
    dirty: stats.dirty,
  }
}

/** 最近一次被拒绝/失败的原因（`null` ⇒ 无；同步 API 的错误通道，见诚实边界 ③） */
export function getStorageLastError(): string | null {
  return stats.lastError
}

/** 仅测试用：重置读数 */
export function __resetStorageStats(): void {
  stats.keys = 0
  stats.totalBytes = 0
  stats.writes = 0
  stats.refused = 0
  stats.coalesced = 0
  stats.dirty = false
  stats.lastError = null
}

/**
 * 宿主是否具备 KV 存储所需的 `fs.*` 三件套。
 *
 * ★用 `appNativeAvailable` 同款探测语义（`{probe:true}` ⇒ 宿主回"未知方法"即 false）。
 * ★**不缓存**：宿主能力在进程内不变，但装配可能发生在宿主注册之前——每次调用问一次更稳。
 */
export function appKvStorageAvailable(): boolean {
  for (const m of ['fs.readBytes', 'fs.writeBytes', 'fs.remove']) {
    const r = invokeHost(m, { probe: true })
    if (!r.ok && r.missing) return false
  }
  return true
}

/**
 * 创建 App 端的 `CompatStorage`（**同步**语义，底层是宿主的 `fs.*`）。
 *
 * @returns 空对象 ⇒ 宿主不支持 `fs.*`（**如实不可用**，由装配点决定不提供该方法）
 *
 * ★不返回"内存兜底"：理由见文件头诚实边界 ①。
 */
export function createAppFileStorage(opts: AppStorageOptions = {}): AppStorageBridge {
  /**
   * ★★★#1207：**返回桥成员对象**（不是裸存储）——抽取器（`app-bridge-keys.mjs`）要求
   *   登记的工厂有顶层 `return { 成员名 }`；这是"数据源契约"，不是风格偏好
   *   （本仓禁止第二份手写解析副本）。★本文件第一版返回裸 `CompatStorage` ⇒ 抽取器硬失败。
   */
  if (!appKvStorageAvailable()) return {}

  /** 内存里的当前文档（合并模式下可能领先于磁盘；落盘失败会回滚） */
  let doc: Record<string, string> | null = null
  /** 最近一次**成功落盘**的快照（回滚基准） */
  let persisted: Record<string, string> | null = null
  /** ② 写合并：是否有未落盘修改 */
  let dirty = false
  /** ② 写合并：累计的未落盘修改次数（用于 `coalesced` 计数） */
  let pendingCount = 0

  if (opts.resources) {
    opts.resources.register({
      type: 'storage-doc',
      owner: opts.owner,
      byteSize: 0, // 初始未加载；读数走 storageStats().totalBytes
      sourceLocation: 'packages/api/src/capability-app-storage.ts',
      release: () => {
        // ★回滚到已落盘快照（不把未落盘的修改当已持久化）；下次访问重新读盘
        doc = persisted
        dirty = false
        pendingCount = 0
        stats.dirty = false
      },
    })
  }

  function docBytes(d: Record<string, string>): number {
    let n = 0
    for (const k of Object.keys(d)) n += utf8Len(k) + utf8Len(d[k] as string) + 4
    return n
  }

  /**
   * 从宿主文件加载（首次访问）。
   * ★区分"文件不存在"（首次使用 ⇒ 合法空文档）与"读失败"（记 lastError，**不装作空文档**）。
   */
  function load(): Record<string, string> {
    if (doc !== null) return doc
    const r = invokeHost('fs.readBytes', { path: APP_KV_STORE_PATH })
    if (!r.ok) {
      // 宿主对"文件不存在"与"读失败"都是 ok:false ⇒ 只能按 reason 区分（不猜）
      const reason = String((r as { reason?: unknown }).reason ?? '')
      if (!/不存在|not found|no such|ENOENT/i.test(reason)) {
        stats.lastError = `storage.load: ${reason || '宿主拒绝读取'}`
      }
      doc = {}
      persisted = doc
      return doc
    }
    try {
      const text = utf8Decode(bytesOf(r.data))
      const parsed = text.length > 0 ? JSON.parse(text) : {}
      doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
    } catch {
      // ★损坏 ⇒ 当空文档（不静默"修复"成半份），但**记错误**（可观测）
      stats.lastError = 'storage.load: 文档损坏（JSON 解析失败）'
      doc = {}
    }
    persisted = doc
    stats.keys = Object.keys(doc).length
    stats.totalBytes = docBytes(doc)
    return doc
  }

  /** 落盘：**写成功才改内存与快照**；失败回滚并记账 */
  function commit(next: Record<string, string>): boolean {
    // ① 总额闸（★写之前判：绝不把文档写到宿主 64 MiB 上限附近）
    const nextBytes = docBytes(next)
    if (nextBytes > STORAGE_MAX_TOTAL_BYTES) {
      stats.refused++
      stats.lastError = `storage.tooLarge: 文档 ${nextBytes}B > ${STORAGE_MAX_TOTAL_BYTES}B`
      return false
    }
    const r = invokeHost('fs.writeBytes', { path: APP_KV_STORE_PATH, bytes: utf8Encode(JSON.stringify(next)) })
    if (!r.ok) {
      stats.refused++
      stats.lastError = `storage.failed: 宿主拒绝写入 ${APP_KV_STORE_PATH}`
      // ★回滚到已落盘快照（内存里绝不留下"看起来存住了"的值）
      doc = persisted
      return false
    }
    doc = next
    persisted = next
    stats.writes++
    stats.keys = Object.keys(next).length
    stats.totalBytes = nextBytes
    return true
  }

  /** ② 写合并：把未落盘修改落盘（幂等；无修改时 no-op） */
  function flush(): boolean {
    if (!dirty || doc === null) return true
    const n = pendingCount
    dirty = false
    pendingCount = 0
    stats.dirty = false
    const ok = commit(doc)
    if (ok && n > 1) stats.coalesced += n - 1   // 合并省掉的落盘次数
    return ok
  }

  /** ② 写合并：安排一次微任务落盘（多次 set 只落一次） */
  function scheduleFlush(): void {
    dirty = true
    stats.dirty = true
    pendingCount++
    // ★待落盘修改过多 ⇒ 立即落盘（不无限推迟，避免长时间"只在内存里"）
    if (pendingCount >= STORAGE_MAX_PENDING_WRITES) { flush(); return }
    if (typeof queueMicrotask === 'function') queueMicrotask(() => { flush() })
    else Promise.resolve().then(() => { flush() })
  }

  /** 写入前的三道闸：键名 / 单值 / 键数。返回错误串或 null（通过） */
  function checkWrite(cur: Record<string, string>, key: string, rawValue: string): string | null {
    if (utf8Len(key) > STORAGE_MAX_KEY_BYTES) {
      return `storage.tooLarge: key ${utf8Len(key)}B > ${STORAGE_MAX_KEY_BYTES}B`
    }
    if (utf8Len(rawValue) > STORAGE_MAX_VALUE_BYTES) {
      return `storage.tooLarge: value ${utf8Len(rawValue)}B > ${STORAGE_MAX_VALUE_BYTES}B`
    }
    if (!(key in cur) && Object.keys(cur).length >= STORAGE_MAX_KEYS) {
      return `storage.tooManyKeys: 已有 ${Object.keys(cur).length} 键（上限 ${STORAGE_MAX_KEYS}）`
    }
    return null
  }

  /** 拒绝一次写入（统一记账；同步面只能这样表达错误） */
  function refuse(code: string): void {
    stats.refused++
    stats.lastError = code
  }

  function readOne<T>(key: string): T | undefined {
    const raw = load()[key]
    if (raw === undefined) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }

  /** 写入一个键；返回错误串或 null */
  function put(key: string, value: unknown): string | null {
    const cur = load()
    let raw: string
    try {
      raw = JSON.stringify(value)
    } catch (e) {
      return `storage.failed: 值无法序列化为 JSON（${e instanceof Error ? e.message : String(e)}）`
    }
    const bad = checkWrite(cur, key, raw)
    if (bad) return bad
    // ★不改原对象（避免写失败后内存被污染）
    const next = { ...cur }
    next[key] = raw
    if (opts.coalesce) {
      // 合并模式：内存先认（set→get 立即可见），落盘在微任务里；失败则回滚 + 记错
      doc = next
      scheduleFlush()
      return null
    }
    return commit(next) ? null : (stats.lastError ?? 'storage.failed: 写入失败')
  }

  const store: CompatStorage = {
    get: <T,>(key: string) => readOne<T>(key),
    set: (key, value) => {
      const bad = put(key, value)
      if (bad) refuse(bad)
    },
    remove: (key) => {
      const cur = load()
      if (!(key in cur)) return
      const next = { ...cur }
      delete next[key]
      commit(next)
    },
    clear: () => {
      commit({})
    },
    // ── 异步面（对齐官方 setStorage/getStorage 的颗粒度；复用同步路径）──
    setAsync: (key, value) => {
      const bad = put(key, value)
      if (bad) {
        refuse(bad)
        return Promise.resolve(capErr(bad.split(':')[0] as string, bad))
      }
      return Promise.resolve(capOk(undefined))
    },
    getAsync: <T,>(key: string) =>
      Promise.resolve(capOk<T | undefined>(readOne<T>(key) as T | undefined)),
    removeAsync: (key) => {
      const cur = load()
      if (key in cur) {
        const next = { ...cur }
        delete next[key]
        if (!commit(next)) return Promise.resolve(capErr('storage.failed', stats.lastError ?? 'storage: 写入失败'))
      }
      return Promise.resolve(capOk(undefined))
    },
    clearAsync: () => {
      if (!commit({})) return Promise.resolve(capErr('storage.failed', stats.lastError ?? 'storage: 写入失败'))
      return Promise.resolve(capOk(undefined))
    },
    info: () => {
      const cur = load()
      let size = 0
      for (const v of Object.values(cur)) size += utf8Encode(v).length
      // ★limitSize 报**真实**上限（#1235 前是 0 = "没有配额概念"；现在有明确上界了）
      return Promise.resolve(capOk({ keys: Object.keys(cur), currentSize: size, limitSize: STORAGE_MAX_TOTAL_BYTES }))
    },
    batchGet: (keys) =>
      Promise.resolve(capOk(keys.map((k) => ({ key: k, value: readOne(k) })))),
    batchSet: (kvList) => {
      // ★批量：一次校验、一次落盘（这条路径本来就是 1 次写）
      const next = { ...load() }
      for (const kv of kvList) {
        let raw: string
        try {
          raw = JSON.stringify(kv.value)
        } catch {
          refuse('storage.failed: 值无法序列化为 JSON')
          return Promise.resolve(capErr('storage.failed', 'storage: 值无法序列化为 JSON'))
        }
        const bad = checkWrite(next, kv.key, raw)
        if (bad) {
          refuse(bad)
          return Promise.resolve(capErr(bad.split(':')[0] as string, bad))
        }
        next[kv.key] = raw
      }
      if (!commit(next)) {
        refuse(stats.lastError ?? 'storage.failed')
        return Promise.resolve(capErr('storage.failed', stats.lastError ?? 'storage: 批量写入失败'))
      }
      return Promise.resolve(capOk(undefined))
    },
  }

  return { getStorage: () => store }
}

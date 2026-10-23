// packages/api/src/capability-app-storage.ts
// ★★★#1207：App 端 **KV 存储**（`getStorage`）——按 useFetch 的标准落地：**底层栈已有，只差接线**。
//
// 【为什么单独成文件】`capability-app.ts` 已顶反巨型化基线（2079 行，**只减不增**）⇒
//   新增实现必须另开文件，装配点（`createAppCapabilities`）只用一行 spread 引入。
//
// 【★★★关键取证：为什么能在 JS 侧实现，不需要新写原生代码】
//   ① 宿主 `fs.readBytes` / `fs.writeBytes` / `fs.remove` **三端之二已实现**
//      （Android `FileTransferCapability` · iOS `file-transfer-capability.swift`）；
//   ② 它们走的是**同步派发**（Android `HostCapabilities.invoke` / iOS `host-capabilities.swift`
//      的 `switch method` 直接 `return ok(try …)`），而 `invokeHost()` 本身也是**同步**的
//      （见 `capability-invoke.ts` 的注释："调原生（**同步**——与 G-39 的 JNI trampoline 同契约）"）；
//   ③ `CompatStorage.get/set/remove/clear` 要求**同步**语义。
//   ⇒ 三者吻合 ⇒ **可以用 `invokeHost('fs.*')` 直接实现同步 KV**，零新原生代码。
//   ★这是本项与 C 类（定位/相机/蓝牙…三端各写平台子系统）的**本质区别**，也是它能进"批 1"的原因。
//
// 【★为什么用 `invokeHost` 而不是 `invokeHostAsync`】
//   `invokeHostAsync` 对 `fs.*` 是"发起 → 等壳回推"两段式（见 `capability-fetch-cache-runtime.ts`），
//   而 `CompatStorage` 的同步 API **等不起**（`get` 必须立即返回）。
//   同步版走同一条 `fs.*` 宿主实现，语义一致。
//
// 【★为什么是"单文件整份"而不是"每键一文件"】
//   宿主只开了 `readBytes/writeBytes/remove`，**没有 `readdir`**，而 Android 的 `fs.remove`
//   用 `File.delete()`——**非空目录删不掉** ⇒ "按索引清盘"在索引缺失/损坏时清不干净
//   （#1151 在 fetch 缓存持久层上真机踩过：iOS 读到前一天残留而索引为空 ⇒ 清盘静默无效）。
//   ⇒ 一个文件存整份 KV：清盘 = 删掉那一个固定文件名（一定成功），且天然原子（一次写完）。
//   ★代价如实登记：写一个键要重写整份文件（O(N) 不是 O(1)）。KV 量级（几十~几百键）可接受。
//
// 【★诚实边界（三条，都必须如实，不许用兜底掩盖）】
//   ① **鸿蒙没有 `fs.*`**（宿主未实现）⇒ 鸿蒙端 `getStorage` **如实不可用**
//     （不提供该桥方法 ⇒ `useStorage` 抛 `storage.unsupported`）。
//     ★**绝不用内存兜底冒充持久化**——那会让业务以为数据存住了、重启即丢（本仓最忌的形态）。
//   ② 单文件写入是**整份覆盖**：并发多进程写会互相覆盖（App 单进程模型下不触发；
//     若将来多进程，须先改宿主契约补 `readdir` 再换成每键一文件）。
//   ③ 单键大小受宿主 `fs.readBytes` 的 64 MiB 上限约束（远超 KV 合理量级，仅登记）。
import { invokeHost } from './capability-invoke'
import { capErr, capOk } from './capability-types'
import type { CapResult, CompatStorage } from './capability-types'

/** 单文件 KV 的沙箱相对路径（宿主 `fs.*` 会自动建父目录） */
export const APP_KV_STORE_PATH = 'storage/proteus-kv.json'

/**
 * 桥成员对象（★抽取器契约要求"工厂顶层 return { 成员名 }"）。
 * ★宿主不支持时返回**空对象** ⇒ 装配层展开后**不提供** `getStorage` ⇒ `useStorage` 如实 unsupported。
 */
export interface AppStorageBridge {
  getStorage?: () => CompatStorage
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
 * @returns `undefined` ⇒ 宿主不支持 `fs.*`（**如实不可用**，由装配点决定不提供该方法）
 *
 * ★不返回"内存兜底"：理由见文件头诚实边界 ①。
 */
export function createAppFileStorage(): AppStorageBridge {
  /**
   * ★★★#1207：**返回桥成员对象**（不是裸存储）——抽取器（`app-bridge-keys.mjs`）要求
   *   登记的工厂有顶层 `return { 成员名 }`；这是"数据源契约"，不是风格偏好
   *   （本仓禁止第二份手写解析副本）。★本文件第一版返回裸 `CompatStorage` ⇒ 抽取器硬失败，
   *   契约当场拦住——这正是它该做的事。
   */
  if (!appKvStorageAvailable()) return {}

  /** 进程内整份文档（首次访问时从文件加载；写入时同步更新） */
  let doc: Record<string, string> | null = null
  /** 上次写盘是否失败（异步 API 据此回 Err；同步 API 只能尽力） */
  let lastWriteOk = true

  function load(): Record<string, string> {
    if (doc !== null) return doc
    const r = invokeHost('fs.readBytes', { path: APP_KV_STORE_PATH })
    if (!r.ok) {
      // 文件不存在 / 读失败 ⇒ 空文档（★不抛：首次使用就该是空文档）
      doc = {}
      return doc
    }
    try {
      const text = utf8Decode(bytesOf(r.data))
      const parsed = text.length > 0 ? JSON.parse(text) : {}
      doc = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
    } catch {
      // ★损坏 ⇒ 当空文档（不静默"修复"成半份；上层读条目时自然取不到）
      doc = {}
    }
    return doc
  }

  /** 整份落盘（同步一次写完）。★失败只记录不抛——同步 API 无错误通道。 */
  function persist(next: Record<string, string>): boolean {
    doc = next
    const r = invokeHost('fs.writeBytes', { path: APP_KV_STORE_PATH, bytes: utf8Encode(JSON.stringify(next)) })
    lastWriteOk = r.ok
    return r.ok
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

  const store: CompatStorage = {
    get: <T,>(key: string) => readOne<T>(key),
    set: (key, value) => {
      const next = { ...load() }
      next[key] = JSON.stringify(value)
      persist(next)
    },
    remove: (key) => {
      const cur = load()
      if (!(key in cur)) return
      const next = { ...cur }
      delete next[key]
      persist(next)
    },
    clear: () => {
      persist({})
    },
    // ── 异步面（对齐官方 setStorage/getStorage 的颗粒度；实现复用同步路径）──
    setAsync: (key, value) => {
      const next = { ...load() }
      next[key] = JSON.stringify(value)
      return Promise.resolve(persist(next) ? capOk(undefined) : capErr('storage.failed', 'storage: 写入失败'))
    },
    getAsync: <T,>(key: string) =>
      Promise.resolve(capOk<T | undefined>(readOne<T>(key) as T | undefined)),
    removeAsync: (key) => {
      const cur = load()
      if (key in cur) {
        const next = { ...cur }
        delete next[key]
        persist(next)
      }
      return Promise.resolve(capOk(undefined))
    },
    clearAsync: () => {
      persist({})
      return Promise.resolve(capOk(undefined))
    },
    info: () => {
      const cur = load()
      let size = 0
      for (const v of Object.values(cur)) size += utf8Encode(v).length
      // ★limitSize 给 0：App 端没有平台配额概念（磁盘容量约束），**不编一个假上限**
      return Promise.resolve(capOk({ keys: Object.keys(cur), currentSize: size, limitSize: 0 }))
    },
    batchGet: (keys) =>
      Promise.resolve(capOk(keys.map((k) => ({ key: k, value: readOne(k) })))),
    batchSet: (kvList) => {
      const next = { ...load() }
      for (const kv of kvList) next[kv.key] = JSON.stringify(kv.value)
      return Promise.resolve(persist(next) ? capOk(undefined) : capErr('storage.failed', 'storage: 批量写入失败'))
    },
  }
  return { getStorage: () => store }
}

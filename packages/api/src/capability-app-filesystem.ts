// packages/api/src/capability-app-filesystem.ts
// ★★★#1226 App 能力批 1 第 3 项：`getFileSystem` —— **基础面**（读写/存在/删除）+ 其余方法的**具名边界**。
//
// 【为什么只做基础面（取证，不是偷懒）】`FileSystemBridge` 契约有 **26 个方法**：
//   readFile/writeFile/appendFile/copyFile/rename/remove/exists/stat/mkdir/rmdir/readdir/getFileInfo/
//   saveFile/getSavedFileList/removeSavedFile/unzip + 10 个 Sync 变体。
//   而宿主 `fs.*` 只有 **3 个**（readBytes/writeBytes/remove，本轮补 `exists` ⇒ 4 个）。
//   ⇒ 缺 22 个，其中 readdir/stat/mkdir/rmdir/copy/rename/unzip 都要**新的宿主方法**（三端各一套）。
//   ★这正是 #1212 口径二修的结论：`getFileSystem` **不是 A 类**（不是"只差接线"）。
//
// 【本文件做什么】
//   ① **基础面 4 个方法**（readFile / writeFile / remove / exists）走宿主 `fs.*`，真实可用；
//   ② 其余 22 个**显式抛 `file-system.unsupported` 并写明缺哪个宿主方法**——
//      ★不静默失败、不返回假数据（本仓最忌："看起来能调，实际什么都没做"）。
//
// 【诚实边界】
//   · 文本编解码用 UTF-8（与 `capability-app-storage.ts` 同一套实现，不引第二份）；
//   · **不做 `appendFile`**：宿主没有 append 语义，用"读全文+拼接+整写"会在并发下丢数据
//     ⇒ 如实归入 unsupported（宁可少一个方法，不给一个会静默丢数据的实现）；
//   · 路径校验由宿主负责（拒绝绝对路径与 `..`）——本层**不复制**沙箱校验（一份就够）。
import { invokeHost } from './capability-invoke'
import type { FileStat, FileSystemBridge } from './capability-types'

/** 基础面（真实可用）的方法名 */
export const APP_FS_BASE_METHODS = [
  'readFile', 'writeFile', 'remove', 'exists',
  // ★★★#1227 目录面
  'stat', 'readdir', 'mkdir', 'rmdir',
] as const

/**
 * 其余方法的**具名缺口语义**：方法名 → 缺哪个宿主能力。
 * ★这张表是"诚实登记"的唯一来源——门禁/文档都读它（不手写第二份清单）。
 */
export const APP_FS_UNSUPPORTED: Readonly<Record<string, string>> = {
  appendFile: '宿主无 append 语义（读全文拼接再整写会在并发下丢数据）',
  copyFile: '宿主缺 fs.copy',
  rename: '宿主缺 fs.rename',
  getFileInfo: '宿主缺 fs.stat（摘要需 size + digest）',
  saveFile: '宿主无"临时文件→持久目录"概念',
  getSavedFileList: '宿主无保存文件索引',
  removeSavedFile: '宿主无保存文件索引',
  unzip: '宿主缺 fs.unzip',
  readFileSync: '宿主 fs.readBytes 走同步派发，但契约要求返回 string（需先定编码约定）',
  writeFileSync: '同上（需先定编码约定）',
  existsSync: '同上',
  statSync: '宿主缺 fs.stat',
  readdirSync: '宿主缺 fs.readdir',
  mkdirSync: '宿主缺 fs.mkdir',
  renameSync: '宿主缺 fs.rename',
  unlinkSync: '宿主缺 fs.unlink（可复用 fs.remove，但需先定 Sync 语义）',
  copyFileSync: '宿主缺 fs.copy',
  appendFileSync: '宿主无 append 语义',
}

/** 宿主是否具备基础面所需的 `fs.*` 四件套 */
export function appFileSystemAvailable(): boolean {
  for (const m of ['fs.readBytes', 'fs.writeBytes', 'fs.remove']) {
    const r = invokeHost(m, { probe: true })
    if (!r.ok && r.missing) return false
  }
  for (const m of ['fs.exists', 'fs.stat', 'fs.readdir', 'fs.mkdir', 'fs.rmdir']) {
    const r = invokeHost(m, { probe: true })
    if (!r.ok && r.missing) return false
  }
  return true
}

/** 宿主回执里取字节（与 capability-app-storage.ts 同口径：number[] / base64 / Uint8Array 都接） */
function bytesOf(r: unknown): Uint8Array {
  if (r instanceof Uint8Array) return r
  if (Array.isArray(r)) return Uint8Array.from(r as number[])
  const o = r as { bytes?: unknown; base64?: unknown } | null
  if (o && Array.isArray(o.bytes)) return Uint8Array.from(o.bytes as number[])
  if (o && typeof o.base64 === 'string') {
    const bin = typeof atob === 'function' ? atob(o.base64) : ''
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
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i)
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return out
}

/** 桥成员对象（★抽取器契约：顶层唯一 `return { 显式属性 }`） */
export interface AppFileSystemBridge {
  getFileSystem?: () => FileSystemBridge
}

/**
 * 创建 App 端的文件系统桥（**基础面可用 + 其余具名 unsupported**）。
 *
 * @returns 空对象 ⇒ 宿主缺 `fs.*` 基础面（如实不可用，装配层不提供该方法）
 */
export function createAppFileSystem(): AppFileSystemBridge {
  const unsupported = (method: string): Promise<never> => {
    const why = APP_FS_UNSUPPORTED[method] ?? '未实现'
    return Promise.reject(new Error(`file-system.unsupported: ${method} —— ${why}`))
  }

  const fs: FileSystemBridge = {
    // ── 基础面（真实可用）──
    readFile: (path: string) => {
      const r = invokeHost('fs.readBytes', { path })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: readFile ${path}：宿主拒绝`))
      return Promise.resolve(utf8Decode(bytesOf(r.data)))
    },
    writeFile: (path: string, data: string) => {
      const r = invokeHost('fs.writeBytes', { path, bytes: utf8Encode(String(data)) })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: writeFile ${path}：宿主拒绝`))
      return Promise.resolve()
    },
    remove: (path: string) => {
      const r = invokeHost('fs.remove', { path })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: remove ${path}：宿主拒绝`))
      return Promise.resolve()
    },
    exists: (path: string) => {
      const r = invokeHost('fs.exists', { path })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: exists ${path}：宿主拒绝`))
      const d = r.data as { exists?: boolean } | null
      return Promise.resolve(Boolean(d && d.exists))
    },
    // ── ★★★#1227 目录面（真实可用）──
    stat: (path: string) => {
      const r = invokeHost('fs.stat', { path })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: stat ${path}：宿主拒绝`))
      const d = (r.data ?? {}) as Partial<FileStat>
      // ★字段逐项验证（不直接 as 强转：宿主缺字段时要能发现）
      return Promise.resolve({
        size: Number(d.size ?? 0),
        mode: Number(d.mode ?? 0),
        lastAccessedTime: Number(d.lastAccessedTime ?? 0),
        lastModifiedTime: Number(d.lastModifiedTime ?? 0),
        isDirectory: Boolean(d.isDirectory),
        isFile: Boolean(d.isFile),
      })
    },
    readdir: (path: string) => {
      const r = invokeHost('fs.readdir', { path })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: readdir ${path}：宿主拒绝`))
      const d = r.data as { entries?: unknown } | null
      const list = Array.isArray(d?.entries) ? (d!.entries as unknown[]) : []
      return Promise.resolve(list.map((x) => String(x)))
    },
    mkdir: (path: string, recursive?: boolean) => {
      const r = invokeHost('fs.mkdir', { path, ...(recursive === undefined ? {} : { recursive }) })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: mkdir ${path}：宿主拒绝`))
      return Promise.resolve()
    },
    rmdir: (path: string, recursive?: boolean) => {
      const r = invokeHost('fs.rmdir', { path, ...(recursive === undefined ? {} : { recursive }) })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: rmdir ${path}：宿主拒绝`))
      return Promise.resolve()
    },
  } as FileSystemBridge

  // ── 其余 22 个：显式 unsupported（★不是 undefined，也不是假实现）──
  for (const m of Object.keys(APP_FS_UNSUPPORTED)) {
    ;(fs as unknown as Record<string, unknown>)[m] = () => unsupported(m)
  }

  return { getFileSystem: () => fs }
}

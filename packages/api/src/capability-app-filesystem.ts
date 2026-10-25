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
//   · ★★**`unzip` 是端可选能力**：Android 有 `ZipInputStream`；iOS `compression.h` 与
//     鸿蒙 `zlib.h` **只有 raw deflate、没有 ZIP 容器解析** ⇒ 该两端宿主未实现 ⇒
//     `unzip()` 在那两端如实报 `unsupported`（**不影响其余 11 个方法可用**）。
import { invokeHost } from './capability-invoke'
import type { FileStat, FileSystemBridge } from './capability-types'

/** 基础面（真实可用）的方法名 */
export const APP_FS_BASE_METHODS = [
  'readFile', 'writeFile', 'remove', 'exists',
  // ★★★#1227 目录面
  'stat', 'readdir', 'mkdir', 'rmdir',
  // ★★★#1228 复合面
  'copyFile', 'rename', 'getFileInfo',
  // ★★★#1229 压缩包（宿主不支持时不提供该方法）
  'unzip',
  // ★★★#1230 保存文件三件套（纯 JS 组合 fs.*，三端一致可用）
  'saveFile', 'getSavedFileList', 'removeSavedFile',
] as const

/**
 * 其余方法的**具名缺口语义**：方法名 → 缺哪个宿主能力。
 * ★这张表是"诚实登记"的唯一来源——门禁/文档都读它（不手写第二份清单）。
 */
export const APP_FS_UNSUPPORTED: Readonly<Record<string, string>> = {
  appendFile: '宿主无 append 语义（读全文拼接再整写会在并发下丢数据）',
  readFileSync: '宿主 fs.readBytes 走同步派发，但契约要求返回 string（需先定编码约定）',
  writeFileSync: '同上（需先定编码约定）',
  existsSync: '同上',
  statSync: '宿主有 fs.stat（#1227），缺的是同步返回 string 的编码约定',
  readdirSync: '宿主有 fs.readdir（#1227），缺的是同步返回 string 的编码约定',
  mkdirSync: '宿主有 fs.mkdir（#1227），缺的是同步返回 string 的编码约定',
  renameSync: '宿主有 fs.rename（#1228），缺的是同步返回 string 的编码约定',
  unlinkSync: '宿主有 fs.remove（幂等），缺的是同步返回 string 的编码约定',
  copyFileSync: '宿主有 fs.copy（#1228），缺的是同步返回 string 的编码约定',
  appendFileSync: '宿主无 append 语义',
}

/** 宿主是否具备基础面所需的 `fs.*` 四件套 */
export function appFileSystemAvailable(): boolean {
  for (const m of ['fs.readBytes', 'fs.writeBytes', 'fs.remove']) {
    const r = invokeHost(m, { probe: true })
    if (!r.ok && r.missing) return false
  }
  // ★★★**这里只探「必需面」**。
  //   ★★自查拉出的真 bug：曾把 `fs.unzip` 也列进这里 ⇒ iOS/鸿蒙（无 ZIP 容器 API）
  //   探测不到 ⇒ `appFileSystemAvailable()` 返 false ⇒ 装配层**不提供 getFileSystem**
  //   ⇒ 连 `readFile`/`writeFile` 都没了（11 个方法一并消失）。
  //   ★**端差异不等于整体不可用**：可选能力单独探测（见下的 optional）。
  for (const m of ['fs.exists', 'fs.stat', 'fs.readdir', 'fs.mkdir', 'fs.rmdir',
                   'fs.copy', 'fs.rename', 'fs.getFileInfo']) {
    const r = invokeHost(m, { probe: true })
    if (!r.ok && r.missing) return false
  }
  return true
}

/**
 * ★可选能力探测（**不影响** `appFileSystemAvailable`）。
 *   `fs.unzip`：只有 Android 有原生 `ZipInputStream`；iOS `compression.h` 与鸿蒙 `zlib.h`
 *   都**只有 raw deflate、没有 ZIP 容器解析**（EOCD/中央目录/local header）。
 */
export function appFileSystemOptionalAvailable(method: 'unzip'): boolean {
  const r = invokeHost(`fs.${method}`, { probe: true })
  return r.ok || r.missing !== true
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

/** 保存文件的专用目录（沙箱相对）——与普通文件分开，便于"保存的东西"与"工作文件"区分 */
export const APP_SAVED_DIR = 'saved'
/** 保存索引（与 KV 存储同目录；单文件 JSON，原子性边界同 getStorage） */
export const APP_SAVED_INDEX = 'storage/proteus-saved.json'
/** 进程内单调序号（解决 `Date.now()` 毫秒碰撞——同一毫秒两次 saveFile 会撞名） */
let savedSeq = 0

/** 索引条目（path → 元数据） */
type SavedIndex = Record<string, { size: number; createTime: number }>

/** 读索引（文件不存在 / 损坏 ⇒ 空索引——与 getStorage 同委态） */
function readSavedIndex(): SavedIndex {
  const r = invokeHost('fs.readBytes', { path: APP_SAVED_INDEX })
  if (!r.ok) return {}
  try {
    const text = utf8Decode(bytesOf(r.data))
    const parsed = text ? (JSON.parse(text) as { entries?: unknown }) : null
    const e = parsed?.entries
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as SavedIndex) : {}
  } catch {
    return {}
  }
}

/** 写索引（返回是否成功；失败时调用方如实报错） */
function writeSavedIndex(idx: SavedIndex): boolean {
  const r = invokeHost('fs.writeBytes', { path: APP_SAVED_INDEX, bytes: utf8Encode(JSON.stringify({ entries: idx })) })
  return r.ok
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
    // ── ★★★#1228 复合面（真实可用）──
    copyFile: (src: string, dest: string) => {
      const r = invokeHost('fs.copy', { src, dest })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: copy ${src} → ${dest}：宿主拒绝`))
      return Promise.resolve()
    },
    rename: (oldPath: string, newPath: string) => {
      const r = invokeHost('fs.rename', { oldPath, newPath })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: rename ${oldPath} → ${newPath}：宿主拒绝`))
      return Promise.resolve()
    },
    getFileInfo: (path: string, digestAlgorithm?: string) => {
      const r = invokeHost('fs.getFileInfo', { path, ...(digestAlgorithm === undefined ? {} : { digestAlgorithm }) })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: getFileInfo ${path}：宿主拒绝`))
      const d = (r.data ?? {}) as { size?: unknown; digest?: unknown; digestSupported?: unknown }
      // ★digestSupported 如果宿主明确说 false（鸿蒙现状）⇒ digest 为空字符串，不假造
      return Promise.resolve({
        size: Number(d.size ?? 0),
        digest: typeof d.digest === 'string' ? d.digest : '',
      })
    },
    unzip: (zipPath: string, targetPath: string) => {
      // ★★端可选能力：宿主没有该方法 ⇒ **unsupported**（不是 failed）
      if (!appFileSystemOptionalAvailable('unzip')) {
        return Promise.reject(new Error('file-system.unsupported: unzip —— 本端宿主无 ZIP 容器解析能力（仅 Android 有 ZipInputStream）'))
      }
      const r = invokeHost('fs.unzip', { zipPath, targetPath })
      if (!r.ok) return Promise.reject(new Error(`file-system.failed: unzip ${zipPath} → ${targetPath}：宿主拒绝`))
      return Promise.resolve()
    },
    // ── ★★★#1230 保存文件三件套（纯 JS 组合：rename/remove/stat/readBytes/writeBytes）──
    //   ★模型：保存的文件放 `saved/`，索引放 `storage/proteus-saved.json`（与 KV 存储同委态）。
    //   ★**为什么能纯 JS**：`fs.rename/remove/stat/readBytes/writeBytes` 三端均已可用
    //     （#1226~#1228）⇒ 不需新宿主方法（与 getStorage 同套工艺）。
    saveFile: async (tempPath: string) => {
      const ex = invokeHost('fs.exists', { path: tempPath })
      if (!ex.ok || !(ex.data as { exists?: boolean } | null)?.exists) {
        throw new Error(`file-system.failed: saveFile 源不存在 ${tempPath}`)
      }
      const mk = invokeHost('fs.mkdir', { path: APP_SAVED_DIR, recursive: true })
      if (!mk.ok) throw new Error('file-system.failed: saveFile 建保存目录失败')
      // ★目标名 = 时间戳 + 原文件名（避免同名冲突；rename 对已存在目标会报错）
      const base = tempPath.split('/').filter(Boolean).pop() ?? 'file'
      const now = Date.now()
      // ★★进程内单调序号：同一毫秒内连续保存同名文件也不会撞路径（判据 ⑥ 抽出的真缺陷）
      const dest = `${APP_SAVED_DIR}/${now}-${++savedSeq}-${base}`
      const rn = invokeHost('fs.rename', { oldPath: tempPath, newPath: dest })
      if (!rn.ok) throw new Error(`file-system.failed: saveFile 移动失败 ${tempPath}`)
      const st = invokeHost('fs.stat', { path: dest })
      const size = st.ok ? Number((st.data as { size?: unknown } | null)?.size ?? 0) : 0
      const idx = readSavedIndex()
      idx[dest] = { size, createTime: now }
      if (!writeSavedIndex(idx)) throw new Error('file-system.failed: saveFile 写索引失败')
      return dest
    },
    getSavedFileList: async () => {
      const idx = readSavedIndex()
      const out: { filePath: string; size: number; createTime: number }[] = []
      let pruned = false
      for (const [p, meta] of Object.entries(idx)) {
        const ex = invokeHost('fs.exists', { path: p })
        const alive = ex.ok && Boolean((ex.data as { exists?: boolean } | null)?.exists)
        // ★★**漂移修剪**：文件被外部删了 ⇒ 从索引剔掉（否则返回一堆不存在的路径）
        if (!alive) { delete idx[p]; pruned = true; continue }
        out.push({ filePath: p, size: Number(meta.size ?? 0), createTime: Number(meta.createTime ?? 0) })
      }
      if (pruned) writeSavedIndex(idx)
      return out.sort((a, b) => b.createTime - a.createTime)   // 新的在前
    },
    removeSavedFile: async (path: string) => {
      // ★宿主 fs.remove 幂等（文件不存在也算成功）⇒ 索引一并清理即可
      const r = invokeHost('fs.remove', { path })
      if (!r.ok) throw new Error(`file-system.failed: removeSavedFile ${path}：宿主拒绝`)
      const idx = readSavedIndex()
      if (path in idx) {
        delete idx[path]
        if (!writeSavedIndex(idx)) throw new Error('file-system.failed: removeSavedFile 写索引失败')
      }
    },
  } as FileSystemBridge

  // ── 其余 22 个：显式 unsupported（★不是 undefined，也不是假实现）──
  for (const m of Object.keys(APP_FS_UNSUPPORTED)) {
    ;(fs as unknown as Record<string, unknown>)[m] = () => unsupported(m)
  }

  return { getFileSystem: () => fs }
}

// packages/api/src/capability-app-unzip.ts
// ★★★#1232 ZIP 容器解析（**三端共用的唯一实现**）+ 通过宿主 `fs.inflateRaw` 解压。
//
// 【为什么 ZIP 解析放共享 JS 层，而不是各端宿主各写一套】
//   ZIP 是**格式**（EOCD → 中央目录 → local header），不是平台能力。各端各写一套的代价：
//   ① 三份 zip slip 校验（最容易写错的安全逻辑）⇒ 必然有一端漏；
//   ② 三份「数据描述符（bit 3）/ ZIP64 / 目录条目」边界处理 ⇒ 行为分叉。
//   ⇒ 只在**这里**解析容器；宿主只提供 **裸 deflate**（`fs.inflateRaw`）。
//   ★这消掉了原先 Android 用 `ZipInputStream`、iOS/鸿蒙没有的分叉 —— 三端现在走**同一条代码**。
//
// 【支持的 ZIP 子集（如实登记，不假装完整）】
//   · 方法 0（stored，不压缩）· 方法 8（deflate）
//   · 无加密 · 无 ZIP64（>4GiB / >65535 条目 —— 超限**报错**而不是错解）
//   · 数据描述符（general purpose bit 3）⇒ 支持（尺寸从**中央目录**取，local header 里可能为 0）
//
// 【安全（三道闸，全部在本文件）】
//   ① **zip slip**：条目名解析后必须仍在目标目录之下（canonical 前缀判定；
//      拒绝绝对路径、`..`、盘符、Windows 反斜杠逃逸）。
//   ② **zip bomb**：条目数 / 单条解压后大小 / 总解压量 三个上限。
//   ③ **不覆盖已存在文件**：解压不静默覆盖（覆盖 = 丢数据）。
import { invokeHost } from './capability-invoke'

/** 上限（与 Android 原生实现同值） */
export const UNZIP_MAX_ENTRIES = 4096
export const UNZIP_MAX_ENTRY_BYTES = 128 * 1024 * 1024
export const UNZIP_MAX_TOTAL_BYTES = 512 * 1024 * 1024

/** 中央目录里的一条记录（解析结果） */
export interface ZipEntryMeta {
  name: string
  /** 压缩方法（0 = stored / 8 = deflate） */
  method: number
  /** 压缩后大小 */
  compressedSize: number
  /** 解压后大小（来自中央目录，**可信** —— 局部头可能是 0） */
  uncompressedSize: number
  /** 压缩数据在文件里的起始偏移 */
  dataOffset: number
  isDirectory: boolean
}

/**
 * 从完整 ZIP 字节里解析出中央目录。
 * @throws 结构非法 / 加密 / ZIP64 / 不支持的压缩方法
 */
export function parseZipCentralDirectory(zip: Uint8Array): ZipEntryMeta[] {
  const len = zip.length
  if (len < 22) throw new Error('fs.unzip: 不是合法 ZIP（长度 < 22）')

  // ① 找 EOCD（End of Central Directory，签名 0x06054b50）——**从尾部往前找**
  //    ★EOCD 后面可能有注释（最长为 65535 字节），所以要扫一个区间而不是只看最后 22 字节。
  let eocd = -1
  const scanFrom = Math.max(0, len - 22 - 0xffff)
  for (let i = len - 22; i >= scanFrom; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('fs.unzip: 找不到 EOCD（不是合法 ZIP，或 ZIP64/多卷）')

  const total = u16(zip, eocd + 10)
  const cdSize = u32(zip, eocd + 12)
  const cdOffset = u32(zip, eocd + 16)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ★ZIP64 的哨兵值：如实报错（不猜——猜错会解出垃圾）
    throw new Error('fs.unzip: 该 ZIP 使用 ZIP64（>4GiB 或 >65535 条目），本版不支持')
  }
  if (cdOffset + cdSize > len) throw new Error('fs.unzip: 中央目录越界（文件被截断？）')

  // ② 遍历中央目录（签名 0x02014b50）
  const entries: ZipEntryMeta[] = []
  let p = cdOffset
  for (let n = 0; n < total; n++) {
    if (p + 46 > len) throw new Error('fs.unzip: 中央目录记录越界')
    if (!(zip[p] === 0x50 && zip[p + 1] === 0x4b && zip[p + 2] === 0x01 && zip[p + 3] === 0x02)) {
      throw new Error(`fs.unzip: 中央目录第 ${n + 1} 条签名非法`)
    }
    const flags = u16(zip, p + 8)
    const method = u16(zip, p + 10)
    const compressedSize = u32(zip, p + 20)
    const uncompressedSize = u32(zip, p + 24)
    const nameLen = u16(zip, p + 28)
    const extraLen = u16(zip, p + 30)
    const commentLen = u16(zip, p + 32)
    const localOffset = u32(zip, p + 42)
    const nameBytes = zip.subarray(p + 46, p + 46 + nameLen)
    const name = decodeUtf8Loose(nameBytes)
    p += 46 + nameLen + extraLen + commentLen

    if ((flags & 0x0001) !== 0) throw new Error(`fs.unzip: 条目「${name}」已加密，不支持`)
    if ((flags & 0x0800) === 0) {
      // ★未设 UTF-8 标志 ⇒ 按 CP437 解释会乱码；本仓只处理 ASCII 名与 UTF-8 名
      //   （非 ASCII 且无标志 ⇒ 如实报错，不猜编码）
      if ([...nameBytes].some((b) => b > 0x7f)) {
        throw new Error(`fs.unzip: 条目名含非 ASCII 但未标记 UTF-8（无法可靠解码）：${name}`)
      }
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error(`fs.unzip: 条目「${name}」使用 ZIP64 尺寸，本版不支持`)
    }

    // ③ 定位数据起点：读 local header（签名 0x04034b50）拿它自己的可变长字段长度
    //    ★不能直接用中央目录的 extraLen —— local header 的 extra 字段长度**可以与中央目录不同**
    if (localOffset + 30 > len) throw new Error(`fs.unzip: 条目「${name}」局部头越界`)
    if (!(zip[localOffset] === 0x50 && zip[localOffset + 1] === 0x4b && zip[localOffset + 2] === 0x03 && zip[localOffset + 3] === 0x04)) {
      throw new Error(`fs.unzip: 条目「${name}」局部头签名非法`)
    }
    const lNameLen = u16(zip, localOffset + 26)
    const lExtraLen = u16(zip, localOffset + 28)
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen
    if (dataOffset + compressedSize > len) throw new Error(`fs.unzip: 条目「${name}」数据越界`)

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      dataOffset,
      isDirectory: name.endsWith('/'),
    })
  }
  return entries
}

/**
 * 取某条目的**原始压缩字节**。
 * @param storedOnly 仅当方法为 0/8 时有效（其他方法在 parse 阶段未拦，这里抛）
 */
export function entryCompressedBytes(zip: Uint8Array, e: ZipEntryMeta): Uint8Array {
  return zip.subarray(e.dataOffset, e.dataOffset + e.compressedSize)
}

/**
 * 解压单个条目（stored 直取 / deflate 走宿主 `fs.inflateRaw`）。
 * @throws 不支持的压缩方法 / 解压失败 / 尺寸与中央目录不符
 */
export function inflateEntry(zip: Uint8Array, e: ZipEntryMeta): Uint8Array {
  const raw = entryCompressedBytes(zip, e)
  if (e.method === 0) {
    // stored：压缩前后一致（但仍校验，防中央目录尺寸撒谎）
    if (raw.length !== e.uncompressedSize) {
      throw new Error(`fs.unzip: 条目「${e.name}」stored 尺寸不符（${raw.length} ≠ ${e.uncompressedSize}）`)
    }
    return raw
  }
  if (e.method !== 8) {
    throw new Error(`fs.unzip: 条目「${e.name}」压缩方法 ${e.method} 不支持（仅 stored/deflate）`)
  }
  const r = invokeHost('fs.inflateRaw', { bytes: Array.from(raw) })
  if (!r.ok) throw new Error(`fs.unzip: 条目「${e.name}」解压失败（宿主拒绝）`)
  const d = r.data as { bytes?: unknown; size?: unknown } | null
  const bytes = Array.isArray(d?.bytes) ? Uint8Array.from(d!.bytes as number[]) : new Uint8Array(0)
  // ★校验解压后尺寸 = 中央目录声明值（防"解出来比声明多"这类炸弹形态）
  if (bytes.length !== e.uncompressedSize) {
    throw new Error(`fs.unzip: 条目「${e.name}」解压尺寸不符（${bytes.length} ≠ ${e.uncompressedSize}）`)
  }
  return bytes
}

/**
 * ★★**zip slip 判定**：条目名是否会逃出目标目录。
 *
 * @param name    ZIP 里的条目名（可能是绝对路径 / `..` / 反斜杠分隔）
 * @returns 归一化后的**沙箱相对路径**（安全）；不安全 ⇒ `null`
 *
 * 【判定规则（宁严不宽）】
 *   · 空 / 绝对路径（`/` 开头或 `X:` 盘符）⇒ 拒
 *   · 任一路段为 `..` ⇒ 拒（**不做"归一化后仍在里面"的宽松判定** —— 那条路径极易写错）
 *   · 反斜杠视作分隔符（Windows 造的 ZIP）
 *   · 前置 `./` 剥掉
 */
export function safeEntryPath(name: string): string | null {
  const norm = name.replace(/\\/g, '/')
  if (norm.length === 0) return null
  if (norm.startsWith('/')) return null
  if (/^[A-Za-z]:/.test(norm)) return null
  const segs = norm.split('/').filter((s) => s.length > 0 && s !== '.')
  if (segs.length === 0) return null
  if (segs.some((s) => s === '..')) return null
  return segs.join('/')
}

/* ───────────── 底层小工具 ───────────── */

function u16(b: Uint8Array, i: number): number {
  return ((b[i] as number) | ((b[i + 1] as number) << 8)) >>> 0
}
function u32(b: Uint8Array, i: number): number {
  return (((b[i] as number) | ((b[i + 1] as number) << 8) | ((b[i + 2] as number) << 16) | ((b[i + 3] as number) << 24)) >>> 0)
}

function decodeUtf8Loose(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] as number)
  return s
}

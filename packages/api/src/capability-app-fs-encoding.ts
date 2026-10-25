// packages/api/src/capability-app-fs-encoding.ts
// ★★★#1231 文件读写**编码器**（对齐 wx `FileSystemManager` 的 encoding 语义）
//
// 【语义来源（用户 2026-10-25 给出的 wx 规则）】
//   「指定读取文件的字符编码，**如果不传 encoding，则以 ArrayBuffer 格式读取文件的二进制内容**」
//   ⇒ `readFileSync(path)` 缺 encoding = 二进制（ArrayBuffer）；
//     `readFileSync(path, 'utf8')` = 字符串。这是 wx 的**契约**，不是我们的选择。
//
// 【为什么编码器在共享层（JS 侧）而不是宿主】
//   宿主只提供字节通道（`fs.readBytes` / `fs.writeBytes`），编码/解码全在这里做 ⇒
//   ① **三端天然一致**（App 三平台 / Web / MP 走同一份实现，不存在"Android 按 GBK、iOS 按 UTF-8"这类分叉）；
//   ② 不需要为每种编码加宿主方法（那是 6 种编码 × 3 端 = 18 个方法）。
//   ★这是本仓"语义在共享层、字节在宿主"分层的一次正面实例。
//
// 【支持的编码集（与 wx 一致）】
//   `utf8` / `utf-8` · `latin1` / `binary` · `ascii` · `base64` · `hex` ·
//   `ucs2` / `ucs-2` / `utf16le` / `utf-16le`
//   ★别名归一（`utf-8`→`utf8` 等），否则同一编码两种写法会走两条分支。
//
// 【诚实边界】
//   ① `ascii` 解码时按 Node 语义**只保留低 7 位**（高位清零）；对非 ASCII 字节会静默变成别的字符
//      —— 这是 wx/Node 的既有行为，不是我们的取舍；文档里写清。
//   ② `ucs2` 是 **UTF-16LE**（每 2 字节一小端字符）；代理对（emoji）需 4 字节，本实现按标准码元逐个拼。
//   ③ 未列编码 ⇒ **抛错**（不静默当 utf8 —— 那是"看起来读了、内容全错"的最坏形态）。

/** 归一后的编码名（未列 ⇒ `null`） */
export type FsEncoding = 'utf8' | 'latin1' | 'ascii' | 'base64' | 'hex' | 'ucs2'

const ALIAS: Record<string, FsEncoding> = {
  utf8: 'utf8',
  'utf-8': 'utf8',
  latin1: 'latin1',
  binary: 'latin1',   // ★wx/Node：binary 是 latin1 的别名
  ascii: 'ascii',
  base64: 'base64',
  hex: 'hex',
  ucs2: 'ucs2',
  'ucs-2': 'ucs2',
  utf16le: 'ucs2',
  'utf-16le': 'ucs2',
}

/**
 * 归一编码名。
 * @param encoding 调用方传入的编码（缺省 ⇒ `'utf8'`，**这是"写"的缺省**；"读"的缺省是 ArrayBuffer，由调用方决定）
 * @throws 未知编码（不静默当 utf8）
 */
export function normalizeEncoding(encoding: string | undefined): FsEncoding {
  if (encoding === undefined || encoding === '') return 'utf8'
  const key = String(encoding).trim().toLowerCase()
  const hit = ALIAS[key]
  if (!hit) {
    throw new Error(
      `file-system.unsupported: 未知编码「${encoding}」（支持 utf8 / latin1 / binary / ascii / base64 / hex / ucs2 / utf16le）`,
    )
  }
  return hit
}

/* ══════════════════════ 解码：bytes → string ══════════════════════ */

/**
 * 字节 → 字符串。
 * @param bytes    0..255 的字节数组
 * @param encoding 目标编码（调用方应已 normalize）
 */
export function decodeBytes(bytes: Uint8Array, encoding: FsEncoding): string {
  switch (encoding) {
    case 'utf8':
      return decodeUtf8(bytes)
    case 'latin1': {
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number)
      return s
    }
    case 'ascii': {
      // ★Node 语义：高位清零（& 0x7F）
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode((bytes[i] as number) & 0x7f)
      return s
    }
    case 'base64':
      return encodeBase64(bytes)
    case 'hex': {
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += (bytes[i] as number).toString(16).padStart(2, '0')
      return s
    }
    case 'ucs2': {
      // ★UTF-16LE：每 2 字节一小端码元；奇数尾巴按 Node 丢弃（不补 0——补 0 会凭空多一个字符）
      let s = ''
      const n = bytes.length - (bytes.length % 2)
      for (let i = 0; i < n; i += 2) {
        s += String.fromCharCode((bytes[i] as number) | ((bytes[i + 1] as number) << 8))
      }
      return s
    }
    default:
      throw new Error(`file-system.unsupported: 解码不支持 ${String(encoding)}`)
  }
}

/* ══════════════════════ 编码：string → bytes ══════════════════════ */

/**
 * 字符串 → 字节。
 * @throws 编码无法表示该字符串时（如 ascii 遇到中文 ⇒ 高位被清零、内容失真）——**不静默丢**
 */
export function encodeString(s: string, encoding: FsEncoding): number[] {
  switch (encoding) {
    case 'utf8':
      return encodeUtf8(s)
    case 'latin1': {
      const out: number[] = []
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        // ★latin1 只能表示 U+0000..U+00FF；超出 ⇒ 抛错（静默截断 = 内容坏了还报成功）
        if (c > 0xff) throw new Error(`file-system.failed: 字符串含 U+${c.toString(16).toUpperCase()}，latin1 无法表示`)
        out.push(c)
      }
      return out
    }
    case 'ascii': {
      const out: number[] = []
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c > 0x7f) throw new Error(`file-system.failed: 字符串含非 ASCII 字符 U+${c.toString(16).toUpperCase()}，ascii 无法表示`)
        out.push(c)
      }
      return out
    }
    case 'base64':
      return decodeBase64(s)
    case 'hex': {
      const clean = s.trim()
      if (clean.length % 2 !== 0) throw new Error('file-system.failed: hex 字符串长度必须为偶数')
      const out: number[] = []
      for (let i = 0; i < clean.length; i += 2) {
        const b = Number.parseInt(clean.slice(i, i + 2), 16)
        if (!Number.isFinite(b)) throw new Error(`file-system.failed: 非法 hex 字符「${clean.slice(i, i + 2)}」`)
        out.push(b)
      }
      return out
    }
    case 'ucs2': {
      const out: number[] = []
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        out.push(c & 0xff, (c >> 8) & 0xff)
      }
      return out
    }
    default:
      throw new Error(`file-system.unsupported: 编码不支持 ${String(encoding)}`)
  }
}

/* ══════════════════════ 底层实现 ══════════════════════ */

function decodeUtf8(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(b)
    } catch {
      /* 回落到手写解码 */
    }
  }
  let s = ''
  let i = 0
  while (i < b.length) {
    const c = b[i] as number
    if (c < 0x80) {
      s += String.fromCharCode(c)
      i += 1
    } else if (c >= 0xc0 && c < 0xe0 && i + 1 < b.length) {
      s += String.fromCharCode(((c & 0x1f) << 6) | ((b[i + 1] as number) & 0x3f))
      i += 2
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length) {
      s += String.fromCharCode(((c & 0x0f) << 12) | (((b[i + 1] as number) & 0x3f) << 6) | ((b[i + 2] as number) & 0x3f))
      i += 3
    } else if (c >= 0xf0 && i + 3 < b.length) {
      const cp =
        (((c & 0x07) << 18) | (((b[i + 1] as number) & 0x3f) << 12) | (((b[i + 2] as number) & 0x3f) << 6) | ((b[i + 3] as number) & 0x3f)) -
        0x10000
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
      i += 4
    } else {
      s += '\ufffd'   // 非法序列 ⇒ 替换字符（与 TextDecoder 默认同）
      i += 1
    }
  }
  return s
}

function encodeUtf8(s: string): number[] {
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

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeBase64(b: Uint8Array): string {
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const b0 = b[i] as number
    const b1 = i + 1 < b.length ? (b[i + 1] as number) : -1
    const b2 = i + 2 < b.length ? (b[i + 2] as number) : -1
    out += B64[b0 >> 2]
    out += B64[((b0 & 0x03) << 4) | (b1 >= 0 ? b1 >> 4 : 0)]
    out += b1 >= 0 ? B64[((b1 & 0x0f) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '='
    out += b2 >= 0 ? B64[b2 & 0x3f] : '='
  }
  return out
}

function decodeBase64(s: string): number[] {
  const clean = s.replace(/[\s=]/g, '')
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) throw new Error(`file-system.failed: 非法 base64 字符「${ch}」`)
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return out
}

/** 字节 → ArrayBuffer（`readFileSync` 不传 encoding 时的返回形态）。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // ★必须是**精确长度**的 buffer（`bytes.buffer` 可能是更大 slab 的视图）
  return bytes.slice().buffer
}

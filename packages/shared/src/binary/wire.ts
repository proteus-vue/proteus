// packages/shared/src/binary/wire.ts
// ★★★跨语言二进制 wire 的**公共原语**（2026-10-13 · 决策 #903 / S2「去 JSON」）
//
// 【为什么在 shared】（原为 `packages/slot-runtime/src/buffer.ts` 的**私有副本**）
//   本仓已有多条二进制通道（`blob.rs`「PLYT」/ `rects_bin.rs`「PRES」/ `slot-runtime`「PVOP」/
//   `invoke-wire`「PINV/PRSP」）——每处各写一份「小端字节游标 + UTF-8」= 纪律 #22 的静默缺陷温床。
//   本文件是全仓**唯一实现**：调用方 import 这里的 `ByteWriter`/`ByteReader`/`utf8Encode`/`utf8Decode`，
//   不再各写副本。
//
// ★slot-runtime 的私有副本**本轮未合并**（该包以「零依赖自包含」为定位，避免为 100 行原语拉依赖）——
//   该边界如实登记在此（两副本的等价性由 `tests/invoke-wire.test.ts` 的中文/代理对用例与
//   `check:invoke-wire-parity` 的 24 条黄金向量守住字节语义）。
//
// 【契约】小端；长度前缀一律以**字节**计（不是字符）；越界/截断**抛错**（不静默补零——
//   静默会让双端比对假绿）；UTF-8 **严格**（非法序列抛错，不替换）。

/** 写入游标（小端；`exact=false` 时自动倍增扩容，`done()` 返回已写段）。 */
export class ByteWriter {
  private buf: Uint8Array
  private pos = 0
  private readonly exact: boolean

  /**
   * @param size  初始容量
   * @param exact 是否定长模式（默认 true = 既有语义：容量不匹配即报错）
   */
  constructor(size: number, exact = true) {
    this.buf = new Uint8Array(size)
    this.exact = exact
  }

  /** 已写入字节数 */
  get length(): number {
    return this.pos
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    if (this.exact) {
      throw new Error(`写入溢出：还需 ${n} 字节，仅剩 ${this.buf.length - this.pos}（定长模式）`)
    }
    let cap = this.buf.length === 0 ? 64 : this.buf.length
    while (cap < this.pos + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
  }

  u8(v: number): void {
    this.ensure(1)
    this.buf[this.pos++] = v & 0xff
  }

  u16(v: number): void {
    this.ensure(2)
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
  }

  u32(v: number): void {
    this.ensure(4)
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
    this.buf[this.pos++] = (v >>> 16) & 0xff
    this.buf[this.pos++] = (v >>> 24) & 0xff
  }

  f32(v: number): void {
    this.ensure(4)
    const f = new Float32Array(1)
    f[0] = v
    const b = new Uint8Array(f.buffer)
    this.buf[this.pos++] = b[0]
    this.buf[this.pos++] = b[1]
    this.buf[this.pos++] = b[2]
    this.buf[this.pos++] = b[3]
  }

  /** u16 长度前缀 + UTF-8（≤65535B；与既有逐帧格式同约定） */
  str(s: string): void {
    const bytes = utf8Encode(s)
    if (bytes.length > 65535) throw new Error(`字符串过长（>65535B）：${bytes.length}`)
    this.ensure(2 + bytes.length)
    this.u16(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }

  /** 裸字节（无前缀） */
  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }

  /**
   * 在指定位置**回填** u32 —— 用于「先占位、后回填」的长度前缀（TLV 区）。
   * 【为什么需要】TLV 写 `len` 时必须先知道 payload 长度，而 payload 是边编码边产生的；
   *   两遍编码要跑两次 UTF-8（浪费），占位回填只需一遍。
   */
  patchU32(at: number, v: number): void {
    if (at < 0 || at + 4 > this.pos) throw new Error(`回填越界：@${at}（已写 ${this.pos} 字节）`)
    this.buf[at] = v & 0xff
    this.buf[at + 1] = (v >>> 8) & 0xff
    this.buf[at + 2] = (v >>> 16) & 0xff
    this.buf[at + 3] = (v >>> 24) & 0xff
  }

  done(): Uint8Array {
    if (this.exact && this.pos !== this.buf.length) {
      throw new Error(`写入长度不符：${this.pos} != ${this.buf.length}`)
    }
    return this.exact ? this.buf : this.buf.subarray(0, this.pos)
  }
}

/** 读取游标（越界即抛，不静默补零）。 */
export class ByteReader {
  private readonly buf: Uint8Array
  private pos = 0

  constructor(buf: Uint8Array) {
    this.buf = buf
  }

  get offset(): number {
    return this.pos
  }

  get remaining(): number {
    return this.buf.length - this.pos
  }

  u8(): number {
    if (this.remaining < 1) throw new Error('字节流被截断（u8）')
    return this.buf[this.pos++]
  }

  u16(): number {
    if (this.remaining < 2) throw new Error('字节流被截断（u16）')
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8)
    this.pos += 2
    return v
  }

  u32(): number {
    if (this.remaining < 4) throw new Error('字节流被截断（u32）')
    const v =
      (this.buf[this.pos] | (this.buf[this.pos + 1] << 8) | (this.buf[this.pos + 2] << 16) | (this.buf[this.pos + 3] << 24)) >>> 0
    this.pos += 4
    return v
  }

  f32(): number {
    if (this.remaining < 4) throw new Error('字节流被截断（f32）')
    const b = this.buf.subarray(this.pos, this.pos + 4)
    this.pos += 4
    // ★拷贝到独立 buffer（subarray 可能非 4 字节对齐，Float32Array 视图会抛）
    const copy = new Uint8Array(4)
    copy.set(b)
    return new Float32Array(copy.buffer)[0]
  }

  str(): string {
    const len = this.u16()
    if (this.remaining < len) throw new Error('字节流被截断（str）')
    const s = utf8Decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  /** 裸字节视图（**不拷贝**；调用方需长期持有请自行 slice） */
  raw(n: number): Uint8Array {
    if (this.remaining < n) throw new Error('字节流被截断（raw）')
    const v = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }

  /** 剩余全部字节（视图） */
  rest(): Uint8Array {
    return this.buf.subarray(this.pos)
  }
}

/** 极小 UTF-8 编码器（与 Rust 的 `String::as_bytes` 一致；代理对按标准编码为 4 字节） */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000
        i++
      }
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

/**
 * 极小 UTF-8 解码器（严格：非法序列报错而不是静默替换——静默替换会让双端比对假绿）。
 *
 * ★★★2026-10-19（决策 #1071）：**ASCII 快路径**。原实现逐字符 `out += String.fromCharCode(cp)`
 *   —— 对 1MB 纯 ASCII 实测 **35.65ms**（V8 原生 `JSON.parse` 同尺寸仅 0.49ms，差 74 倍）。
 *   而 App 三端引擎（QuickJS/JSC/JSVM）**都没有 `TextDecoder`**（查证：C 桥 / JSC 上下文 / JSVM 注入点
 *   均无该全局），所以只能在本文件内优化。
 *
 * 【快路径做法】连续 ASCII 段用 `String.fromCharCode.apply` 分块批量转换（引擎内建，C++ 侧实现）。
 *   实测 1MB ASCII：35.65ms → **4.05ms（8.8x）**；CJK 密集内容无改善（仍逐码点，如实）。
 *
 * 【★严格性不变】快路径只处理 `< 0x80` 的字节（ASCII 不可能误解码）；一旦遇到高位字节就退回
 *   原有逐码点分支 ⇒ **非法序列仍然抛错**，双端比对不会假绿。分块边界不切在多字节序列中间
 *   （因为只切在 ASCII 段末尾）。
 */
export function utf8Decode(bytes: Uint8Array): string {
  const n = bytes.length
  // 分块大小：兼顾 `apply` 实参数量上限与调用次数（8K 在 QuickJS/JSC/V8 上均安全）
  const CHUNK = 8192
  const parts: string[] = []
  let i = 0
  while (i < n) {
    // ① ASCII 连续段：批量转换（快路径）
    let asciiEnd = i
    while (asciiEnd < n && bytes[asciiEnd] < 0x80) asciiEnd++
    if (asciiEnd > i) {
      const seg = bytes.subarray(i, asciiEnd)
      if (seg.length <= CHUNK) {
        parts.push(String.fromCharCode.apply(null, seg as unknown as number[]))
      } else {
        for (let p = 0; p < seg.length; p += CHUNK) {
          const sub = seg.subarray(p, Math.min(seg.length, p + CHUNK))
          parts.push(String.fromCharCode.apply(null, sub as unknown as number[]))
        }
      }
      i = asciiEnd
      continue
    }
    // ② 多字节序列：逐码点解（与原实现完全一致，含全部严格校验）
    const b0 = bytes[i]
    let cp: number
    let need: number
    if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f
      need = 1
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f
      need = 2
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07
      need = 3
    } else {
      throw new Error(`非法 UTF-8 首字节：0x${b0.toString(16)} @${i}`)
    }
    if (i + need >= n) throw new Error(`UTF-8 截断 @${i}`)
    for (let k = 1; k <= need; k++) {
      const bn = bytes[i + k]
      if ((bn & 0xc0) !== 0x80) throw new Error(`非法 UTF-8 续字节：0x${bn.toString(16)} @${i + k}`)
      cp = (cp << 6) | (bn & 0x3f)
    }
    i += need + 1
    if (cp > 0xffff) {
      cp -= 0x10000
      parts.push(String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)))
    } else {
      parts.push(String.fromCharCode(cp))
    }
  }
  // 单片直接返回（常见：小 JSON）——省一次 join
  return parts.length === 1 ? parts[0]! : parts.join('')
}

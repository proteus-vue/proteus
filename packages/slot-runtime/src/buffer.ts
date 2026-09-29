// packages/slot-runtime/src/buffer.ts
// Vapor for Proteus IR —— ★OpBuffer 与**二进制线上格式**（方案 §2.4）
//
// 【为什么是二进制而不是 JSON（本仓实测的量化依据）】
//   layout-core-rust/src/blob.rs 顶注记录：4051 节点场景里「布局耗时」的 **95%+ 是 JSON 通道成本**
//   （解析 + 建树 75.84ms，而纯布局仅约 2ms）。更新指令走的是**每帧**都要过的热路径，
//   比首屏建树更敏感 ⇒ 指令通道必须是「顺序读 + 定长字段」，无字符扫描、无 f32 文本解析。
//
// 【与既有 blob.rs 的差别（为什么不能直接复用它的格式）】
//   blob.rs 传的是**节点树**（一次性构造，长生命周期）；本格式传的是**更新指令**（每帧一批、
//   短生命周期）。前者优化「体积」，后者优化「解码路径长度」——故本格式**不压缩、不位图**，
//   每条指令定长（除 SET_ATTRS / LIST_SPLICE 的可变数组成员），解码即游标推进。
//
// ── 线上格式（全部小端；★TS 与 Rust 必须逐字节一致，由 golden 门禁锁定）──
//   Header（20B）
//     magic    u32 = 0x504F5650（"PVOP"）
//     version  u32
//     opCount  u32
//     keyCount u32          属性键表条目数
//     strCount u32          字符串池条目数
//   KeyPool         keyCount ×（u16 len, utf8 bytes）
//   StringPool      strCount ×（u16 len, utf8 bytes）
//   Ops             opCount 条，见下方 OPS_SIZE / encodeOp
//
// ★★**V2 的语义变更：池按需（只含被引用的条目）**（2026-09-29）
//
// 【为什么（本仓真机实测）】V1 每条消息都携带**全量**键池与字符串池。列表场景下
//   字符串池会累积 1000 个文本（`行1`…`行1000`）⇒ 单行更新消息 **7964 字节**中
//   **~7900 是池**（真实增量仅 ~20 字节）⇒ 膨胀 ~78×，编码成本 42×。
//   ⇒ V2：编码时**扫描本消息实际引用的 ref**，只把这些条目放进池，并**重映射** ref 下标。
//   解码端语义**完全不变**（`key_of`/`string_of` 仍按池下标解析）——它只会看到一个更小的池。
//
// 【为什么不用"会话内池缓存"（方案 A）】那会给 Rust 解码引入**跨消息状态**（与句柄绑定、
//   销毁需重置）；而"按需 + 重映射"保持**无状态解码**（本格式的架构美德，见文件头第 2 段）。
//
// 【版本】`OPS_VERSION` 1 → **2**。解码端对 1 仍兼容吗？——**不兼容**（池语义不同，
//   同字节会解出不同结果）⇒ 双端必须同步升级；版本不符时**显式报错**（已有机制）。
//
// 【指令体尺寸】SET_PROP/SET_STYLE 11 · SET_TEXT 9 · SET_ATTRS 7+6n · TOGGLE_VIS 6 ·
//   INSERT_BLOCK 10 · REMOVE_NODE 5 · MOVE_NODE 10 · LIST_SET 9 · LIST_SPLICE 15+4n ·
//   LIST_UPDATE 17 · CALL_COMPONENT_UPDATE 13
import { InsertPos, OpCode, PropKeyTable, StringPool } from './opcode'
import type { UpdateOp } from './opcode'

export const OPS_MAGIC = 0x504f5650 // "PVOP"（小端字节序 50 56 4F 50）
export const OPS_VERSION = 2   // ★V2：池按需（只含被引用条目）+ ref 重映射
export const OPS_HEADER_BYTES = 20

/** 指令体**最小**字节数（判据用；实际值见文件头注释） */
export function opSize(op: UpdateOp): number {
  switch (op.op) {
    case OpCode.SET_PROP:
    case OpCode.SET_STYLE:
      return 11
    case OpCode.SET_TEXT:
      return 9
    case OpCode.SET_ATTRS:
      return 7 + 6 * op.attrs.length
    case OpCode.TOGGLE_VIS:
      return 6
    case OpCode.INSERT_BLOCK:
      return 10
    case OpCode.REMOVE_NODE:
      return 5
    case OpCode.MOVE_NODE:
      return 10
    case OpCode.LIST_SET:
      return 9
    case OpCode.LIST_SPLICE:
      return 15 + 4 * op.itemKeyRefs.length
    case OpCode.LIST_UPDATE:
      return 17
    case OpCode.CALL_COMPONENT_UPDATE:
      return 13
    default: {
      const never: never = op
      throw new Error(`未知指令：${JSON.stringify(never)}`)
    }
  }
}

/* ────────────────────────── 写入游标 ────────────────────────── */

class ByteWriter {
  private buf: Uint8Array
  private pos = 0
  constructor(size: number) {
    this.buf = new Uint8Array(size)
  }
  u8(v: number): void {
    this.buf[this.pos++] = v & 0xff
  }
  u16(v: number): void {
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
  }
  u32(v: number): void {
    this.buf[this.pos++] = v & 0xff
    this.buf[this.pos++] = (v >>> 8) & 0xff
    this.buf[this.pos++] = (v >>> 16) & 0xff
    this.buf[this.pos++] = (v >>> 24) & 0xff
  }
  f32(v: number): void {
    // ★必须走 Float32Array（而不是手写位运算）：语义是「f32 精度取舍」，与 Rust 的
    //   `as f32` 完全一致；手写会引入 f64 中间表示，双端会出现 1ulp 级偏差。
    const f = new Float32Array(1)
    f[0] = v
    const b = new Uint8Array(f.buffer)
    this.buf[this.pos++] = b[0]
    this.buf[this.pos++] = b[1]
    this.buf[this.pos++] = b[2]
    this.buf[this.pos++] = b[3]
  }
  str(s: string): void {
    const bytes = utf8Encode(s)
    if (bytes.length > 0xffff) throw new Error(`字符串过长（>65535B）：${bytes.length}`)
    this.u16(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }
  done(): Uint8Array {
    if (this.pos !== this.buf.length) throw new Error(`写入长度不符：${this.pos} != ${this.buf.length}`)
    return this.buf
  }
}

class ByteReader {
  private pos = 0
  constructor(private readonly buf: Uint8Array) {}
  get offset(): number {
    return this.pos
  }
  get remaining(): number {
    return this.buf.length - this.pos
  }
  u8(): number {
    if (this.remaining < 1) throw new Error('指令流被截断（u8）')
    return this.buf[this.pos++]
  }
  u16(): number {
    if (this.remaining < 2) throw new Error('指令流被截断（u16）')
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8)
    this.pos += 2
    return v
  }
  u32(): number {
    if (this.remaining < 4) throw new Error('指令流被截断（u32）')
    const v =
      (this.buf[this.pos] | (this.buf[this.pos + 1] << 8) | (this.buf[this.pos + 2] << 16) | (this.buf[this.pos + 3] << 24)) >>> 0
    this.pos += 4
    return v
  }
  f32(): number {
    if (this.remaining < 4) throw new Error('指令流被截断（f32）')
    const b = this.buf.subarray(this.pos, this.pos + 4)
    this.pos += 4
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + 4))[0]
  }
  str(): string {
    const len = this.u16()
    if (this.remaining < len) throw new Error('指令流被截断（str）')
    const s = utf8Decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }
}

/* ────────────────────────── UTF-8（不依赖 TextEncoder：宿主环境不一定有） ────────────────────────── */

/** 极小 UTF-8 编码器（与 Rust 的 `String::as_bytes` 一致；代理对按标准编码为 4 字节） */
function utf8Encode(s: string): Uint8Array {
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

/** 极小 UTF-8 解码器（严格：非法序列报错而不是静默替换——静默替换会让双端比对假绿） */
function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let cp: number
    let need: number
    if (b0 < 0x80) {
      cp = b0
      need = 0
    } else if ((b0 & 0xe0) === 0xc0) {
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
    if (i + need >= bytes.length) throw new Error(`UTF-8 截断 @${i}`)
    for (let k = 1; k <= need; k++) {
      const bn = bytes[i + k]
      if ((bn & 0xc0) !== 0x80) throw new Error(`非法 UTF-8 续字节：0x${bn.toString(16)} @${i + k}`)
      cp = (cp << 6) | (bn & 0x3f)
    }
    i += need + 1
    if (cp > 0xffff) {
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += String.fromCharCode(cp)
    }
  }
  return out
}

/* ────────────────────────── OpBuffer ────────────────────────── */

/** 提交回调：拿到编码后的字节（App 端即「一次 JSI 调用」的位置） */
export type OpSink = (bytes: Uint8Array, opCount: number) => void

/**
 * 指令缓冲区（方案 §2.4）
 *
 * 【用法】槽位写入 → `push(op)` 累积 → 帧调度器每帧调用一次 `flush(...)` 一次性提交。
 * 【为什么 flush 后清空】缓冲区按帧复用（同一实例），避免每帧分配（热路径不产生垃圾）。
 */
export class OpBuffer {
  private readonly ops: UpdateOp[] = []

  push(op: UpdateOp): void {
    this.ops.push(op)
  }

  get count(): number {
    return this.ops.length
  }

  /** 只读快照（调试 / explain / 测试用） */
  snapshot(): readonly UpdateOp[] {
    return this.ops.slice()
  }

  clear(): void {
    this.ops.length = 0
  }

  /**
   * 编码并提交，随后**清空**。
   *
   * @param keys    属性键表（进入 Header，供消费方还原 keyId → 字符串）
   * @param strings 字符串池（同上）
   * @param sink    提交出口（App 端 = 一次 JSI 调用）
   * @returns 本次提交的字节数
   */
  flush(keys: PropKeyTable, strings: StringPool, sink: OpSink): number {
    const bytes = encodeOps(this.ops, keys, strings)
    const n = this.ops.length
    sink(bytes, n)
    this.ops.length = 0
    return bytes.length
  }
}

/** 编码（纯函数；导出供 golden 门禁与调试使用） */
/**
 * ★★本消息**实际引用**的池下标（升序去重）——V2「池按需」的依据
 *
 * 【为什么单独抽出来】ref 的使用点有 6 处（SET_PROP/SET_STYLE 的 keyId · SET_ATTRS 的
 *   attrs[].keyId · SET_TEXT 的 textRef · LIST_SPLICE 的 itemKeyRefs[] · LIST_UPDATE 的
 *   itemKeyRef · …）。**逐处手写收集必漏**（本仓纪律 #22：第 N 份手写副本 = 下一个静默缺陷）
 *   ⇒ 收敛到这里一处；将来加新 opcode 时只改这一个函数。
 */
function collectRefs(ops: readonly UpdateOp[]): { keyIds: number[]; strRefs: number[] } {
  const k = new Set<number>()
  const s = new Set<number>()
  for (const op of ops) {
    switch (op.op) {
      case OpCode.SET_PROP:
      case OpCode.SET_STYLE:
        k.add(op.keyId)
        break
      case OpCode.SET_ATTRS:
        for (const a of op.attrs) k.add(a.keyId)
        break
      case OpCode.SET_TEXT:
        s.add(op.textRef)
        break
      case OpCode.LIST_SPLICE:
        for (const r of op.itemKeyRefs) s.add(r)
        break
      case OpCode.LIST_UPDATE:
        s.add(op.itemKeyRef)
        break
      // TOGGLE_VIS / INSERT_BLOCK / REMOVE_NODE / MOVE_NODE / LIST_SET /
      // CALL_COMPONENT_UPDATE：无池引用（若将来新增，**在此处补一支**）
      default:
        break
    }
  }
  return { keyIds: [...k].sort((a, b) => a - b), strRefs: [...s].sort((a, b) => a - b) }
}

/** 重映射表：旧池下标 → 新池下标（未引用 ⇒ undefined） */
function remapOf(used: number[]): Map<number, number> {
  const m = new Map<number, number>()
  used.forEach((old, i) => m.set(old, i))
  return m
}

/** 按重映射表改 ref（**唯一实现**：与 `collectRefs` 的 6 个使用点严格对应） */
function remapOp(op: UpdateOp, kMap: Map<number, number>, sMap: Map<number, number>): UpdateOp {
  switch (op.op) {
    case OpCode.SET_PROP:
    case OpCode.SET_STYLE:
      return { ...op, keyId: kMap.get(op.keyId) ?? 0 }
    case OpCode.SET_ATTRS:
      return { ...op, attrs: op.attrs.map((a) => ({ keyId: kMap.get(a.keyId) ?? 0, value: a.value })) }
    case OpCode.SET_TEXT:
      return { ...op, textRef: sMap.get(op.textRef) ?? 0 }
    case OpCode.LIST_SPLICE:
      return { ...op, itemKeyRefs: op.itemKeyRefs.map((r) => sMap.get(r) ?? 0) }
    case OpCode.LIST_UPDATE:
      return { ...op, itemKeyRef: sMap.get(op.itemKeyRef) ?? 0 }
    default:
      return op
  }
}

export function encodeOps(ops: readonly UpdateOp[], keys: PropKeyTable, strings: StringPool): Uint8Array {
  const allKeys = keys.toArray()
  const allStrs = strings.toArray()

  // ★V2：池按需——只保留本消息引用的条目，并重映射 ref（见文件头「V2 的语义变更」）
  const used = collectRefs(ops)
  const keyArr = used.keyIds.map((i) => allKeys[i]!).filter((x) => x !== undefined)
  const strArr = used.strRefs.map((i) => allStrs[i]!).filter((x) => x !== undefined)
  // 重映射表（用**实际保留的条目**建，跳过越界索引 ⇒ 与 pool 长度严格一致）
  const kMap = remapOf(used.keyIds.filter((i) => allKeys[i] !== undefined))
  const sMap = remapOf(used.strRefs.filter((i) => allStrs[i] !== undefined))

  let size = OPS_HEADER_BYTES
  for (const k of keyArr) size += 2 + utf8Encode(k).length
  for (const s of strArr) size += 2 + utf8Encode(s).length
  for (const op of ops) size += opSize(op)

  const w = new ByteWriter(size)
  w.u32(OPS_MAGIC)
  w.u32(OPS_VERSION)
  w.u32(ops.length)
  w.u32(keyArr.length)
  w.u32(strArr.length)
  for (const k of keyArr) w.str(k)
  for (const s of strArr) w.str(s)
  for (const op of ops) encodeOp(w, remapOp(op, kMap, sMap))
  return w.done()
}

function encodeOp(w: ByteWriter, op: UpdateOp): void {
  w.u8(op.op)
  switch (op.op) {
    case OpCode.SET_PROP:
    case OpCode.SET_STYLE:
      w.u32(op.nodeId)
      w.u16(op.keyId)
      w.f32(op.value)
      return
    case OpCode.SET_TEXT:
      w.u32(op.nodeId)
      w.u32(op.textRef)
      return
    case OpCode.SET_ATTRS:
      w.u32(op.nodeId)
      w.u16(op.attrs.length)
      for (const a of op.attrs) {
        w.u16(a.keyId)
        w.f32(a.value)
      }
      return
    case OpCode.TOGGLE_VIS:
      w.u32(op.nodeId)
      w.u8(op.visible ? 1 : 0)
      return
    case OpCode.INSERT_BLOCK:
      w.u32(op.blockId)
      w.u32(op.refNodeId)
      w.u8(op.pos)
      return
    case OpCode.REMOVE_NODE:
      w.u32(op.nodeId)
      return
    case OpCode.MOVE_NODE:
      w.u32(op.nodeId)
      w.u32(op.refNodeId)
      w.u8(op.pos)
      return
    case OpCode.LIST_SET:
      w.u32(op.listId)
      w.u32(op.dataRef)
      return
    case OpCode.LIST_SPLICE:
      w.u32(op.listId)
      w.u32(op.start)
      w.u32(op.delCount)
      w.u16(op.itemKeyRefs.length)
      for (const r of op.itemKeyRefs) w.u32(r)
      return
    case OpCode.LIST_UPDATE:
      w.u32(op.listId)
      w.u32(op.itemKeyRef)
      w.u32(op.slotId)
      w.f32(op.value)
      return
    case OpCode.CALL_COMPONENT_UPDATE:
      w.u32(op.componentId)
      w.u32(op.slotId)
      w.f32(op.value)
      return
    default: {
      const never: never = op
      throw new Error(`未知指令：${JSON.stringify(never)}`)
    }
  }
}

export interface DecodedOps {
  version: number
  ops: UpdateOp[]
  keys: PropKeyTable
  strings: StringPool
}

/** 解码（消费方视角的参考实现；Rust 侧 `ops.rs` 必须与它逐字节等价） */
export function decodeOps(bytes: Uint8Array): DecodedOps {
  const r = new ByteReader(bytes)
  const magic = r.u32()
  if (magic !== OPS_MAGIC) throw new Error(`magic 不符：0x${magic.toString(16)}（期望 0x${OPS_MAGIC.toString(16)}）`)
  const version = r.u32()
  if (version !== OPS_VERSION) throw new Error(`版本不符：${version}（期望 ${OPS_VERSION}）`)
  const opCount = r.u32()
  const keyCount = r.u32()
  const strCount = r.u32()

  const keys = new PropKeyTable()
  for (let i = 0; i < keyCount; i++) keys.intern(r.str())
  const strings = new StringPool()
  for (let i = 0; i < strCount; i++) strings.intern(r.str())

  const ops: UpdateOp[] = []
  for (let i = 0; i < opCount; i++) ops.push(decodeOp(r))
  if (r.remaining !== 0) throw new Error(`指令流尾部有 ${r.remaining} 字节残留（格式或计数不符）`)
  return { version, ops, keys, strings }
}

function decodeOp(r: ByteReader): UpdateOp {
  const op = r.u8()
  switch (op) {
    case OpCode.SET_PROP:
    case OpCode.SET_STYLE:
      return { op, nodeId: r.u32(), keyId: r.u16(), value: r.f32() }
    case OpCode.SET_TEXT:
      return { op, nodeId: r.u32(), textRef: r.u32() }
    case OpCode.SET_ATTRS: {
      const nodeId = r.u32()
      const n = r.u16()
      const attrs: Array<{ keyId: number; value: number }> = []
      for (let i = 0; i < n; i++) attrs.push({ keyId: r.u16(), value: r.f32() })
      return { op, nodeId, attrs }
    }
    case OpCode.TOGGLE_VIS:
      return { op, nodeId: r.u32(), visible: r.u8() !== 0 }
    case OpCode.INSERT_BLOCK:
      return { op, blockId: r.u32(), refNodeId: r.u32(), pos: r.u8() as InsertPos }
    case OpCode.REMOVE_NODE:
      return { op, nodeId: r.u32() }
    case OpCode.MOVE_NODE:
      return { op, nodeId: r.u32(), refNodeId: r.u32(), pos: r.u8() as InsertPos }
    case OpCode.LIST_SET:
      return { op, listId: r.u32(), dataRef: r.u32() }
    case OpCode.LIST_SPLICE: {
      const listId = r.u32()
      const start = r.u32()
      const delCount = r.u32()
      const n = r.u16()
      const itemKeyRefs: number[] = []
      for (let i = 0; i < n; i++) itemKeyRefs.push(r.u32())
      return { op, listId, start, delCount, itemKeyRefs }
    }
    case OpCode.LIST_UPDATE:
      return { op, listId: r.u32(), itemKeyRef: r.u32(), slotId: r.u32(), value: r.f32() }
    case OpCode.CALL_COMPONENT_UPDATE:
      return { op, componentId: r.u32(), slotId: r.u32(), value: r.f32() }
    default:
      throw new Error(`未知操作码：0x${op.toString(16)}（游标位置 ${r.offset}）`)
  }
}

/** 指令流规范化（双端比对的**语义**视图：JSON 可比较、键序无关） */
export function canonicalOps(decoded: DecodedOps): unknown {
  return {
    version: decoded.version,
    keys: decoded.keys.toArray(),
    strings: decoded.strings.toArray(),
    ops: decoded.ops.map((o) => ({ ...o })),
  }
}

// hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts
// ★★★invoke 通道二进制线格式的**鸿蒙（ArkTS）侧唯一实现** —— T-app-fetch · 决策 #903 的第四端
//
// 【它是什么】`PINV`（去程）/ `PRSP`（回程）帧的编解码器。与
//   `packages/api/src/invoke-wire.ts`（TS SSOT）· `hosts/android/.../InvokeWire.java` ·
//   `hosts/ios/ProteusHost/runtime/InvokeWire.swift` **逐字节等价**。
//
// 【★为什么本文件零 import】ArkTS 工程的构建（hvigor/ets-loader）与 pnpm workspace 是两套体系；
//   且对拍门禁（`pnpm check:invoke-wire-parity`）要把**同一份源码**拿来跑。零依赖 ⇒
//   ① 可被 tsx 直接执行（对拍）；② 可被 ArkTS 编译（宿主）。
//   ★UTF-8 也**手写**（不用 util.TextEncoder）：TS 侧对孤立代理编码为 3 字节（WTF-8），
//   而平台编码器会替换成 U+FFFD ⇒ 字节不等价。
//
// 【★诚实边界（对拍覆盖到哪一层）】ArkTS 没有独立 CLI 编译器（编译发生在 hvigor 构建里），
//   故 `check:invoke-wire-parity` 的 ArkTS 轮用 **tsx 跑本文件**验**字节语义**；
//   类型/语法是否被 ArkTS 接受，由 `bash hosts/harmony/build-host-app.sh` 的构建判据兜住
//   （本文件被 `http-capability.ts` → `Superapp.ets` 引用 ⇒ 不参与编译会立刻暴露）。
//
// 【线格式】小端；20B header + 长度前缀变长区 + TLV meta + 裸字节 body。
//   去程：magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//         · method(u16+utf8) · reqId(u16+utf8) · meta(TLV) · body
//   回程：同 header · reqId(u16+utf8) · meta(TLV) · body
//   TLV：tag u8 · len u32 · payload；未知 tag **跳过**（版本演进纪律）。

/** 去程帧 magic = "PINV" */
export const INVOKE_MAGIC: number = 0x564e4950
/** 回程帧 magic = "PRSP" */
export const RESOLVE_MAGIC: number = 0x50535250
/** 线格式版本（与 TS `INVOKE_WIRE_VERSION` 同步） */
export const INVOKE_WIRE_VERSION: number = 1
/** header 字节数 */
export const INVOKE_HEADER_BYTES: number = 20

/** 去程 flags 位 */
export const INVOKE_FLAG_HAS_BODY: number = 1
/** 回程 flags 位 */
export const RESOLVE_FLAG_HAS_BODY: number = 1
export const RESOLVE_FLAG_IS_ERROR: number = 2

/** 去程 TLV tag（1–15 段） */
export const TAG_URL: number = 1
export const TAG_HTTP_METHOD: number = 2
export const TAG_HEADERS: number = 3
export const TAG_PARAMS: number = 4
export const TAG_TIMEOUT_MS: number = 5
export const TAG_RESPONSE_TYPE: number = 6
export const TAG_CONTENT_TYPE: number = 7
/** ★#1118：请求分块回推（1 = 流式；undefined = 整包） */
export const TAG_STREAM: number = 8
/** ★#1119：落盘路径（宿主直写沙箱） */
export const TAG_SAVE_PATH: number = 9
/** ★#1120：流式上传规格（宿主自读文件 + 自拼 multipart） */
export const TAG_UPLOAD_PATH: number = 10
// ★#1134：重定向控制（1 = 宿主不跟随，把 3xx + Location 回给 JS；undefined = 跟随）
export const TAG_REDIRECT: number = 11
// ★#1153：TLS 证书 pinning（string = 换行分隔的 base64 SHA-256 SPKI 指纹）
export const TAG_PINS: number = 12
// ★#1153：pinning 信任语义（1 = 用 pin 替代系统信任；undefined = 叠加）
export const TAG_PIN_ONLY: number = 13

/** 回程 TLV tag（16 起；与去程段不重叠） */
export const RTAG_HTTP_STATUS: number = 16
export const RTAG_REASON: number = 17
export const RTAG_MISSING: number = 18
export const RTAG_PENDING: number = 19
export const RTAG_HEADERS: number = 20
/** ★#1118：流式块序号（有本字段 = 本帧是数据块，不结算） */
export const RTAG_STREAM_SEQ: number = 21

/** 响应体解释方式（与 `RequestConfig.responseType` 同语义） */
export const RESPONSE_TEXT: number = 0
export const RESPONSE_JSON: number = 1
export const RESPONSE_ARRAYBUFFER: number = 2

const EMPTY: Uint8Array = new Uint8Array(0)

/* ────────────────────────── 小端字节游标 ────────────────────────── */

/** 写入游标（自动倍增扩容；`done()` 返回已写段）。 */
class Writer {
  private buf: Uint8Array
  private pos: number = 0

  constructor(size: number) {
    this.buf = new Uint8Array(size < 8 ? 8 : size)
  }

  length(): number {
    return this.pos
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return
    let cap: number = this.buf.length === 0 ? 64 : this.buf.length
    while (cap < this.pos + n) cap *= 2
    const next: Uint8Array = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
  }

  u8(v: number): void {
    this.ensure(1)
    this.buf[this.pos] = v & 0xff
    this.pos++
  }

  u16(v: number): void {
    this.ensure(2)
    this.buf[this.pos] = v & 0xff
    this.buf[this.pos + 1] = (v >>> 8) & 0xff
    this.pos += 2
  }

  u32(v: number): void {
    this.ensure(4)
    this.buf[this.pos] = v & 0xff
    this.buf[this.pos + 1] = (v >>> 8) & 0xff
    this.buf[this.pos + 2] = (v >>> 16) & 0xff
    this.buf[this.pos + 3] = (v >>> 24) & 0xff
    this.pos += 4
  }

  /** u16 长度前缀 + UTF-8（长度按**字节**计）。 */
  str(s: string): void {
    const b: Uint8Array = utf8Encode(s)
    if (b.length > 0xffff) throw new Error(`字符串过长（>65535B）：${b.length}`)
    this.ensure(2 + b.length)
    this.u16(b.length)
    this.buf.set(b, this.pos)
    this.pos += b.length
  }

  /** 裸字节（无前缀）——大载荷走这里。 */
  raw(b: Uint8Array): void {
    if (b.length === 0) return
    this.ensure(b.length)
    this.buf.set(b, this.pos)
    this.pos += b.length
  }

  /** 回填 u32（TLV 长度前缀；payload 只编码一遍）。 */
  patchU32(at: number, v: number): void {
    if (at < 0 || at + 4 > this.pos) throw new Error(`回填越界：@${at}（已写 ${this.pos} 字节）`)
    this.buf[at] = v & 0xff
    this.buf[at + 1] = (v >>> 8) & 0xff
    this.buf[at + 2] = (v >>> 16) & 0xff
    this.buf[at + 3] = (v >>> 24) & 0xff
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}

/** 读取游标（越界即抛，不静默补零）。 */
class Reader {
  private buf: Uint8Array
  private pos: number = 0

  constructor(buf: Uint8Array) {
    this.buf = buf
  }

  remaining(): number {
    return this.buf.length - this.pos
  }

  private need(n: number, what: string): void {
    if (this.remaining() < n) throw new Error(`字节流被截断（${what}）`)
  }

  u8(): number {
    this.need(1, 'u8')
    const v: number = this.buf[this.pos]
    this.pos++
    return v
  }

  u16(): number {
    this.need(2, 'u16')
    const v: number = this.buf[this.pos] | (this.buf[this.pos + 1] << 8)
    this.pos += 2
    return v
  }

  u32(): number {
    this.need(4, 'u32')
    const v: number = (this.buf[this.pos] | (this.buf[this.pos + 1] << 8)
      | (this.buf[this.pos + 2] << 16) | (this.buf[this.pos + 3] << 24)) >>> 0
    this.pos += 4
    return v
  }

  str(): string {
    const len: number = this.u16()
    this.need(len, 'str')
    const s: string = utf8Decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  /** 裸字节**拷贝**（调用方长期持有）。 */
  raw(n: number): Uint8Array {
    this.need(n, 'raw')
    const out: Uint8Array = this.buf.slice(this.pos, this.pos + n)
    this.pos += n
    return out
  }
}

/* ────────────────────────── UTF-8（与 shared/src/binary/wire.ts 逐字节一致） ────────────────────────── */

/** 极小 UTF-8 编码器（代理对按标准编 4 字节；孤立代理按 3 字节原样编——**不替换**）。 */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let cp: number = s.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo: number = s.charCodeAt(i + 1)
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

/** 极小 UTF-8 解码器（**严格**：非法序列抛错，不静默替换——替换会让双端比对假绿）。 */
export function utf8Decode(bytes: Uint8Array): string {
  let out: string = ''
  let i: number = 0
  while (i < bytes.length) {
    const b0: number = bytes[i]
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
      const bn: number = bytes[i + k]
      if ((bn & 0xc0) !== 0x80) throw new Error(`非法 UTF-8 续字节：0x${bn.toString(16)} @${i + k}`)
      cp = (cp << 6) | (bn & 0x3f)
    }
    i += need + 1
    if (cp > 0xffff) {
      const v: number = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      out += String.fromCharCode(cp)
    }
  }
  return out
}

/** ★★★#1120：流式上传规格（与 TS `UploadSpec` 逐一对应）。 */
export class UploadSpec {
  path: string = ''
  fieldName: string = ''
  filename: string = ''
  boundary: string = ''
  /** 普通表单字段（`Map` 保插入序——编码顺序是契约的一部分）。 */
  formData: Map<string, string> | undefined = undefined
}

function writeUploadSpec(w: Writer, u: UploadSpec): void {
  w.str(u.path)
  w.str(u.fieldName)
  w.str(u.filename)
  w.str(u.boundary)
  const fd = u.formData
  const n = fd === undefined ? 0 : fd.size
  w.u16(n)
  if (fd !== undefined) {
    fd.forEach((v: string, k: string) => { w.str(k); w.str(v) })
  }
}

function readUploadSpec(r: Reader): UploadSpec {
  const u: UploadSpec = new UploadSpec()
  u.path = r.str()
  u.fieldName = r.str()
  u.filename = r.str()
  u.boundary = r.str()
  const n = r.u16()
  const fd: Map<string, string> = new Map<string, string>()
  for (let i = 0; i < n; i++) { const k = r.str(); fd.set(k, r.str()) }
  u.formData = fd
  return u
}

/* ────────────────────────── 数据形态 ────────────────────────── */

/** 去程帧（`PINV`）解码结果。`undefined` = **未指定**（对应 TS 的 `=== undefined`）。 */
export class InvokeFrame {
  method: string = ''
  reqId: string = ''
  url: string | undefined = undefined
  httpMethod: string | undefined = undefined
  headers: Map<string, string> | undefined = undefined
  params: Map<string, string> | undefined = undefined
  timeoutMs: number | undefined = undefined
  responseType: number | undefined = undefined
  contentType: string | undefined = undefined
  /** ★#1118：`undefined` = 未指定（不写 TLV）——与 TS 侧 `meta.stream === true` 对齐 */
  stream: boolean | undefined = undefined
  /** ★#1119：非 undefined ⇒ 宿主把响应体直接写进该沙箱路径 */
  savePath: string | undefined = undefined
  /** ★#1134：true ⇒ 不跟随重定向（undefined = 跟随，与老行为一致） */
  redirectManual: boolean | undefined = undefined
  /** ★#1153：非 undefined ⇒ 只信任这些 SPKI 指纹（换行分隔的 base64 SHA-256） */
  tlsPins: string | undefined = undefined
  /** ★#1153：true ⇒ 用 tlsPins 替代系统信任；undefined/false ⇒ 叠加 */
  tlsPinOnly: boolean | undefined = undefined
  /** ★#1120：非 undefined ⇒ 宿主边读文件边拼 multipart 边发 */
  upload: UploadSpec | undefined = undefined
  body: Uint8Array = EMPTY

  /** 取值语义（缺省 = text）。 */
  responseKind(): number {
    return this.responseType !== undefined ? this.responseType : RESPONSE_TEXT
  }

  /** 取值语义（缺省 = 15000ms，与 `RequestConfig` 默认一致）。 */
  timeoutOrDefault(): number {
    return this.timeoutMs !== undefined ? this.timeoutMs : 15000
  }
}

/** 回程帧（`PRSP`）。 */
export class ResolveFrame {
  reqId: string = ''
  ok: boolean = true
  reason: string | undefined = undefined
  missing: boolean | undefined = undefined
  pending: boolean | undefined = undefined
  status: number | undefined = undefined
  headers: Map<string, string> | undefined = undefined
  /** ★#1118：非 undefined ⇒ 本帧是流式数据块（不结算） */
  streamSeq: number | undefined = undefined
  body: Uint8Array = EMPTY

  static okFrame(reqId: string): ResolveFrame {
    const f: ResolveFrame = new ResolveFrame()
    f.reqId = reqId
    return f
  }

  static errFrame(reqId: string, reason: string): ResolveFrame {
    const f: ResolveFrame = new ResolveFrame()
    f.reqId = reqId
    f.ok = false
    f.reason = reason
    return f
  }

  /** "无此方法"（不是失败）：桥按 `missing` 给 `*.unsupported`。 */
  static missingMethod(reqId: string, reason: string): ResolveFrame {
    const f: ResolveFrame = ResolveFrame.errFrame(reqId, reason)
    f.missing = true
    return f
  }

  static pendingFrame(reqId: string): ResolveFrame {
    const f: ResolveFrame = ResolveFrame.okFrame(reqId)
    f.pending = true
    return f
  }
}

/* ────────────────────────── TLV ────────────────────────── */

/** 写一个 TLV 项：`tag u8 + len u32 + payload`（占位回填）。 */
function writeTlv(w: Writer, tag: number, payload: (w2: Writer) => void): void {
  w.u8(tag)
  const lenAt: number = w.length()
  w.u32(0)
  const payloadAt: number = w.length()
  payload(w)
  w.patchU32(lenAt, w.length() - payloadAt)
}

/** 键值对列表：`count u16 + (name str, value str) × count` */
function writeNameValues(w: Writer, nv: Map<string, string>): void {
  if (nv.size > 0xffff) throw new Error(`键值对过多（>65535）：${nv.size}`)
  w.u16(nv.size)
  nv.forEach((v: string, k: string) => {
    w.str(k)
    w.str(v)
  })
}

function readNameValues(r: Reader): Map<string, string> {
  const n: number = r.u16()
  const out: Map<string, string> = new Map<string, string>()
  for (let i = 0; i < n; i++) {
    const k: string = r.str()
    out.set(k, r.str())
  }
  return out
}

/* ────────────────────────── 去程 ────────────────────────── */

function encodeInvokeMeta(f: InvokeFrame): Uint8Array {
  const w: Writer = new Writer(64)
  // ★判据与三端逐字对齐：`!== undefined` 才写 TLV（**不是** `!= 0`）
  if (f.url !== undefined) writeTlv(w, TAG_URL, (x: Writer) => x.str(f.url as string))
  if (f.httpMethod !== undefined) writeTlv(w, TAG_HTTP_METHOD, (x: Writer) => x.str(f.httpMethod as string))
  if (f.headers !== undefined) writeTlv(w, TAG_HEADERS, (x: Writer) => writeNameValues(x, f.headers as Map<string, string>))
  if (f.params !== undefined) writeTlv(w, TAG_PARAMS, (x: Writer) => writeNameValues(x, f.params as Map<string, string>))
  if (f.timeoutMs !== undefined) writeTlv(w, TAG_TIMEOUT_MS, (x: Writer) => x.u32(f.timeoutMs as number))
  if (f.responseType !== undefined) writeTlv(w, TAG_RESPONSE_TYPE, (x: Writer) => x.u8(f.responseType as number))
  if (f.contentType !== undefined) writeTlv(w, TAG_CONTENT_TYPE, (x: Writer) => x.str(f.contentType as string))
  // ★#1118：只在**显式 true** 时写（与 TS `meta.stream === true` 逐字对齐）
  if (f.stream === true) writeTlv(w, TAG_STREAM, (x: Writer) => x.u8(1))
  if (f.savePath !== undefined) writeTlv(w, TAG_SAVE_PATH, (x: Writer) => x.str(f.savePath as string))
  if (f.upload !== undefined) writeTlv(w, TAG_UPLOAD_PATH, (x: Writer) => writeUploadSpec(x, f.upload as UploadSpec))
  // ★#1134：只在**显式 true** 时写（与 TS `meta.redirectManual === true` 逐字对齐）
  if (f.redirectManual === true) writeTlv(w, TAG_REDIRECT, (x: Writer) => x.u8(1))
  // ★#1153：pinning 只在显式要求时写（缺省 = 平台默认信任链）
  if (f.tlsPins !== undefined && f.tlsPins.length > 0) writeTlv(w, TAG_PINS, (x: Writer) => x.str(f.tlsPins as string))
  if (f.tlsPinOnly === true) writeTlv(w, TAG_PIN_ONLY, (x: Writer) => x.u8(1))
  return w.done()
}

/** 编码去程帧（宿主侧一般不用；对拍门禁用）。 */
export function encodeInvoke(f: InvokeFrame): Uint8Array {
  const meta: Uint8Array = encodeInvokeMeta(f)
  const body: Uint8Array = f.body
  const w: Writer = new Writer(64)
  w.u32(INVOKE_MAGIC)
  w.u32(INVOKE_WIRE_VERSION)
  w.u32(body.length > 0 ? INVOKE_FLAG_HAS_BODY : 0)
  w.u32(meta.length)
  w.u32(body.length)
  w.str(f.method)
  w.str(f.reqId)
  w.raw(meta)
  w.raw(body)
  return w.done()
}

function decodeInvokeMeta(bytes: Uint8Array, into: InvokeFrame): void {
  const r: Reader = new Reader(bytes)
  while (r.remaining() > 0) {
    const tag: number = r.u8()
    const len: number = r.u32()
    if (r.remaining() < len) {
      throw new Error(`去程 meta TLV 被截断：tag=${tag} len=${len} 剩余=${r.remaining()}`)
    }
    const p: Reader = new Reader(r.raw(len))
    if (tag === TAG_URL) into.url = p.str()
    else if (tag === TAG_HTTP_METHOD) into.httpMethod = p.str()
    else if (tag === TAG_HEADERS) into.headers = readNameValues(p)
    else if (tag === TAG_PARAMS) into.params = readNameValues(p)
    else if (tag === TAG_TIMEOUT_MS) into.timeoutMs = p.u32()
    else if (tag === TAG_RESPONSE_TYPE) into.responseType = p.u8()
    else if (tag === TAG_CONTENT_TYPE) into.contentType = p.str()
    else if (tag === TAG_STREAM) into.stream = p.u8() !== 0
    else if (tag === TAG_SAVE_PATH) into.savePath = p.str()
    else if (tag === TAG_UPLOAD_PATH) into.upload = readUploadSpec(p)
    else if (tag === TAG_REDIRECT) into.redirectManual = p.u8() !== 0
    else if (tag === TAG_PINS) into.tlsPins = p.str()
    else if (tag === TAG_PIN_ONLY) into.tlsPinOnly = p.u8() !== 0
    // 未知 tag 跳过（版本演进）
  }
}

/** 解码去程帧（宿主主用）。magic/版本不符、尾部残留、截断 ⇒ 抛错。 */
export function decodeInvoke(bytes: Uint8Array): InvokeFrame {
  const r: Reader = new Reader(bytes)
  const magic: number = r.u32()
  if (magic !== INVOKE_MAGIC) {
    throw new Error(`去程帧 magic 不符：0x${magic.toString(16)}（期望 0x${INVOKE_MAGIC.toString(16)}）`)
  }
  const version: number = r.u32()
  if (version !== INVOKE_WIRE_VERSION) {
    throw new Error(`去程帧版本不符：${version}（期望 ${INVOKE_WIRE_VERSION}）`)
  }
  r.u32() // flags（body 长度已由 bodyBytes 给出）
  const metaBytes: number = r.u32()
  const bodyBytes: number = r.u32()
  const f: InvokeFrame = new InvokeFrame()
  f.method = r.str()
  f.reqId = r.str()
  decodeInvokeMeta(r.raw(metaBytes), f)
  f.body = r.raw(bodyBytes)
  if (r.remaining() !== 0) {
    throw new Error(`去程帧尾部有 ${r.remaining()} 字节残留（格式或长度不符）`)
  }
  return f
}

/** **只读方法名**（不做全帧解码，不碰 meta/body——日志路径开销与载荷无关）。 */
export function peekMethod(bytes: Uint8Array): string {
  try {
    const r: Reader = new Reader(bytes)
    if (r.u32() !== INVOKE_MAGIC) return '?'
    r.u32()
    r.u32()
    r.u32()
    r.u32()
    return r.str()
  } catch (e) {
    return '?'
  }
}

/* ────────────────────────── 回程 ────────────────────────── */

function encodeResolveMeta(f: ResolveFrame): Uint8Array {
  const w: Writer = new Writer(64)
  if (f.status !== undefined) writeTlv(w, RTAG_HTTP_STATUS, (x: Writer) => x.u32(f.status as number))
  if (f.reason !== undefined) writeTlv(w, RTAG_REASON, (x: Writer) => x.str(f.reason as string))
  if (f.missing !== undefined) writeTlv(w, RTAG_MISSING, (x: Writer) => x.u8(f.missing === true ? 1 : 0))
  if (f.pending !== undefined) writeTlv(w, RTAG_PENDING, (x: Writer) => x.u8(f.pending === true ? 1 : 0))
  if (f.headers !== undefined) writeTlv(w, RTAG_HEADERS, (x: Writer) => writeNameValues(x, f.headers as Map<string, string>))
  if (f.streamSeq !== undefined) writeTlv(w, RTAG_STREAM_SEQ, (x: Writer) => x.u32(f.streamSeq as number))
  return w.done()
}

/** 编码回程帧（宿主主用）。 */
export function encodeResolve(f: ResolveFrame): Uint8Array {
  const meta: Uint8Array = encodeResolveMeta(f)
  const body: Uint8Array = f.body
  let flags: number = 0
  if (body.length > 0) flags |= RESOLVE_FLAG_HAS_BODY
  if (!f.ok) flags |= RESOLVE_FLAG_IS_ERROR
  const w: Writer = new Writer(64)
  w.u32(RESOLVE_MAGIC)
  w.u32(INVOKE_WIRE_VERSION)
  w.u32(flags)
  w.u32(meta.length)
  w.u32(body.length)
  w.str(f.reqId)
  w.raw(meta)
  w.raw(body)
  return w.done()
}

function decodeResolveMeta(bytes: Uint8Array, into: ResolveFrame): void {
  const r: Reader = new Reader(bytes)
  while (r.remaining() > 0) {
    const tag: number = r.u8()
    const len: number = r.u32()
    if (r.remaining() < len) {
      throw new Error(`回程 meta TLV 被截断：tag=${tag} len=${len} 剩余=${r.remaining()}`)
    }
    const p: Reader = new Reader(r.raw(len))
    if (tag === RTAG_HTTP_STATUS) into.status = p.u32()
    else if (tag === RTAG_REASON) into.reason = p.str()
    else if (tag === RTAG_MISSING) into.missing = p.u8() !== 0
    else if (tag === RTAG_PENDING) into.pending = p.u8() !== 0
    else if (tag === RTAG_HEADERS) into.headers = readNameValues(p)
    else if (tag === RTAG_STREAM_SEQ) into.streamSeq = p.u32()
  }
}

/** 解码回程帧（宿主侧一般不用；对拍门禁与诊断用）。 */
export function decodeResolve(bytes: Uint8Array): ResolveFrame {
  const r: Reader = new Reader(bytes)
  const magic: number = r.u32()
  if (magic !== RESOLVE_MAGIC) {
    throw new Error(`回程帧 magic 不符：0x${magic.toString(16)}（期望 0x${RESOLVE_MAGIC.toString(16)}）`)
  }
  const version: number = r.u32()
  if (version !== INVOKE_WIRE_VERSION) {
    throw new Error(`回程帧版本不符：${version}（期望 ${INVOKE_WIRE_VERSION}）`)
  }
  const flags: number = r.u32()
  const metaBytes: number = r.u32()
  const bodyBytes: number = r.u32()
  const f: ResolveFrame = new ResolveFrame()
  f.reqId = r.str()
  f.ok = (flags & RESOLVE_FLAG_IS_ERROR) === 0
  decodeResolveMeta(r.raw(metaBytes), f)
  f.body = r.raw(bodyBytes)
  if (r.remaining() !== 0) {
    throw new Error(`回程帧尾部有 ${r.remaining()} 字节残留（格式或长度不符）`)
  }
  return f
}

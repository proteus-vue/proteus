// packages/api/src/invoke-wire.ts
// ★★★invoke 通道的**二进制线格式**（TS 侧唯一实现 = SSOT）—— 2026-10-13 · 决策 #903 / S2「去 JSON」
//
// 【为什么有本文件（用户原话：「跨语言数据通道不要用 JSON 字符串，性能损耗太大，走纯二进制方向」）】
//   能力调用（`proteusHost.invoke`）此前是**两处 JSON 文本**：派发 `JSON.stringify({...args,__reqId})`
//   + 回推 `__proteusHostResolve(reqId, json)`。最坏的不是请求参数而是**响应体**（HTML/JSON/文件几 MB）
//   ——每字节经 `number[]`/转义膨胀 3~4× + 两次 UTF-8 + 一次 parse。本文件定义替代它的帧格式。
//
// 【★三层判据分工（不要互相替代）】
//   ① 形态（静态）`check:no-json-wire`：通道**是不是**字节形态；
//   ② 字节（对拍）`check:invoke-wire-parity`：TS ⇄ Java ⇄ Swift 三端编码器**逐字节等价**
//      （本文件是 golden 向量的生成侧——**改这里等于改全端起跑线**，三端必须同步改）；
//   ③ 通路（真跑）`check:ios-invoke-bytes` / 真机判据：桥在真实 JS 引擎上跑得通。
//
// 【线格式（与 `blob.rs`「PLYT」/ `rects_bin.rs`「PRES」/ `slot-runtime/buffer.ts`「PVOP」同族纪律）】
//   · 全**小端**；`magic u32 + version u32` 开头（去程 `PINV` / 回程 `PRSP`），magic 不符即拒；
//   · 定长 header（20B）+ 长度前缀变长区（解码即游标推进，无字符扫描、无 JSON 语法层）；
//   · 大块载荷（请求 / 响应 body）**裸字节垫底**（不 base64、不当字符串）；
//   · 未知 TLV tag **跳过而不报错**（版本演进：老解码头遇新 tag 应忽略，而非崩）。
//
//   去程帧布局：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   method(u16 len + utf8) · reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   回程帧布局（字段更少）：
//     [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
//     [20..)   reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
//   TLV 项：`tag u8 · len u32 · payload`

import { ByteReader, ByteWriter, utf8Decode } from '@proteus-vue/shared'

/** 去程帧 magic = "PINV"（小端字节序 50 49 4E 56） */
export const INVOKE_MAGIC = 0x564e4950
/** 回程帧 magic = "PRSP"（小端字节序 50 52 53 50） */
export const RESOLVE_MAGIC = 0x50535250
/** 线格式版本（★字段增删 / 语义变更 ⇒ +1；三端 TxD 必须同步） */
export const INVOKE_WIRE_VERSION = 1
/** header 字节数（magic + version + flags + metaBytes + bodyBytes） */
export const INVOKE_HEADER_BYTES = 20
/** 回程 header 字节数（字段数同去程） */
export const RESOLVE_HEADER_BYTES = 20

/** 去程 flags 位 */
export const INVOKE_FLAG_HAS_BODY = 1 << 0
/** 回程 flags 位 */
export const RESOLVE_FLAG_HAS_BODY = 1 << 0
/** 回程 flags 位：`ok === false`（对应既有 `{"ok":false}`） */
export const RESOLVE_FLAG_IS_ERROR = 1 << 1

/** 去程 meta 的 TLV tag（★1–15 段留给去程） */
export const MetaTagInvoke = {
  Url: 1,
  HttpMethod: 2,
  Headers: 3,
  Params: 4,
  TimeoutMs: 5,
  ResponseType: 6,
  /**
   * 请求体 MIME 类型（如 `application/json`）。
   * 【为什么需要】body 是**裸字节**，宿主不理解其语义 —— 对结构化参数（`window.setSize` 的
   * `{width,height}`）上层仍编成 JSON 字节（小数据用 JSON 最经济），由本字段告诉宿主"这批字节是 JSON"。
   * 缺省（无 tag）⇒ 宿主按**不透明字节**透传（网络类请求的原始 body 即为这种）。
   */
  ContentType: 7,
  /**
   * ★★★#1118 流式请求（uint8：1 = 请求**分块回推**，0/缺省 = 一问一答整包）。
   * 【为什么需要这个 tag 而不是靠"回程是不是 pending"猜】
   *   不声明流式的请求，宿主必须把整包放进**单个**回程帧（受 32 MiB 上限约束）；
   *   声明了流式，宿主改为**逐块回推**（每帧一个 `StreamSeq`），最后一帧才结算。
   *   ⇒ 宿主的行为差异必须由**请求**决定，不能由宿主自己猜（否则同一份代码在两端语义不同）。
   */
  Stream: 8,
  /**
   * ★★★#1119 落盘路径（string）：让**宿主自己**把响应体写进沙箱文件。
   *
   * 【为什么需要（这是 download 到 S3 的关键）】
   *   没有本 tag 时，download 的链路是「宿主收到整包 → 回推给 JS → JS 再调 `fs.writeBytes` 写盘」
   *   ⇒ **文件多大，JS 堆就吃多大**（超级应用的视频/安装包会直接 OOM）。
   *   有本 tag，宿主边收边写盘，**JS 侧完全不碰字节**——内存与文件大小解耦。
   *
   * 【与 `Stream` 的关系】两者可同时用（宿主边收边写 + 顺带回推块做进度），也可只用本 tag。
   *   只用本 tag 时宿主**不需要**回推 body（JS 只要 path/size/status）。
   *
   * 【安全】路径语义与 `fs.writeBytes` **完全一致**（沙箱相对路径、拒绝绝对路径与 `..`）——
   *   复用同一套 `resolve()` 校验，不在这里另写一份（两套校验 = 迟早分叉）。
   */
  SavePath: 9,
  /**
   * ★★★#1120 **流式上传**（结构体）：让宿主**边读沙箱文件边拼 multipart 边发**，
   * JS 侧完全不碰文件字节。
   *
   * 【payload 布局（TLV 内部再套一层定长前缀 + 变长字段）】
   *   `str path` · `str fieldName` · `str filename` · `str boundary`
   *   · `u16 fieldCount` + (`str name` · `str value`) × fieldCount
   *
   * 【为什么是一个 tag 装结构体，而不是 5 个独立 tag】
   *   ★这 5 个字段**必须同时出现才有意义**（缺任一都无法拼出合法的 multipart）⇒
   *     拆成独立 tag 会制造"只给了一半"的非法中间态，宿主还得各自校验组合完整性。
   *   同理 `NameValues` 的编码在同一文件里已有实现，复用它省掉一套新编解码。
   *
   * 【为什么 boundary / fieldName / filename 由 **JS** 决定而不是宿主】
   *   ① boundary 必须写进 `Content-Type` 头，而头是 JS 组好传下来的 ⇒ 两边各生成一次必然不一致；
   *   ② 字段名/文件名是业务语义（wx 的 `name` / `filePath` 末段），宿主不该猜。
   *
   * 【与 `SavePath`（#1119）对称】一个是"宿主直写响应体"，一个是"宿主直读请求体"——同一思路的两面。
   */
  UploadPath: 10,
} as const



/** 回程 meta 的 TLV tag（★16 起留给回程，两段不重叠 ⇒ 同一 tag 号在两侧含义稳定） */
export const MetaTagResolve = {
  HttpStatus: 16,
  Reason: 17,
  Missing: 18,
  Pending: 19,
  Headers: 20,
  /**
   * ★★★#1118 流式块序号（uint32，从 0 递增）。
   * 【语义】**带本 tag 的回程帧 = 数据块**（body 是该块字节；`pending` 同时为 true ⇒ 不结算）。
   *   不带本 tag 且 `pending !== true` 的帧 = **最终帧**（status/headers/错误在此）。
   * 【为什么用显式 tag 而不是"有 body 就是块"】空块（心跳）/空响应的区分会含糊；
   *   且序号让消费方能**检测丢帧**（seq 跳跃 ⇒ 宿主队列丢了数据，必须报错而不是静默拼接）。
   */
  StreamSeq: 21,
} as const

/** 响应体解释方式（与 `RequestConfig.responseType` 同语义） */
export type ResponseKind = 'text' | 'json' | 'arraybuffer'

/* ── responseType 的线格式 id（跨语言枚举必须定死数值，不能传字符串名） ── */
const RESPONSE_KIND_ID: Record<ResponseKind, number> = { text: 0, json: 1, arraybuffer: 2 }
const RESPONSE_KIND_NAME: readonly ResponseKind[] = ['text', 'json', 'arraybuffer']

const EMPTY = new Uint8Array(0)

/** ★★★#1120：流式上传规格（宿主据此自己读文件 + 拼 multipart）。 */
export interface UploadSpec {
  /** 沙箱相对路径（与 `fs.readBytes` 同一套校验：拒绝绝对路径与 `..`） */
  path: string
  /** multipart 字段名（如 `file`） */
  fieldName: string
  /** 上传文件名（进 `Content-Disposition` 的 filename） */
  filename: string
  /** multipart 边界串——**必须与 `Content-Type` 头里的一致**（由 JS 生成一次、两边共用） */
  boundary: string
  /** 普通表单字段（按插入序编码，与既有 `buildMultipart` 一致） */
  formData?: Record<string, string>
}

/** 编码 `UploadSpec`：`path` · `fieldName` · `filename` · `boundary` · `count` + (name,value)×n */
function writeUploadSpec(w: ByteWriter, u: UploadSpec): void {
  w.str(u.path)
  w.str(u.fieldName)
  w.str(u.filename)
  w.str(u.boundary)
  const entries = Object.entries(u.formData ?? {})
  if (entries.length > 65535) throw new Error(`表单字段过多（>65535）：${entries.length}`)
  w.u16(entries.length)
  for (const [k, v] of entries) { w.str(k); w.str(v) }
}

function readUploadSpec(r: ByteReader): UploadSpec {
  const path = r.str()
  const fieldName = r.str()
  const filename = r.str()
  const boundary = r.str()
  const n = r.u16()
  const formData: Record<string, string> = {}
  for (let i = 0; i < n; i++) { const k = r.str(); formData[k] = r.str() }
  return { path, fieldName, filename, boundary, formData }
}

/** 去程元数据（业务无关的"请求元数据"——宿主只执行，不解释业务） */
export interface InvokeMeta {
  url?: string
  /** HTTP 方法（大写，如 `GET`） */
  method?: string
  headers?: Record<string, string>
  /** query 参数（**键值对原样传**，由宿主用平台 API 拼接编码——宿主持有 `URLComponents`/`Uri.Builder` 等） */
  params?: Record<string, string>
  timeoutMs?: number
  responseType?: ResponseKind
  /** 请求体 MIME（见 `MetaTagInvoke.ContentType`；缺省 = 不透明字节） */
  contentType?: string
  /**
   * ★★★#1119：让宿主把响应体直接写进沙箱文件（见 `MetaTagInvoke.SavePath`）。
   * 给出本字段 ⇒ 回程的 `data` 是**落盘路径**，不再有 body 字节。
   */
  savePath?: string
  /**
   * ★★★#1120：**流式上传**（见 `MetaTagInvoke.UploadPath`）。
   * 给出本字段 ⇒ 宿主自己从沙箱读文件、拼 multipart、边读边发；JS 完全不碰字节。
   */
  upload?: UploadSpec
  /** ★#1118：要求宿主分块回推（见 `MetaTagInvoke.Stream`）；缺省 = 整包 */
  stream?: boolean
}

export interface InvokeFrame {
  /** 原生方法名（如 `http.request`） */
  method: string
  reqId: string
  meta: InvokeMeta
  /** 请求体（裸字节；无 body ⇒ 省略） */
  body?: Uint8Array
}

export interface ResolveFrame {
  reqId: string
  ok: boolean
  /** 回程错误信息（`ok === false` 时） */
  reason?: string
  /** ★保留既有语义：壳未实现该方法（桥据此给 `*.unsupported`） */
  missing?: boolean
  /** ★保留既有语义：壳已受理、结果稍后回推 */
  pending?: boolean
  /** HTTP 状态码（网络类回程） */
  status?: number
  /** 响应头 */
  headers?: Record<string, string>
  /** 响应体（裸字节） */
  body?: Uint8Array
  /**
   * ★#1118：流式块序号。**有本字段 = 本帧是数据块**（不结算，交消费方的 onChunk）；
   * 无本字段且 `pending !== true` = 最终帧（结算）。
   */
  streamSeq?: number
}

/* ────────────────────────── TLV 原语 ────────────────────────── */

/** 写一个 TLV 项：`tag u8 + len u32 + payload`（len 由**占位回填**得到，payload 只编码一遍）。 */
function writeTlv(w: ByteWriter, tag: number, writePayload: () => void): void {
  w.u8(tag)
  const lenAt = w.length
  w.u32(0) // 占位
  const payloadAt = w.length
  writePayload()
  w.patchU32(lenAt, w.length - payloadAt)
}

/** 键值对列表：`count u16 + (name str, value str) × count` */
function writeNameValues(w: ByteWriter, nv: Record<string, string>): void {
  const entries = Object.entries(nv)
  if (entries.length > 65535) throw new Error(`键值对过多（>65535）：${entries.length}`)
  w.u16(entries.length)
  for (const [k, v] of entries) {
    w.str(k)
    w.str(v)
  }
}

function readNameValues(r: ByteReader): Record<string, string> {
  const n = r.u16()
  const out: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    const k = r.str()
    out[k] = r.str()
  }
  return out
}

/* ────────────────────────── 去程（JS → 原生） ────────────────────────── */

function encodeInvokeMeta(meta: InvokeMeta): Uint8Array {
  const w = new ByteWriter(64, false)
  // ★判据必须与三端逐字对齐：`!== undefined` 才写 TLV（Java 侧对应 `!= null`，**不是** `!= 0`）
  const url = meta.url
  if (url !== undefined) writeTlv(w, MetaTagInvoke.Url, () => w.str(url))
  const method = meta.method
  if (method !== undefined) writeTlv(w, MetaTagInvoke.HttpMethod, () => w.str(method))
  const headers = meta.headers
  if (headers !== undefined) writeTlv(w, MetaTagInvoke.Headers, () => writeNameValues(w, headers))
  const params = meta.params
  if (params !== undefined) writeTlv(w, MetaTagInvoke.Params, () => writeNameValues(w, params))
  const timeoutMs = meta.timeoutMs
  if (timeoutMs !== undefined) writeTlv(w, MetaTagInvoke.TimeoutMs, () => w.u32(timeoutMs))
  const responseType = meta.responseType
  if (responseType !== undefined) writeTlv(w, MetaTagInvoke.ResponseType, () => w.u8(RESPONSE_KIND_ID[responseType]))
  const contentType = meta.contentType
  if (contentType !== undefined) writeTlv(w, MetaTagInvoke.ContentType, () => w.str(contentType))
  // ★#1118：只在**显式要求**时写（`false` 与缺省同为"整包"，不写 tag ⇒ 老宿主行为不变）
  if (meta.stream === true) writeTlv(w, MetaTagInvoke.Stream, () => w.u8(1))
  const savePath = meta.savePath
  if (savePath !== undefined) writeTlv(w, MetaTagInvoke.SavePath, () => w.str(savePath))
  const up = meta.upload
  if (up !== undefined) writeTlv(w, MetaTagInvoke.UploadPath, () => writeUploadSpec(w, up))
  return w.done()
}

/**
 * 编码去程帧（JS → 原生）。
 *
 * 布局：
 *   [0..20)  magic u32 · version u32 · flags u32 · metaBytes u32 · bodyBytes u32
 *   [20..)   method(u16 len + utf8) · reqId(u16 len + utf8) · meta(TLV) · body(裸字节)
 */
export function encodeInvokeFrame(frame: InvokeFrame): Uint8Array {
  const meta = encodeInvokeMeta(frame.meta)
  const body = frame.body ?? EMPTY
  const w = new ByteWriter(64, false)
  w.u32(INVOKE_MAGIC)
  w.u32(INVOKE_WIRE_VERSION)
  w.u32(body.length > 0 ? INVOKE_FLAG_HAS_BODY : 0)
  w.u32(meta.length)
  w.u32(body.length)
  w.str(frame.method)
  w.str(frame.reqId)
  w.raw(meta)
  w.raw(body)
  return w.done()
}

function decodeInvokeMeta(bytes: Uint8Array, into: InvokeMeta): void {
  const r = new ByteReader(bytes)
  while (r.remaining > 0) {
    const tag = r.u8()
    const len = r.u32()
    if (r.remaining < len) throw new Error(`去程 meta TLV 被截断：tag=${tag} len=${len} 剩余=${r.remaining}`)
    const p = new ByteReader(r.raw(len))
    switch (tag) {
      case MetaTagInvoke.Url:
        into.url = p.str()
        break
      case MetaTagInvoke.HttpMethod:
        into.method = p.str()
        break
      case MetaTagInvoke.Headers:
        into.headers = readNameValues(p)
        break
      case MetaTagInvoke.Params:
        into.params = readNameValues(p)
        break
      case MetaTagInvoke.TimeoutMs:
        into.timeoutMs = p.u32()
        break
      case MetaTagInvoke.ResponseType:
        into.responseType = RESPONSE_KIND_NAME[p.u8()]
        break
      case MetaTagInvoke.ContentType:
        into.contentType = p.str()
        break
      case MetaTagInvoke.Stream:
        into.stream = p.u8() !== 0
        break
      case MetaTagInvoke.SavePath:
        into.savePath = p.str()
        break
      case MetaTagInvoke.UploadPath:
        into.upload = readUploadSpec(p)
        break
      // ★未知 tag 跳过（版本演进：老解码头遇到新 tag 应忽略，而非报错）
      default:
        break
    }
  }
}

/** 解码去程帧（宿主侧参考实现；三端原生解码器必须与它逐字节等价） */
export function decodeInvokeFrame(bytes: Uint8Array): InvokeFrame {
  const r = new ByteReader(bytes)
  const magic = r.u32()
  if (magic !== INVOKE_MAGIC) {
    throw new Error(`去程帧 magic 不符：0x${magic.toString(16)}（期望 0x${INVOKE_MAGIC.toString(16)}）`)
  }
  const version = r.u32()
  if (version !== INVOKE_WIRE_VERSION) {
    throw new Error(`去程帧版本不符：${version}（期望 ${INVOKE_WIRE_VERSION}）`)
  }
  r.u32() // flags（当前仅 HAS_BODY；body 长度已由 bodyBytes 给出 ⇒ 解码无需它）
  const metaBytes = r.u32()
  const bodyBytes = r.u32()
  const method = r.str()
  const reqId = r.str()
  const meta: InvokeMeta = {}
  decodeInvokeMeta(r.raw(metaBytes), meta)
  const body = r.raw(bodyBytes)
  if (r.remaining !== 0) {
    throw new Error(`去程帧尾部有 ${r.remaining} 字节残留（格式或长度不符）`)
  }
  return { method, reqId, meta, body }
}

/* ────────────────────────── 回程（原生 → JS） ────────────────────────── */

function encodeResolveMeta(f: ResolveFrame): Uint8Array {
  const w = new ByteWriter(64, false)
  const status = f.status
  if (status !== undefined) writeTlv(w, MetaTagResolve.HttpStatus, () => w.u32(status))
  const reason = f.reason
  if (reason !== undefined) writeTlv(w, MetaTagResolve.Reason, () => w.str(reason))
  const missing = f.missing
  if (missing !== undefined) writeTlv(w, MetaTagResolve.Missing, () => w.u8(missing ? 1 : 0))
  const pending = f.pending
  if (pending !== undefined) writeTlv(w, MetaTagResolve.Pending, () => w.u8(pending ? 1 : 0))
  const headers = f.headers
  if (headers !== undefined) writeTlv(w, MetaTagResolve.Headers, () => writeNameValues(w, headers))
  const streamSeq = f.streamSeq
  if (streamSeq !== undefined) writeTlv(w, MetaTagResolve.StreamSeq, () => w.u32(streamSeq))
  return w.done()
}

/**
 * 编码回程帧（原生 → JS）。
 * ★三端宿主各需一份等价实现（Java / Swift / ArkTS）——**编的是同一份字节**。
 */
export function encodeResolveFrame(f: ResolveFrame): Uint8Array {
  const meta = encodeResolveMeta(f)
  const body = f.body ?? EMPTY
  let flags = 0
  if (body.length > 0) flags |= RESOLVE_FLAG_HAS_BODY
  if (!f.ok) flags |= RESOLVE_FLAG_IS_ERROR
  const w = new ByteWriter(64, false)
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
  const r = new ByteReader(bytes)
  while (r.remaining > 0) {
    const tag = r.u8()
    const len = r.u32()
    if (r.remaining < len) throw new Error(`回程 meta TLV 被截断：tag=${tag} len=${len} 剩余=${r.remaining}`)
    const p = new ByteReader(r.raw(len))
    switch (tag) {
      case MetaTagResolve.HttpStatus:
        into.status = p.u32()
        break
      case MetaTagResolve.Reason:
        into.reason = p.str()
        break
      case MetaTagResolve.Missing:
        into.missing = p.u8() !== 0
        break
      case MetaTagResolve.Pending:
        into.pending = p.u8() !== 0
        break
      case MetaTagResolve.Headers:
        into.headers = readNameValues(p)
        break
      case MetaTagResolve.StreamSeq:
        into.streamSeq = p.u32()
        break
      default:
        break
    }
  }
}

/** 解码回程帧（JS 侧——壳回推后由桥消费） */
export function decodeResolveFrame(bytes: Uint8Array): ResolveFrame {
  const r = new ByteReader(bytes)
  const magic = r.u32()
  if (magic !== RESOLVE_MAGIC) {
    throw new Error(`回程帧 magic 不符：0x${magic.toString(16)}（期望 0x${RESOLVE_MAGIC.toString(16)}）`)
  }
  const version = r.u32()
  if (version !== INVOKE_WIRE_VERSION) {
    throw new Error(`回程帧版本不符：${version}（期望 ${INVOKE_WIRE_VERSION}）`)
  }
  const flags = r.u32()
  const metaBytes = r.u32()
  const bodyBytes = r.u32()
  const reqId = r.str()
  const out: ResolveFrame = { reqId, ok: (flags & RESOLVE_FLAG_IS_ERROR) === 0 }
  decodeResolveMeta(r.raw(metaBytes), out)
  out.body = r.raw(bodyBytes)
  if (r.remaining !== 0) {
    throw new Error(`回程帧尾部有 ${r.remaining} 字节残留（格式或长度不符）`)
  }
  return out
}

/**
 * 按 `responseType` 解释响应体（**唯一实现**——调用方不要各自 `JSON.parse`）。
 * ★空 body：`json` 返 `null`（对齐既有"空响应体不是错误"的处理），`text` 返 `''`。
 */
export function interpretBody(body: Uint8Array, kind: ResponseKind): unknown {
  if (kind === 'arraybuffer') return body
  const text = utf8Decode(body)
  if (kind === 'json') return text.length === 0 ? null : JSON.parse(text)
  return text
}

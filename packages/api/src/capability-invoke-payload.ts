// packages/api/src/capability-invoke-payload.ts
// ★★★#1344 B-3：**能力调用的"去程载荷"编码**（`args` → 线格式 meta + 裸字节 body）。
//   （从 `capability-invoke.ts` 抽出——那个文件被 `check:file-size` 的 1000 行上限顶着）
//
// 【为什么这块单独成文件】
//   它是**纯函数**（无状态、无宿主交互），与 `capability-invoke.ts` 里那些待决表/取消通道/
//   回推结算完全不同职责。抽出来之后，改"哪个字段该折进 meta"不必再翻一个 1000 行文件。
//
// 【★★★这块最容易出的缺陷（本仓踩过三次，都在这里）】
//   归类表漏一个字段 ⇒ 该字段**落进 body** 被 JSON 编进请求体：
//     · `upload`（#1120）—— 整个上传规格被编进 body；
//     · `redirectManual`（#1134）—— 布尔值被编进 body，宿主照旧跟随重定向；
//     · `httpDns`（#1169）—— 整张 DNS 表被编进 body。
//   三者形状一致：**帧里"有"这个字段（在 body 里），宿主读的是 meta ⇒ 静默失效**。
//   ⇒ 判据在 `tests/fetch-wire-fields.test.ts`：它拿 `FetchConfig` 的线上字段逐项对这四张表，
//     新增字段忘了归类 ⇒ 当场红。
import type { InvokeMeta, ResponseKind } from './invoke-wire'
import { utf8Encode } from '@proteus-vue/shared'

const EMPTY_BYTES = new Uint8Array(0)

/** 去程 meta 归类表：纯字符串字段（★`tlsPins` #1153 也在此：它落到 tag 12 而非 body） */
const META_STR = ['url', 'contentType', 'savePath', 'tlsPins']
/** 去程 meta 归类表：值是键值对的字段 */
const META_HEADERS = ['headers', 'params']
/** 去程 meta 归类表：枚举校验器（形态合法才折入 meta，否则按业务体处理） */
const META_ENUM: Record<string, (v: unknown) => boolean> = {
  responseType: (v) => v === 'text' || v === 'json' || v === 'arraybuffer',
}

const JSON_CONTENT_TYPE = 'application/json'

/**
 * 把能力方法的 `args` 拆成「线格式 meta + 裸字节 body」。
 * ★归类规则与 `AppRequestConfig` 字段同名（url/method/headers/params/timeoutMs|timeout/responseType/
 *   contentType）；未识别字段归入 body（按 JSON 编——小数据用 JSON 最经济，宿主按 `contentType` 理解）。
 */
export function splitFramePayload(args: unknown): { meta: InvokeMeta; body: Uint8Array } {
  if (args === null || args === undefined) return { meta: {}, body: EMPTY_BYTES }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { meta: { contentType: 'application/json' }, body: utf8Encode(JSON.stringify(args)) }
  }
  const src = args as Record<string, unknown>
  const meta: InvokeMeta = {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue
    if (META_STR.includes(k) && typeof v === 'string') {
      // ★逐分支显式赋值（不能写兜底 `else meta.contentType = v`：新增 META_STR 成员会被静默当 contentType）
      if (k === 'url') meta.url = v
      else if (k === 'savePath') meta.savePath = v
      else if (k === 'tlsPins') meta.tlsPins = v
      else meta.contentType = v
    } else if (META_HEADERS.includes(k) && v !== null && typeof v === 'object') {
      const nv: Record<string, string> = {}
      for (const [hk, hv] of Object.entries(v as Record<string, unknown>)) nv[hk] = String(hv)
      if (k === 'headers') meta.headers = nv
      else meta.params = nv
    } else if (k === 'method' && typeof v === 'string') {
      // ★线格式归一大写（宿主按 HTTP 语义消费；`get` 与 `GET` 是同一方法）
      meta.method = v.toUpperCase()
    } else if (k === 'timeoutMs' && typeof v === 'number') {
      meta.timeoutMs = v
    } else if (k === 'timeout' && typeof v === 'number') {
      // `RequestConfig.timeout` 别名 ⇒ 线格式 `timeoutMs`（与 `AppRequestConfig` 对齐）
      meta.timeoutMs = v
    } else if (META_ENUM[k]?.(v)) {
      if (k === 'responseType') meta.responseType = v as ResponseKind
    } else if (k === 'upload' && v !== null && typeof v === 'object') {
      // ★#1120：流式上传规格——**不能落到 body**（否则整个结构会被 JSON 编进请求体）
      meta.upload = v as InvokeMeta['upload']
    } else if (k === 'redirectManual' && typeof v === 'boolean') {
      // ★#1134：重定向不跟随开关（宿主侧最小能力；跟随/拦截策略在 JS 管线）
      //   ★必须在此归类：落到 body 会被 JSON 编进请求体（与 upload 同一个坑）
      meta.redirectManual = v
    } else if (k === 'tlsPinOnly' && typeof v === 'boolean') {
      meta.tlsPinOnly = v
    } else if (k === 'httpDns' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // ★★★#1169：HTTPDNS 映射表（name-values）——**不能落到 body**（否则整张表会被 JSON 编进请求体）
      //   ★值已是逗号分隔串（`runFetch` 归一）；这里只做形态收敛，不改写语义。
      const nv: Record<string, string> = {}
      for (const [host, ips] of Object.entries(v as Record<string, unknown>)) {
        const s = Array.isArray(ips) ? ips.join(',') : String(ips ?? '')
        if (host && s) nv[host] = s
      }
      if (Object.keys(nv).length > 0) meta.httpDns = nv
    } else if (k === 'data' || k === 'body') {
      rest[k] = v
    } else {
      rest[k] = v
    }
  }
  const body = encodeBody(src.data !== undefined ? src.data : src.body, meta)
  return { meta, body }
}

/** body 编码：字符串 ⇒ utf8；字节/视图 ⇒ 原样；其它对象 ⇒ JSON 字节（并标注 contentType）。 */
function encodeBody(data: unknown, meta: InvokeMeta): Uint8Array {
  if (data === undefined || data === null) return EMPTY_BYTES
  if (typeof data === 'string') {
    if (meta.contentType === undefined) meta.contentType = 'text/plain'
    return utf8Encode(data)
  }
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (meta.contentType === undefined) meta.contentType = 'application/json'
  return utf8Encode(JSON.stringify(data))
}

/**
 * 通用能力的去程载荷：`args` 编成 **JSON 字节**（`contentType: application/json`）。
 * ★为什么不给每种能力定义 TLV：#903 已登记的诚实边界——结构化小对象用 JSON 字节最经济；
 *   真·大载荷（文件/媒体）应在该能力自己的通道里走裸字节，不要把 JSON 当传输层。
 */
export function genericFramePayload(args: unknown): { meta: InvokeMeta; body: Uint8Array } {
  if (args === undefined || args === null) return { meta: { contentType: JSON_CONTENT_TYPE }, body: EMPTY_BYTES }
  if (args instanceof Uint8Array) return { meta: {}, body: args }
  if (args instanceof ArrayBuffer) return { meta: {}, body: new Uint8Array(args) }
  if (ArrayBuffer.isView(args)) {
    return { meta: {}, body: new Uint8Array(args.buffer, args.byteOffset, args.byteLength) }
  }
  return { meta: { contentType: JSON_CONTENT_TYPE }, body: utf8Encode(JSON.stringify(args)) }
}

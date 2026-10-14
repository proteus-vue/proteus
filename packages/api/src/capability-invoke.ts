// packages/api/src/capability-invoke.ts
// ★★invoke **通道层**（零 import 的业务无关实现；2026-10-13 · 决策 #903 / S2「去 JSON」）
//
// 【为什么单列一个文件】本层最初内联在 `capability-app.ts`（2100 行），但它是**协议层**：
//   ① 两条腿（JSON / 二进制帧）的择优降级；② 异步回推的两个入口（`__proteusHostResolve` +
//   `__proteusHostResolveBytes`）；③ 帧编解码只经 `./invoke-wire`（SSOT）。把它提起，是为了
//   `capability-app.ts` 只关心**能力语义**（哪些方法、返回什么形状），协议细节单点可查。
//
// 【★两条通道（真机实测补上第二条）】App 壳可以从两处暴露原生调用：
//   ① `globalThis.__proteusHostInvoke(method, argsJson)` —— 通用通道（简单宿主/测试可自行注册）；
//   ② **`proteusHost.invoke(method, argsJson)`** —— **JNI 条件注入的主通道**
//      （`quickjs_jni.c` 的 `js_host_invoke`：宿主 Java 侧实现 `invoke(String,String):String` 即自动注入）。
//   ★初版只查 ① ⇒ 真实 Java 宿主（提供 ②）**够不着**——真机实测抓出（删掉 JS 桩后立即暴露）。
//   二进制腿同理有 ① `__proteusHostInvokeBytes`（JSC C-API 注入族）/ ② `proteusHost.invokeBytes`。
//
// 【★异步回推（G-39 §2.1 `invokeNative(name, args): Promise` 的落地面）】
//   · JSON 腿：派发带 `__reqId` → 壳回 `{pending:true}` → 壳完成后调 `__proteusHostResolve(reqId, json)`；
//   · 二进制腿：派发 `PINV` 帧（reqId 编在帧内）→ 壳回 `PRSP` 受理帧/最终帧，或稍后调
//     `__proteusHostResolveBytes(frame)` 回推。
//   ★两条腿共用一张 pending 表 ⇒ 超时/结算/泄漏语义只有一份。
//
// 【诚实边界】① 字节腿只覆盖 capability invoke（superapp 运行期）；整树 mount 的 blob、vapor 的
//   `sendOps` 是各自通道（不混用本文件）。② JSON 腿保留（老壳零回归，降级**不静默**——
//   `lastInvokeWire()` 可查实际走的线格式）。③ 鸿蒙 ArkTS 编解码器未做（#903/#904 已登记）。

import { utf8Encode } from '@proteus-vue/shared'
import {
  decodeResolveFrame,
  encodeInvokeFrame,
  interpretBody,
  type InvokeMeta,
  type ResponseKind,
  type ResolveFrame,
} from './invoke-wire'

/** 壳注册的原生调用入口的全局键（壳侧：`globalThis.__proteusHostInvoke = (name, argsJson) => json`） */
export const HOST_INVOKE_KEY = '__proteusHostInvoke'

/** 壳注册的原生调用签名（同步：返回 JSON 串；抛错 = 原生调用失败） */
export type HostInvokeFn = (method: string, argsJson: string) => string

/** 取壳注册的原生调用入口（未注册 ⇒ null） */
export function getHostInvoke(): HostInvokeFn | null {
  const g = globalThis as Record<string, unknown>
  const f = g[HOST_INVOKE_KEY]
  return typeof f === 'function' ? (f as HostInvokeFn) : null
}

/**
 * 调原生（**同步**——与 G-39 的 JNI trampoline 同契约：壳内同步完成）。
 *
 * @returns `{ ok: true, data }` 或 `{ ok: false, reason }`
 * ★未注册（壳没提供该方法）与调用失败**分得开**：
 *   前者 = 该端无此能力（框架据此给 `*.unsupported`）；后者 = 有 API 但调用出错（`*.failed`）。
 */
export function invokeHost(
  method: string,
  args?: unknown,
): { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } {
  const f = getHostInvoke()
  // ② JNI 注入通道：`proteusHost.invoke`（真机 Android/iOS 壳的主路径）
  const ph = (globalThis as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
  if (!f && typeof ph?.invoke !== 'function') {
    return { ok: false, reason: `壳未注册 ${HOST_INVOKE_KEY} 且无 proteusHost.invoke（App 端原生通道）`, missing: true }
  }
  try {
    const out = f ? f(method, JSON.stringify(args ?? null)) : ph!.invoke!(method, JSON.stringify(args ?? null))
    const parsed = JSON.parse(out) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
    if (parsed && parsed.ok === false) {
      return { ok: false, reason: String(parsed.reason ?? '原生调用失败'), missing: !!parsed.missing }
    }
    return { ok: true, data: parsed?.data ?? parsed }
  } catch (e) {
    // 抛错 = 壳未实现该方法（壳侧 `throw new Error('unsupported: …')`）或真失败——
    // 消息里带 'unsupported'/'missing' 视为"无此能力"（诚实降级），否则算失败
    const msg = e instanceof Error ? e.message : String(e)
    const missing = /unsupported|missing|not implemented|no such/i.test(msg)
    return { ok: false, reason: msg, missing }
  }
}

/** App 端能力位是否可用（壳注册了通道 + 该方法可用——供生成器/文档的端支持分档） */
export function appNativeAvailable(method: string): boolean {
  const r = invokeHost(method, { probe: true })
  return r.ok || !r.missing
}

/* ══════════════════ 二进制腿（`PINV`/`PRSP` 帧——#903 的主通路） ══════════════════ */

/** 壳注册的**二进制**原生调用入口的全局键（通用通道/测试可自行注册） */
export const HOST_INVOKE_BYTES_KEY = '__proteusHostInvokeBytes'
/** 壳**异步结果回推**的二进制入口的全局键（壳完成后按此名调用） */
export const HOST_RESOLVE_BYTES_KEY = '__proteusHostResolveBytes'

/** 二进制原生调用签名（入参/出参都是 `PINV`/`PRSP` 帧；抛错 = 未实现或失败） */
export type HostInvokeBytesFn = (frame: Uint8Array) => Uint8Array

/** 取壳注册的二进制原生入口（未注册 ⇒ null） */
export function getHostInvokeBytes(): HostInvokeBytesFn | null {
  const g = globalThis as Record<string, unknown>
  const f = g[HOST_INVOKE_BYTES_KEY]
  if (typeof f === 'function') return f as HostInvokeBytesFn
  const ph = (globalThis as { proteusHost?: { invokeBytes?: (frame: Uint8Array) => Uint8Array } }).proteusHost
  if (typeof ph?.invokeBytes === 'function') return ph.invokeBytes.bind(ph)
  return null
}

/** 本端二进制通道是否就绪（供生成器/文档分档与诊断——**不谎报**） */
export function appNativeBytesAvailable(): boolean {
  return getHostInvokeBytes() !== null
}

/** 上一次 invoke 实际走的线格式（诊断：证明"去 JSON"真的生效，而非静默回退） */
export let _lastInvokeWire: 'bytes' | 'json' = 'json'

/** 读上一次线格式（导出函数而非直接读 let——打包后 live-binding 在部分宿主不可靠） */
export function lastInvokeWire(): 'bytes' | 'json' {
  return _lastInvokeWire
}

/** 最近一次回推帧解码失败的信息（诊断；`null` = 无） */
let lastResolveDecodeError: string | null = null

export function lastResolveDecodeErrorInfo(): string | null {
  return lastResolveDecodeError
}

const EMPTY_BYTES = new Uint8Array(0)

/** 去程 meta 归类表：值是字符串的字段（url / contentType） */
const META_STR = ['url', 'contentType']
/** 去程 meta 归类表：值是键值对的字段 */
const META_HEADERS = ['headers', 'params']
/** 去程 meta 归类表：枚举校验器（形态合法才折入 meta，否则按业务体处理） */
const META_ENUM: Record<string, (v: unknown) => boolean> = {
  responseType: (v) => v === 'text' || v === 'json' || v === 'arraybuffer',
}

/**
 * 把能力方法的 `args` 拆成「线格式 meta + 裸字节 body」。
 * ★归类规则与 `AppRequestConfig` 字段同名（url/method/headers/params/timeoutMs|timeout/responseType/
 *   contentType）；未识别字段归入 body（按 JSON 编——小数据用 JSON 最经济，宿主按 `contentType` 理解）。
 */
function splitFramePayload(args: unknown): { meta: InvokeMeta; body: Uint8Array } {
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
      if (k === 'url') meta.url = v
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

/* ══════════════════ 异步通道（两条腿共用 pending 表） ══════════════════ */

/** 待决调用（`resolve/reject` 由 Promise 构造器给出；`responseType` 决定结算时如何解释 body） */
interface PendingHostCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  responseType: ResponseKind
}

const pendingHostCalls = new Map<string, PendingHostCall>()
let hostCallSeq = 0

/** 生成 `__reqId`（壳按它关联回推；格式 `app-async-N`——真机判据按它与宿主记账对账） */
function nextReqId(): string {
  return `app-async-${++hostCallSeq}`
}

/** 按回程帧结算（两条腿共用；`p` 只取结算所需的最小接口）。 */
function settleFromFrame(p: Pick<PendingHostCall, 'resolve' | 'reject' | 'responseType'>, f: ResolveFrame): void {  if (!f.ok) {
    const msg = f.reason ?? '原生异步调用失败'
    // ★`missing` ⇒ `unsupported:` 前缀（桥据此给 `*.unsupported`，与同步通道同口径）
    p.reject(new Error(f.missing ? `unsupported: ${msg}` : msg))
    return
  }
  const body = f.body ?? EMPTY_BYTES
  p.resolve({
    data: interpretBody(body, p.responseType),
    status: f.status ?? 0,
    headers: f.headers ?? {},
  })
}

/** JSON 腿回推结算（`__proteusHostResolve(reqId, json)`）。 */
function settleHostCall(reqId: string, resultJson: string): void {
  const p = pendingHostCalls.get(reqId)
  if (!p) return
  clearTimeout(p.timer)
  pendingHostCalls.delete(reqId)
  try {
    const parsed = JSON.parse(resultJson) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
    if (parsed && parsed.ok === false) {
      const msg = String(parsed.reason ?? '原生异步调用失败')
      p.reject(new Error(parsed.missing ? `unsupported: ${msg}` : msg))
    } else {
      p.resolve(parsed?.data ?? parsed)
    }
  } catch (e) {
    p.reject(e instanceof Error ? e : new Error(String(e)))
  }
}

/**
 * 二进制腿回推结算（`__proteusHostResolveBytes(frame)`）。
 * ★reqId **取自帧内**（与 JSON 腿按参数取不同——帧是自描述的整体）。
 * ★`pending:true` 的帧是"已受理"通知，**不**结算（等最终帧）。
 */
function settleHostCallBytes(frame: Uint8Array): void {
  let f: ResolveFrame
  try {
    f = decodeResolveFrame(frame)
  } catch (e) {
    // ★坏帧不静默：丢弃 + 记诊断（不抛进业务——回推是宿主主动调，抛错只会在宿主侧炸）
    lastResolveDecodeError = e instanceof Error ? e.message : String(e)
    return
  }
  const p = pendingHostCalls.get(f.reqId)
  if (!p) return
  if (f.ok && f.pending === true) return
  clearTimeout(p.timer)
  pendingHostCalls.delete(f.reqId)
  settleFromFrame(p, f)
}

/** 壳异步回推入口的全局键（**JSON** 形态——老壳沿用；新壳走 `HOST_RESOLVE_BYTES_KEY`） */
export const HOST_RESOLVE_KEY = '__proteusHostResolve'

/**
 * 安装壳回推入口（**幂等**——重复调用只装一次）。
 * ★同时装**两个**入口：`__proteusHostResolve`（JSON，老壳）与 `__proteusHostResolveBytes`（二进制，新壳）。
 */
export function installHostResolveBridge(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g[HOST_RESOLVE_KEY] !== 'function') {
    g[HOST_RESOLVE_KEY] = (reqId: string, resultJson: string): void => settleHostCall(reqId, resultJson)
  }
  if (typeof g[HOST_RESOLVE_BYTES_KEY] !== 'function') {
    g[HOST_RESOLVE_BYTES_KEY] = (frame: Uint8Array): void => settleHostCallBytes(frame)
  }
}

/** 待决异步调用数（诊断/测试：证明回推被真实消费、且超时/结算后**无泄漏**） */
export function pendingHostCallCount(): number {
  return pendingHostCalls.size
}

/**
 * 异步调原生（G-39 §2.1 `invokeNative(name, args): Promise` 的落地面）。
 *
 * ★**两条腿，择优降级**（与 vapor 的 `sendOps` 同构）：
 *   · 宿主实现 `invokeBytes` ⇒ **二进制帧**（`PINV` 派发 → `PRSP` 回执/回推）；
 *   · 否则 ⇒ **回退**既有 JSON 通道（老壳零回归；`lastInvokeWire()` 记录实际走的哪条）。
 *
 * @returns resolve：二进制腿 = `{data,status,headers}`；JSON 腿 = 壳回推的 `data`（**既有语义不变**）
 *          reject：失败 / 超时 / 通道缺失
 */
export function invokeHostAsync(method: string, args?: unknown, timeoutMs = 15000): Promise<unknown> {
  installHostResolveBridge()
  const bytesFn = getHostInvokeBytes()
  if (bytesFn) return invokeHostAsyncBytes(bytesFn, method, args, timeoutMs)
  _lastInvokeWire = 'json'
  const f = getHostInvoke()
  const ph = (globalThis as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
  if (!f && typeof ph?.invoke !== 'function') {
    return Promise.reject(
      new Error(`壳未注册原生通道（${HOST_INVOKE_KEY} / proteusHost.invoke）——${method} 不可用`),
    )
  }
  const reqId = nextReqId()
  const payload = JSON.stringify({ ...((args ?? {}) as Record<string, unknown>), __reqId: reqId })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostCalls.delete(reqId)
      reject(new Error(`原生异步调用超时（${method}，${timeoutMs}ms）`))
    }, timeoutMs)
    pendingHostCalls.set(reqId, { resolve, reject, timer, responseType: 'text' })
    let out: string
    try {
      out = f ? f(method, payload) : ph!.invoke!(method, payload)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    // 壳可以当场给最终结果（同步壳）或回 `{pending:true}`（异步壳）——两者都合法
    let parsed: { ok?: boolean; data?: unknown; reason?: string; missing?: boolean } | null
    try {
      parsed = JSON.parse(out) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
    } catch {
      parsed = null
    }
    const d = parsed?.data
    if (parsed && parsed.ok !== false && d && typeof d === 'object' && (d as { pending?: boolean }).pending === true) {
      return // 已受理 ⇒ 等回推
    }
    pendingHostCalls.delete(reqId)
    clearTimeout(timer)
    if (parsed && parsed.ok === false) {
      const msg = parsed.reason ?? ''
      reject(new Error(parsed.missing ? `unsupported: ${msg}` : msg || '原生调用失败'))
      return
    }
    resolve(parsed?.data ?? parsed)
  })
}

/** 二进制腿的派发实现（`invokeHostAsync` 探测到宿主实现 `invokeBytes` 后走这里）。 */
function invokeHostAsyncBytes(
  fn: HostInvokeBytesFn,
  method: string,
  args: unknown,
  timeoutMs: number,
): Promise<unknown> {
  _lastInvokeWire = 'bytes'
  const reqId = nextReqId()
  const { meta, body } = splitFramePayload(args)
  // ★缺省 responseType = text（与 JSON 腿的 `responseType: 'text'` 默认一致）
  if (meta.responseType === undefined) meta.responseType = 'text'
  const responseType = meta.responseType
  let frame: Uint8Array
  try {
    frame = encodeInvokeFrame({ method, reqId, meta, body })
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostCalls.delete(reqId)
      reject(new Error(`原生异步调用超时（${method}，${timeoutMs}ms）`))
    }, timeoutMs)
    pendingHostCalls.set(reqId, { resolve, reject, timer, responseType })
    let out: Uint8Array | undefined
    try {
      out = fn(frame)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    // 壳返回空 ⇒ 语义等同"已受理待回推"（回推走 `__proteusHostResolveBytes`）
    if (out === undefined || out === null || !(out instanceof Uint8Array) || out.length === 0) {
      return
    }
    let reply: ResolveFrame
    try {
      reply = decodeResolveFrame(out)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    if (reply.ok && reply.pending === true) return // 受理帧不结算
    pendingHostCalls.delete(reqId)
    clearTimeout(timer)
    settleFromFrame({ resolve, reject, responseType }, reply)
  })
}

/* ══════════════════ 上文 `APP_NATIVE_METHODS.httpRequest` 用的配置/响应类型 ══════════════════
 * ★为什么定义在这里（而非 capability-app.ts）：它们描述的是**线格式的字段分类**
 *   （url/method/headers/params/timeoutMs/responseType/contentType 各有 TLV tag），
 *   与 `splitFramePayload` 的归类表是同一条契约 —— 两处必须一起改。 */

/** 请求配置（对齐 `RequestConfig`） */
export interface AppRequestConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  baseURL?: string
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  /** ms，默认 15000（与 types 包同默认） */
  timeout?: number
  retry?: number
  retryDelay?: number
  skipAuth?: boolean
  /** ★S2（#903）：响应体解释方式——`arraybuffer` 时 `data` 是**裸 `Uint8Array`**（不做文本解码） */
  responseType?: ResponseKind
}

/** 请求响应（对齐 `RequestResponse`） */
export interface AppRequestResponse<T> {
  data: T
  status: number
  headers: Record<string, string>
  config: AppRequestConfig
}

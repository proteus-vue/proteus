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
// 【诚实边界】① 字节腿覆盖 capability invoke（含**同步**能力——2026-10-19 扩面；宿主不认则回落
//   JSON 且 `lastInvokeWire()` 可查）。整树 mount 的 blob、vapor 的 `sendOps` 是各自通道（不混用本文件）。
//   ② JSON 腿保留（老壳零回归，降级**不静默**）。③ 通用能力的参数/结果是**结构化小对象** ⇒ 以 JSON
//   **字节**承载（#903 已登记的边界：不为每种能力定义 TLV schema）；大载荷（HTTP 响应/文件）走裸字节。

import { utf8Decode, utf8Encode } from '@proteus-vue/shared'
// ★★★#1344 B-3：**去程载荷编码已抽到独立文件**（纯函数，零状态）。
//   抽因：本文件涨到 1007 行顶破 `check:file-size` 的 1000 行硬上限；而那块（meta 归类表 +
//   body 编码）与"待决表/取消通道/回推结算"完全不同职责。
import { splitFramePayload, genericFramePayload } from './capability-invoke-payload'
// ★#1122：取消契约的**单一来源**（`capability-fetch-types`）
import type { AbortSignalLike } from './capability-fetch-types'
import {
  decodeResolveFrame,
  encodeInvokeFrame,
  interpretBody,
  type InvokeMeta,
  type ResponseKind,
  type ResolveFrame,
  type TransportReadout,
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

/** 壳是否提供 JSON 腿（通用入口或 `proteusHost.invoke`）——决定字节腿 `missing` 时能否回落。 */
function hasJsonHostChannel(): boolean {
  if (getHostInvoke()) return true
  const ph = (globalThis as { proteusHost?: { invoke?: unknown } }).proteusHost
  return typeof ph?.invoke === 'function'
}

/**
 * 调原生（**同步**——与 G-39 的 JNI trampoline 同契约：壳内同步完成）。
 *
 * ★★ 2026-10-19 扩面（用户：「能力通道也去 JSON 化」）：**同步能力也优先走二进制帧**
 *   （`PINV`/`PRSP`）。宿主 `invokeBytes` 不认该方法（回 `missing` 帧）⇒ 回落既有 JSON 腿，
 *   由 `lastInvokeWire()` 如实记录实际线格式（降级不静默）。
 *
 * @returns `{ ok: true, data }` 或 `{ ok: false, reason }`
 * ★未注册（壳没提供该方法）与调用失败**分得开**：
 *   前者 = 该端无此能力（框架据此给 `*.unsupported`）；后者 = 有 API 但调用出错（`*.failed`）。
 */
export function invokeHost(
  method: string,
  args?: unknown,
): { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } {
  // ★边界：`screen.*` 不是能力（归 M5 执行器，走 `proteusHost.invoke` 自己的分流——Android 的
  //   `HostBridge.invoke` 会转 `ScreenHost`，而 `invokeBytes` 的通用分发**不**转）。本文件只负责能力通道；
  //   screen.* 若从这里进字节腿会拿到 body 级 missing ⇒ 执行器整条失效。
  const bytesFn = method.startsWith('screen.') ? null : getHostInvokeBytes()
  if (bytesFn) {
    const viaBytes = tryInvokeHostBytesSync(bytesFn, method, args)
    if (viaBytes !== null) {
      _lastInvokeWire = 'bytes'
      return viaBytes
    }
  }
  _lastInvokeWire = 'json'
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

/**
 * 内部哨兵：字节腿回 `missing` 帧（宿主不认该方法）。
 * ★不是业务错误——`invokeHostAsyncBytes` 捕获它并**回落 JSON 腿**（`lastInvokeWire()` 会如实变成
 *   `'json'`）。用唯一对象身份判定，避免与业务里真的抛 `Error('missing')` 混淆。
 */
const BYTES_MISSING = Symbol('proteus.invokeBytes.missing')

/* ★★★#1344 B-3：`splitFramePayload` / `genericFramePayload` / 四张 meta 归类表
   已抽到 `capability-invoke-payload.ts`（纯函数，零状态）。
   那个文件头写着这块**最容易出的三类缺陷**（upload / redirectManual / httpDns 被编进 body），
   判据见 `tests/fetch-wire-fields.test.ts`。 */
/**
 * **同步**字节腿：`PINV` 去程 → `PRSP` 回程。
 * 返回 `null` = **本次不能走字节**（宿主没装字节桥 / 不认该方法 / 空回执 / 坏帧）⇒ 调用方回落 JSON。
 */
function tryInvokeHostBytesSync(
  fn: HostInvokeBytesFn,
  method: string,
  args: unknown,
): { ok: true; data: unknown } | { ok: false; reason: string; missing: boolean } | null {
  const { meta, body } = genericFramePayload(args)
  let frame: Uint8Array
  try {
    frame = encodeInvokeFrame({ method, reqId: nextReqId(), meta, body })
  } catch {
    return null
  }
  let out: Uint8Array | undefined
  try {
    out = fn(frame)
  } catch {
    // 宿主抛错（老壳的字节分发不认这个方法）⇒ 回落 JSON
    return null
  }
  if (!out || !(out instanceof Uint8Array) || out.length === 0) return null
  let reply: ResolveFrame
  try {
    reply = decodeResolveFrame(out)
  } catch {
    return null
  }
  // ★`missing` 的处置分两种（2026-10-19）：
  //   · `http.request`：字节分发**本应**认得它（专用通道）⇒ missing 就是"这端没有网络能力"，
  //     如实返回失败（不回落 JSON —— 老壳的 JSON 腿同样没有 http.request，回落只会掩盖）；
  //   · 通用能力：旧壳的字节分发只认 http.request ⇒ missing 是"这条腿不认识"，回落 JSON 再试。
  if (reply.missing === true) {
    if (method === 'http.request') {
      return { ok: false, reason: reply.reason ?? 'http.request 未实现', missing: true }
    }
    return null
  }
  if (!reply.ok) return { ok: false, reason: reply.reason ?? '原生调用失败', missing: false }
  const raw = reply.body ?? EMPTY_BYTES
  if (raw.length === 0) return { ok: true, data: null }
  const text = utf8Decode(raw)
  if (method === 'http.request') return { ok: true, data: text }
  // ★通用能力：宿主把**既有 `invoke()` 的 JSON 串原样**放进回程 body（`{ok,data}` / 裸值）——
  //   与 JSON 腿 `parsed?.data ?? parsed` 逐字同语义，业务拿到的形状不变。
  let parsed: { ok?: boolean; data?: unknown; reason?: string; missing?: boolean } | null
  try {
    parsed = JSON.parse(text) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
  } catch {
    // 非 JSON 正文（宿主自定义形态）⇒ 原样返回文本，不吞成 null
    return { ok: true, data: text }
  }
  if (parsed && parsed.ok === false) {
    return { ok: false, reason: String(parsed.reason ?? '原生调用失败'), missing: !!parsed.missing }
  }
  return { ok: true, data: parsed?.data ?? parsed }
}

/**
 * ★★★#1121：**最小 AbortController**（App 三端 JS 引擎都**没有** `AbortController`）。
 *
 * 【为什么自己实现】QuickJS / JSC 精简版 / JSVM 都不带 `AbortController`/`AbortSignal`
 *   （与本仓既有的"无 setTimeout / 无 TextEncoder"同族，#1071 已为此降级过一次）。
 *   ⇒ 提供一个**只满足取消需求**的最小实现（不做 `reason` / `throwIfAborted` / 事件冒泡）。
 *
 * 【★诚实边界】`abort()` 之后 `signal.aborted` 恒为 true；**单个消费者**（只支持一个 onabort
 *   回调，不支持 addEventListener 多订阅）——够 `useFetch` 用，超出范围请自行包一层。
 */
// ★#1122：契约面在 `capability-fetch-types`（只要求 `aborted` 可读 ⇒ 兼容原生 AbortSignal）；
//   这里有 `onabort` 是实现所需（单消费者）。⇒ 用 extend 保证"实现满足契约"。
export interface AbortSignalImpl extends AbortSignalLike {
  /** 取消时触发（单消费者） */
  onabort?: () => void
}

export interface AbortControllerLike {
  /** ★#1122：返回**实现版**（带 `onabort`）——调用方 `attachAbort` 要挂回调 */
  readonly signal: AbortSignalImpl
  abort(): void
}

export function createAbortController(): AbortControllerLike {
  let aborted = false
  const signal: AbortSignalImpl = {
    get aborted(): boolean {
      return aborted
    },
    onabort: undefined,
  }
  return {
    signal,
    abort(): void {
      if (aborted) return
      aborted = true
      const cb = signal.onabort
      if (typeof cb === 'function') cb()
    },
  }
}

/* ══════════════════ 异步通道（两条腿共用 pending 表） ══════════════════ */

/** 待决调用（`resolve/reject` 由 Promise 构造器给出；`responseType` 决定结算时如何解释 body） */
interface PendingHostCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  /** ★异步腿的超时句柄（引擎无 `setTimeout` 时是 no-op——见 `armHostCallTimeout`）。 */
  timer: TimerHandle
  responseType: ResponseKind
  /** ★通用能力（非 `http.request`）：回程 body = 既有 `invoke()` 的 JSON 串（#2026-10-19）。 */
  generic: boolean
  /** ★#1118：流式消费回调（声明了 `stream: true` 才有）。每块调一次，**不结算**。 */
  onChunk?: (chunk: Uint8Array, seq: number) => void
  /** ★#1118：已收到的最大块序号（-1 = 还没收到）；用于**丢帧检测**。由 `trackPending` 初始化。 */
  lastStreamSeq?: number
  /** ★#1121：取消后用这个 reqId 通知宿主中止 */
  signal?: AbortSignalLike
}

/** 超时句柄（`clear()` 幂等；无引擎定时器时是 no-op）。 */
export interface TimerHandle {
  clear(): void
}

/**
 * ★★★`setTimeout` 是**宿主环境**能力，不是 ECMAScript 标准 —— 而 App 三端 JS 引擎**都没有**它：
 *   Android = QuickJS（`JS_NewContext` 不带 libc 定时器）· iOS = JavaScriptCore（`JSContext` 无 window）·
 *   鸿蒙 = JSVM（同上）。此前本文件**无条件** `setTimeout(...)` ⇒ 异步腿（含 `useFetch`）在真机上
 *   直接 `ReferenceError: setTimeout is not defined`（Promise 构造器内抛出 ⇒ 立刻 reject）。
 * ★为什么不是"偷偷跳过超时"：帧的 meta 里**已带 `timeoutMs`**，宿主持有同值超时（Android/iOS 各自
 *   设 connect/read timeout、鸿蒙设 RCP connect/transfer）⇒ 超时语义**由宿主兜底**，JS 侧只是
 *   第二道防线。故无定时器时降级为 host-only，并**记下来**（`hostCallTimerMode()` 可查，不静默）。
 */
function armHostCallTimeout(ms: number, onTimeout: () => void): TimerHandle {
  const st = (globalThis as { setTimeout?: (fn: () => void, ms?: number) => unknown }).setTimeout
  if (typeof st !== "function") {
    timerMode = "host-only"
    return { clear() {} }
  }
  timerMode = "js-timer"
  const id = st(onTimeout, ms)
  const ct = (globalThis as { clearTimeout?: (id: unknown) => void }).clearTimeout
  return { clear() { if (typeof ct === "function") ct(id) } }
}

/** 实际使用的超时形态（`js-timer` | `host-only`；真机/单测判据读它）。 */
let timerMode: "js-timer" | "host-only" | "unset" = "unset"
export function hostCallTimerMode(): "js-timer" | "host-only" | "unset" {
  return timerMode
}

const pendingHostCalls = new Map<string, PendingHostCall>()
let hostCallSeq = 0

/**
 * ★★★待决表上限（决策 #1071）。
 *
 * 【为什么必须有】App 三端引擎没有 `setTimeout` ⇒ 超时降级为 `host-only`（JS 侧不设表）；
 *   此时只有"宿主回推"或"宿主抛错"才会删条目。宿主一旦丢帧/重装/被系统杀过一次，
 *   对应 Promise 就**永久挂在表里**（实测：5000 次调用不回推 ⇒ pending 5000、heap +5.54MB）。
 *   超级应用长跑会持续涨。
 * 【策略】超过上限时**淘汰最旧**并 reject 掉——不静默丢弃（调用方拿到明确错误而不是永久挂起）。
 *   上限取 1024：正常并发请求远低于此（HTTP 默认 6 并发/域），触到上限本身就说明宿主异常。
 */
const PENDING_HOST_CALLS_MAX = 1024
/** 被容量淘汰的累计次数（诊断读数——供门禁/真机判据观察宿主是否在丢回推） */
/**
 * ★★★#1121：挂上取消钩子。`abort()` 时：
 *   ① 立刻 reject（调用方不必等宿主回执——宿主可能已经没响应）；
 *   ② 清 pending 表（防泄漏）；
 *   ③ **尽力**通知宿主中止（`http.cancel`）——宿主不支持就静默（不因为取消失败而改报别的错）。
 *
 * 【★为什么要发 `http.cancel` 而不是只 reject JS 侧】
 *   只 reject 不改宿主：网络传输仍在跑、内存仍在涨（流式下尤其明显）⇒ 变成"用户以为取消了，
 *   其实后台还在下载"。⇒ 必须让宿主真的停。
 *
 * 【★诚实边界（#1165 更正）】宿主不支持 `http.cancel`（老壳）时：JS 侧照常 reject，
 *   但**后端传输不会停**——这是能力位差异，不是本函数能兜住的（已在能力页登记）。
 *
 *   ★★★**鸿蒙不能混为一谈**（#1165 源码复核 + 判据固化）：鸿蒙宿主是**同步 napi**
 *   （一次性 VM ⇒ `invokeHostAsyncBytes` 里就是 `out = fn(frame)` 同步取结果），
 *   请求期间 JS 线程**被占** ⇒ `signal.onabort` **根本没有执行机会**。
 *   ⇒ 鸿蒙上 `abort()` 是 **no-op**：**连本函数的 reject 都不会发生**，请求照常成功返回。
 *   ★而且**不存在"后台还在跑"**——没有后台，请求就在调用线程里同步跑完。
 *   ⇒ 鸿蒙上要"别等太久"必须用 **`timeout`**（宿主有界等待 + 超时主动 cancel），不是 `abort()`。
 *   ★这条区分的意义：写成"只 reject 本地"会让业务以为取消能兜住、于是不设 `timeout`——
 *     **夸大与贬低同样是假信息**。判据：`tests/fetch-cancel.test.ts` 的「鸿蒙 abort 是 no-op」段。
 */
/**
 * ★★★#1344 B-2c 诊断：**最近一次 abort 的取消帧落地情况**（只读）。
 *
 * 【为什么必须有（本轮真机取证链）】真机读数：`abort()` 后 JS 侧 `fetch.aborted` +
 *   `settle_ms_after_abort=3`（都"对"），而宿主 `cancelStats.calls=0`、hilog 里
 *   `PROTEUS_INVOKE_BYTES_*` 一条都没有 ⇒ 结论只能是 `fn(cancelFrame)` 在**进 native 之前**
 *   就抛了，而那个空 `catch`（"取消是尽力而为，不该产生二次错误"）把原因**永久吞掉**。
 *   ★这是本仓反复踩的同一类坑：**只验"桥说成功"就是假绿**——这里反过来，
 *     "桥静默失败"同样是假绿（看起来取消跑了，实际宿主没收到）。
 *   ⇒ 记录 stage + 异常原文，真机一次运行即可定位，不必反复排除。
 */
export interface AbortDiag {
  /** 被取消的 reqId */
  reqId: string
  /** abort 时该 reqId 是否还在待决表里（false ⇒ 请求已结算，取消无意义） */
  inPending: boolean
  /** 取消帧是否编码成功 */
  encoded: boolean
  /** 取消帧是否真的交给宿主通道（`fn()` 正常返回） */
  sent: boolean
  /** 宿主回执帧的字节数（0 = 空回执；-1 = 没走到取回执） */
  replyBytes: number
  /** 宿主回执的可读片段（UTF-8 直读，失败则空）——`no-inflight` 等判定直接可见 */
  replyText: string
  /** 编码或派发抛出的异常原文（空串 = 无异常） */
  error: string
}
let lastAbortDiag: AbortDiag | null = null
export function abortDiag(): AbortDiag | null {
  return lastAbortDiag
}

function attachAbort(
  signal: AbortSignalImpl | undefined,
  reqId: string,
  fn: HostInvokeBytesFn,
  timer: TimerHandle,
  reject: (e: Error) => void,
): void {
  if (!signal) return
  const doAbort = (): void => {
    const diag: AbortDiag = {
      reqId, inPending: pendingHostCalls.has(reqId), encoded: false, sent: false,
      replyBytes: -1, replyText: '', error: '',
    }
    lastAbortDiag = diag
    if (!diag.inPending) return   // 已结算 ⇒ 取消无意义
    pendingHostCalls.delete(reqId)
    timer.clear()
    // ③ 尽力通知宿主（同步帧；失败不抛——取消是"尽力而为"，不该产生二次错误）
    try {
      const cancelFrame = encodeInvokeFrame({
        method: 'http.cancel',
        reqId: `${reqId}#cancel`,
        meta: { contentType: 'application/json' },
        body: utf8Encode(JSON.stringify({ reqId })),
      })
      diag.encoded = true
      const out = fn(cancelFrame)
      diag.sent = true
      /* ★回执内容也是证据：宿主若回 `cancelled:false / no-inflight`，说明"帧到了但表里没有"
         ——与"帧根本没到"是**完全不同的缺陷**，此前读不出来。 */
      if (out instanceof Uint8Array) {
        diag.replyBytes = out.length
        try {
          diag.replyText = utf8Decode(out).slice(0, 200)
        } catch {
          diag.replyText = ''
        }
      } else {
        diag.replyBytes = 0
      }
    } catch (e) {
      // ★仍然吞掉（取消失败不该改报别的错），但**必须留证**——否则"取消静默失效"无法定位
      diag.error = e instanceof Error ? e.message : String(e)
    }
    // ① 立即 reject（**在通知宿主之后**——先通知能让宿主尽快停，减少白跑）
    // ★#1122：**必须带 `code`**——`capability-fetch.runFetch` 从 `e.code` 取错误码，
    //   只给 message 前缀的话会被判成 `fetch.failed`（本轮真机实测：取消生效了但码不对）。
    const abortErr = new Error(`fetch.aborted: 请求已取消（${reqId}）`) as Error & { code?: string }
    abortErr.code = 'fetch.aborted'
    reject(abortErr)
    // ★② pending 已删；timer 已清
  }
  if (signal.aborted) {
    doAbort()
    return
  }
  signal.onabort = doAbort
}

let pendingEvictions = 0
export function pendingHostCallEvictions(): number {
  return pendingEvictions
}
/** 插入并维护上限（所有 `pendingHostCalls.set` 都走这里） */
function trackPending(reqId: string, p: PendingHostCall): void {
  // ★#1118：流式序号从 -1 起（首块必须是 seq=0，否则按丢帧拒绝）
  if (p.lastStreamSeq === undefined) p.lastStreamSeq = -1
  pendingHostCalls.set(reqId, p)
  while (pendingHostCalls.size > PENDING_HOST_CALLS_MAX) {
    const oldest = pendingHostCalls.keys().next()
    if (oldest.done) break
    const victim = pendingHostCalls.get(oldest.value)
    pendingHostCalls.delete(oldest.value)
    pendingEvictions++
    if (victim) {
      try {
        victim.timer.clear()
        victim.reject(new Error(`原生异步调用被淘汰（待决表超过 ${PENDING_HOST_CALLS_MAX} 条——宿主可能丢失回推）`))
      } catch { /* reject 抛错不影响淘汰流程 */ }
    }
  }
}

/** 生成 `__reqId`（壳按它关联回推；格式 `app-async-N`——真机判据按它与宿主记账对账） */
function nextReqId(): string {
  return `app-async-${++hostCallSeq}`
}

/** 按回程帧结算（两条腿共用；`p` 只取结算所需的最小接口）。 */
function settleFromFrame(
  p: Pick<PendingHostCall, 'resolve' | 'reject' | 'responseType' | 'generic'>,
  f: ResolveFrame,
): void {
  if (!f.ok) {
    const msg = f.reason ?? '原生异步调用失败'
    // ★`missing` ⇒ `unsupported:` 前缀（桥据此给 `*.unsupported`，与同步通道同口径）
    p.reject(new Error(f.missing ? `unsupported: ${msg}` : msg))
    return
  }
  const body = f.body ?? EMPTY_BYTES
  // ★通用能力（非 http.request）：回程 body = 既有 `invoke()` 的 JSON 串（`{ok,data}` / 裸值），
  //   与 JSON 腿 `parsed?.data ?? parsed` 同语义（#2026-10-19 全能力通道去 JSON）。
  if (p.generic) {
    const text = utf8Decode(body)
    let parsed: { ok?: boolean; data?: unknown; reason?: string; missing?: boolean } | null
    try {
      parsed = JSON.parse(text) as { ok?: boolean; data?: unknown; reason?: string; missing?: boolean }
    } catch {
      p.resolve(text)
      return
    }
    if (parsed && parsed.ok === false) {
      const msg = String(parsed.reason ?? '原生异步调用失败')
      p.reject(new Error(parsed.missing ? `unsupported: ${msg}` : msg))
      return
    }
    p.resolve(parsed?.data ?? parsed)
    return
  }
  /**
   * ★★★#1150：这里**不能抛**。`responseType:'json'` 遇非 JSON 体（5xx 错误页/纯文本）时
   *   `interpretBody` 按契约抛错，而本函数在**宿主回推回调**里执行 ⇒ 异常逃出 ⇒ pending 已删、
   *   Promise 既不 resolve 也不 reject ⇒ 请求**永久挂起**（真机实测卡死 120s）。
   *   ⇒ 降级为原文；`status` 照常返回（业务仍能判断 4xx/5xx，SIE 也正因此才看得到 5xx）。
   *   纯函数 `interpretBody` 的严格契约**保持不变**（分层：契约留在纯函数，兜底放在不能抛的边界）。
   */
  let data: unknown
  try {
    data = interpretBody(body, p.responseType)
  } catch {
    data = utf8Decode(body)
  }
  p.resolve({
    data,
    status: f.status ?? 0,
    headers: f.headers ?? {},
    // ★★★#1158：宿主侧传输读数（缺省 ⇒ 字段不出现；键是线格式短名，解析在管线层）
    ...(f.transport ? { transport: f.transport } : {}),
  })
}

/** JSON 腿回推结算（`__proteusHostResolve(reqId, json)`）。 */
function settleHostCall(reqId: string, resultJson: string): void {
  const p = pendingHostCalls.get(reqId)
  if (!p) return
  p.timer.clear()
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
  // ★★★#1118 流式块：带 `streamSeq` = 数据块（**不结算**，交消费方）。
  //   ★为什么必须先判它再判 `pending`：宿主可能把块帧的 pending 省略（省略即 undefined），
  //     若按 `pending === true` 才当块，这类帧会被**当成最终帧结算** ⇒ 流在中途被截断且不报错。
  if (f.streamSeq !== undefined) {
    // ★丢帧检测：seq 必须**连续递增**。跳跃 ⇒ 宿主队列丢过数据，必须报错而不是静默拼接
    //   （超级应用里静默半截 JSON 比直接失败难查得多）。
    const last = p.lastStreamSeq ?? -1
    if (f.streamSeq !== last + 1) {
      p.timer.clear()
      pendingHostCalls.delete(f.reqId)
      p.reject(new Error(`流式回推丢帧：期望 seq=${last + 1}，实得 ${f.streamSeq}`))
      return
    }
    p.lastStreamSeq = f.streamSeq
    try {
      p.onChunk?.(f.body ?? new Uint8Array(0), f.streamSeq)
    } catch (e) {
      // 消费方回调抛错 ⇒ 终止本次流（否则后续块继续到达却没人消费，属泄漏）
      p.timer.clear()
      pendingHostCalls.delete(f.reqId)
      p.reject(e instanceof Error ? e : new Error(String(e)))
    }
    return
  }
  if (f.ok && f.pending === true) return
  p.timer.clear()
  pendingHostCalls.delete(f.reqId)
  // ★★★#1150：结算**绝不能抛**（本函数在宿主回推回调里跑；抛出会让 Promise 既不 resolve
  //   也不 reject ⇒ 请求永久挂起，真机实测卡死 120s）。兜底保证将来任何新增解析逻辑都不会制造僵尸。
  try {
    settleFromFrame(p, f)
  } catch (e) {
    try {
      p.reject(e instanceof Error ? e : new Error(String(e)))
    } catch {
      /* reject 本身也不该抛；到这里说明 Promise 已结算，忽略 */
    }
  }
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
export function invokeHostAsync(
  method: string,
  args?: unknown,
  timeoutMs = 15000,
  opts?: { signal?: AbortSignalLike },
): Promise<unknown> {
  installHostResolveBridge()
  const bytesFn = getHostInvokeBytes()
  if (bytesFn) return invokeHostAsyncBytes(bytesFn, method, args, timeoutMs, opts?.signal)
  return invokeHostAsyncJson(method, args, timeoutMs)
}

/**
 * ★★★#1118 **流式**派发（宿主逐块回推，调用方按块消费）。
 *
 * 【它解决什么】S3 的"背压 + 流式"：一问一答整包通道下，一个 30 MiB 响应必须**整体驻留**
 *   且调用方在拿到全部字节前看不到任何数据。流式让消费方**边到边处理**（如 NDJSON/SSE 逐行解析、
 *   下载落盘），内存占用从"响应体大小"降到"块大小 × 队列深度"。
 *
 * 【★背压怎么形成（三端各自的真实机制，不粉饰为同一套）】
 *   · **Android / iOS**：宿主在**另起读线程**里边读边推；推满有界队列后**阻塞读线程**
 *     （不是无限堆积）⇒ 网络层自然减速（TCP 窗口）⇒ 生产被消费速度约束。
 *     ★这是真背压：消费慢 ⇒ 队列满 ⇒ 读停 ⇒ 服务器发不动。
 *   · **鸿蒙**：一次性 VM 形态下**没有回推接收方**（见 `proteus_http.h` 文件头）
 *     ⇒ 本 API 在鸿蒙**回 `unsupported:`**（不假装支持）。
 *
 * 【★诚实边界】
 *   ① `onChunk` 是**同步**调用（在宿主回推的 JS 线程上）⇒ 回调里做重活会阻塞后续块；
 *      需要异步处理时请自行入队（本 API 不代管消费方队列）。
 *   ② 块序号**必须连续**：跳跃即报错（宿主队列丢数据），不静默拼接。
 *   ③ 流式请求**不受 32 MiB 整包上限约束**（上限本就是"整包驻留"的护栏），
 *      但受 `timeoutMs` 与总块数（`MAX_STREAM_CHUNKS`）约束。
 */
export function invokeHostStream(
  method: string,
  args: unknown,
  onChunk: (chunk: Uint8Array, seq: number) => void,
  timeoutMs = 15000,
  signal?: AbortSignalLike,
): Promise<unknown> {
  installHostResolveBridge()
  const bytesFn = getHostInvokeBytes()
  if (!bytesFn) {
    return Promise.reject(new Error('unsupported: 流式通道要求宿主实现 invokeBytes（JSON 腿无回推帧）'))
  }
  _lastInvokeWire = 'bytes'
  const reqId = nextReqId()
  const isHttp = method === 'http.request'
  const { meta, body } = isHttp ? splitFramePayload(args) : genericFramePayload(args)
  if (meta.responseType === undefined) meta.responseType = isHttp ? 'text' : 'json'
  // ★★关键：**由请求声明**流式（宿主据此改变回推形态；缺省仍是整包）
  meta.stream = true
  let frame: Uint8Array
  try {
    frame = encodeInvokeFrame({ method, reqId, meta, body })
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
  const settled = new Promise<unknown>((resolve, reject) => {
    const timer: TimerHandle = armHostCallTimeout(timeoutMs, () => {
      pendingHostCalls.delete(reqId)
      reject(new Error(`原生流式调用超时（${method}，${timeoutMs}ms，已收 ${received} 块）`))
    })
    received = 0
    trackPending(reqId, {
      resolve,
      reject,
      timer,
      responseType: meta.responseType as ResponseKind,
      generic: !isHttp,
      signal,
      onChunk: (chunk, seq) => {
        received++
        if (received > MAX_STREAM_CHUNKS) {
          timer.clear()
          pendingHostCalls.delete(reqId)
          reject(new Error(`流式块数超过上限 ${MAX_STREAM_CHUNKS}（疑似宿主未按 seq 收敛/服务端无限流）`))
          return
        }
        onChunk(chunk, seq)
      },
    })
    // ★#1121：流式同样可取消（尤其重要——流式可能跑很久）
    attachAbort(signal, reqId, bytesFn, timer, reject)
    let out: Uint8Array | undefined
    try {
      out = bytesFn(frame)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      timer.clear()
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    if (out === undefined || out === null || !(out instanceof Uint8Array) || out.length === 0) return
    let reply: ResolveFrame
    try {
      reply = decodeResolveFrame(out)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      timer.clear()
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    if (reply.streamSeq !== undefined) return // 同步壳也可能直接给块（罕见，但语义一致）
    if (reply.ok && reply.pending === true) return
    if (reply.missing === true) {
      pendingHostCalls.delete(reqId)
      timer.clear()
      reject(new Error(`unsupported: ${reply.reason ?? `${method} 不支持流式`}`))
      return
    }
    pendingHostCalls.delete(reqId)
    timer.clear()
    settleFromFrame({ resolve, reject, responseType: meta.responseType as ResponseKind, generic: !isHttp }, reply)
  })
  return settled
}

/**
 * 流式块数上限（#1118）。
 * 【为什么需要】`seq` 连续递增的校验能防"丢帧"，但**防不了"永不结束"**——
 *   服务端无限流 / 宿主 seq 不推进都会让 Promise 永久挂起（只有 timeout 兜底）。
 *   65536 块 × 典型 16 KiB ≈ 1 GiB 上限，足够真实场景（SSE/分块下载），又能兜住失控。
 */
const MAX_STREAM_CHUNKS = 65536
/** 最近一次流式调用收到的块数（诊断/判据读数）。 */
let received = 0
export function lastStreamChunkCount(): number {
  return received
}

/** JSON 腿（老壳 / 字节分发不认该方法时的回落——语义与 #902 完全一致）。 */
function invokeHostAsyncJson(method: string, args: unknown, timeoutMs: number): Promise<unknown> {
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
    const timer: TimerHandle = armHostCallTimeout(timeoutMs, () => {
      pendingHostCalls.delete(reqId)
      reject(new Error(`原生异步调用超时（${method}，${timeoutMs}ms）`))
    })
    trackPending(reqId, { resolve, reject, timer, responseType: 'text', generic: false })
    let out: string
    try {
      out = f ? f(method, payload) : ph!.invoke!(method, payload)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      timer.clear()
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
    timer.clear()
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
  signal?: AbortSignalLike,
): Promise<unknown> {
  _lastInvokeWire = 'bytes'
  const reqId = nextReqId()
  // ★`http.request` 用请求元数据 TLV（url/method/headers/params/…）；其余能力 = 结构化小对象 ⇒
  //   泛载荷（JSON 字节 + contentType）。★同步腿同理（见 `genericFramePayload`）。
  const isHttp = method === 'http.request'
  const { meta, body } = isHttp ? splitFramePayload(args) : genericFramePayload(args)
  // ★缺省 responseType：http = text（与 JSON 腿一致）；通用能力 = json（宿主回 `{"ok":true,"data":…}` 的 data）
  if (meta.responseType === undefined) meta.responseType = isHttp ? 'text' : 'json'
  const responseType = meta.responseType
  let frame: Uint8Array
  try {
    frame = encodeInvokeFrame({ method, reqId, meta, body })
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
  const settled = new Promise<unknown>((resolve, reject) => {
    const timer: TimerHandle = armHostCallTimeout(timeoutMs, () => {
      pendingHostCalls.delete(reqId)
      reject(new Error(`原生异步调用超时（${method}，${timeoutMs}ms）`))
    })
    trackPending(reqId, { resolve, reject, timer, responseType, generic: !isHttp, signal })
    // ★#1121：取消通道（宿主按 reqId 中止；JS 侧立即 reject，不等宿主回执）
    attachAbort(signal, reqId, fn, timer, reject)
    let out: Uint8Array | undefined
    try {
      out = fn(frame)
    } catch (e) {
      pendingHostCalls.delete(reqId)
      timer.clear()
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
      timer.clear()
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    if (reply.ok && reply.pending === true) return // 受理帧不结算
    if (reply.missing === true) {
      pendingHostCalls.delete(reqId)
      timer.clear()
      if (isHttp || !hasJsonHostChannel()) {
        // http.request 的 missing = 该端真没网络能力；无 JSON 腿时也没有回落目标 ⇒ 如实报 unsupported
        reject(new Error(`unsupported: ${reply.reason ?? `${method} 未实现`}`))
        return
      }
      // ★旧壳的字节分发只认 http.request ⇒ 通用能力回落 JSON 腿
      //   （降级不静默：JSON 腿会写 lastInvokeWire）
      reject(BYTES_MISSING)
      return
    }
    pendingHostCalls.delete(reqId)
    timer.clear()
    settleFromFrame({ resolve, reject, responseType, generic: !isHttp }, reply)
  })
  return settled.catch((e: unknown) => {
    if (e === BYTES_MISSING) return invokeHostAsyncJson(method, args, timeoutMs)
    throw e
  })
}

/* ══════════════════ 上文 `APP_NATIVE_METHODS.httpRequest` 用的配置/响应类型 ══════════════════
 * ★为什么定义在这里（而非 capability-app.ts）：它们描述的是**线格式的字段分类**
 *   （url/method/headers/params/timeoutMs/responseType/contentType 各有 TLV tag），
 *   与 `splitFramePayload` 的归类表是同一条契约 —— 两处必须一起改。 */

/** ★★#1158：`AppRequestConfig` / `AppRequestResponse` 已抽到同名文件
 *  （`capability-app-request-types.ts`）——它们是"线格式字段归类"的契约描述，
 *   与 `splitFramePayload` 的归类表同源；留在本文件会把 998 行的文件顶过 1000 行硬上限。 */
export type { AppRequestConfig, AppRequestResponse } from './capability-app-request-types'

// packages/api/src/capability-websocket.ts
// ★★★决策 #1093（2026-10-19）：App 端（iOS/Android/鸿蒙）WebSocket 桥（C27 `useWebSocket`）。
//
// 【它解决什么】「网络与通信」域在 App 端此前 11 项里只有 `fetch` 可用，WebSocket 全 🟡。
//   而两端平台 API 都是现成的（Android `okhttp3.WebSocket` / iOS `URLSessionWebSocketTask`），
//   缺的只是**通道形态**：`invoke` 是"一问一答"，WebSocket 是"连上以后持续双向"。
//
// 【通道设计（一次受理 + 壳推事件流）】
//   ① `ws.open`（invoke）：`{ url, protocols }` → `{ id, protocol? }`
//      ★**受理即返**：宿主完成连接后才推 `open` 事件，invoke 不等握手（与 `http.request`
//        的 `{pending:true}` 同形态——G-39 的"统一异步"纪律）。
//   ② `ws.send`（invoke）：`{ id, data, binary? }` → `{}`（受理即返，发送失败经事件回报）
//   ③ `ws.close`（invoke）：`{ id, code, reason }` → `{}`
//   ④ 壳推 `__proteusHostWs({ id, event, ... })`：`open` / `message` / `close` / `error`
//      ——与键盘/传感器/录屏同族"约定即接口"（App 端无 DOM 事件，只能壳推）。
//
// 【为什么不把每条消息做成一次 invoke 往返】
//   消息是**高频**的（直播弹幕、协同编辑）。一问一答会把每条消息变成两次跨边界调用
//   （JS→宿主 + 宿主→JS），并把背压完全交给 JS 侧。壳推是单向流，且天然按到达顺序。
//
// 【诚实边界】宿主未实现 `ws.*` ⇒ `websocket.unsupported`（`invokeHost` 的 missing 分档）；
//   连接失败 ⇒ 推 `error` 事件 + 后续 `close`（与浏览器语义同形）；**不伪造 `open`**。

import { invokeHost } from './capability-invoke'
// ★★★#1344 P4：域名白名单与 HTTP 走**同一份实现**（一处规则，两条通道）
import { hostOf, isHostAllowed } from './request/tenant'
// ★★★#1344 P4：域名白名单与 HTTP 走**同一份实现**（一处规则，两条通道）
import { hostOf, isHostAllowed } from './request/tenant'
import type { CapabilityResourceRegistry } from './capability-resources'   // ★#1094 G-43 边界资源账本
import { CapError as ProteusCapError } from './capability-types'
import type { CapResult, WebSocketConnection } from './capability-types'

/** 宿主方法名（契约：三端宿主按这些名字实现；未实现 ⇒ 桥返回 unsupported） */
export const APP_WS_METHODS = {
  /** 发起连接：`{ url, protocols? }` → `{ id, protocol? }`（受理即返，不等握手） */
  open: 'ws.open',
  /** 发送：`{ id, data, binary? }` → `{}` */
  send: 'ws.send',
  /** 关闭：`{ id, code?, reason? }` → `{}` */
  close: 'ws.close',
} as const

/** 壳推通道（`{ id, event, data?, code?, reason?, message? }`） */
export const APP_WS_PUSH_KEY = '__proteusHostWs'

/** 一条连接的事件订阅表（id → handlers） */
type EventName = 'open' | 'message' | 'close' | 'error'
const conns = new Map<number, Map<EventName, Set<(payload?: unknown) => void>>>()

/* ══════════════ ★★★#1244 §1.0 S3 四项必答（ws 此前是 S1）══════════════ */

/**
 * ④ **连接数上界**。
 *
 * 【为什么必须有（超级应用规模下的真风险）】`conns` 原来是**无界 Map**——
 *   每个连接在 JS 侧持有一份订阅表，在宿主侧持有一个 socket + 读线程。
 *   页面泄漏/用户狂点重连 ⇒ 连接无限增长 ⇒ 宿主线程数爆掉、JS 堆随订阅表增长。
 *   ★"宿主可能会拒"不算上界（那是**别人**的决定，我们这边照样先长满）。
 *
 * 【取值】64：单个页面/scope 的合理并发远低于此；触到上限说明有泄漏或异常重连。
 *   ★超限**显式拒绝**（`websocket.tooManyConnections`），不淘汰旧连接——
 *     WS 连接不像 KV/缓存，它有业务语义（淘汰谁都是错的判断），只能拒绝新的。
 */
export const WS_MAX_CONNECTIONS = 64

/** ②⑤ 单连接的**消息订阅者**上界（同一事件挂太多 handler = 泄漏的典型形态） */
export const WS_MAX_HANDLERS_PER_EVENT = 128

/** ① 单条发送消息上限（与宿主同值：Android MAX_MESSAGE = 16 MiB；超出由宿主以 1009 关闭） */
export const WS_MAX_SEND_BYTES = 16 * 1024 * 1024

/**
 * ② **背压**：单次分发占用超过该毫秒数即视为"订阅者处理慢"。
 *
 * 【ws 的背压形态与 fetch 不同（必须说清，否则判据会被当成凑数）】
 *   fetch 的背压是"宿主读线程 `put` 阻塞"（有队列、有深度）；
 *   ws 的壳推是**宿主线程同步调进 JS**（`__proteusHostWs(...)`）——
 *   订阅者慢 ⇒ **宿主那条线程被占着** ⇒ 它连下一条消息都收不下来。
 *   ★所以 ws 侧不需要"队列"（队列在宿主/内核里），需要的是**慢处理的直接度量**：
 *     一次分发耗时 > 阈值 ⇒ 计一次 slowDispatch。这与上传的 `slowWrites` 同族
 *     （阻塞式背压，没有队列也没有丢弃），不是"没有背压"。
 *
 * 【★为什么不加 JS 侧缓冲队列】加了反而糟：JS 队列只能缓冲**已经进了 JS 的**消息，
 *   而问题恰恰是"进不来"；缓冲只会把内存风险搬进 JS 并掩盖宿主线程被占的事实。
 */
export const WS_SLOW_DISPATCH_MS = 8

/**
 * ② 单次分发最多调用多少个订阅者之后**主动让出**（返回，剩下的排到下一条）。
 * ★意义：N 个慢订阅者串行调用会让单次分发变成 N × 慢；有上界才不会一条消息卡死整条通道。
 * ★超出的订阅者**不丢**（下次消息一起收）——WS 语义是"广播"，丢订阅者等于静默少发。
 */
export const WS_MAX_DISPATCH_PER_PUSH = 64

/** 规模读数（判据/探针用；不改变状态） */
export interface WsStats {
  /** 当前活跃连接数 */
  connections: number
  /** 历史峰值连接数（证明上界真的被逼近过） */
  peakConnections: number
  /** 因超连接上限被拒绝的次数（④ 淘汰/拒绝策略） */
  rejectedConnections: number
  /** 因超订阅者上限被拒绝的次数 */
  rejectedHandlers: number
  /** 累计收到的消息条数（② 流量读数） */
  messagesReceived: number
  /** 因无主（连接已关/未知 id）被丢弃的消息条数（② 丢弃计数） */
  messagesDropped: number
  /** 累计发送条数 */
  messagesSent: number
  /** 发送失败条数（宿主拒/连接已断） */
  sendFailures: number
  /** ② 分发耗时超阈值（订阅者慢 ⇒ 宿主线程被占）的次数 */
  slowDispatches: number
  /** ② 累计分发耗时（与 slowDispatches 同源，可算平均） */
  dispatchMs: number
  /** ② 单次分发因订阅者过多被截断的次数（超出 WS_MAX_DISPATCH_PER_PUSH） */
  dispatchTruncated: number
  /**
   * ★★★#1344 P4：因**域名不在白名单**被拒绝的连接次数。
   *   【为什么单记一个数】WS 曾是"绕过全部 HTTP 加固"的洞（痛点 #15）：
   *   业务以为平台配了域名白名单就管住了所有出网，而 WS 照连不误。
   *   这条读数是"白名单真的拦住了 WS"的唯一直接证据（不是"代码里有那个函数"）。
   */
  rejectedByAllowlist: number
}

const wsStats: WsStats = {
  connections: 0,
  peakConnections: 0,
  rejectedConnections: 0,
  rejectedHandlers: 0,
  messagesReceived: 0,
  messagesDropped: 0,
  messagesSent: 0,
  sendFailures: 0,
  slowDispatches: 0,
  dispatchMs: 0,
  dispatchTruncated: 0,
  rejectedByAllowlist: 0,
}

/** 读规模读数（探针/判据用） */
export function wsStatsSnapshot(): WsStats {
  return { ...wsStats, connections: conns.size }
}

/** 仅测试用：重置读数 */
export function __resetWsStats(): void {
  wsStats.connections = 0
  wsStats.peakConnections = 0
  wsStats.rejectedConnections = 0
  wsStats.rejectedHandlers = 0
  wsStats.messagesReceived = 0
  wsStats.messagesDropped = 0
  wsStats.messagesSent = 0
  wsStats.sendFailures = 0
  wsStats.slowDispatches = 0
  wsStats.dispatchMs = 0
  wsStats.dispatchTruncated = 0
  wsStats.rejectedByAllowlist = 0
}

/**
 * ★★★已发生事件的状态缓存（#1093 真机实测抓出的**真 bug**）。
 *
 * 【问题】`open` 可能在 `await connect(...)` **resolve 之前**就由壳推到。
 *   而调用方的自然写法是「拿到句柄 → `ws.on('open', …)`」——
 *   等它订阅时，open 已经分发过了 ⇒ **回调永远不触发**（浏览器 WebSocket 不会这样：
 *   它把状态记在 `readyState` 上，且 open 后订阅的 listener 会立刻感知）。
 *   真机表现：连接**成功建立**（服务端日志有 conn#1 open），但探针等 open 超时。
 *
 * 【修法】按 id 记"已经发生过的事件"，`on()` 注册时若该事件已发生 ⇒ **立刻补调一次**。
 *   只缓存 `open` / `close` / `error`（状态型，各发生一次）；`message` 是流式，不缓存
 *   （缓存消息会导致重复投递，语义错误）。
 */
const happened = new Map<number, Map<EventName, unknown>>()

/** 归一壳推载荷（三端字段习惯不同：data / text / binary 都接受） */
function normalizeWsPush(payload: unknown): { id: number; event: EventName; payload?: unknown } | null {
  // ★★★#1093 真机抓出的根因：宿主用 `__proteusHostWs(<JSON 字符串>)` 推（JSONObject.quote 包了一层引号），
  //   而本函数只接受**对象** ⇒ `typeof payload === 'object'` 为 false ⇒ 返回 null ⇒
  //   dispatchWsPush 恒返回 0（连接明明通了、事件却永远到不了业务）。
  //   ⇒ 字符串入参先 JSON.parse（与键盘/传感器/录屏的载荷习惯一致：那几处宿主也传 JSON 串）。
  let normalized: unknown = payload
  if (typeof normalized === 'string') {
    try { normalized = JSON.parse(normalized) } catch { return null }
  }
  if (!normalized || typeof normalized !== 'object') return null
  const p = normalized as Record<string, unknown>
  const id = Number(p.id)
  if (!Number.isFinite(id)) return null
  const event = String(p.event ?? '')
  if (event !== 'open' && event !== 'message' && event !== 'close' && event !== 'error') return null
  if (event === 'message') {
    const data = p.data ?? p.text ?? p.binary
    return { id, event, payload: { data } }
  }
  if (event === 'close') return { id, event, payload: { code: p.code, reason: p.reason } }
  if (event === 'error') return { id, event, payload: { message: p.message ?? p.reason } }
  return { id, event, payload: { protocol: p.protocol } }
}

/**
 * 分发一条壳推（幂等安装；未知 id 静默忽略——可能是已 close 的连接）。
 * @returns 命中的订阅数（0 = 无主，通常是连接已关闭后的迟到消息）
 */
export function dispatchWsPush(payload: unknown): number {
  const n = normalizeWsPush(payload)
  // ★#1244：解析失败的推送也计数（否则"收到多少条"与"处理了多少条"对不上）
  if (!n) { wsStats.messagesDropped++; return 0 }
  wsStats.messagesReceived++
  // ★状态型事件（open/close/error）先记账——即使此刻没人订阅，晚到的 on() 也能补感知
  if (n.event !== 'message') {
    let s = happened.get(n.id)
    if (!s) { s = new Map(); happened.set(n.id, s) }
    s.set(n.event, n.payload)
  }
  const handlers = conns.get(n.id)?.get(n.event)
  if (!handlers || handlers.size === 0) {
    // ★#1244 ②：无主消息（连接已关 / 未知 id / 该事件无人订阅）⇒ 计入丢弃
    //   ★这不是错误（迟到消息是常态），但**必须可观测**——否则"消息丢了"永远查不出来。
    wsStats.messagesDropped++
    // ★close/error 之后清理该连接的全部订阅（防泄漏）
    if (n.event === 'close' || n.event === 'error') {
      conns.delete(n.id)
      happened.delete(n.id)
      if (n.event === 'close') releaseConnResource(n.id)
    }
    return 0
  }
  // ★★★#1244 ② 背压：给分发计时（慢订阅者会让**宿主线程**一直占着——见 WS_SLOW_DISPATCH_MS）
  const t0 = nowMs()
  const list = [...handlers]
  // ★② 单次分发上界：N 个慢订阅者串行 = 一条消息卡死整条通道 ⇒ 截断（**不丢订阅者**，下次一起收）
  const take = list.length > WS_MAX_DISPATCH_PER_PUSH ? WS_MAX_DISPATCH_PER_PUSH : list.length
  if (take < list.length) wsStats.dispatchTruncated++
  for (let i = 0; i < take; i++) {
    try {
      ;(list[i] as (p?: unknown) => void)(n.payload)
    } catch {
      /* 单个订阅者抛错不影响其它订阅者（订阅者边界） */
    }
  }
  const elapsed = nowMs() - t0
  wsStats.dispatchMs += elapsed
  if (elapsed >= WS_SLOW_DISPATCH_MS) wsStats.slowDispatches++
  if (n.event === 'close') {
    conns.delete(n.id)
    happened.delete(n.id)
    // ★#1094：连接真正关闭 ⇒ 资源账本销账（否则账本会把已关连接当泄漏）
    releaseConnResource(n.id)
  }
  return handlers.size
}

/** 装配壳推接收通道（幂等；已存在则保留）。 */
export function installWsChannel(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g[APP_WS_PUSH_KEY] === 'function') return
  try {
    g[APP_WS_PUSH_KEY] = (payload: unknown) => dispatchWsPush(payload)
  } catch {
    try {
      Object.defineProperty(g, APP_WS_PUSH_KEY, { value: (p: unknown) => dispatchWsPush(p), configurable: true, writable: true })
    } catch {
      /* 冻结环境（个别宿主）——通道装不上就保持 unsupported 语义，不抛 */
    }
  }
}

/** 测试用：清空所有连接订阅。 */
export function resetWsConnections(): void {
  conns.clear()
  happened.clear()
}

type R<T, E extends Error = ProteusCapError> = { ok: true; data: T } | { ok: false; error: E }

/** 统一错误构造（保证 `error.code` 一定存在——与 #1083 的 errOf 同款） */
function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/**
 * App 端 `connectWebSocket` 实现。
 *
 * @returns 连接句柄（`send`/`close`/`on`）；**句柄不等于已连上**——
 *   `open` 事件才是连接建立的证据（与浏览器 `WebSocket` 同语义）。
 */
export function createAppWebSocket(
  opts: {
    resources?: CapabilityResourceRegistry
    owner?: string
    /**
     * ★★★#1344 P4：**域名白名单**（与 HTTP 的 `TenantPolicy.allowedDomains` 同一份语义）。
     *
     * 【为什么 WS 必须有这一条（痛点 #15）】此前 WS 是"绕过全部加固"的通道：
     *   平台给 HTTP 配了域名白名单，业务换 `useWebSocket` 就能连任意域 ——
     *   而且 `wss://` 出网在审计里看起来"只是条连接"，实际是常驻双向通道（最能外传数据）。
     *   ★不配 ⇒ 不限制（白名单是可选增强，与 HTTP 同口径；否则现有业务全被拦死）。
     */
    allowedDomains?: string[]
  } = {},
): (url: string, protocols?: string[]) => Promise<WebSocketConnection> {
  installWsChannel()
  return async (url, protocols) => {
    /**
     * ★★★#1344 P4：**域名白名单必须在发起之前判**（与连接数上界同一个时机）。
     *   ★排在连接数上界**之前**：被白名单拒的连接根本不该占用并发额度
     *     （否则恶意域名刷满额度，把合法业务挤掉 —— 那等于用一个洞换另一个洞）。
     *   ★错误码 `websocket.forbidden`（不是 `unsupported`）：调用方传错了域，
     *     与"本端没这个能力"是两件事。
     */
    if (!isHostAllowed(url, opts.allowedDomains)) {
      wsStats.rejectedByAllowlist++
      throw errOf(
        'websocket.forbidden',
        `域名不在白名单内：${hostOf(url) || '(无法解析)'} —— 请用平台配置的允许域名，或联系平台加成`,
      )
    }
    // ★★★#1244 ④ 连接数上界：**在发起之前**判（先连上再拒 = 宿主 socket 已建、还得再关一次）
    if (conns.size >= WS_MAX_CONNECTIONS) {
      wsStats.rejectedConnections++
      throw errOf(
        'websocket.tooManyConnections',
        `并发连接已达上界 ${WS_MAX_CONNECTIONS}（当前 ${conns.size}）——疑似泄漏或异常重连`,
      )
    }
    const r = invokeHost(APP_WS_METHODS.open, { url, protocols: protocols ?? [] })
    if (!r.ok) {
      // ★missing ⇒ unsupported（该类业务的正常降级）；其它 ⇒ failed
      throw errOf(
        r.missing ? 'websocket.unsupported' : 'websocket.failed',
        `ws.open 失败：${r.reason}`,
      )
    }
    const d = (r.data ?? {}) as { id?: unknown; protocol?: unknown }
    const id = Number(d.id)
    if (!Number.isFinite(id) || id <= 0) {
      throw errOf('websocket.failed', `ws.open 未返回有效连接 id（收到 ${JSON.stringify(d)}）`)
    }
    const table = new Map<EventName, Set<(payload?: unknown) => void>>()
    conns.set(id, table)
    wsStats.connections = conns.size
    if (conns.size > wsStats.peakConnections) wsStats.peakConnections = conns.size
    // ★★★#1094：登记为**边界资源**（G-43.1 禁止无主资源）。
    //   释放钩子必须真的把连接关掉——只清本地表会让宿主侧 socket 泄漏。
    //   ★这也是"页面卸载但宿主没推 close"时的唯一回收路径（此前 conns 会永久留下）。
    if (opts.resources) {
      const res = opts.resources.register({
        type: 'ws-connection',
        owner: opts.owner,
        sourceLocation: 'packages/api/src/capability-websocket.ts',
        release: () => {
          try { invokeHost(APP_WS_METHODS.close, { id, code: 1001, reason: 'owner-dropped' }) } catch { /* 宿主不在也不阻断本地清理 */ }
          conns.delete(id)
          happened.delete(id)
          connResource.delete(id)
        },
      })
      connResource.set(id, { registry: opts.resources, resourceId: res.id })
    }
    const on = (event: EventName, handler: (payload?: unknown) => void): (() => void) => {
      let set = table.get(event)
      if (!set) { set = new Set(); table.set(event, set) }
      // ★★★#1244 ②⑤：单事件订阅者上界（同一事件挂太多 handler = 泄漏的典型形态）
      //   ★超限如实抛（不静默不挂）——静默不挂会让业务以为订阅成功了
      if (set.size >= WS_MAX_HANDLERS_PER_EVENT) {
        wsStats.rejectedHandlers++
        throw errOf(
          'websocket.tooManyHandlers',
          `事件 ${event} 的订阅者已达上界 ${WS_MAX_HANDLERS_PER_EVENT}——疑似未取消订阅`,
        )
      }
      set.add(handler)
      // ★补感知：该状态型事件**已经发生过** ⇒ 立刻回调一次
      //   （否则「await connect() 之后再 on('open')」会永久错过——真机实测的连接失败形态）
      const already = happened.get(id)
      if (already && already.has(event)) {
        const p = already.get(event)
        try { handler(p) } catch { /* 订阅者抛错不外溢 */ }
      }
      return () => { set!.delete(handler) }
    }
    return {
      send: (data) => {
        const isBinary = typeof data !== 'string'
        // ★★★#1244 ① 单条上限：与宿主同值（Android MAX_MESSAGE = 16 MiB）
        //   ★在 JS 侧也判一次：宿主超限会用 1009 关连接（副作用是整条连接没了），
        //     而业务只是"这条消息太大"——先在本地拒掉，连接保留。
        const bytes = isBinary ? (data as ArrayBuffer).byteLength : utf8LenOf(String(data))
        if (bytes > WS_MAX_SEND_BYTES) {
          wsStats.sendFailures++
          for (const h of [...(table.get('error') ?? [])]) {
            h({ message: `消息过大 ${bytes}B > ${WS_MAX_SEND_BYTES}B`, tooLarge: true })
          }
          return
        }
        const args = isBinary
          ? { id, binary: Array.from(new Uint8Array(data as ArrayBuffer)), binaryFlag: true }
          : { id, data }
        const s = invokeHost(APP_WS_METHODS.send, args)
        if (s.ok) { wsStats.messagesSent++ } else {
          wsStats.sendFailures++
          // ★发送失败**经 error 事件回报**（不抛：send 的签名是 void，与浏览器一致）
          for (const h of [...(table.get('error') ?? [])]) h({ message: s.reason, missing: s.missing })
          if (s.missing) conns.delete(id)
        }
      },
      close: (code, reason) => {
        invokeHost(APP_WS_METHODS.close, { id, code, reason })
        // ★不等于已断：真实 `close` 仍由壳推；这里只清理本地订阅的兜底在 dispatch 里做
      },
      on,
    }
  }
}

/** 探针用：当前活跃连接数（诊断读数）。 */
export function wsConnectionCount(): number {
  return conns.size
}

/**
 * 时钟（App 三端引擎无 `performance.now`；`Date.now` 精度足够判"是否超过 8ms"）。
 * ★★#1244：**可注入**（`__setWsClock`）——判据必须能确定性地造出"慢分发"，
 *   而不是靠真实耗时（本仓红线：禁止任何形式的盲等）。
 *   用假时钟 ⇒ 判据既确定又瞬时（不需要真的等 8ms）。
 */
let wsClock: () => number = () => Date.now()
function nowMs(): number {
  return wsClock()
}

/** 仅测试用：注入时钟（传 null 恢复 `Date.now`）。★生产不要调。 */
export function __setWsClock(fn: (() => number) | null): void {
  wsClock = fn ?? (() => Date.now())
}

/** UTF-8 字节长度（发送上限判定用；只算长度不真编码） */
function utf8LenOf(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

/**
 * ★#1094：连接 id → 所属账本 + 资源 id（close 时把登记项一并销账）。
 * ★为什么放在模块级：`dispatchWsPush` 是模块级函数，拿不到 `createAppWebSocket` 的闭包。
 */
const connResource = new Map<number, { registry: CapabilityResourceRegistry; resourceId: string }>()

/** close/error 时销账（幂等；未登记则无操作）。 */
export function releaseConnResource(id: number): boolean {
  const rec = connResource.get(id)
  if (!rec) return false
  connResource.delete(id)
  return rec.registry.release(rec.resourceId)
}

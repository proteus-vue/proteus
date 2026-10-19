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
  if (!n) return 0
  // ★状态型事件（open/close/error）先记账——即使此刻没人订阅，晚到的 on() 也能补感知
  if (n.event !== 'message') {
    let s = happened.get(n.id)
    if (!s) { s = new Map(); happened.set(n.id, s) }
    s.set(n.event, n.payload)
  }
  const handlers = conns.get(n.id)?.get(n.event)
  if (!handlers || handlers.size === 0) {
    // ★close/error 之后清理该连接的全部订阅（防泄漏）
    if (n.event === 'close' || n.event === 'error') {
      conns.delete(n.id)
      happened.delete(n.id)
      if (n.event === 'close') releaseConnResource(n.id)
    }
    return 0
  }
  for (const h of [...handlers]) {
    try {
      h(n.payload)
    } catch {
      /* 单个订阅者抛错不影响其它订阅者（订阅者边界） */
    }
  }
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
  opts: { resources?: CapabilityResourceRegistry; owner?: string } = {},
): (url: string, protocols?: string[]) => Promise<WebSocketConnection> {
  installWsChannel()
  return async (url, protocols) => {
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
        const args = isBinary
          ? { id, binary: Array.from(new Uint8Array(data as ArrayBuffer)), binaryFlag: true }
          : { id, data }
        const s = invokeHost(APP_WS_METHODS.send, args)
        if (!s.ok) {
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

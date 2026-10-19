// packages/api/src/capability-socket-task.ts
// ★★★决策 #1096（2026-10-19）：App 端 C28 `useSocketTask` —— **复用已验证的 WebSocket 腿**。
//
// 【为什么能复用（不是"偷懒"，是契约本来就重叠）】
//   `SocketTaskBridge`（wx `SocketTask` 语义）与本仓的 `WebSocketConnection`（C27）是**同一件事的两种形状**：
//     · SocketTask: `send/close/onMessage/isConnected`（低层句柄，同步拿、异步连）
//     · WebSocketConnection: `send/close/on(event)`（Web 语义，异步 connect）
//   App 端两者底层都是同一条 WebSocket（Android 手写 RFC 6455 / iOS `URLSessionWebSocketTask`）。
//   ⇒ 本文件只在 ws 之上做**形状适配**，不新增任何网络栈、不新增宿主方法。
//
// 【★关键形态差异（必须处理，否则语义错误）】
//   `createSocketTask(url)` 是**同步返回句柄**（wx 语义），而 `connect(url)` 是 **async**。
//   ⇒ 句柄立即返回（`isConnected()` 先为 false），内部异步 connect；连接建立后置 connected，
//     并把服务端消息转给 `onMessage` 订阅者。★这与浏览器 `new WebSocket()` 的同步返回 + 异步 open 同形。
//
// 【诚实边界】
//   · 连接失败 ⇒ **通过 error 语义暴露**：`send` 会 reject（`socket-task.failed`），
//     `isConnected()` 恒 false。不伪造"已连接"。
//   · `wx.SocketTask` 的 `onError`/`onClose` 在本契约里**没有对应成员**——
//     `SocketTaskBridge` 只声明了 `send/close/onMessage/isConnected`，故不额外扩展
//     （扩展等于改公共契约，属单独决策）。
//   · 只支持**文本**消息（契约 `send(data: string)`）——二进制走 C27 `useWebSocket`。

import { createAppWebSocket } from './capability-websocket'
import { CapError as ProteusCapError } from './capability-types'
import type { CapabilityResourceRegistry } from './capability-resources'
import type { SocketTaskBridge } from './capability-types'

/** 连接状态（一次连接的生命周期）。 */
type TaskState = 'connecting' | 'open' | 'failed' | 'closed'

/**
 * App 端 `createSocketTask`：同步返回句柄，内部异步连接。
 *
 * @param connFactory 带资源账本的 ws 工厂（由装配层注入，与 `useWebSocket` 同源）
 */
export function createAppSocketTask(
  connFactory: ReturnType<typeof createAppWebSocket>,
): (url: string) => SocketTaskBridge {
  return (url: string): SocketTaskBridge => {
    let state: TaskState = 'connecting'
    let lastError = ''
    const messageCbs = new Set<(data: string) => void>()
    /** 连接建立前积压的发送（wx 语义：`send` 在 connecting 期间也能调用，排队等连接） */
    const pendingSends: string[] = []
    let conn: { send: (d: string | ArrayBuffer) => void; close: (c?: number, r?: string) => void; on: (e: 'open' | 'message' | 'close' | 'error', h: (p?: unknown) => void) => () => void } | null = null

    connFactory(url).then(
      (ws) => {
        conn = ws
        ws.on('open', () => {
          state = 'open'
          // 连接建立后补发积压消息（顺序不变）
          for (const m of pendingSends.splice(0)) {
            try { ws.send(m) } catch { /* 单条失败不阻断其余 */ }
          }
        })
        ws.on('message', (p) => {
          // ★契约是文本消息：非字符串载荷（二进制）**不静默丢弃**，用空串之外的方式暴露
          const data = (p as { data?: unknown } | undefined)?.data
          if (typeof data === 'string') {
            for (const cb of [...messageCbs]) {
              try { cb(data) } catch { /* 单订阅者异常不影响其余 */ }
            }
          }
        })
        ws.on('close', () => { state = 'closed' })
        ws.on('error', (p) => {
          lastError = String((p as { message?: unknown } | undefined)?.message ?? 'websocket error')
          if (state === 'connecting') state = 'failed'
        })
      },
      (e: { code?: string, message?: string }) => {
        lastError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
        state = 'failed'
      },
    )

    return {
      send: (data: string): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          if (state === 'failed') return reject(errOf('socket-task.failed', `连接失败：${lastError}`))
          if (state === 'closed') return reject(errOf('socket-task.failed', '连接已关闭'))
          if (state === 'open' && conn) {
            try {
              conn.send(data)
              resolve()
            } catch (e) {
              reject(errOf('socket-task.failed', `发送失败：${String((e as Error)?.message ?? e)}`))
            }
            return
          }
          // ★connecting：排队等 open（wx 语义允许先发后连）
          pendingSends.push(data)
          resolve()
        }),

      close: (code?: number, reason?: string): Promise<void> =>
        new Promise<void>((resolve) => {
          if (conn) {
            try { conn.close(code, reason) } catch { /* 关闭失败不阻断（下面统一置态） */ }
          }
          state = 'closed'
          resolve()
        }),

      onMessage: (cb: (data: string) => void): (() => void) => {
        messageCbs.add(cb)
        return () => { messageCbs.delete(cb) }
      },

      isConnected: (): boolean => state === 'open',
    }
  }
}

function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/** 探针用：当前任务状态（诊断读数）。 */
export function socketTaskStateOf(task: SocketTaskBridge): string {
  return task.isConnected() ? 'open' : 'not-open'
}

/** 装配层可选传账本（当前实现**不额外登记**：连接由底层 ws 已登记为 `ws-connection`）。 */
export type SocketTaskOptions = { resources?: CapabilityResourceRegistry; owner?: string }

// packages/hmr/src/client.ts —— WebSocket 客户端（devtools-plus G-34 M1）
// 连接 Dev Server → 接收 HMR payload → 交给 HMR Runtime 按序应用；断线指数退避重连。
// ★注入式零依赖：createSocket 工厂（原生 WebSocket / mock 均可）；重连纯逻辑可单测。
import type { HmrEvent, HmrPayload } from './types'
import type { HmrRuntime } from './runtime'

/** WebSocket 形状（结构类型：原生 WebSocket / mock 均可注入） */
export interface HmrWebSocketLike {
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: (() => void) | null
  close(): void
}

export interface HmrClientOptions {
  /** Dev Server WebSocket 地址（如 ws://localhost:5174/__proteus_hmr__） */
  url: string
  runtime: HmrRuntime
  /** WebSocket 工厂（注入可单测；缺省 new WebSocket(url)） */
  createSocket?: (url: string) => HmrWebSocketLike
  /** 重连：maxAttempts（缺省 -1 无限）+ baseDelayMs（指数退避 baseDelayMs * 2^attempt，缺省 500） */
  reconnect?: { maxAttempts?: number; baseDelayMs?: number }
  onEvent?: (event: HmrEvent) => void
}

export interface HmrClient {
  connect(): void
  disconnect(): void
  /** 当前是否已连接 */
  readonly connected: boolean
  /** 已尝试的重连次数 */
  readonly attempt: number
}

export function createHmrClient(options: HmrClientOptions): HmrClient {
  const { url, runtime, onEvent } = options
  const createSocket = options.createSocket ?? ((u: string) => new WebSocket(u) as unknown as HmrWebSocketLike)
  const maxAttempts = options.reconnect?.maxAttempts ?? -1
  const baseDelayMs = options.reconnect?.baseDelayMs ?? 500

  let socket: HmrWebSocketLike | null = null
  let isOpen = false
  let closedByUser = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function emit(event: HmrEvent): void {
    onEvent?.(event)
  }

  function open(): void {
    let sock: HmrWebSocketLike
    try {
      sock = createSocket(url)
    } catch (err) {
      emit({ type: 'error', message: `WebSocket 创建失败：${String(err)}` })
      scheduleReconnect()
      return
    }
    socket = sock
    sock.onopen = () => {
      attempt = 0
      isOpen = true
      emit({ type: 'connected' })
    }
    sock.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as HmrPayload | HmrPayload[]
        // ★性能优化：批量消息（同文件合并 + 按序应用）走 applyBatch
        if (Array.isArray(data)) runtime.applyBatch(data)
        else runtime.apply(data)
      } catch (err) {
        emit({ type: 'error', message: `payload 解析失败：${String(err)}` })
      }
    }
    sock.onclose = (ev) => {
      isOpen = false
      emit({ type: 'disconnected', reason: ev.reason })
      if (!closedByUser) scheduleReconnect()
    }
    sock.onerror = () => {
      // 错误后 onclose 会跟随（标准 WebSocket 行为）
    }
  }

  function scheduleReconnect(): void {
    if (closedByUser) return
    if (maxAttempts >= 0 && attempt >= maxAttempts) {
      emit({ type: 'error', message: `重连超过最大次数（${maxAttempts}）` })
      return
    }
    const delayMs = baseDelayMs * 2 ** attempt
    attempt += 1
    emit({ type: 'reconnecting', attempt, delayMs })
    reconnectTimer = setTimeout(() => {
      open()
    }, delayMs)
  }

  return {
    connect(): void {
      closedByUser = false
      isOpen = false
      open()
    },
    disconnect(): void {
      closedByUser = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      socket?.close()
      socket = null
      isOpen = false
    },
    get connected() {
      return isOpen
    },
    get attempt() {
      return attempt
    },
  }
}

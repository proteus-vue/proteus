// packages/devtools/src/source.ts
// DevTools 数据源抽象（注入式）：本地 TraceBus 直连 / WS（CDP Proteus.* 协议，对接 @proteus-vue/hmr/cdp 桥）
import type { TraceEvent, TracePhase, TraceSource } from '@proteus-vue/devtools-runtime'
import type { TraceBus } from '@proteus-vue/devtools-runtime'

export interface DevtoolsSource {
  /** 订阅事件流，返回取消函数 */
  onEvent(cb: (e: TraceEvent) => void): () => void
  /** 订阅连接状态（可选）：WS 源连上即通知——面板「已连接」不再等首个事件（避免「连上了但暂无事件」误显示连接中） */
  onStatus?(cb: (s: DevtoolsSourceStatus) => void): () => void
  /** 应用信息（Proteus.appInfo：pages/依赖图数据源；WS 源请求缓存，TraceBus 源缺省） */
  appInfo?(): unknown
  /** ★M8 设备信息（Proteus.deviceInfo：环境/能力数据源；WS 源请求缓存，TraceBus 源缺省） */
  deviceInfo?(): unknown
  /** ★G-43 B4 所有权图（Proteus.ownership：视图数据源；WS 源请求缓存，TraceBus 源缺省） */
  ownership?(): unknown
  /** ★远程命令下发（WS 源：面板 → relay → 应用侧执行；如 Proteus.restoreStores 时间旅行恢复） */
  sendCommand?(method: string, params?: Record<string, unknown>): void
  close(): void
}

export type DevtoolsSourceStatus = 'connecting' | 'connected' | 'closed'

/** TraceBus 直连源：进程内 TraceBus 事件 → DevtoolsSource（Web 端运行时接入用） */
export function createTraceBusSource(bus: TraceBus): DevtoolsSource {
  return {
    onEvent(cb: (e: TraceEvent) => void): () => void {
      return bus.on(cb)
    },
    // 本地直连：进程内总线，状态恒已连接
    onStatus(cb: (s: DevtoolsSourceStatus) => void): () => void {
      cb('connected')
      return () => {}
    },
    close(): void {
      // TraceBus 由业务持有，close 不关闭总线
    },
  }
}

/** WS 数据源：连接 dev server → Proteus.enable → 接收 Proteus.event 重组 TraceEvent（断线 1s 重连） */
export function createDevtoolsWsSource(url: string, createSocket?: (url: string) => WebSocket): DevtoolsSource {
  const makeSocket = createSocket ?? ((u: string) => new WebSocket(u))
  const handlers: Array<(e: TraceEvent) => void> = []
  const statusHandlers: Array<(s: DevtoolsSourceStatus) => void> = []
  let ws: WebSocket | null = null
  let closed = false
  let seq = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let appInfoCache: unknown
  let status: DevtoolsSourceStatus = 'connecting'
  // ★命令确认跟踪：enable/appInfo 未收到响应 → 定时重发（面板先开、应用后连也能等到数据；CDP enable 语义）
  let enableId: number | null = null
  let appInfoId: number | null = null
  let enableAcked = false
  let retryTimer: ReturnType<typeof setInterval> | null = null
  // ★M8 设备面板：Proteus.deviceInfo 命令响应缓存（应用侧环境/能力上报）
  let deviceInfoId: number | null = null
  let deviceInfoCache: unknown
  // ★G-43 B4 所有权面板：Proteus.ownership 命令响应缓存
  let ownershipId: number | null = null
  let ownershipCache: unknown

  function setStatus(s: DevtoolsSourceStatus): void {
    status = s
    for (const h of statusHandlers) h(s)
  }

  /** 发 enable + appInfo（onopen 及未确认重试时调用） */
  function sendCommands(sock: { send(d: string): void }): void {
    enableId = ++seq
    enableAcked = false
    sock.send(JSON.stringify({ id: enableId, method: 'Proteus.enable' }))
    appInfoId = ++seq
    // ★appInfo（pages/依赖图数据）：请求路由表，响应缓存供 panel 注入
    sock.send(JSON.stringify({ id: appInfoId, method: 'Proteus.appInfo' }))
    deviceInfoId = ++seq
    // ★M8 设备面板：请求环境/能力信息，响应缓存供 panel 注入
    sock.send(JSON.stringify({ id: deviceInfoId, method: 'Proteus.deviceInfo' }))
    ownershipId = ++seq
    // ★G-43 B4 所有权面板：请求所有权视图数据，响应缓存供 panel 注入
    sock.send(JSON.stringify({ id: ownershipId, method: 'Proteus.ownership' }))
  }

  /** ★远程命令下发（时间旅行恢复等：面板 → relay → 应用侧执行） */
  function sendCommand(method: string, params?: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ id: ++seq, method, params }))
  }

  function startRetry(): void {
    if (retryTimer) return
    retryTimer = setInterval(() => {
      // ★enable 未确认（relay 里尚无 source 时命令被丢弃）→ 重发，直到应用连上响应
      if (closed || !ws || ws.readyState !== WebSocket.OPEN || enableAcked) return
      sendCommands(ws)
    }, 2000)
  }

  function connect(): void {
    if (closed) return
    try {
      ws = makeSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    const sock = ws
    sock.onopen = () => {
      setStatus('connected')
      sendCommands(sock)
      startRetry()
    }
    sock.onmessage = (ev) => {
      let msg: { id?: number; method?: string; result?: unknown; params?: Record<string, unknown> }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      // ★enable 响应（bridge 回放后回 result）→ 标记确认；不写 appInfoCache（避免覆盖真实路由表）
      if (msg.id === enableId && msg.result !== undefined) {
        enableAcked = true
        return
      }
      // appInfo 命令响应 → 缓存
      if (msg.id === appInfoId && msg.result !== undefined) {
        appInfoCache = msg.result
        return
      }
      // ★M8：deviceInfo 命令响应 → 缓存
      if (msg.id === deviceInfoId && msg.result !== undefined) {
        deviceInfoCache = msg.result
        return
      }
      // ★G-43 B4：ownership 命令响应 → 缓存
      if (msg.id === ownershipId && msg.result !== undefined) {
        ownershipCache = msg.result
        return
      }
      if (msg.method !== 'Proteus.event') return
      const p = msg.params ?? {}
      const source = p.source as TraceSource | undefined
      const name = p.name as string | undefined
      if (!source || !name) return
      const event: TraceEvent = {
        source,
        phase: (p.phase as TracePhase | undefined) ?? 'point',
        name,
        payload: p.payload,
        timestamp: (p.timestamp as number | undefined) ?? Date.now(),
        traceId: p.traceId as string | undefined,
      }
      for (const h of handlers) h(event)
    }
    sock.onclose = () => {
      setStatus('closed')
      if (!closed) scheduleReconnect()
    }
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 1000)
  }

  connect()

  return {
    onEvent(cb: (e: TraceEvent) => void): () => void {
      handlers.push(cb)
      return () => {
        const i = handlers.indexOf(cb)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    onStatus(cb: (s: DevtoolsSourceStatus) => void): () => void {
      statusHandlers.push(cb)
      cb(status)
      return () => {
        const i = statusHandlers.indexOf(cb)
        if (i >= 0) statusHandlers.splice(i, 1)
      }
    },
    close(): void {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (retryTimer) {
        clearInterval(retryTimer)
        retryTimer = null
      }
      ws?.close()
      ws = null
    },
    appInfo() {
      return appInfoCache
    },
    /** ★M8：设备信息（环境/能力；Proteus.deviceInfo 命令响应缓存；未确认前 undefined） */
    deviceInfo() {
      return deviceInfoCache
    },
    /** ★G-43 B4：所有权视图数据（Proteus.ownership 命令响应缓存；未确认前 undefined） */
    ownership() {
      return ownershipCache
    },
    sendCommand,
  }
}

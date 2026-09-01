// packages/devtools/src/source.ts
// DevTools 数据源抽象（注入式）：本地 TraceBus 直连 / WS（CDP Proteus.* 协议，对接 @proteus-vue/hmr/cdp 桥）
import type { TraceEvent, TracePhase, TraceSource } from '@proteus-vue/devtools-runtime'
import type { TraceBus } from '@proteus-vue/devtools-runtime'

export interface DevtoolsSource {
  /** 订阅事件流，返回取消函数 */
  onEvent(cb: (e: TraceEvent) => void): () => void
  /** 应用信息（Proteus.appInfo：pages/依赖图数据源；WS 源请求缓存，TraceBus 源缺省） */
  appInfo?(): unknown
  close(): void
}

/** TraceBus 直连源：进程内 TraceBus 事件 → DevtoolsSource（Web 端运行时接入用） */
export function createTraceBusSource(bus: TraceBus): DevtoolsSource {
  return {
    onEvent(cb: (e: TraceEvent) => void): () => void {
      return bus.on(cb)
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
  let ws: WebSocket | null = null
  let closed = false
  let seq = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let appInfoCache: unknown

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
      sock.send(JSON.stringify({ id: ++seq, method: 'Proteus.enable' }))
      // ★appInfo（pages/依赖图数据）：请求路由表，响应缓存供 panel 注入
      sock.send(JSON.stringify({ id: ++seq, method: 'Proteus.appInfo' }))
    }
    sock.onmessage = (ev) => {
      let msg: { id?: number; method?: string; result?: unknown; params?: Record<string, unknown> }
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      // appInfo 命令响应（含 id 且无 method）→ 缓存
      if (msg.id !== undefined && msg.result !== undefined) {
        appInfoCache = msg.result
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
    close(): void {
      closed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      ws?.close()
      ws = null
    },
    appInfo() {
      return appInfoCache
    },
  }
}

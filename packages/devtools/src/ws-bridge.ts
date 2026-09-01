// packages/devtools/src/ws-bridge.ts
// devtools 远程查看桥（浏览器侧）：TraceBus 事件 → WS（/proteus-source）上行 → 电脑端 panel.html 下行查看
//   ——手机/桌面浏览器跑应用，面板在电脑上看（devtools-plan M11 雏形）
// 协议复用 dev-server CDP 桥 Proteus.* 形状：上行 Proteus.event；响应 Proteus.enable / Proteus.appInfo 命令
import type { TraceBus, TraceEvent } from '@proteus-vue/devtools-runtime'

export interface TraceBusWsBridgeOptions {
  /** WS 地址（如 ws://host/proteus-source——由 devtoolsRelayPlugin 提供端点） */
  url: string
  /** Proteus.appInfo 响应（面板 pages/依赖图数据；缺省空对象） */
  appInfo?: () => unknown
}

export interface TraceBusWsBridge {
  close(): void
}

/** 创建 TraceBus → WS 桥（业务侧 installProteusDevtools remote 选项内部使用；也可独立接入） */
export function createTraceBusWsBridge(bus: TraceBus, options: TraceBusWsBridgeOptions): TraceBusWsBridge {
  const ws = new WebSocket(options.url)
  function sendEvent(e: TraceEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(
      JSON.stringify({
        method: 'Proteus.event',
        params: { source: e.source, phase: e.phase, name: e.name, payload: e.payload, timestamp: e.timestamp, traceId: e.traceId },
      }),
    )
  }
  const off = bus.on((e) => sendEvent(e))
  ws.onmessage = (ev) => {
    let msg: { id?: number; method?: string } | null = null
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.method === 'Proteus.enable') {
      // ★历史回放：面板（重）连接时补发缓冲内已 emit 事件——面板后开/重连立即有数据（生命周期/路由早已 emit）
      //   CDP enable 语义；缓冲被 flush 清空 + bus.on 实时订阅 → 无重复
      for (const e of bus.flush()) sendEvent(e)
      ws.send(JSON.stringify({ id: msg.id, result: {} }))
    } else if (msg.method === 'Proteus.appInfo') {
      ws.send(JSON.stringify({ id: msg.id, result: options.appInfo ? options.appInfo() : {} }))
    }
  }
  return {
    close() {
      off()
      ws.close()
    },
  }
}

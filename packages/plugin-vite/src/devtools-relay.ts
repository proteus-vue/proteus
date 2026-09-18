// packages/plugin-vite/src/devtools-relay.ts
// devtools 远程查看中转（devtools-plan M11 可观测性雏形）：应用侧 TraceBus → WS → 电脑端 panel.html
//   双通道（URL path 区分）：`/proteus-source`（应用桥连接）/ `/proteus-panel`（面板连接）
//   路由：面板 CDP 命令（Proteus.enable/appInfo）→ 转发 source；source 响应按命令 id 路由回原面板；
//         source 的 Proteus.event → 广播所有面板
// ★纯逻辑（socket 结构类型注入，可单测）；协议复用 dev-server CDP 桥的 Proteus.* 形状
import type { WebSocket } from 'ws'

export type RelayRole = 'source' | 'panel'

export interface RelaySocket {
  send(data: string): void
  close(): void
  readonly readyState: number
}

export interface ProteusRelay {
  /** 新连接（role 由 WS URL path 决定） */
  handleConnection(role: RelayRole, socket: RelaySocket): void
  /** 连接数（诊断） */
  counts(): { source: number; panel: number }
  /** 关闭全部（dev server 退出） */
  close(): void
}

/** 创建事件中转（纯逻辑：socket 只暴露 send/close/readyState——ws 库 WebSocket 天然符合） */
export function createProteusRelay(): ProteusRelay {
  const sources = new Set<RelaySocket>()
  const panels = new Set<RelaySocket>()
  /** 面板命令 pending：命令 id → 发起面板（source 响应按 id 路由回） */
  const pending = new Map<number, RelaySocket>()

  function onMessage(role: RelayRole, socket: RelaySocket, raw: string): void {
    let msg: { id?: number; method?: string } | null = null
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (role === 'source') {
      // source 响应（带 id 且是 pending 的命令）→ 路由回原面板；否则广播（Proteus.event 等）
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        const target = pending.get(msg.id) as RelaySocket
        pending.delete(msg.id)
        target.send(raw)
        return
      }
      for (const p of panels) p.send(raw)
      return
    }
    // panel：CDP 命令（Proteus.enable/appInfo）→ 转发第一个 source（记 pending 等响应）
    if (typeof msg.id === 'number' && sources.size > 0) {
      pending.set(msg.id, socket)
      const first = sources.values().next().value as RelaySocket
      first.send(raw)
    }
  }

  function onClose(socket: RelaySocket): void {
    sources.delete(socket)
    panels.delete(socket)
    for (const entry of pending) {
      if (entry[1] === socket) pending.delete(entry[0])
    }
  }

  return {
    handleConnection(role, socket) {
      ;(role === 'source' ? sources : panels).add(socket)
      // 挂接 onmessage/onclose：ws 库 WebSocket 的 on 接口（结构类型——socket 需带 on 方法）
      const withOn = socket as RelaySocket & { on?: (event: string, cb: (data: unknown) => void) => void }
      if (typeof withOn.on === 'function') {
        withOn.on('message', (data) => onMessage(role, socket, String(data)))
        withOn.on('close', () => onClose(socket))
      }
    },
    counts() {
      return { source: sources.size, panel: panels.size }
    },
    close() {
      for (const s of sources) s.close()
      for (const p of panels) p.close()
      sources.clear()
      panels.clear()
      pending.clear()
    },
  }
}

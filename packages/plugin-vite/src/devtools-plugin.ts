// packages/plugin-vite/src/devtools-plugin.ts
// devtools 远程查看 vite 插件（devtools-plan M11 雏形）：dev server 起 WS 中转（/proteus-source + /proteus-panel）
//   手机/桌面浏览器跑应用（createTraceBusWsBridge 上行）→ 电脑浏览器 panel.html?ws=ws://host/proteus-panel 下行查看
import type { Plugin } from 'vite'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { createProteusRelay } from './devtools-relay'

export interface DevtoolsRelayOptions {
  /** 显式关闭（缺省 dev serve 模式开启） */
  enabled?: boolean
}

/**
 * devtools 远程中转插件：vite dev server 加 WS 端点
 *   `/proteus-source` —— 应用侧 TraceBus 桥（createTraceBusWsBridge）连接
 *   `/proteus-panel`  —— panel.html?ws= 面板连接
 * 仅 dev serve 生效（apply: 'serve'），build 零产物。
 */
export function devtoolsRelayPlugin(opts: DevtoolsRelayOptions = {}): Plugin {
  let wss: WebSocketServer | null = null
  let relay: ReturnType<typeof createProteusRelay> | null = null

  /** ★结构类型：ViteDevServer/PreviewServer 的 httpServer 泛型不同——只取 upgrade 事件面 */
  function setup(server: { httpServer?: unknown }): void {
    const httpServer = server.httpServer as
      | { on: (event: string, cb: (req: { url?: string }, socket: unknown, head: unknown) => void) => void }
      | null
      | undefined
    if (!httpServer) return
    relay = createProteusRelay()
    wss = new WebSocketServer({ noServer: true })
    httpServer.on('upgrade', (req, socket, head) => {
      const url = String((req as { url?: string }).url ?? '').split('?')[0]
      const role = url === '/proteus-source' ? ('source' as const) : url === '/proteus-panel' ? ('panel' as const) : null
      if (!role || !relay) return
      // ★upgrade 回调的 req/socket/head 结构类型收窄后需还原为 ws 期望形状
      wss?.handleUpgrade(req as never, socket as never, head as never, (ws: WebSocket) => {
        wss?.emit('connection', ws, req)
        relay?.handleConnection(role, ws as never)
      })
    })
  }

  return {
    name: 'proteus-devtools-relay',
    apply: 'serve',
    configureServer(server) {
      if (opts.enabled === false || relay) return
      setup(server)
    },
    configurePreviewServer(server) {
      if (opts.enabled === false || relay) return
      setup(server)
    },
    closeBundle() {
      wss?.close()
      relay?.close()
      wss = null
      relay = null
    },
  }
}

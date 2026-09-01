// packages/plugin-vite/src/devtools-plugin.ts
// devtools 远程查看 vite 插件（devtools-plan M11 雏形）：
//   ① WS 中转（/proteus-source + /proteus-panel）——手机/桌面浏览器跑应用（createTraceBusWsBridge 上行）
//     → 电脑浏览器 panel.html?ws=ws://host/proteus-panel 下行查看
//   ② ★面板页面端点 /proteus-devtools——vite dev 直接浏览器打开面板（开发者无需点 node_modules 里的 panel.html）；
//      HTML 注入当前 host 的 /proteus-panel 为默认 WS 地址（?ws= 仍可覆盖），资源路径重写为绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { createProteusRelay } from './devtools-relay'

export interface DevtoolsRelayOptions {
  /** 显式关闭（缺省 dev serve 模式开启） */
  enabled?: boolean
}

const require_ = createRequire(import.meta.url)

/** 解析 @proteus-vue/devtools 包目录（panel.html / style.css / dist/panel.js 所在） */
export function resolveDevtoolsDir(): string {
  return path.dirname(require_.resolve('@proteus-vue/devtools/package.json'))
}

/** 面板页面处理器（纯逻辑，req/res 结构注入可单测）：/proteus-devtools → panel.html（注入 WS 默认 + 资源路径重写） */
export function createPanelPageHandler(devtoolsDir: string): (req: { url?: string; headers?: Record<string, string | undefined> }, res: {
  setHeader(k: string, v: string): void
  end(data: string | Buffer): void
}) => boolean {
  return (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    const base = '/proteus-devtools'
    if (pathname === base || pathname === base + '/') {
      // ★占位符全局唯一替换：panel.html 里 ws://127.0.0.1:5174/ 出现多次（注释+JS 默认值），
      //   旧实现 replace 只替换第一个（命中注释）→ JS 默认值漏替换 → 面板连 5174 端口永远连接中；
      //   占位符也用 /g 全局替换（JS 三元里出现两次），避免重复踩坑
      const host = req.headers?.host ?? 'localhost'
      const proto = req.headers?.['x-forwarded-proto'] === 'https' ? 'wss' : 'ws'
      const html = fs
        .readFileSync(path.join(devtoolsDir, 'panel.html'), 'utf8')
        .replace(/__PROTEUS_DEFAULT_WS__/g, `'${proto}://${host}/proteus-panel'`)
        .replace('./style.css', base + '/style.css')
        .replace('./dist/panel.js', base + '/panel.js')
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(html)
      return true
    }
    if (pathname === base + '/style.css') {
      res.setHeader('content-type', 'text/css; charset=utf-8')
      res.end(fs.readFileSync(path.join(devtoolsDir, 'style.css')))
      return true
    }
    if (pathname === base + '/panel.js') {
      res.setHeader('content-type', 'application/javascript; charset=utf-8')
      res.end(fs.readFileSync(path.join(devtoolsDir, 'dist', 'panel.js')))
      return true
    }
    return false
  }
}

/**
 * 启动后打印面板地址（vite 启动输出里提示开发者：devtools 面板在 /proteus-devtools）
 * 纯逻辑（httpServer/logger 结构注入可单测）；listening 事件后取实际端口（port 0 随机时准确）
 */
export function printPanelUrl(
  httpServer: { once?: (event: string, cb: () => void) => void; address?: () => unknown } | undefined | null,
  logger: { info: (msg: string) => void } | undefined | null,
  defaultPort = 5173,
): void {
  if (!httpServer || typeof httpServer.once !== 'function') return
  httpServer.once('listening', () => {
    const addr = httpServer.address?.()
    const port = typeof addr === 'object' && addr !== null ? (addr as { port?: number }).port : undefined
    logger?.info(`  ➜  Proteus DevTools:  http://localhost:${port ?? defaultPort}/proteus-devtools`)
  })
}

/**
 * devtools 远程中转 + 面板页面插件：
 *   `/proteus-source`（应用桥）/ `/proteus-panel`（面板 WS）/ `/proteus-devtools`（面板页面）
 * 仅 dev serve 生效（apply: 'serve'），build 零产物。
 */
export function devtoolsRelayPlugin(opts: DevtoolsRelayOptions = {}): Plugin {
  let wss: WebSocketServer | null = null
  let relay: ReturnType<typeof createProteusRelay> | null = null
  let pageHandler: ReturnType<typeof createPanelPageHandler> | null = null

  /** ★结构类型：ViteDevServer/PreviewServer 的 httpServer 泛型不同——只取 upgrade 事件面 */
  function setup(server: { httpServer?: unknown; middlewares?: unknown }): void {
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
    // ★面板页面端点（vite 内部中间件之前注册 → 拦截 /proteus-devtools 不被 spa fallback 吞掉）
    pageHandler = createPanelPageHandler(resolveDevtoolsDir())
    const middlewares = server.middlewares as
      | { use?: (fn: (req: { url?: string; headers?: Record<string, string | undefined> }, res: { setHeader(k: string, v: string): void; end(d: string | Buffer): void }, next: () => void) => void) => void }
      | undefined
    middlewares?.use?.((req, res, next) => {
      if (pageHandler && pageHandler(req, res)) return
      next()
    })
  }

  return {
    name: 'proteus-devtools-relay',
    apply: 'serve',
    configureServer(server) {
      if (opts.enabled === false || relay) return
      setup(server)
      // ★启动后打印面板地址（开发者无需记 /proteus-devtools 路径）
      const httpServer = (server as { httpServer?: unknown }).httpServer
      const logger = (server as { config?: { logger?: { info: (msg: string) => void } } }).config?.logger
      printPanelUrl(httpServer as never, logger)
    },
    configurePreviewServer(server) {
      if (opts.enabled === false || relay) return
      setup(server)
      const httpServer = (server as { httpServer?: unknown }).httpServer
      const logger = (server as { config?: { logger?: { info: (msg: string) => void } } }).config?.logger
      printPanelUrl(httpServer as never, logger)
    },
    closeBundle() {
      wss?.close()
      relay?.close()
      wss = null
      relay = null
      pageHandler = null
    },
  }
}

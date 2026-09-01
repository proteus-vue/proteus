// packages/hmr/src/dev-server/index.ts —— HMR Dev Server（devtools-plus G-34 收尾：编译侧增量闭环）
// ★Node-only 子路径（'@proteus-vue/hmr/dev-server'）：WS 服务端 + 文件 watch 防抖管线 + 增量编译回调注入
//   链路：保存文件 → watch 收集 → 防抖合并 → compile(files) 增量编译 → broadcast(HmrPayload[]) → 客户端 HMR Runtime 应用
//   编译回调由调用方注入（CLI 接 @proteus-vue/compiler.compileVueSfc 单文件增量；测试注入 mock）
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type { HmrPayload } from '../types'
import { createCdpBridge } from '../cdp'
import type { CdpBridge, CdpMessage, ProteusDevEvent } from '../cdp'

/** Dev Server 可观测事件（原则 #3 编译透明：编译→推送全链路可见） */
export type HmrDevServerEvent =
  | { type: 'listening'; port: number }
  | { type: 'client-connect'; clientCount: number }
  | { type: 'client-disconnect'; clientCount: number }
  | { type: 'files-changed'; files: string[] }
  | { type: 'compiled'; payloads: HmrPayload[] }
  | { type: 'broadcast'; payloads: HmrPayload[] }
  | { type: 'error'; message: string }

export interface HmrDevServerOptions {
  /** WS 监听端口（0 = 随机） */
  port: number
  /** WS 监听主机（缺省 127.0.0.1——开发工具本机服务；★显式 IPv4 避免双栈 `::` 绑定下 IPv4 连接不达） */
  host?: string
  /** 监听根目录（文件变更触发增量编译 + 广播） */
  watchRoots: string[]
  /** 忽略规则（返回 true 跳过；缺省忽略 node_modules/dist/.git 与隐藏文件） */
  ignore?: (file: string) => boolean
  /** 防抖毫秒（缺省 300——一次保存的多文件变更合并为一批） */
  debounceMs?: number
  /** ★增量编译回调：变更文件集合 → 增量 payload（编译侧注入） */
  compile: (files: string[]) => HmrPayload[]
  /** ★DevTools 面板 CDP 桥：Runtime.evaluate 执行器（可选——未注入时面板 evaluate 返回错误） */
  evaluate?: (expression: string) => Promise<unknown>
  /** 外部 TraceBus 事件注入（可选——面板 Proteus.event 通道数据源） */
  traceSource?: () => Array<{ source: string; phase: string; name: string; payload?: unknown; timestamp: number; traceId?: string }>
  /** 可观测 */
  onEvent?: (event: HmrDevServerEvent) => void
}

export interface HmrDevServer {
  /** 启动（WS 监听 + watch） */
  start(): Promise<void>
  /** 停止（关闭 WS + 解绑 watch） */
  close(): Promise<void>
  /** 手动广播 payload（不经过编译管线） */
  broadcast(payloads: HmrPayload[]): void
  /** WS 端口 */
  readonly port: number
  /** 当前连接客户端数 */
  readonly clientCount: number
}

function defaultIgnore(file: string): boolean {
  const name = path.basename(file)
  if (name.startsWith('.')) return true
  return /(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/.test(file)
}

export function createHmrDevServer(options: HmrDevServerOptions): HmrDevServer {
  const { port, watchRoots, compile, onEvent } = options
  const host = options.host ?? '127.0.0.1'
  const debounceMs = options.debounceMs ?? 300
  const ignore = options.ignore ?? defaultIgnore

  let wss: WebSocketServer | null = null
  const watchers: fs.FSWatcher[] = []
  const clients = new Set<WebSocket>()
  /** ★DevTools CDP 桥（per-client：transport 直发对应 socket） */
  const bridges = new Map<WebSocket, CdpBridge>()
  let timer: ReturnType<typeof setTimeout> | null = null
  /** 防抖窗口内收集的变更文件（去重） */
  const pendingFiles = new Set<string>()

  function emit(event: HmrDevServerEvent): void {
    onEvent?.(event)
  }

  /** ★把 Proteus 事件推给所有已启用的 CDP 桥（面板 Proteus.event 通道） */
  function pushBridges(devEvent: ProteusDevEvent): void {
    for (const bridge of bridges.values()) bridge.push(devEvent)
  }

  /** ★外部 TraceBus 事件 → Proteus.event 推送（面板数据源） */
  function pushTraceEvents(): void {
    const traces = options.traceSource?.()
    if (!traces) return
    for (const t of traces) {
      pushBridges({ kind: 'trace', event: t })
    }
  }

  /** 防抖窗口结束 → 增量编译 + 广播 */
  function flush(): void {
    timer = null
    // ★过滤目录级事件（递归 watch 会附带父目录条目）：只保留真实存在的文件
    const files = Array.from(pendingFiles).filter((f) => {
      try {
        return fs.existsSync(f) && fs.statSync(f).isFile()
      } catch {
        return false
      }
    })
    pendingFiles.clear()
    if (files.length === 0) return
    emit({ type: 'files-changed', files })
    pushBridges({ kind: 'trace', event: { source: 'compiler', phase: 'start', name: 'watch files', payload: { count: files.length }, timestamp: Date.now() } })
    let payloads: HmrPayload[]
    try {
      payloads = compile(files)
    } catch (err) {
      emit({ type: 'error', message: `增量编译失败：${String(err)}` })
      return
    }
    if (payloads.length === 0) return
    emit({ type: 'compiled', payloads })
    pushBridges({ kind: 'trace', event: { source: 'compiler', phase: 'end', name: 'incremental compile', payload: { count: payloads.length }, timestamp: Date.now() } })
    broadcast(payloads)
  }

  function schedule(file: string): void {
    if (ignore(file)) return
    pendingFiles.add(file)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  function watchRoot(dir: string): void {
    if (!fs.existsSync(dir)) return
    try {
      const watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
        if (file) schedule(path.join(dir, file.toString()))
      })
      watchers.push(watcher)
    } catch {
      // 个别目录 watch 失败不阻塞（权限/平台差异）
    }
  }

  function broadcast(payloads: HmrPayload[]): void {
    emit({ type: 'broadcast', payloads })
    pushBridges({ kind: 'trace', event: { source: 'hmr', phase: 'point', name: 'hmr broadcast', payload: { count: payloads.length }, timestamp: Date.now() } })
    const data = JSON.stringify(payloads.length === 1 ? payloads[0] : payloads)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data)
    }
  }

  return {
    get port() {
      // ★实际监听端口（port 0 随机分配时取真实值）
      const addr = wss?.address()
      return typeof addr === 'object' && addr !== null ? addr.port : options.port
    },
    get clientCount() {
      return clients.size
    },
    async start(): Promise<void> {
      if (wss) return
      wss = new WebSocketServer({ port, host })
      wss.on('connection', (socket) => {
        clients.add(socket)
        emit({ type: 'client-connect', clientCount: clients.size })
        // ★DevTools CDP 桥：per-client 实例（transport 直发对应 socket；evaluate 注入）
        const bridge = createCdpBridge({
          transport: {
            send: (m: CdpMessage) => {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m))
            },
          },
          evaluate: options.evaluate,
        })
        bridges.set(socket, bridge)
        socket.on('message', (data) => {
          try {
            const msg = JSON.parse(String(data)) as CdpMessage
            if (msg && typeof msg === 'object' && 'method' in msg) bridge.handleMessage(msg)
          } catch {
            // 非 CDP 形状消息忽略（HMR payload 走广播通道，不经桥）
          }
        })
        socket.on('close', () => {
          clients.delete(socket)
          bridges.delete(socket)
          emit({ type: 'client-disconnect', clientCount: clients.size })
        })
        pushTraceEvents()
      })
      await new Promise<void>((resolve) => {
        wss?.once('listening', () => {
          emit({ type: 'listening', port })
          resolve()
        })
      })
      // ★watch 根目录：既有目录立即监听，缺失目录后续出现不阻塞
      for (const root of watchRoots) {
        if (fs.existsSync(root)) watchRoot(root)
      }
    },
    async close(): Promise<void> {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pendingFiles.clear()
      for (const watcher of watchers) watcher.close()
      watchers.length = 0
      for (const client of clients) client.close()
      clients.clear()
      if (wss) {
        await new Promise<void>((resolve) => {
          wss?.close(() => resolve())
          // 无活跃连接时 close 回调可能不触发——超时兜底
          setTimeout(() => resolve(), 100)
        })
        wss = null
      }
    },
    broadcast,
  }
}

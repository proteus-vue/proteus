// packages/cli/src/app-dev-server.ts —— ★★★完整宿主 · App 端 dev server（2026-10-08）
//
// 【它补什么（用户「dev 模式实时刷新 App 宿主页面内容」）】App 宿主此前**无任何 dev 通道**
//   （实测：三端宿主 grep dev server/localhost/ws/fetch 零命中）⇒ 改一页必须重编打包重装。
//   本模块提供 **HTTP dev server**：宿主（dev 变体）长连它，源码一变 ⇒ 重建 bundle ⇒ 推版本号 ⇒
//   宿主重拉 bundle 并热重载（`AppActivity.startDevWatch` → `/version` 变化 → `/bundle` → hotReload）。
//
// 【协议（极简、无第三方依赖）】
//   GET /health   → `{"ok":true,"version":N}`（探活）
//   GET /version  → `N`（纯文本版本号——宿主轮询它判"是否变了"，变化即拉 bundle）
//   GET /bundle   → bundle-superapp.js 全文（text/javascript；每次请求现读盘，取最新）
//   ★为什么用"轮询 /version"而不是 SSE/WebSocket：宿主侧三端（Kotlin/Swift/ArkTS）各要一套长连与重连
//     实现，而**轮询一个有界小响应**在三端都只需十几行（且与"有界 + 条件"的效率纪律一致：
//     每秒一次 30 字节，远低于任何长连的心跳开销）。★诚实边界：这是**轮询**而非 push；后续可加 SSE（协议已预留 version 语义）。
//
// 【watch】用 `fs.watch`（递归）监听项目源码目录（pages/router/styles/App.vue 等），防抖后重建。
//   重建走 `buildAppBundle`（与 `build` 命令**同一实现**——一处实现，dev 与 build 产物同构）。
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { buildAppBundle } from './app-bundle'
import { appBundleFile, type AppPlatform } from './targets'
import { resolveAppRoutes } from './app-routes'
import { renderDevtoolsPage } from './app-devtools-page'

export interface AppDevServerOptions {
  projectRoot: string
  platform: AppPlatform
  /** 端口（0/缺省 = 自动选空闲端口） */
  port?: number
  /** 监听主机（缺省 0.0.0.0——真机需从局域网访问本机） */
  host?: string
  /** 每次重建的回调（日志/进度） */
  onRebuild?: (info: { version: number; bytes: number; ms: number; reason: string }) => void
}

export interface AppDevServer {
  /** dev server 基址（**局域网**可访问；宿主用它拉 bundle） */
  url: string
  port: number
  /** 当前 bundle 版本号（单调递增） */
  version(): number
  /** 实际监听到的源码根（相对项目根；供 CLI UI 打"watch 就绪"行） */
  watchRoots: string[]
  /** 关闭 server + 停 watch */
  close(): Promise<void>
}

/** 取本机**非回环** IPv4（真机经局域网访问本机 dev server 用；无则回落 127.0.0.1）。 */
export function lanAddress(): string {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return '127.0.0.1'
}

/**
 * 计算需要监听的项目源码根（**按项目布局/配置**，不是硬编码根目录名）。
 *
 * ★★★为什么（决策 #667 · 用户实测「dev 热刷链路」）：此前硬编码 `pages`/`router`/`App.vue` 于**项目根**——
 *   而 create-proteus 模板把它们放在 **`src/`** 下（`src/pages`、`src/router`、`src/App.vue`）⇒
 *   候选全不存在 ⇒ **监听列表为空** ⇒ dev server 起来了但**永不重建**（热刷静默失效）。
 *   主仓工程（css-conformance/superapp）恰好是根形态 ⇒ 框架内测全绿、真用户断（同 #664 D1 的
 *   「靠主仓布局巧合满足才隐身」）。
 *   修法：honor 配置（`pagesDir`/`router.routesOutput`/`globalStyle`）**并**兜底整棵 `src/`（模板形态）。
 *   返回值为「监听根」（目录递归 / 文件单点）；祖先已在集合时跳过后代（避免重复监听）。
 */
export async function resolveWatchRoots(projectRoot: string): Promise<string[]> {
  const cands: string[] = []
  const push = (p: string): void => { if (p && fs.existsSync(p)) cands.push(p) }
  // ① 模板形态：整棵 `src/`（src/pages、src/router、src/App.vue、src/styles 全在内）
  push(path.join(projectRoot, 'src'))
  // ② 配置驱动（根形态工程：pages/、router/、styles/）——honor 配置（同 #664 D1 的单一口径）
  let config: { pagesDir?: string; targets?: { mp?: { globalStyle?: string } } } | undefined
  let routesDir: string | undefined
  try {
    const r = await resolveAppRoutes(projectRoot)
    config = r.config as typeof config
    routesDir = path.dirname(r.file)
  } catch { /* 无配置/加载失败 ⇒ 仅靠 ① + ③ */ }
  if (config?.pagesDir) push(path.resolve(projectRoot, config.pagesDir))
  if (routesDir) push(routesDir)
  const gs = config?.targets?.mp?.globalStyle
  if (gs) push(path.dirname(path.resolve(projectRoot, gs)))
  // ③ 根级常见文件（布局壳/应用配置/入口——改它们同样影响 bundle）
  for (const f of ['App.vue', 'app.vue', 'app.config.ts', 'app-shell.ts', 'proteus.config.ts']) {
    push(path.join(projectRoot, f))
  }
  // ④ 去重：祖先（目录）已在集合 ⇒ 跳过其后代（避免重复监听/双触发）
  const uniq = [...new Set(cands)].sort((a, b) => a.length - b.length)
  const roots: string[] = []
  for (const c of uniq) {
    if (roots.some((r) => c === r || c.startsWith(r + path.sep))) continue
    roots.push(c)
  }
  return roots
}

/**
 * 启动 App dev server：先建一次 bundle，再起 HTTP + watch。
 */
export async function startAppDevServer(opts: AppDevServerOptions): Promise<AppDevServer> {
  const projectRoot = path.resolve(opts.projectRoot)
  const platform = opts.platform
  const outFile = appBundleFile(projectRoot, platform)
  const host = opts.host ?? '0.0.0.0'
  const port = opts.port ?? 0

  let version = 0
  let building = false
  let pendingReason: string | null = null

  // ── DevTools 面板状态（决策 #672/#673）──
  interface RebuildEvent { version: number; bytes: number; ms: number; reason: string; time: number }
  interface HostState { screen: string; time: number; env?: Record<string, unknown>; perf?: Record<string, unknown> }
  /** ★channel（决策 #679）：'native' = 宿主/H TTP；'project' = 项目 JS 侧（console.* / 桥调用）。 */
  interface NetEvent { channel: 'native' | 'project'; method: string; path: string; status: number; bytes: number; ms: number; time: number }
  interface ConsoleEvent { channel: 'native' | 'project'; level: string; text: string; time: number }
  interface TraceEvent { gesture: string; id: number; chain: number[]; handled: boolean; fired: number[]; time: number }
  const events: RebuildEvent[] = []         // 环形（近 50 条）重建时间线
  const netLog: NetEvent[] = []             // 环形网络日志（dev server 收到的请求——它就是"网络源头"）
  const consoleLog: ConsoleEvent[] = []     // 环形控制台日志（宿主转发：JS console + 宿主 dev 事件）
  const traceLog: TraceEvent[] = []         // 环形事件 trace（手势派发——决策 #675）
  let lastBytes = 0
  let lastMs = 0
  let lastHost: HostState | null = null
  let lastTree: unknown = null              // ★元素内省（决策 #674）：当前屏实例化节点树（含 rects 几何）
  let lastInspect: { id: number; time: number } | null = null   // ★元素点选（决策 #675）
  const sseClients = new Set<import('node:http').ServerResponse>()

  /** 向所有 SSE 客户端广播一条事件。 */
  const broadcast = (obj: unknown): void => {
    const frame = `data: ${JSON.stringify(obj)}\n\n`
    for (const c of sseClients) { try { c.write(frame) } catch { sseClients.delete(c) } }
  }
  /** 面板连接时的初始快照（版本/体积/耗时/时间线/宿主态 + 网络 + 控制台 + 元素树 + 点选 + trace）。 */
  const snapshot = (): unknown => ({
    type: 'snapshot', version, bytes: lastBytes, lastMs,
    events: events.slice(-50), host: lastHost,
    net: netLog.slice(-80), console: consoleLog.slice(-200), tree: lastTree,
    inspect: lastInspect, trace: traceLog.slice(-80),
  })
  /** 记一条网络日志（dev server 请求）+ 广播。 */
  const recordNet = (e: NetEvent): void => {
    netLog.push(e)
    if (netLog.length > 80) netLog.shift()
    broadcast({ type: 'net', ...e })
  }

  const rebuild = async (reason: string): Promise<void> => {
    if (building) { pendingReason = reason; return }   // 重建中 ⇒ 记待办（防抖，不并发）
    building = true
    const t0 = Date.now()
    try {
      const r = await buildAppBundle({ projectRoot, platform, outFile, dev: true })
      version++
      const ms = Date.now() - t0
      lastBytes = r.bytes
      lastMs = ms
      const ev: RebuildEvent = { version, bytes: r.bytes, ms, reason, time: Date.now() }
      events.push(ev)
      if (events.length > 50) events.shift()
      broadcast({ type: 'rebuild', ...ev })
      opts.onRebuild?.({ version, bytes: r.bytes, ms, reason })
    } catch (e) {
      console.error(`[proteus-dev] ✗ 重建失败：${(e as Error).message}`)
    } finally {      building = false
      const next = pendingReason
      pendingReason = null
      if (next) void rebuild(next)   // 串行补跑（保证最终一致；非并发）
    }
  }

  // 首建（宿主启动前 bundle 必须就绪）
  await rebuild('initial')

  const server = http.createServer((req, res) => {
    const [pathname, query] = (req.url ?? '/').split('?')
    const url = pathname
    // ★Network 日志（决策 #673）：dev server **就是** App 的网络源头（bundle/version/ping/…）⇒
    //   捕获每个请求的 方法/路径/状态/字节/耗时，推给面板（面板 Network 表）。SSE/面板自身不计入噪声。
    const netStart = Date.now()
    let netStatus = 0
    let netBytes = 0
    const isNoise = url === '/events' || url === '/' || url === '/index.html' || url === '/health'
    const _writeHead = res.writeHead.bind(res)
    res.writeHead = ((code: number, ...rest: unknown[]) => { netStatus = code; return (_writeHead as (...a: unknown[]) => unknown)(code, ...rest) }) as typeof res.writeHead
    const _end = res.end.bind(res)
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') netBytes += Buffer.byteLength(chunk)
      else if (Buffer.isBuffer(chunk)) netBytes += chunk.length
      if (!isNoise) recordNet({ channel: 'native', method: req.method ?? 'GET', path: req.url ?? '/', status: netStatus, bytes: netBytes, ms: Date.now() - netStart, time: Date.now() })
      return (_end as (...a: unknown[]) => unknown)(chunk, ...rest)
    }) as typeof res.end
    // ★DevTools 面板（决策 #672）：浏览器打开 dev server 根路径即见可视化面板。
    if (url === '/' || url === '/index.html') {
      const boundPort = (server.address() as { port: number } | null)?.port ?? port
      const bindAddr = host === '0.0.0.0' || host === '::' ? lanAddress() : host
      const html = renderDevtoolsPage({
        platform,
        projectName: path.basename(projectRoot),
        projectRoot,
        url: `http://${bindAddr}:${boundPort}`,
      })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      return
    }
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, version }))
      return
    }
    if (url === '/version') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end(String(version))
      return
    }
    if (url === '/bundle') {
      try {
        const body = fs.readFileSync(outFile)
        // ★每次现读盘（取最新）；no-store 防中间层缓存（否则热刷拿到旧 bundle）
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('bundle not built yet')
      }
      return
    }
    // ★SSE 事件流（面板实时更新：重建事件 + 宿主心跳）
    if (url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
      sseClients.add(res)
      const ping = setInterval(() => { try { res.write(': keep-alive\n\n') } catch { /* 断开由 close 处理 */ } }, 15000)
      req.on('close', () => { clearInterval(ping); sseClients.delete(res) })
      return
    }
    // ★宿主心跳（AppActivity 的 dev-watch 每次轮询顺带上报"当前屏" + 设备环境）⇒ 面板"设备在线 + 当前屏 + 设备环境"
    if (url === '/ping') {
      const q = new URLSearchParams(query ?? '')
      let env: Record<string, unknown> | undefined
      let perf: Record<string, unknown> | undefined
      const envRaw = q.get('env')
      if (envRaw) { try { env = JSON.parse(envRaw) as Record<string, unknown> } catch { /* 非法 ⇒ 不带 */ } }
      const perfRaw = q.get('perf')
      if (perfRaw) { try { perf = JSON.parse(perfRaw) as Record<string, unknown> } catch { /* 非法 ⇒ 不带 */ } }
      lastHost = { screen: q.get('screen') ?? '', time: Date.now(), ...(env ? { env } : {}), ...(perf ? { perf } : {}) }
      broadcast({ type: 'host', ...lastHost })
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }
    // ★元素点选（决策 #675）：宿主在触摸命中时上报"被点内核节点 id" ⇒ 面板高亮该节点 + 详情。
    if (url === '/inspect') {
      const q = new URLSearchParams(query ?? '')
      const id = Number(q.get('id'))
      if (Number.isFinite(id)) { lastInspect = { id, time: Date.now() }; broadcast({ type: 'inspect', id, time: lastInspect.time }) }
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }
    // ★事件 trace（决策 #675）：宿主逐条上报手势派发 ⇒ 面板"事件"面板。
    if (url === '/trace') {
      const q = new URLSearchParams(query ?? '')
      const ev: TraceEvent = {
        gesture: q.get('type') ?? '', id: Number(q.get('id')) || 0,
        chain: (q.get('chain') || '').split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x)),
        handled: q.get('handled') === '1', fired: (q.get('fired') || '').split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x)),
        time: Date.now(),
      }
      if (ev.gesture) { traceLog.push(ev); if (traceLog.length > 80) traceLog.shift(); broadcast({ type: 'trace', ...ev }) }
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }
    // ★元素内省（决策 #674）：宿主每渲染后 POST 当前屏实例化节点树（JSON body）⇒ 面板"元素"树。
    if (url === '/tree') {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy() })
        req.on('end', () => {
          try { lastTree = JSON.parse(body); broadcast({ type: 'tree', tree: lastTree }) } catch { /* 非法 JSON ⇒ 忽略 */ }
          res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('ok')
        })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(lastTree ?? { nodes: [] }))
      return
    }
    // ★控制台日志（决策 #673）：宿主把**项目 JS 的 console.\*** 与**原生（宿主）dev 事件**转发到此 ⇒ 面板 Console。
    //   `GET /log?channel=project|native&level=log|info|warn|error&text=<urlencoded>`（一行一条；免加 POST）。
    //   ★channel 缺省 `native`（兼容旧宿主：只想报原生事件）。
    if (url === '/log') {
      const q = new URLSearchParams(query ?? '')
      const ch = q.get('channel') === 'project' ? 'project' : 'native'
      const ev: ConsoleEvent = { channel: ch, level: q.get('level') ?? 'log', text: q.get('text') ?? '', time: Date.now() }
      if (ev.text) { consoleLog.push(ev); if (consoleLog.length > 200) consoleLog.shift(); broadcast({ type: 'console', ...ev }) }
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }
    // ★项目通道·桥调用（决策 #679）：宿主把 JS→原生的 `proteusHost.invoke(method,args)` 逐次上报 ⇒
    //   面板 Network · **项目通道**（`screen.mount`/`ui.*` 等；方法即"路径"）。
    //   `GET /bridge?method=<name>&ok=1|0&ms=<n>`。
    if (url === '/bridge') {
      const q = new URLSearchParams(query ?? '')
      const method = q.get('method') ?? ''
      if (method) {
        recordNet({ channel: 'project', method: 'INVOKE', path: method, status: q.get('ok') === '1' ? 200 : 500, bytes: 0, ms: Number(q.get('ms')) || 0, time: Date.now() })
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end('ok')
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('proteus dev server: / (devtools) · /health · /version · /bundle · /events · /ping · /tree · /inspect · /trace · /log · /bridge')
  })

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
  const actualPort = (server.address() as { port: number }).port

  // watch（防抖 250ms——一次保存常触发多个 fs 事件）
  let debounce: NodeJS.Timeout | null = null
  const watchers: fs.FSWatcher[] = []
  const watchRoots = await resolveWatchRoots(projectRoot)
  // ★watch 就绪行不在此打印（由 `proteus dev` 的 UI 在「安装」步骤后统一打一行）——避免重复。
  if (watchRoots.length === 0) {
    console.warn('[proteus-dev] ⚠ 未找到可监听的项目源码（pagesDir/router/App.vue/src/）——热刷不会触发；检查工程布局')
  }
  for (const t of watchRoots) {
    try {
      const w = fs.watch(t, { recursive: fs.statSync(t).isDirectory() }, (_evt, fname) => {
        if (fname && /\.(vue|ts|css|scss|json)$/.test(String(fname)) === false) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => void rebuild(`change:${String(fname ?? '?')}`), 250)
      })
      watchers.push(w)
    } catch { /* 某些平台不支持 recursive——退化为不监听该项（首建仍可用） */ }
  }

  // ★url 按**实际绑定 host**计算：绑定 0.0.0.0 时用**局域网地址**（真机经局域网访问本机）；
  //   显式绑定某 host（如 127.0.0.1，测试用）时用它本身。
  const bindAddr = host === '0.0.0.0' || host === '::' ? lanAddress() : host
  const url = `http://${bindAddr}:${actualPort}`
  return {
    url,
    port: actualPort,
    watchRoots,
    version: () => version,
    close: async () => {
      if (debounce) clearTimeout(debounce)
      for (const w of watchers) w.close()
      for (const c of sseClients) { try { c.end() } catch { /* 已断 */ } }
      sseClients.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

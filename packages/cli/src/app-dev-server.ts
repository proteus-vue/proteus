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

/** 需要监听的项目源码目录/文件（页面/路由/样式等——改这些影响 bundle 内容） */
function watchTargets(projectRoot: string): string[] {
  const cands = ['pages', 'router', 'styles', 'components', 'App.vue', 'proteus.config.ts', 'app.config.ts', 'app-shell.ts']
  return cands.map((c) => path.join(projectRoot, c)).filter((p) => fs.existsSync(p))
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

  const rebuild = async (reason: string): Promise<void> => {
    if (building) { pendingReason = reason; return }   // 重建中 ⇒ 记待办（防抖，不并发）
    building = true
    const t0 = Date.now()
    try {
      const r = await buildAppBundle({ projectRoot, platform, outFile, dev: true })
      version++
      opts.onRebuild?.({ version, bytes: r.bytes, ms: Date.now() - t0, reason })
    } catch (e) {
      console.error(`[proteus-dev] ✗ 重建失败：${(e as Error).message}`)
    } finally {
      building = false
      const next = pendingReason
      pendingReason = null
      if (next) void rebuild(next)   // 串行补跑（保证最终一致；非并发）
    }
  }

  // 首建（宿主启动前 bundle 必须就绪）
  await rebuild('initial')

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
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
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('proteus dev server: /health /version /bundle')
  })

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
  const actualPort = (server.address() as { port: number }).port

  // watch（防抖 250ms——一次保存常触发多个 fs 事件）
  let debounce: NodeJS.Timeout | null = null
  const watchers: fs.FSWatcher[] = []
  for (const t of watchTargets(projectRoot)) {
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
    version: () => version,
    close: async () => {
      if (debounce) clearTimeout(debounce)
      for (const w of watchers) w.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

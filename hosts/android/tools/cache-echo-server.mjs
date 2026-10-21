#!/usr/bin/env node
// hosts/android/tools/cache-echo-server.mjs
// ★★★#1149：**HTTP 条件请求缓存**的真机判据服务端。
//
// 【为什么必须是"服务端记账"，不能只看客户端】
//   客户端"看起来 304 了"可能只是本地缓存装出来的。唯一能证明"真发了条件请求、
//   服务端真回了 304"的证据在**服务端视角**：
//     · `/__stats` 的 `hits[path]`  —— 到底有没有打过来（判断"缓存命中省掉网络"）
//     · `/__stats` 的 `conditional[path]` —— 收到的 `If-None-Match` / `If-Modified-Since` 原文
//     · `generated[path]` —— 真正**生成**了几次响应体（304 不生成）
//
// 【端点的语义（判据各取一条）】
//   GET /fresh        Cache-Control: max-age=60  + ETag ⇒ 第二次必须**命中缓存（服务端零请求）**
//   GET /etag         Cache-Control: max-age=0   + ETag ⇒ 每次校验；带对 ETag ⇒ 304
//   GET /lastmod      Cache-Control: max-age=0   + Last-Modified（无 ETag）
//   GET /nostore      Cache-Control: no-store    ⇒ 不许缓存
//   GET /vary         Vary: Accept-Language      ⇒ 分桶
//   GET /__stats      返回上面的记账（JSON）
//
// 用法：node cache-echo-server.mjs <port> [host]
import http from 'node:http'

const port = Number(process.argv[2] ?? 8800)
const host = process.argv[3] ?? '0.0.0.0'

/** 每端点记账：请求数 / 收到的条件头 / 生成次数 */
const stats = {
  hits: /** @type {Record<string, number>} */ ({}),
  conditional: /** @type {Record<string, string[]>} */ ({}),
  generated: /** @type {Record<string, number>} */ ({}),
}

const bump = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by
}

/**
 * 生成一个响应体。`gen` 是**真正生成次数**（304 不增加）
 * ⇒ 客户端拿到的 `gen` 能证明"这个体是缓存里的，还是新生成的"。
 */
function bodyFor(path, gen, extra = {}) {
  return JSON.stringify({ path, gen, ...extra })
}

/**
 * ★★★#1150：**故障开关**——判据要模拟"源站挂了"（stale-if-error 的触发条件）。
 * 用 `?fail=<status>` 让端点按需返回 5xx；`/__reset` 会清空。
 * ★为什么不用"停掉服务"：那会让**后续所有端点**都失败，判据无法在同一个服务进程里
 *   既测正常路径又测故障路径（本仓纪律：一条判据一个可复现形态）。
 */
const failures = new Map()

/**
 * ★★★#1150：**内容版本旋钮**——判据要模拟"后台校验时服务端内容真的变了"。
 *
 * 【为什么需要（首版判据设计错误）】`/swr` 的 ETag 若基于"生成次数"，后台校验带
 *   `If-None-Match: "g1"` 回来时服务端发现版本没变 ⇒ 回 **304** ⇒ 缓存体（gen=1）不变
 *   ⇒ 判据"第三次请求应拿到更新的代"**永远不可能成立**（不是实现坏，是判据假设错了）。
 *   ⇒ 加一个显式版本：`/__bump/<path>` 递增版本 ⇒ 下次条件请求带旧版本 ⇒ 服务端回 **200 + 新体**
 *     ⇒ 这样才能验证"后台校验的新值真的进了缓存"。
 */
const versions = new Map()
const versionOf = (p) => versions.get(p) ?? 1

/** 把返回 5xx 的端点统一成"带 Content-Length + Connection: close"（见下方 failCode 段注释） */
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x')
  const path = u.pathname
  // ★排障日志（真机探针卡住时，唯一能区分"请求没发出"与"回推帧没到"的证据）
  console.log(`[req] ${new Date().toISOString()} ${req.method} ${req.url} inm=${req.headers['if-none-match'] ?? '-'}`)

  if (path === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ...stats, failures: Object.fromEntries(failures) }))
    return
  }
  if (path === '/__reset') {
    stats.hits = {}
    stats.conditional = {}
    stats.generated = {}
    failures.clear()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"ok":true}')
    return
  }
  /** ★故障控制：`/__fail/<path><status>` 设、`/__fail/<path>0` 清 */
  if (path.startsWith('/__fail/')) {
    const rest = path.slice('/__fail/'.length)
    const target = '/' + rest.replace(/\d+$/, '')
    const code = Number(/\d+$/.exec(rest)?.[0] ?? 0)
    if (code > 0) failures.set(target, code)
    else failures.delete(target)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, target, code }))
    return
  }
  /** ★内容版本：`/__bump/<path>` 递增（模拟"上游内容更新了"） */
  if (path.startsWith('/__bump/')) {
    const target = '/' + path.slice('/__bump/'.length)
    versions.set(target, versionOf(target) + 1)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, target, version: versionOf(target) }))
    return
  }

  bump(stats.hits, path)
  // ★故障注入：命中开关 ⇒ 直接回 5xx（不生成新体）
  //   ★★#1150 真机教训：首版只 `res.writeHead(503, {'Content-Type':'text/plain'})` + `res.end(body)`
  //     ⇒ 响应是 **chunked 且无 Content-Length**。Node 的 fetch 2ms 就拿到，
  //     但 Android 的 `HttpURLConnection` 在这条路径上**卡住**（`getResponseCode()` 之后读 errorStream 不回）。
  //     ⇒ 显式给 **Content-Length + Connection: close**：
  //       ① 让宿主能走"已知长度"的读取路径（与正常响应同形态，减少一个变量）；
  //       ② 断言"这不是框架/缓存的问题，而是测试服务端的响应形态问题"。
  const failCode = failures.get(path)
  if (failCode !== undefined) {
    const body = 'injected-failure'
    res.writeHead(failCode, {
      'Content-Type': 'text/plain',
      'Content-Length': String(Buffer.byteLength(body)),
      Connection: 'close',
    })
    res.end(body)
    return
  }
  const inm = req.headers['if-none-match']
  const ims = req.headers['if-modified-since']
  const conds = []
  if (typeof inm === 'string') conds.push('If-None-Match: ' + inm)
  if (typeof ims === 'string') conds.push('If-Modified-Since: ' + ims)
  if (conds.length) {
    stats.conditional[path] = [...(stats.conditional[path] ?? []), ...conds]
  }

  const gen = (stats.generated[path] ?? 0) + 1
  const etagOf = (n) => `"g${n}"`
  const lastMod = 'Wed, 21 Oct 2015 07:28:00 GMT'

  switch (path) {
    case '/fresh': {
      // 新鲜期很长：第二次不该打过来
      stats.generated[path] = gen
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=60',
        ETag: etagOf(gen),
      })
      res.end(bodyFor(path, gen))
      return
    }
    case '/etag': {
      // ★当前 ETag = 上次生成的那一版；对上就 304（不生成新体）
      const current = stats.generated[path] ?? 0
      if (current > 0 && inm === etagOf(current)) {
        res.writeHead(304, { ETag: etagOf(current), 'Cache-Control': 'max-age=0' })
        res.end()
        return
      }
      stats.generated[path] = current + 1
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=0',
        ETag: etagOf(current + 1),
      })
      res.end(bodyFor(path, current + 1))
      return
    }
    case '/lastmod': {
      const current = stats.generated[path] ?? 0
      if (current > 0 && ims === lastMod) {
        res.writeHead(304, { 'Last-Modified': lastMod, 'Cache-Control': 'max-age=0' })
        res.end()
        return
      }
      stats.generated[path] = current + 1
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=0',
        'Last-Modified': lastMod,
      })
      res.end(bodyFor(path, current + 1))
      return
    }
    case '/nostore': {
      stats.generated[path] = gen
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ETag: etagOf(gen) })
      res.end(bodyFor(path, gen))
      return
    }
    case '/vary': {
      const lang = String(req.headers['accept-language'] ?? 'none')
      stats.generated[path] = gen
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=60',
        Vary: 'Accept-Language',
        ETag: `"lang-${lang}"`,
      })
      res.end(bodyFor(path, gen, { lang }))
      return
    }
    /**
     * ★★★#1150 `stale-while-revalidate`：`max-age=0`（立即 stale）+ SWR 窗口 60s。
     * 判据：第二次请求应**立即回旧值**（status=stale）且服务端稍后收到一次**条件**校验。
     */
    case '/swr': {
      const ver = versionOf('/swr')
      const cc = 'max-age=0, stale-while-revalidate=60'
      // ★版本对上 ⇒ 304（内容没变）；版本变了 ⇒ 200 + 新体（判据用 /__bump 造这个场景）
      if (inm === `"v${ver}"`) {
        res.writeHead(304, { ETag: `"v${ver}"`, 'Cache-Control': cc })
        res.end()
        return
      }
      stats.generated[path] = gen
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': cc, ETag: `"v${ver}"` })
      res.end(bodyFor(path, gen, { ver }))
      return
    }
    /**
     * ★★★#1150 `stale-if-error`：`max-age=0` + SIE 窗口 60s。
     * 判据：先正常存一份，再 `/__fail/sie503` 让源站 503 ⇒ 必须用旧值兜底。
     */
    case '/sie': {
      const current = stats.generated[path] ?? 0
      const cc = 'max-age=0, stale-if-error=60'
      stats.generated[path] = current + 1
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': cc, ETag: etagOf(current + 1) })
      res.end(bodyFor(path, current + 1))
      return
    }
    /**
     * ★★★#1151 持久层判据端点：新鲜期很长（10 分钟）+ 稳定 ETag。
     * 判据用法：`phase=write` 进程请求一次（落盘）→ **进程退出** →
     *   `phase=read` **新进程**请求同一 URL ⇒ 必须命中；**服务端 hits 不增**是唯一硬证据。
     */
    case '/persist': {
      stats.generated[path] = gen
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=600',
        ETag: '"persist-v1"',
      })
      res.end(bodyFor(path, gen))
      return
    }
    /**
     * ★#1150 SWR 窗口=0 ⇒ **不得**再回旧值（边界判据）。
     */
    case '/swr-zero': {
      const current = stats.generated[path] ?? 0
      const cc = 'max-age=0, stale-while-revalidate=0'
      if (current > 0 && inm === etagOf(current)) {
        res.writeHead(304, { ETag: etagOf(current), 'Cache-Control': cc })
        res.end()
        return
      }
      stats.generated[path] = current + 1
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': cc, ETag: etagOf(current + 1) })
      res.end(bodyFor(path, current + 1))
      return
    }
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('nope')
  }
})

server.listen(port, host, () => {
  console.log(`[cache-echo] listening http://${host}:${port}`)
})

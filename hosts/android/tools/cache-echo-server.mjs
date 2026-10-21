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

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x')
  const path = u.pathname

  if (path === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(stats))
    return
  }
  if (path === '/__reset') {
    stats.hits = {}
    stats.conditional = {}
    stats.generated = {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end('{"ok":true}')
    return
  }

  bump(stats.hits, path)
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
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('nope')
  }
})

server.listen(port, host, () => {
  console.log(`[cache-echo] listening http://${host}:${port}`)
})

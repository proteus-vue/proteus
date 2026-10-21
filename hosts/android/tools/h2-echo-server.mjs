#!/usr/bin/env node
// hosts/android/tools/h2-echo-server.mjs
// ★★★决策 #1155：**传输层事实取证**服务端——HTTP/2 协商与连接复用**是否已经在工作**。
//
// 【要回答的问题（不猜，实测）】
//   矩阵 P1 写着「HTTP/2 + 连接池：需 Android 引入 OkHttp」。但 **Android 的 `HttpURLConnection`
//   底层就是 OkHttp**（AOSP 从 4.4 起 `com.android.okhttp`）——那么 HTTP/2 与连接池
//   **可能早就在工作**，缺的只是"我们看不见它"（没有可观测字段）。
//   若实测表明已工作 ⇒ P1 的实质不是"换栈"，而是"**补可观测性** + HTTPDNS"（两者都不需要换栈）。
//   若实测表明没工作 ⇒ 才需要真的引 OkHttp（APK +Δ，独立大单）。
//
// 【本服务端记录什么（客户端自述不算，以服务端视角为准）】
//   · 每个请求的 **协议版本**（`h2` vs `http/1.1`）——由 `req.httpVersion` / stream 事件决定；
//   · **TCP 连接总数**（`connection` 事件的次数）——连接复用 = 请求数 > 连接数；
//   · 每个连接上的请求数（`socket` 身份 → 计数）。
//   ★三种端点的对照：
//     `/__whoami`  正常响应（受试者的请求）
//     `/__stats`   返回上述记账（JSON）
//     `/__reset`   清空记账
//
// 用法：node h2-echo-server.mjs <port> [--gen-dir=<dir>]
//   ★必须 HTTPS（h2 走 TLS + ALPN）；证书自签，客户端需 `tlsPinOnly` 才连得上——
//     正好复用 #1154 的 pinning 能力（`/__pin` 返回本服务证书的 SPKI 指纹）。
import http from 'node:http'
import http2 from 'node:http2'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const port = Number(process.argv[2] ?? '8830')
const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const genDir = argOf('gen-dir') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-h2-'))
fs.mkdirSync(genDir, { recursive: true })

const keyFile = path.join(genDir, `h2-${port}.key`)
const certFile = path.join(genDir, `h2-${port}.crt`)
if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
  const san = argOf('san') ?? 'DNS:localhost,IP:127.0.0.1'
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', `/CN=proteus-h2-${port}`,
    '-addext', `subjectAltName=${san}`,
  ], { stdio: 'ignore' })
}
const spkiPin = execFileSync(
  'sh',
  ['-c', `openssl x509 -in "${certFile}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A`],
  { maxBuffer: 10 * 1024 * 1024 },
).toString().trim()

/**
 * 记账（服务端视角）——★按**通道**（`tls` / `plain`）分开，且连接身份用**对端 socket**。
 *
 * 【为什么必须按通道分（#1155 判据修正，本地校准实测）】
 *   首版把所有受试样本记进同一个 `requests`/`protocols` ⇒ 一次探针里明文基线 3 次 + TLS 3 次
 *   会合并成「6 请求 / 4 连接」，再拿它判"复用"——**跨通道混算**，结论对也是巧合。
 *
 * 【为什么连接身份不能用 `req.socket` / `perConnection`】
 *   Node 的 h2 兼容层里**每个流有各自的 `req.socket` 包装对象** ⇒ 同一条 TCP 连接上 3 个流
 *   会得到 3 个不同 id（本地校准：单会话 3 请求，`connections=1` 但 `perConnection=c1,c2,c3`）。
 *   ⇒ 改用 **`remoteAddress:remotePort`**：它是 TCP 四元组的一端，**同一连接的所有流相同**
 *     （校准里 `peers={"127.0.0.1:63121":3}`）⇒ h1/h2 都成立。
 *
 * 【为什么全局 `connection` / `secureConnection` 计数不作判据】
 *   ① 就绪探测（`wait_for --port`）与控制端点（`/__pin` `/__stats`）都会建连
 *      ——实测明文 3 请求只用了 1 条连接，全局却计成 3（**假红**，害我白查一轮）；
 *   ② `secureConnection` 在 h2 服务上并不保证每握手一次（iOS 实测 3 条连接只计了 2）。
 *   ⇒ 全局计数只作**信息位**（排障用），判据一律走下面的 `channels[tag]`。
 */
const stats = {
  /** 全局建连数（含就绪探测/控制端点——**不作判据**，仅排障） */
  connections: 0,
  /** 通道 → 受试样本记账 */
  channels: /** @type {Record<string, { requests: number, protocols: Record<string, number>, conns: Record<string, number> }>} */ ({}),
}
const streamIds = new WeakMap()
let nextStreamId = 1

/** 取/建通道记账 */
function channelOf(tag) {
  if (!stats.channels[tag]) stats.channels[tag] = { requests: 0, protocols: {}, conns: {} }
  return stats.channels[tag]
}

/**
 * `/__stats` 的对外形态：每通道 `{requests, protocols, conns, connections, reused}`。
 *
 * ★`reused` 由**服务端**算，不由客户端自己比——判据只该有一个实现，
 *   否则"服务端计数正确、客户端判错"这类假绿会长期潜伏（本仓 #1150/#1152 都踩过）。
 */
function statsSnapshot() {
  const channels = {}
  for (const [tag, c] of Object.entries(stats.channels)) {
    const connections = Object.keys(c.conns).length
    channels[tag] = {
      requests: c.requests,
      protocols: c.protocols,
      conns: c.conns,
      connections,
      reused: c.requests > connections && connections > 0,
    }
  }
  return { channels, globalConnections: stats.connections, spki: spkiPin, port }
}

/**
 * ★★★#1155：**明文对照端口**（可选 `--plain-port=`）——用于"连接复用基线"。
 * 【为什么需要】真机首跑发现 5 次请求用了 5 条 TCP 连接（完全不复用）。唯一可疑差异是
 *   pinning 会 `setSSLSocketFactory`（若每次新建 `SSLContext`，连接池按它分桶 ⇒ 复用失效）。
 *   ⇒ 同一台机器的**明文端口**做基线：基线复用 + 带 pin 不复用 ⇒ 才能把责任归到 pinning 实现。
 *   ★明文端口不做 TLS，所以不需要 pin（探针那侧也不传）。
 */
function makeHandler(tag) {
  return (req, res) => {
    const u = new URL(req.url ?? '/', 'https://x')
    /**
     * ★★★#1155 判据修正：**控制端点不计入受试样本**。
     * 【真机实测抓出的误判】首版把所有请求都计进 `protocols`，而判据自己的
     *   `curl /__pin`（**Node 走 h2**）和 `useFetch /__stats` 也被算进去
     *   ⇒ Android 明明是 `http/1.1`，却因那条 `tls:h2:1` 被判成"已协商 h2" ⇒ **假绿**。
     * ⇒ 只有 `/__whoami`（业务形态的请求）是受试样本；`/__pin` `/__stats` `/__reset` 一律不计。
     */
    const isSample = u.pathname === '/__whoami'
    const proto = req.httpVersion === '2.0' ? 'h2' : 'http/1.1'
    // ★连接身份 = **对端 socket**（TCP 四元组的一端）——同一连接的所有 h2 流相同。
    //   ★不能用 `req.socket` 对象本身：h2 兼容层每个流一个包装 ⇒ 同连接多条"连接"（见 stats 注释）。
    const peer = `${req.socket.remoteAddress ?? '?'}:${req.socket.remotePort ?? 0}`
    if (!streamIds.has(req.socket)) streamIds.set(req.socket, `s${nextStreamId++}`)
    const sid = streamIds.get(req.socket)
    if (isSample) {
      const ch = channelOf(tag)
      ch.requests++
      ch.protocols[proto] = (ch.protocols[proto] ?? 0) + 1
      ch.conns[peer] = (ch.conns[peer] ?? 0) + 1
    }
    console.log(`[h2-req] ${new Date().toISOString()} ${tag} ${proto} peer=${peer} sid=${sid}${isSample ? ' SAMPLE' : ' ctl'} ${req.method} ${u.pathname}`)

    if (u.pathname === '/__stats') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(statsSnapshot()))
      return
    }
    if (u.pathname === '/__reset') {
      stats.channels = {}
      stats.connections = 0
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end('{"ok":true}')
      return
    }
    if (u.pathname === '/__pin') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ spki: spkiPin, port }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, proto, peer, sid, whoami: 'h2-echo', tag, port, path: u.pathname }))
  }
}

const server = http2.createSecureServer(
  { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), allowHTTP1: true },
  makeHandler('tls'),
)

// ★全局建连计数：**只作排障信息位，不作判据**（原因见 stats 注释：
//   就绪探测/控制端点会抬高它；h2 下 `secureConnection` 也不保证每次握手都触发，iOS 实测 3 条只计 2 条）。
server.on('secureConnection', () => {
  stats.connections++
})

server.listen(port, '0.0.0.0', () => {
  console.log(`[h2-echo] listening https://0.0.0.0:${port}（证书 ${certFile}）`)
  console.log(`[h2-echo] SPKI pin = ${spkiPin}`)
})

// ★明文对照端口（连接复用基线）
const plainPort = Number(argOf('plain-port') ?? 0)
if (plainPort > 0) {
  const plain = http.createServer(makeHandler('plain'))
  plain.on('connection', () => {
    stats.connections++
  })
  plain.listen(plainPort, '0.0.0.0', () => {
    console.log(`[h2-echo] listening http://0.0.0.0:${plainPort}（明文对照端口）`)
  })
}

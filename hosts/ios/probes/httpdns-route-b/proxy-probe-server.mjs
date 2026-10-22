// B 路线可行性探针 · 本地 HTTP 代理（只做一件事：记录 CFNetwork 怎么找上门）
// 用法: node proxy-probe-server.mjs <port> <outJson>
// 判据:
//   收到 `CONNECT host:443`  ⇒ URLSession 对 https 走 CONNECT 隧道 ⇒ B 路线可行
//   收到 `GET https://...`   ⇒ 明文绝对 URI（不应出现在 TLS 场景）⇒ 异常
//   完全没请求               ⇒ 代理配置未生效 / 被忽略
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'

const port = Number(process.argv[2] || 18899)
const outJson = process.argv[3] || '/tmp/proxy-probe.json'
// ★#1179：bind 地址可配（真机经 LAN IP 访问 ⇒ 需要 0.0.0.0；默认仍 loopback，模拟器行为不变）
const bindAddr = process.argv[4] || '127.0.0.1'
const events = []
const t0 = Date.now()

const record = (ev) => {
  ev.atMs = Date.now() - t0
  events.push(ev)
  fs.writeFileSync(outJson, JSON.stringify({ port, events }, null, 2))
  console.log('[proxy]', JSON.stringify(ev))
}

const server = http.createServer((req, res) => {
  // 绝对 URI 形态（明文代理请求）
  record({ kind: 'request', method: req.method, url: req.url, host: req.headers.host })
  res.writeHead(502, { 'content-type': 'text/plain' })
  res.end('proxy-probe: non-CONNECT request received\n')
})

server.on('connect', (req, clientSocket, head) => {
  // ★关键事件：CFNetwork 要求建立隧道
  record({ kind: 'connect', url: req.url, host: req.headers.host })
  const [host, p] = String(req.url).split(':')
  // ★探针映射：sni-probe.local 指向本机 TLS 服务端（该域名无真实 DNS 记录）
  const targetHost = host === 'sni-probe.local' ? '127.0.0.1' : host
  const upstream = net.connect(Number(p || 443), targetHost, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head && head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', (e) => {
    record({ kind: 'upstream_error', host, err: String(e.message) })
    try { clientSocket.end() } catch {}
  })
  clientSocket.on('error', () => { try { upstream.destroy() } catch {} })
})

server.listen(port, bindAddr, () => {
  record({ kind: 'listening', port, bind: bindAddr })
})

// 收到 SIGTERM 时把最终结果落盘
process.on('SIGTERM', () => {
  fs.writeFileSync(outJson, JSON.stringify({ port, events, summary: summarize() }, null, 2))
  server.close(() => process.exit(0))
})

function summarize() {
  const connects = events.filter((e) => e.kind === 'connect')
  const plain = events.filter((e) => e.kind === 'request')
  return {
    connectCount: connects.length,
    plainRequestCount: plain.length,
    connectTargets: connects.map((e) => e.url),
    verdict: connects.length > 0 ? 'CONNECT_SUPPORTED' : plain.length > 0 ? 'PLAINTEXT_ONLY' : 'NO_TRAFFIC',
  }
}

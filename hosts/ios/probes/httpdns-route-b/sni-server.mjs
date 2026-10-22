// B 路线加强验证 · 本地 TLS 服务端，用 SNICallback 直接读出客户端发来的 SNI
// 用法: node sni-server.mjs <port> <outJson>
// 判据: SNICallback 收到的 servername 必须等于请求 URL 里的主机名（而不是 IP）
import https from 'node:https'
import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const port = Number(process.argv[2] || 18443)
const outJson = process.argv[3] || '/tmp/b-probe/sni.json'
// ★#1179：bind 地址可配（真机经 LAN IP 访问 ⇒ 0.0.0.0；默认仍 loopback）
const bindAddr = process.argv[4] || '127.0.0.1'
const keyPath = path.join(path.dirname(outJson), 'b-probe-key.pem')
const certPath = path.join(path.dirname(outJson), 'b-probe-cert.pem')

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 2 ` +
      `-subj "/CN=sni-probe.local" -addext "subjectAltName=DNS:sni-probe.local" 2>/dev/null`,
  )
}

const events = []
const t0 = Date.now()
const record = (ev) => {
  ev.atMs = Date.now() - t0
  events.push(ev)
  fs.writeFileSync(outJson, JSON.stringify({ port, events }, null, 2))
  console.log('[sni]', JSON.stringify(ev))
}

const ctx = tls.createSecureContext({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) })

const server = https.createServer(
  {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    SNICallback: (servername, cb) => {
      // ★这就是直接证据：客户端在 TLS 握手时实际发来的 SNI
      record({ kind: 'sni', servername })
      cb(null, ctx)
    },
  },
  (req, res) => {
    record({ kind: 'request', method: req.method, url: req.url, host: req.headers.host, alpn: req.socket.alpnProtocol })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, host: req.headers.host, alpn: req.socket.alpnProtocol || 'http/1.1' }))
  },
)

server.listen(port, bindAddr, () => record({ kind: 'listening', port, bind: bindAddr }))

process.on('SIGTERM', () => {
  const snis = events.filter((e) => e.kind === 'sni').map((e) => e.servername)
  fs.writeFileSync(
    outJson,
    JSON.stringify(
      {
        port,
        events,
        summary: {
          sniCount: snis.length,
          sniValues: snis,
          distinctSni: [...new Set(snis)],
          alpnSeen: events.filter((e) => e.kind === 'request').map((e) => e.alpn),
        },
      },
      null,
      2,
    ),
  )
  server.close(() => process.exit(0))
})

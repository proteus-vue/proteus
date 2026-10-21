#!/usr/bin/env node
// hosts/android/tools/tls-echo-server.mjs
// ★★★决策 #1153：**TLS pinning** 真机判据的 HTTPS 服务（自签证书 + 可切换）。
//
// 【为什么必须是真 HTTPS（不能用 http）】pinning 只在 **TLS 握手**阶段生效；
//   用明文服务测"证书对不对"根本走不到那一步 ⇒ 判据会假绿（"请求成功"但与 pin 无关）。
//
// 【装置设计（两条互斥的判据需要两套证书）】
//   · `server-a`（默认端口 8810）：证书 A
//   · `server-b`（默认端口 8811）：证书 **B**（不同密钥）
//   判据用法：
//     ① 对 A 发请求 + `tlsPins=[A 的 SPKI]` ⇒ 必须成功（pin 命中）；
//     ② 对 A 发请求 + `tlsPins=[B 的 SPKI]` ⇒ 必须 `fetch.tlsError`（pin 未命中）；
//     ③ 对 A 发请求 + `tlsPins=[A]` 但 **不加** `tlsPinOnly` ⇒ 失败（自签过不了系统信任）
//        —— 这条证明"叠加模式真的叠加了"，而不是"pin 命中就放行"；
//     ④ 对 A 发请求 + `tlsPins=[A]` + `tlsPinOnly=true` ⇒ 成功（替代模式生效）。
//
// 【★证书怎么来】运行时用 openssl 现生成（零入库私钥；判据跑完即删）。
//   ★不把私钥/证书入库：那是**装置产物**，入库既无意义也会被 secret 扫描拦。
//
// 用法：node tls-echo-server.mjs <port[,port2,...]> [--cert=<path>] [--key=<path>] [--gen-dir=<dir>]
//   · 多端口（`8900,8901` 或 `8900+8901`）⇒ **每端口各起一个 listener，共用同一套证书**
//     ★为什么需要多端口：#1153 真机实测发现 iOS 的 `URLSession` 会**复用已建立的 TLS 连接**
//       ⇒ 同一 host:port 的多次请求只触发**一次** challenge ⇒ "无 pin 也成功""pin 不匹配也成功"
//       都是复用了前一次已建立的连接（不是 pinning 失效）。
//     ★接受 `+` 分隔：判据的 `--tls-probe=<baseA>,...` 是逗号分隔的多实参，
//       base 内部的端口再用逗号会被外层切碎 ⇒ runner 用 `+` 传进来。
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ports = String(process.argv[2] ?? '8810')
  .split(/[,+]/)
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const genDir = argOf('gen-dir') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-tls-'))
fs.mkdirSync(genDir, { recursive: true })

/** 现生成一张自签证书（若未给现成的）；返回 { key, cert, spkiPin } */
function ensureCert(name) {
  const key = argOf('key') ?? path.join(genDir, `${name}.key`)
  const cert = argOf('cert') ?? path.join(genDir, `${name}.crt`)
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    /**
     * ★★★SAN 必须包含**判据实际访问用的地址**（`--san=` 传入，逗号分隔）。
     *   【真机实测抓出的坑】iOS 判据经局域网 IP 访问（`https://192.168.x.x:port`），
     *   而首版 SAN 只有 `DNS:localhost,IP:127.0.0.1` ⇒ **主机名不匹配** ⇒
     *   `pinOnly` 模式下 `URLSession` 仍会因主机名拒（`with_pins=3 / rejected=3 / accepted=0`），
     *   看起来像"pin 永远不命中"，实际是证书不含该 IP。
     *   ★诚实边界：`pinOnly` **只替代信任锚，不替代主机名校验**（本仓有意如此——
     *     放宽主机名会打开 MITM 的大门，那是另一个策略开关）。
     */
    const san = argOf('san') ?? 'DNS:localhost,IP:127.0.0.1'
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '2',
      '-subj', `/CN=${name}`,
      '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' })
  }
  // ★权威 SPKI 指纹（与 JS/宿主实现同一口径：公钥 DER 的 SHA-256，base64）
  const spkiPin = execFileSync(
    'sh',
    ['-c', `openssl x509 -in "${cert}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A`],
    { maxBuffer: 10 * 1024 * 1024 },
  ).toString().trim()
  return { key, cert, spkiPin }
}

const material = ensureCert(`proteus-tls-${ports[0]}`)
const keyPem = fs.readFileSync(material.key)
const certPem = fs.readFileSync(material.cert)

/** 每个端口一个 listener（**共用同一套证书** ⇒ 同一个 pin 可用于所有端口）。 */
for (const port of ports) {
  const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
    const u = new URL(req.url ?? '/', 'https://x')
    console.log(`[tls-req] ${new Date().toISOString()} port=${port} ${req.method} ${u.pathname}`)
    if (u.pathname === '/__pin') {
      // ★判据据此拿"本服务的正确 pin"——避免判据自己算错指纹（装置自证）
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ spki: material.spkiPin, port }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, whoami: 'tls-echo', port, path: u.pathname }))
  })
  server.on('error', (e) => {
    // ★端口被占用时**不崩整个进程**（其它端口仍可用）：真机判据只要求"够用的端口数"，
    //   一个端口失败不该让整条判据变红（那是装置环境问题，不是 pinning 结论）。
    console.error(`[tls-echo] port ${port} 启动失败（${e.code || e.message}）——跳过该端口`)
  })
  server.listen(port, '0.0.0.0', () => {
    console.log(`[tls-echo] listening https://0.0.0.0:${port}（证书 ${material.cert}）`)
    if (port === ports[0]) console.log(`[tls-echo] SPKI pin = ${material.spkiPin}`)
  })
}

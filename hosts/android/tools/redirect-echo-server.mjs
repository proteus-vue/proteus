// hosts/android/tools/redirect-echo-server.mjs
// ★★★决策 #1134：**重定向真机判据**用的本地 HTTP 服务（`run-redirect-probe.sh` 起它）。
//
// 【它证明什么（缺一不算"重定向可拦"）】
//   ① `redirect:'manual'` ⇒ 业务拿到 **302 + Location**，而不是跳到终点；
//   ② `onRedirect` 每跳都被调（能拿到 from/to/status）⇒ 业务可真"看见每一跳"；
//   ③ 跳数上限真的拦住环（返回 `fetch.tooManyRedirects`，不是静默成功）；
//   ④ **跨域跳转剥离 Authorization**（本服务记录每跳收到的凭据头，探针比对其"是否消失"）。
//
// 【★为什么要两个端口】跨域判定看 scheme+host+port ⇒ 同进程两个 listener 即可造出
//   "另一个 origin"（不必依赖外网；判据可复现）。
//
// 【★为什么记录了 `seen` 列表】只看客户端回溯不够——服务端**真的收到过什么头**才是事实。
//   这是本仓「判据要取证到对端」的同一纪律（与 #1095 的逐字节核对同源）。
//
// 用法：node redirect-echo-server.mjs <portA> <portB>
//   输出一行 `READY <portA> <portB>`（脚本读它，不盲等）

import http from 'node:http'

const portA = Number(process.argv[2] ?? 8801)
const portB = Number(process.argv[3] ?? 8802)

/** 记录每一次被访问的 (路径, 方法, 凭据头, 是否跟随过) —— 探针与脚本读它。 */
const seen = []

function handler(name) {
  return (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const rec = {
      port: name,
      path: u.pathname,
      method: req.method ?? '',
      auth: req.headers.authorization ?? '',
      cookie: req.headers.cookie ?? '',
      trace: req.headers['x-trace'] ?? '',
      // 客户端自报的跳数（探针会把"这是第几跳"放进 header，便于核对"真的重发了"）
      hop: req.headers['x-probe-hop'] ?? '',
    }
    seen.push(rec)

    // ① 单跳：302 → /final
    if (u.pathname === '/one') {
      res.writeHead(302, { location: '/final' })
      res.end()
      return
    }
    // ② 两跳：/two → /one → /final
    if (u.pathname === '/two') {
      res.writeHead(301, { location: '/one' })
      res.end()
      return
    }
    // ③ 环
    if (u.pathname === '/loop1') {
      res.writeHead(302, { location: '/loop2' })
      res.end()
      return
    }
    if (u.pathname === '/loop2') {
      res.writeHead(302, { location: '/loop1' })
      res.end()
      return
    }
    // ④ 跨域：跳到另一个端口（用 query 传目标，便于脚本控制）
    if (u.pathname === '/cross') {
      const to = u.searchParams.get('to') ?? ''
      res.writeHead(302, { location: to })
      res.end()
      return
    }
    // ⑤ 303 / 307（方法改写判据）
    if (u.pathname === '/see-other') {
      res.writeHead(303, { location: '/echo' })
      res.end()
      return
    }
    if (u.pathname === '/temp') {
      res.writeHead(307, { location: '/echo' })
      res.end()
      return
    }
    // ⑥ 回显（探针读 method/auth）
    if (u.pathname === '/echo') {
      let body = ''
      req.on('data', (c) => (body += String(c)))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'x-probe': 'echo' })
        res.end(JSON.stringify({ port: name, method: req.method, body, auth: rec.auth, cookie: rec.cookie }))
      })
      return
    }
    // ⑦ 终点
    if (u.pathname === '/final') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-probe': 'final' })
      res.end(JSON.stringify({ ok: true, port: name, auth: rec.auth, cookie: rec.cookie }))
      return
    }
    // ⑧ 记账出口（脚本/探针读服务端视角）
    if (u.pathname === '/__seen') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(seen))
      return
    }
    if (u.pathname === '/__reset') {
      seen.length = 0
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (u.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(404)
    res.end('nope')
  }
}

const a = http.createServer(handler('A'))
const b = http.createServer(handler('B'))
a.listen(portA, '0.0.0.0', () => {
  b.listen(portB, '0.0.0.0', () => {
    process.stdout.write(`READY ${portA} ${portB}\n`)
  })
})
process.on('SIGTERM', () => {
  a.close(() => b.close(() => process.exit(0)))
})

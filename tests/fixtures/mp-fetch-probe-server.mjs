// tests/fixtures/mp-fetch-probe-server.mjs
// ★★★#1130：MP 真容器 e2e 的**外部**探针服务（独立进程，不是测试进程内）。
//
// 【为什么必须是独立进程（真跑抓出）】
//   `packages/test-core/src/driver/wxide.ts` 的调用是 `spawnSync` ⇒ **阻塞 Node 事件循环**。
//   若 HTTP 服务与测试同进程，整个请求期间服务端根本不会 accept/respond：
//     · 正常路径用例在 `automation_evaluate` 里挂到 tool 自己超时（退出码 1）；
//     · 而 timeout/unsupported 用例反而"通过"（它们不等服务端）——**假绿**。
//   独立进程不受父进程事件循环阻塞影响，是这条链路的唯一正确形态。
//
// 【契约】启动后向 stdout 打印一行 `READY <port>`（端口 0 = 内核分配），父进程读管道等它
//   ——「让被测对象主动上报」形态，零轮询、零 sleep。
//
// 【路由】
//   /echo?…  ⇒ JSON 回显 { path, search, query }（验 params 真的拼进 URL）
//   /bin     ⇒ 4 字节 01 02 03 FA（验 responseType=arraybuffer 的裸字节）
//   /slow    ⇒ 3000ms 后才回（验 timeout 真的中断）
//   其他     ⇒ 404 'nope'
import http from 'node:http'

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (u.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json', 'x-probe': 'mp-true' })
    res.end(JSON.stringify({ path: u.pathname, search: u.search, query: Object.fromEntries(u.searchParams) }))
    return
  }
  if (u.pathname === '/bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.from([1, 2, 3, 250]))
    return
  }
  if (u.pathname === '/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('late')
    }, 3000)
    return
  }
  res.writeHead(404)
  res.end('nope')
})

server.listen(0, '127.0.0.1', () => {
  const addr = server.address()
  process.stdout.write(`READY ${addr.port}\n`)
})

// 父进程 kill 时安静退出（SIGTERM 默认行为即可，这里只为显式关闭监听）
process.on('SIGTERM', () => server.close(() => process.exit(0)))

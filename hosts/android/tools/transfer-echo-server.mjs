// hosts/android/tools/transfer-echo-server.mjs
// ★★★决策 #1095：上传/下载真机判据用的**本地 HTTP 服务**（`run-transfer-probe.sh` 起它）。
//
// 【它证明什么】
//   · `POST /upload`：读 multipart body，回 `{ ok, bytes, fields, filename }`——
//     让探针能**逐字节核对**服务端收到的文件内容（不是"看起来传完了"）。
//   · `GET /download?size=N`：回 N 个可预测字节（`i % 256`）——探针落盘后读回逐字节比对。
//   · `GET /health`：就绪探针（脚本用 --http 等它，不盲等）。
//
// 【为什么不用公网】判据要可复现：公网服务会限流/断连，而"连不上"与"宿主腿有 bug"无法区分。

import http from 'node:http'
import crypto from 'node:crypto'

const port = Number(process.argv[2] ?? 8788)
const host = process.argv[3] ?? '127.0.0.1'

/** 从 multipart body 里抽出文件字节与普通字段（够用的最小解析）。 */
function parseMultipart(body, boundary) {
  // ★Bug 修正（实测）：Buffer 没有 split ⇒ 原实现直接 TypeError，服务端崩、客户端看到
  //   "unexpected end of stream"。改成**按字节切分**（不把文件内容当文本，二进制安全）。
  const delim = Buffer.from(`--${boundary}`)
  // ★只取**分隔符之后**的段（第一个 delim 之前是空/前导，不是 part）
  const parts = []
  let from = body.indexOf(delim)
  if (from < 0) return { file: null, filename: null, fields: {} }
  from += delim.length
  for (;;) {
    const at = body.indexOf(delim, from)
    if (at < 0) break
    parts.push(body.subarray(from, at))
    from = at + delim.length
  }
  const fields = {}
  let file = null
  let filename = null
  for (const part of parts) {
    const idx = part.indexOf('\r\n\r\n')
    if (idx < 0) continue
    const head = part.subarray(0, idx).toString('utf8')
    let data = part.subarray(idx + 4)
    // 去掉尾部 \r\n
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) {
      data = data.subarray(0, data.length - 2)
    }
    const nameM = /name="([^"]+)"/.exec(head)
    if (!nameM) continue
    const name = nameM[1]
    const fileM = /filename="([^"]*)"/.exec(head)
    if (fileM) { file = data; filename = fileM[1] } else { fields[name] = data.toString('utf8') }
  }
  return { file, filename, fields }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  if (url.pathname === '/download') {
    const size = Math.min(Number(url.searchParams.get('size') ?? 1024), 8 * 1024 * 1024)
    const buf = Buffer.alloc(size)
    for (let i = 0; i < size; i++) buf[i] = i % 256
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(size) })
    res.end(buf)
    console.error(`[transfer] download ${size}B`)
    return
  }
  /**
   * ★★★#1118：**慢速流式**端点——验证 S3 的「边读边推 + 真背压」。
   * `GET /stream?chunks=N&size=B&delayMs=D`
   *   · 分 N 块、每块 B 字节、块间等 D 毫秒（`setTimeout`，不是忙等）
   *   · **不声明 content-length**（chunked）⇒ 宿主只能边读边推，无法预分配
   *   ★为什么需要 delayMs：本地回环太快，**不给消费侧制造压力就看不出背压**——
   *     "队列从未满过"与"没有队列"在读数上完全同形（本仓 #1103 踩过"首遍读数冒充稳态"同族）。
   *   ★响应是**可校验的确定序列**（第 i 块第 j 字节 = (i*31+j) & 0xff）⇒ 消费侧能逐字节验证
   *     "没丢块、没乱序"（只统计块数会漏掉"内容错位"）。
   */
  if (url.pathname === '/stream') {
    const chunks = Math.min(Number(url.searchParams.get('chunks') ?? 64), 4096)
    const size = Math.min(Number(url.searchParams.get('size') ?? 16 * 1024), 1024 * 1024)
    const delayMs = Math.min(Number(url.searchParams.get('delayMs') ?? 0), 500)
    res.writeHead(200, { 'content-type': 'application/octet-stream' }) // ★无 content-length
    let i = 0
    const pump = () => {
      if (i >= chunks) { res.end(); console.error(`[transfer] stream done chunks=${chunks} size=${size} delay=${delayMs}`); return }
      const buf = Buffer.alloc(size)
      for (let j = 0; j < size; j++) buf[j] = (i * 31 + j) & 0xff
      i++
      res.write(buf)
      if (delayMs > 0) setTimeout(pump, delayMs)
      else pump()
    }
    pump()
    return
  }
  /**
   * ★★★决策 #1115：**超大响应**端点——专门验证 `fetch.tooLarge`。
   * `GET /huge?size=N&chunked=1`
   *   · 默认带 `content-length` ⇒ 宿主走"**预判**"那道闸（见 Android `perform()`）
   *   · `chunked=1` ⇒ **不声明长度**、分块写出 ⇒ 宿主走"**读取累计**"那道闸
   * ★两道闸必须**各自**被验证——只测一个有洞：谎报/未知长度时预判失效。
   * ★上限放宽到 256 MiB（本端点就是拿来超限的，不能被 /download 的 8 MiB 夹住）。
   */
  if (url.pathname === '/huge') {
    const size = Math.min(Number(url.searchParams.get('size') ?? 64 * 1024 * 1024), 256 * 1024 * 1024)
    const chunked = url.searchParams.get('chunked') === '1'
    if (chunked) res.writeHead(200, { 'content-type': 'application/octet-stream' }) // 无 content-length
    else res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(size) })
    const CH = 64 * 1024
    let sent = 0
    const pump = () => {
      while (sent < size) {
        const n = Math.min(CH, size - sent)
        sent += n
        if (!res.write(Buffer.alloc(n, 7))) { res.once('drain', pump); return }
      }
      res.end()
      console.error(`[transfer] huge ${size}B chunked=${chunked}`)
    }
    pump()
    return
  }
  /**
   * `ANY /body-echo` —— ★★★#1160：**请求体回显**（POST/PUT 带体探针的服务端）。
   *
   * 【为什么必须加这个端点】换栈第一版 `perform()`（整包路径）漏了 `cfg.body` ⇒
   *   Android 所有带 `data` 的 POST/PUT **静默变空体**。而原有探针全是 GET/上传/流式/落盘
   *   ⇒ **没有任何一条覆盖"整包路径 + 请求体"**，9 组真机回归全绿而功能已坏。
   *   本端点把"服务端到底收到多少字节"变成可断言的事实（length / 首末字节 / Content-Type）。
   *
   * ★也接受 GET（返回 length=0），用来证明"没有把体错挂到 GET"（OkHttp 会直接抛）。
   */
  if (url.pathname === '/body-echo') {
    const ct = String(req.headers['content-type'] ?? '')
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const digest = crypto.createHash('sha256').update(body).digest('hex')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        method: req.method,
        length: body.length,
        sha: digest,
        first: body.length > 0 ? body[0] : -1,
        last: body.length > 0 ? body[body.length - 1] : -1,
        contentType: ct,
      }))
      console.error(`[transfer] body-echo ${req.method} ${body.length}B sha=${digest.slice(0, 12)} ct=${ct}`)
    })
    return
  }
  if (url.pathname === '/upload' && req.method === 'POST') {
    const ct = req.headers['content-type'] ?? ''
    const bm = /boundary=(.+)$/.exec(ct)
    if (!bm) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'missing boundary' }))
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const { file, filename, fields } = parseMultipart(body, bm[1])
      const n = file ? file.length : 0
      // ★#1120：大文件（> 4 MiB）**不逐字节 reduce**——那是 O(n) 的 JS 循环，
      //   8 MiB 要跑几千万次取模（本机实测拖慢判据数十秒）。改为**采样**校验：
      //   头尾 + 等距 512 点，足以发现"字节错位/截断/全零"。
      const SAMPLED_MAX = 4 * 1024 * 1024
      let sum = 0
      let sampled = 0
      if (file) {
        if (n <= SAMPLED_MAX) { sum = file.reduce((a, b) => (a + b) % 1000003, 0); sampled = n }
        else {
          const step = Math.max(1, Math.floor(n / 512))
          for (let i = 0; i < n; i += step) { sum = (sum + file[i]) % 1000003; sampled++ }
        }
      }
      const out = {
        ok: true,
        bytes: n,
        filename,
        fields,
        // ★摘要（探针据此断言"服务端收到的就是你发的"）
        first: file && n ? file[0] : null,
        last: file && n ? file[n - 1] : null,
        sum,
        sampled,
      }
      console.error(`[transfer] upload ${out.bytes}B filename=${filename} fields=${JSON.stringify(fields)}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out))
    })
    return
  }
  /**
   * ★★★#1404 请求层**并发吞吐**端点：`GET /perf?i=N`
   *   · 极小的 200 JSON（无延迟）——量的是**宿主管道 + 连接复用**，不是服务端业务耗时
   *   · 回显序号 ⇒ 客户端能核对"响应确实属于本次请求"（不只看个数）
   *   · ★之前没有本路由，探针打到 404 兜底：`useFetch` 只要传输成功就 `ok:true`，
   *     所以旧读数**也是完整的 HTTP 往返**，但"404 也能当成功"不该是吞吐口径的默认形态。
   *   · ★content-length 用 Buffer.byteLength 实测——写死常量在 i 跨位数时会**短报**，
   *     客户端按该长度截断 ⇒ 响应体不完整（假绿型缺陷）。
   */
  if (url.pathname === '/perf') {
    const body = Buffer.from('{"ok":1,"i":' + String(Number(url.searchParams.get('i') ?? 0) | 0) + '}')
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) })
    res.end(body)
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(port, host, () => {
  console.log(`transfer-echo-ready port=${port} host=${host}`)
})

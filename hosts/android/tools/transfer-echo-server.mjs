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
      const out = {
        ok: true,
        bytes: file ? file.length : 0,
        filename,
        fields,
        // ★逐字节摘要（探针据此断言"服务端收到的就是你发的"）
        first: file && file.length ? file[0] : null,
        last: file && file.length ? file[file.length - 1] : null,
        sum: file ? file.reduce((a, b) => (a + b) % 1000003, 0) : 0,
      }
      console.error(`[transfer] upload ${out.bytes}B filename=${filename} fields=${JSON.stringify(fields)}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(out))
    })
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(port, host, () => {
  console.log(`transfer-echo-ready port=${port} host=${host}`)
})

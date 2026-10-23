// hosts/harmony/upload-probe-server.mjs
// ★★★#1205：鸿蒙 multipart 上传的**服务端回显装置**（判据用，不是产品代码）。
//
// 【为什么必须有它】上传"请求成功"说明不了任何事——真正的判据是**服务端收到了什么**：
//   · 有没有 `boundary`（且与客户端 Content-Type 里声明的一致）；
//   · 表单字段的名字/值对不对；
//   · 文件字段的 filename 对不对；
//   · 文件字节是否**逐字节等于**源文件（用 sha256 对拍，不看长度——长度对但内容错照样是坏的）。
//   ⇒ 服务端解析 multipart 并把结构回显成 JSON，判据脚本据此断言。
//
// 【诚实边界】本服务端只做"够用的 multipart 解析"（单层、文本字段 + 单文件字段），
//   不实现 RFC 7578 的全部分支（嵌套 multipart / 编码文件名等）。够判据用。
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const PORT = Number(process.env.UPLOAD_PORT || 18081)
const STATS = process.env.UPLOAD_STATS || '/tmp/proteus-upload/upload-probe-server.json'
const MAX = 64 * 1024 * 1024

/** 从 Content-Type 里取 boundary */
function boundaryOf(ct) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct || '')
  return m ? (m[1] || m[2] || '').trim() : ''
}

/**
 * 解析 multipart 体（够用即可）。
 * @returns {{fields: Array<{name:string,value:string}>, file: {name:string,filename:string,bytes:number,sha256:string}|null}}
 */
function parseMultipart(buf, boundary) {
  const out = { fields: [], file: null }
  if (!boundary) return out
  const delim = Buffer.from('--' + boundary)
  let i = buf.indexOf(delim)
  if (i < 0) return out
  while (i >= 0) {
    i += delim.length
    // 结束标记 `--`
    if (buf[i] === 0x2d && buf[i + 1] === 0x2d) break
    // 跳过 CRLF
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) i += 2
    const headEnd = buf.indexOf('\r\n\r\n', i)
    if (headEnd < 0) break
    const head = buf.toString('utf8', i, headEnd)
    const bodyStart = headEnd + 4
    const next = buf.indexOf(delim, bodyStart)
    if (next < 0) break
    // 体末尾去掉前导 CRLF
    let bodyEnd = next
    if (buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2
    const body = buf.subarray(bodyStart, bodyEnd)
    const nameM = /name="([^"]*)"/i.exec(head)
    const fileM = /filename="([^"]*)"/i.exec(head)
    const name = nameM ? nameM[1] : ''
    if (fileM) {
      out.file = {
        name,
        filename: fileM[1],
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      }
    } else {
      out.fields.push({ name, value: body.toString('utf8') })
    }
    i = next
  }
  return out
}

function persist(obj) {
  try {
    writeFileSync(STATS, JSON.stringify(obj, null, 2))
  } catch {
    /* 落盘失败不阻断 */
  }
}

const state = { requests: 0, last: null }

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(state))
    return
  }
  const chunks = []
  let total = 0
  let aborted = false
  req.on('data', (c) => {
    total += c.length
    if (total > MAX) {
      aborted = true
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted) return
    const buf = Buffer.concat(chunks)
    const ct = req.headers['content-type'] || ''
    const boundary = boundaryOf(ct)
    const parsed = parseMultipart(buf, boundary)
    state.requests++
    state.last = {
      method: req.method,
      contentType: ct,
      boundary,
      contentLength: req.headers['content-length'] || '',
      bodyBytes: buf.length,
      fields: parsed.fields,
      file: parsed.file,
      bodySha256: createHash('sha256').update(buf).digest('hex'),
    }
    persist(state)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, received: state.last }))
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PROTEUS_UPLOAD_SERVER_READY port=${PORT} stats=${STATS}`)
  persist(state)
})

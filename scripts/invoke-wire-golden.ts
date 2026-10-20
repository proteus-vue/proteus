// scripts/invoke-wire-golden.ts —— ★★跨语言对拍的**黄金向量生成器**（TS 侧）
//
// 【它解决什么（本仓纪律 #22「第 N 份手写副本 = 下一个静默缺陷」的机器化对策）】
//   invoke 通道的二进制线格式要在 **TS / Java / Swift / ArkTS** 各写一份编解码器。手写副本不可怕，
//   **没有对拍才可怕**（实测过的同族事故：hook 只自测"自己 stdout 有 deny"就宣布拦住了，
//   而消费方读的是另一套契约 ⇒ 契约从未成立）。⇒ 本脚本用 SSOT（`packages/api/src/invoke-wire.ts`）
//   产出**黄金向量**，由 `scripts/check-invoke-wire-parity.mjs` 喂给各端原生实现做逐字节比对。
//
// 【★为什么"期望值"是 TS 自己的**往返结果**而不是人写的常量】
//   `expect = encode(decode(input))` —— 断言的是「**Java 与 TS 语义等价**」，而不是「Java 等于某个
//   人手抄的字节串」。好处：① 向量改动只改一处（此文件）；② 版本演进（新增 TLV tag）时，
//   老实现"跳过未知 tag"的行为**自动**被验到（未知 tag 会在往返中被丢弃，两侧应丢成同一个结果）。
//
// 【输出格式（TSV——刻意不用 JSON）】每行 5 列，`\t` 分隔：
//   name · kind · inputHex · expectHex · extra
//   · kind=invoke / resolve ⇒ 期望 `encode(decode(input))` 的十六进制 == expectHex
//   · kind=reject-invoke / reject-resolve ⇒ 期望**对应解码器抛错**（expectHex 填 `-`）
//   · extra：kind=invoke 时 = `peekMethod` 的期望值（另一条独立入口也要对拍）；其余填 `-`
//   ★为什么不用 JSON：消费方是 **Java**（无 JSON 库依赖，且本单的整个立意就是"少一层 JSON"）。
//
// 用法：npx tsx scripts/invoke-wire-golden.ts <输出文件路径>
import fs from 'node:fs'

import { ByteWriter } from '../packages/shared/src/binary/wire.ts'
import {
  decodeInvokeFrame,
  decodeResolveFrame,
  encodeInvokeFrame,
  encodeResolveFrame,
  INVOKE_MAGIC,
  INVOKE_WIRE_VERSION,
  type InvokeFrame,
  type ResolveFrame,
} from '../packages/api/src/invoke-wire.ts'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

interface Row {
  name: string
  /** ★`reject-*` 必须点明**用哪个解码器**去拒（同一段字节，去程/回程解码器互不通用 ⇒ 不能靠名字猜） */
  kind: 'invoke' | 'resolve' | 'reject-invoke' | 'reject-resolve'
  inputHex: string
  expectHex: string
  extra: string
}

const rows: Row[] = []

/** 去程向量：`expect` = TS 自己的往返结果（见文件头【为什么】）。 */
function addInvoke(name: string, frame: InvokeFrame): void {
  const input = encodeInvokeFrame(frame)
  const expect = encodeInvokeFrame(decodeInvokeFrame(input))
  rows.push({ name, kind: 'invoke', inputHex: hex(input), expectHex: hex(expect), extra: frame.method })
}

/** 回程向量：同法。 */
function addResolve(name: string, frame: ResolveFrame): void {
  const input = encodeResolveFrame(frame)
  const expect = encodeResolveFrame(decodeResolveFrame(input))
  rows.push({ name, kind: 'resolve', inputHex: hex(input), expectHex: hex(expect), extra: '-' })
}

/** 直接用**构造好的字节**当输入（用于"未知 tag"/"坏帧"这类无法用编码器产生的形态）。 */
function addRawInvoke(name: string, input: Uint8Array): void {
  const expect = encodeInvokeFrame(decodeInvokeFrame(input))
  rows.push({ name, kind: 'invoke', inputHex: hex(input), expectHex: hex(expect), extra: decodeInvokeFrame(input).method })
}

function addReject(name: string, input: Uint8Array, kind: 'reject-invoke' | 'reject-resolve'): void {
  rows.push({ name, kind, inputHex: hex(input), expectHex: '-', extra: '-' })
}

/* ══════════════════ 去程向量（`http.request` 为主，但**不以方法名为判据**） ══════════════════ */

// ① 最小形态：只有 url，无 body、无 timeout、responseType 未指定
addInvoke('invoke-min-url-only', {
  method: 'http.request',
  reqId: 'app-async-1',
  meta: { url: 'https://api.example.cn/v1/ping' },
})

// ② 全字段：方法 / 头 / query / 超时 / 响应类型 / MIME / body
addInvoke('invoke-all-fields', {
  method: 'http.request',
  reqId: 'app-async-2',
  meta: {
    url: 'https://api.example.cn/v1/orders',
    method: 'POST',
    headers: { 'X-Trace-Id': 'abc-123', Accept: 'application/json' },
    params: { page: '1', size: '20' },
    timeoutMs: 8000,
    responseType: 'json',
    contentType: 'application/json',
  },
  body: new TextEncoder().encode('{"sku":"A-1","qty":2}'),
})

// ③ 中文 / 多字节：url、头值、body 全含非 ASCII（证 UTF-8 逐字节一致，且**无 JSON 转义膨胀**）
addInvoke('invoke-utf8-cn', {
  method: 'http.request',
  reqId: 'app-async-中文-3',
  meta: {
    url: 'https://api.example.cn/搜索?q=互助公约',
    method: 'POST',
    headers: { 'X-备注': '康爱公社 · 大病互助' },
    responseType: 'text',
    contentType: 'text/plain; charset=utf-8',
  },
  body: new TextEncoder().encode('你好，世界 —— Proteus 跨语言二进制通道'),
})

// ④ 引号 / 反斜杠 / 换行：证**不经 JSON**（若走 JSON 会变成 \" \\ \n，字节数会变）
addInvoke('invoke-escapes-no-json', {
  method: 'http.request',
  reqId: 'r-esc',
  meta: {
    url: 'https://api.example.cn/a"b\\c',
    headers: { 'X-Pattern': "line1\nline2'quote\\back" },
  },
  body: new TextEncoder().encode('{"raw":"a\\"b\\nc"}'),
})

// ⑤ 全 256 字节值：证 body 是**裸字节**（若当字符串处理，非法 UTF-8 会在此炸掉或替换）
{
  const all = new Uint8Array(256)
  for (let i = 0; i < 256; i++) all[i] = i
  addInvoke('invoke-all-byte-values', {
    method: 'http.request',
    reqId: 'r-256',
    meta: { url: 'https://api.example.cn/blob', method: 'PUT', responseType: 'arraybuffer' },
    body: all,
  })
}

// ⑥ 大载荷（64KB 伪随机）：体积与游标推进的规模校验
{
  const big = new Uint8Array(64 * 1024)
  let seed = 0x12345678
  for (let i = 0; i < big.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    big[i] = seed & 0xff
  }
  addInvoke('invoke-large-body-64k', {
    method: 'http.request',
    reqId: 'r-big',
    meta: { url: 'https://api.example.cn/upload', method: 'POST', responseType: 'text' },
    body: big,
  })
}

// ⑦ 空字符串方法名 / reqId + 显式 `responseType: 'text'`（= 0 ⇒ 必须**写**该 TLV，不能被"默认值省略"吞掉）
addInvoke('invoke-empty-strings', {
  method: '',
  reqId: '',
  meta: { url: 'https://api.example.cn/x', responseType: 'text' },
})

// ⑧ 未知 TLV tag（tag=99）⇒ 两侧都必须**跳过**（版本演进纪律），往返后该 tag 应消失
{
  const meta = new ByteWriter(64, false)
  meta.u8(99)            // ★未知 tag（当前契约里 1–7 去程 / 16–20 回程，99 不在其中）
  meta.u32(2)
  meta.u8(0xaa)
  meta.u8(0xbb)
  meta.u8(1)             // 已知 tag: Url
  const at = meta.length
  meta.u32(0)
  const payloadAt = meta.length
  meta.str('https://api.example.cn/unk')
  meta.patchU32(at, meta.length - payloadAt)
  const metaBytes = meta.done()

  const w = new ByteWriter(64, false)
  w.u32(INVOKE_MAGIC)
  w.u32(INVOKE_WIRE_VERSION)
  w.u32(0)
  w.u32(metaBytes.length)
  w.u32(0)
  w.str('http.request')
  w.str('r-unknown-tag')
  w.raw(metaBytes)
  addRawInvoke('invoke-unknown-tag-skipped', w.done())
}

// ⑨ 未知方法名（非网络类）——线格式**不关心方法语义**（数据驱动）；仍应逐字节往返一致
addInvoke('invoke-other-method-name', {
  method: 'window.setSize',
  reqId: 'r-other',
  meta: { timeoutMs: 0 },
  body: new TextEncoder().encode('{"width":390,"height":844}'),
})

// ⑨b ★#1118 流式请求：`stream: true` 必须写 tag 8（值 1）
addInvoke('invoke-stream-true', {
  method: 'http.request',
  reqId: 'r-stream-1',
  meta: { url: 'https://api.example.cn/v1/events', responseType: 'text', stream: true },
})

// ⑨d ★#1119 落盘路径：宿主直写沙箱（download 到 S3 的关键——JS 完全不碰字节）
addInvoke('invoke-save-path', {
  method: 'http.request',
  reqId: 'r-save-1',
  meta: { url: 'https://api.example.cn/v1/pkg.apk', responseType: 'arraybuffer', savePath: 'download/pkg.apk' },
})

// ⑨e ★#1119 落盘 + 流式同帧（宿主边收边写 + 顺带回推块做进度）
addInvoke('invoke-save-path-stream', {
  method: 'http.request',
  reqId: 'r-save-2',
  meta: { url: 'https://api.example.cn/big.bin', savePath: 'download/big.bin', stream: true },
})

// ⑨c ★#1118 `stream: false` 与缺省**同为整包** ⇒ 都必须**不写** tag 8（往返后 tag 消失）
//      ★这条是"判据配对"：只测 true 的话，把 false 也写成 tag 的实现会漏网。
addInvoke('invoke-stream-false-no-tag', {
  method: 'http.request',
  reqId: 'r-stream-0',
  meta: { url: 'https://api.example.cn/v1/events', stream: false },
})

// ⑨f ★#1120 流式上传：宿主自读文件 + 自拼 multipart（字段名/boundary/formData 都由 JS 决定）
addInvoke('invoke-upload-path', {
  method: 'http.request',
  reqId: 'r-up-1',
  meta: {
    url: 'https://api.example.cn/upload',
    method: 'POST',
    contentType: 'multipart/form-data; boundary=----B1',
    upload: {
      path: 'upload/a.bin',
      fieldName: 'file',
      filename: 'a.bin',
      boundary: '----B1',
      formData: { tag: 'probe', 中文: '值' },
    },
  },
})

// ⑨g ★#1120 空 formData（必须是 count=0，不是省略该项——否则两端解码分叉）
addInvoke('invoke-upload-no-fields', {
  method: 'http.request',
  reqId: 'r-up-2',
  meta: {
    url: 'https://api.example.cn/upload',
    upload: { path: 'upload/b.bin', fieldName: 'file', filename: 'b.bin', boundary: '----B2' },
  },
})

// ⑨h ★#1134 重定向不跟随：redirectManual=true 必须写 tag 11（值 1）
//      ★语义：宿主据此**不跟随** 3xx，把 status + Location 原样回给 JS 由框架层决定。
addInvoke('invoke-redirect-manual', {
  method: 'http.request',
  reqId: 'r-redir-1',
  meta: { url: 'https://api.example.cn/v1/login', responseType: 'text', redirectManual: true },
})

// ⑨i ★#1134 判据配对：redirectManual=false / 缺省 ⇒ **都不写** tag 11（往返后 tag 消失）
//      ★只测 true 的话，"把 false 也写成 tag"的实现会漏网（与 ⑨c 的 stream:false 同款配对）。
addInvoke('invoke-redirect-false-no-tag', {
  method: 'http.request',
  reqId: 'r-redir-0',
  meta: { url: 'https://api.example.cn/v1/login', redirectManual: false },
})

// ⑨j ★#1134 redirectManual 与保存/流式同帧（真实组合：下载链接 302 到 CDN + 要落盘）
addInvoke('invoke-redirect-save-path', {
  method: 'http.request',
  reqId: 'r-redir-2',
  meta: {
    url: 'https://api.example.cn/v1/pkg.apk',
    responseType: 'arraybuffer',
    savePath: 'download/pkg.apk',
    redirectManual: true,
  },
})

/* ══════════════════ 回程向量 ══════════════════ */

// ⑩ 受理回执（pending）—— 决定 JS 侧"保持挂起"的那一帧
addResolve('resolve-pending', { reqId: 'app-async-9', ok: true, pending: true })

// ⑪ 成功 + 状态码 + 响应头 + 中文 body
addResolve('resolve-ok-headers-body', {
  reqId: 'app-async-10',
  ok: true,
  status: 200,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Trace': 'T-1' },
  body: new TextEncoder().encode('{"message":"登录成功","token":"a.b.c"}'),
})

// ⑫ 失败 + missing（桥据 `missing` 给 `*.unsupported`，与 JSON 通道同口径）
addResolve('resolve-err-missing', {
  reqId: 'app-async-11',
  ok: false,
  reason: 'invokeBytes 宿主侧失败：帧解码失败',
  missing: true,
})

// ⑬ `pending:false` / `missing:false` 显式布尔（= tag 必须**写**且值为 0，不能被吞）
addResolve('resolve-explicit-false-flags', { reqId: 'r-false', ok: true, pending: false, missing: false })

// ⑭ 最小成功回程（无 meta / 无 body）
addResolve('resolve-minimal', { reqId: 'r-min', ok: true })

// ⑮ 二进制响应体（含 0x00 与全 0xFF）——证响应体不经文本层
{
  const b = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x00, 0x7f, 0x80, 0xff])
  addResolve('resolve-binary-body', { reqId: 'r-bin', ok: true, status: 206, body: b })
}

// ⑯ 大响应体（128KB 伪随机）——"响应体几 MB 不再膨胀 3~4×"的规模位
{
  const big = new Uint8Array(128 * 1024)
  let seed = 0x0badc0de
  for (let i = 0; i < big.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    big[i] = seed & 0xff
  }
  addResolve('resolve-large-body-128k', { reqId: 'r-rbig', ok: true, status: 200, body: big })
}

// ⑰ ★#1118 流式数据块：`streamSeq` + `pending` + body（三者同帧 ⇒ 不结算）
addResolve('resolve-stream-chunk', {
  reqId: 'r-stream-1',
  ok: true,
  pending: true,
  streamSeq: 0,
  body: new TextEncoder().encode('data: {"n":1}\n\n'),
})

// ⑱ ★同一 reqId 的末块（seq 高、**无 pending**）= 最终帧（结算点）
//    ★判据：有流式块与最终帧是**两种帧**；把末块也写成 pending 会让调用方永远挂着。
addResolve('resolve-stream-final', {
  reqId: 'r-stream-1',
  ok: true,
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
  body: new TextEncoder().encode('data: [DONE]\n\n'),
})

// ⑲ 流式块 seq 为 0 且无 body（空块/心跳）——证"有 streamSeq 就是块"，不靠 body 非空推断
addResolve('resolve-stream-empty-chunk', { reqId: 'r-stream-2', ok: true, pending: true, streamSeq: 0 })

/* ══════════════════ 坏帧（两侧都必须**拒**，不许静默接受） ══════════════════ */

{
  const good = encodeInvokeFrame({ method: 'http.request', reqId: 'r', meta: { url: 'https://x.cn/' } })

  const badMagic = good.slice()
  badMagic[0] = 0x51 // 'Q' 而不是 'P' ⇒ magic 不符
  addReject('reject-bad-magic', badMagic, 'reject-invoke')

  const badVersion = good.slice()
  badVersion[4] = 0x02 // version = 2
  addReject('reject-bad-version', badVersion, 'reject-invoke')

  const trailing = new Uint8Array(good.length + 3)
  trailing.set(good, 0)
  addReject('reject-trailing-bytes', trailing, 'reject-invoke')

  addReject('reject-truncated', good.subarray(0, good.length - 3), 'reject-invoke')
  addReject('reject-empty', new Uint8Array(0), 'reject-invoke')

  // header 完整但 method 长度前缀指向超出缓冲的长度 ⇒ str 截断
  const badLen = good.slice()
  badLen[20] = 0xff // method 的 u16 长度低位（原为 0x0c = 12）⇒ 变 255
  badLen[21] = 0x00
  addReject('reject-str-overrun', badLen, 'reject-invoke')

  // 回程帧也要拒（同一纪律）
  const badResolve = encodeResolveFrame({ reqId: 'r', ok: true })
  badResolve[0] = 0x51 // 'Q' 而不是 'P'
  addReject('reject-resolve-bad-magic', badResolve, 'reject-resolve')

  // ★方向互不通用：**去程**帧交给**回程**解码器也必须拒（防两向混用）
  addReject('reject-cross-direction', good, 'reject-resolve')
}

/* ══════════════════ 输出 ══════════════════ */

const outPath = process.argv[2]
if (!outPath) {
  console.error('用法：npx tsx scripts/invoke-wire-golden.ts <输出文件路径>')
  process.exit(2)
}
const lines = [
  '# invoke-wire golden vectors · 由 scripts/invoke-wire-golden.ts 用 SSOT 编解码器生成',
  '# name\tkind\tinputHex\texpectHex\textra',
  ...rows.map((r) => [r.name, r.kind, r.inputHex, r.expectHex, r.extra].join('\t')),
]
fs.writeFileSync(outPath, lines.join('\n') + '\n')
console.log(`✓ 黄金向量 ${rows.length} 条 → ${outPath}`)

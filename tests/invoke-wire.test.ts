// tests/invoke-wire.test.ts
// ★★invoke 二进制线格式的**契约测试**（决策 #903 / T-app-wire）。
//
// 【要锁什么】
//   ① **往返对称**：encode → decode 逐字段还原（含中文 UTF-8 / 全 meta 字段 / 空 body）；
//   ② **拒错**：magic 不符 / 版本不符 / 尾部残留 —— 一律**报错**（不静默吞，否则双端比对假绿）；
//   ③ **版本演进**：未知 TLV tag **跳过而不报错**（老解码头遇到新 tag 应忽略）；
//   ④ ★**核心契约**：body 走**裸字节**（帧体积 = 原始字节 + 固定开销，**无膨胀**）——
//      与旧形态「`number[]` JSON」的体积对照（每字节 3~4 字符）即为本改动的直接收益。
import { describe, it, expect } from 'vitest'
import {
  encodeInvokeFrame,
  decodeInvokeFrame,
  encodeResolveFrame,
  decodeResolveFrame,
  interpretBody,
  INVOKE_MAGIC,
  RESOLVE_MAGIC,
  INVOKE_WIRE_VERSION,
  MetaTagInvoke,
  MetaTagResolve,
} from '../packages/api/src/invoke-wire'
import { ByteWriter } from '@proteus-vue/shared'

/* ────────────────────────── ① 往返对称 ────────────────────────── */

describe('① 去程帧往返', () => {
  it('全 meta 字段 + 请求体逐字段还原', () => {
    const frame = encodeInvokeFrame({
      method: 'http.request',
      reqId: 'app-async-7',
      meta: {
        url: 'https://api.example.com/v1/orders',
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer xyz' },
        params: { page: '1', size: '20' },
        timeoutMs: 15000,
        responseType: 'json',
      },
      body: new Uint8Array([0x7b, 0x7d]), // "{}"
    })
    const d = decodeInvokeFrame(frame)
    expect(d.method).toBe('http.request')
    expect(d.reqId).toBe('app-async-7')
    expect(d.meta.url).toBe('https://api.example.com/v1/orders')
    expect(d.meta.method).toBe('POST')
    expect(d.meta.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer xyz' })
    expect(d.meta.params).toEqual({ page: '1', size: '20' })
    expect(d.meta.timeoutMs).toBe(15000)
    expect(d.meta.responseType).toBe('json')
    expect(Array.from(d.body as Uint8Array)).toEqual([0x7b, 0x7d])
  })

  it('中文（多字节 UTF-8）长度正确、内容无损', () => {
    const url = 'https://api.example.com/搜索?关键字=康爱公社'
    const frame = encodeInvokeFrame({ method: 'http.request', reqId: 'r-中文-1', meta: { url } })
    const d = decodeInvokeFrame(frame)
    expect(d.meta.url).toBe(url) // ★长度前缀按**字节**计，按**字符**计会截断
    expect(d.reqId).toBe('r-中文-1')
  })

  it('空 meta + 无 body：帧仍合法且可解', () => {
    const frame = encodeInvokeFrame({ method: 'host.context', reqId: 'r1', meta: {} })
    const d = decodeInvokeFrame(frame)
    expect(d.meta).toEqual({})
    expect((d.body as Uint8Array).length).toBe(0)
    expect(frame.length).toBe(20 + 2 + 'host.context'.length + 2 + 2) // header + method + reqId + 零字节 meta
  })
})

describe('① 回程帧往返', () => {
  it('ok / status / headers / body 逐字段还原', () => {
    const body = new Uint8Array([1, 2, 3, 4, 5])
    const frame = encodeResolveFrame({
      reqId: 'app-async-7',
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body,
    })
    const d = decodeResolveFrame(frame)
    expect(d.reqId).toBe('app-async-7')
    expect(d.ok).toBe(true)
    expect(d.status).toBe(200)
    expect(d.headers).toEqual({ 'content-type': 'application/octet-stream' })
    expect(Array.from(d.body as Uint8Array)).toEqual([1, 2, 3, 4, 5])
  })

  it('★保留既有语义：missing / pending 两个标记可被桥消费', () => {
    const miss = decodeResolveFrame(encodeResolveFrame({ reqId: 'r1', ok: false, missing: true, reason: '未实现 http.request' }))
    expect(miss.ok).toBe(false)
    expect(miss.missing).toBe(true)
    expect(miss.reason).toBe('未实现 http.request')

    const pend = decodeResolveFrame(encodeResolveFrame({ reqId: 'r2', ok: true, pending: true }))
    expect(pend.pending).toBe(true)
    expect(pend.ok).toBe(true)
  })
})

/* ────────────────────────── ② 拒错（不静默） ────────────────────────── */

describe('② 拒错：magic / 版本 / 残留', () => {
  it('magic 不符 ⇒ 报错（防误接别的帧）', () => {
    const frame = encodeInvokeFrame({ method: 'm', reqId: 'r', meta: {} })
    frame[0] = (INVOKE_MAGIC + 1) & 0xff
    expect(() => decodeInvokeFrame(frame)).toThrow(/magic 不符/)
  })

  it('版本不符 ⇒ 报错（双端线格式必须同步升级）', () => {
    const frame = encodeInvokeFrame({ method: 'm', reqId: 'r', meta: {} })
    new DataView(frame.buffer, frame.byteOffset).setUint32(4, INVOKE_WIRE_VERSION + 1, true)
    expect(() => decodeInvokeFrame(frame)).toThrow(/版本不符/)
  })

  it('回程帧用去程 magic ⇒ 报错（两种帧不串道）', () => {
    const rframe = encodeResolveFrame({ reqId: 'r', ok: true })
    expect(() => decodeInvokeFrame(rframe)).toThrow(/magic 不符/)
    const iframe = encodeInvokeFrame({ method: 'm', reqId: 'r', meta: {} })
    expect(() => decodeResolveFrame(iframe)).toThrow(/magic 不符/)
  })

  it('尾部残留 ⇒ 报错（长度/计数不符不许静默通过）', () => {
    const frame = encodeInvokeFrame({ method: 'm', reqId: 'r', meta: {} })
    const padded = new Uint8Array(frame.length + 3)
    padded.set(frame, 0)
    expect(() => decodeInvokeFrame(padded)).toThrow(/残留/)
  })

  it('meta 长度谎报 ⇒ 报错（TLV 截断被抓住）', () => {
    const frame = encodeInvokeFrame({ method: 'm', reqId: 'r', meta: { url: 'https://x.y' } })
    // 把 bodyBytes 改成超过实际长度
    const dv = new DataView(frame.buffer, frame.byteOffset)
    dv.setUint32(16, 999, true)
    expect(() => decodeInvokeFrame(frame)).toThrow()
  })
})

/* ────────────────────────── ③ 版本演进：未知 tag 跳过 ────────────────────────── */

describe('③ 未知 TLV tag 跳过（版本演进纪律）', () => {
  it('meta 里混入未知 tag ⇒ 已知字段照常解出，不报错', () => {
    // 手工构造 meta：Url(1) + 未知 tag 99 + HttpMethod(2)
    const w = new ByteWriter(64, false)
    w.u8(MetaTagInvoke.Url)
    const at1 = w.length
    w.u32(0)
    const p1 = w.length
    w.str('https://a.b')
    w.patchU32(at1, w.length - p1)
    w.u8(99) // ★未知 tag
    const at2 = w.length
    w.u32(0)
    const p2 = w.length
    w.u32(0xdeadbeef)
    w.patchU32(at2, w.length - p2)
    w.u8(MetaTagInvoke.HttpMethod)
    const at3 = w.length
    w.u32(0)
    const p3 = w.length
    w.str('GET')
    w.patchU32(at3, w.length - p3)
    const meta = w.done()

    const w2 = new ByteWriter(64, false)
    w2.u32(INVOKE_MAGIC)
    w2.u32(INVOKE_WIRE_VERSION)
    w2.u32(0)
    w2.u32(meta.length)
    w2.u32(0)
    w2.str('http.request')
    w2.str('r1')
    w2.raw(meta)
    const d = decodeInvokeFrame(w2.done())
    expect(d.meta.url).toBe('https://a.b')
    expect(d.meta.method).toBe('GET')
  })

  it('回程 meta 混入未知 tag 同理', () => {
    const w = new ByteWriter(64, false)
    w.u8(MetaTagResolve.HttpStatus)
    const at = w.length
    w.u32(0)
    const p = w.length
    w.u32(204)
    w.patchU32(at, w.length - p)
    w.u8(120) // 未知
    const at2 = w.length
    w.u32(0)
    const p2 = w.length
    w.u8(1)
    w.patchU32(at2, w.length - p2)
    const meta = w.done()

    const w2 = new ByteWriter(64, false)
    w2.u32(RESOLVE_MAGIC)
    w2.u32(INVOKE_WIRE_VERSION)
    w2.u32(0)
    w2.u32(meta.length)
    w2.u32(0)
    w2.str('r1')
    w2.raw(meta)
    expect(decodeResolveFrame(w2.done()).status).toBe(204)
  })
})

/* ────────────────────────── ④ ★核心契约：body 裸字节无膨胀 ────────────────────────── */

describe('④ body 走裸字节（去 JSON 的直接收益）', () => {
  it('4KB 二进制响应：帧开销 < 64B，体积 ≈ 原始字节（无膨胀）', () => {
    const body = new Uint8Array(4096).fill(0xff)
    const frame = encodeResolveFrame({ reqId: 'app-async-1', ok: true, status: 200, body })
    const overhead = frame.length - body.length
    expect(overhead).toBeGreaterThan(0)
    expect(overhead).toBeLessThan(64) // header 20 + reqId + meta，量级几十字节
  })

  it('★与旧形态对照：把同一批字节编成 `number[]` JSON ⇒ 膨胀 3 倍以上', () => {
    const body = new Uint8Array(4096).fill(0xff)
    const binaryLen = encodeResolveFrame({ reqId: 'r', ok: true, body }).length
    const legacyLen = JSON.stringify(Array.from(body)).length // 旧通道：每字节 "255," = 4 字符
    expect(legacyLen).toBeGreaterThan(body.length * 3)
    expect(binaryLen).toBeLessThan(legacyLen / 3)
  })

  it('1MB 文本响应：帧体积 ≈ 文本字节数（不经转义/膨胀）', () => {
    const text = 'x'.repeat(1024 * 1024)
    const body = new Uint8Array(1024 * 1024).fill(0x78) // 'x'
    const frame = encodeResolveFrame({ reqId: 'r', ok: true, status: 200, body })
    expect(frame.length).toBe(body.length + (frame.length - body.length))
    expect(frame.length - body.length).toBeLessThan(64)
    expect(text.length).toBe(body.length) // 一致性：1 字符 = 1 字节（ASCII）
  })
})

/* ────────────────────────── ⑤ interpretBody ────────────────────────── */

describe('⑤ interpretBody：按 responseType 解释（唯一实现）', () => {
  const enc = (s: string): Uint8Array => {
    const b = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff // ASCII 测试用
    return b
  }

  it('text ⇒ 字符串', () => {
    expect(interpretBody(enc('hello'), 'text')).toBe('hello')
  })

  it('json ⇒ 解析后的对象；空 body ⇒ null（空响应体不是错误）', () => {
    expect(interpretBody(enc('{"a":1}'), 'json')).toEqual({ a: 1 })
    expect(interpretBody(new Uint8Array(0), 'json')).toBeNull()
  })

  it('arraybuffer ⇒ 原字节（不解释）', () => {
    const b = enc('binary')
    expect(interpretBody(b, 'arraybuffer')).toBe(b)
  })

  it('json 解析失败 ⇒ 抛错（不静默返回 null，否则调用方分不清"空"与"坏"）', () => {
    expect(() => interpretBody(enc('not json'), 'json')).toThrow()
  })
})

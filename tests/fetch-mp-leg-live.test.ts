// tests/fetch-mp-leg-live.test.ts
// ★★★#1127：**MP fetch 腿的真实运行**判据（#1122 诚实边界②的另一半）
//
// 【为什么静态判据不够】
//   #1122 给 MP 腿补了 timeout 传递 / responseType 映射 / 超时单列错误码 / 四个 unsupported 分支，
//   但只有源码文本断言。文本在 ≠ 行为对：
//     · `timeout: config.timeout` 传了，但 `wx.request` 是**回调式**——不跑一遍不知道参数真到没到；
//     · `responseType` 映射写反了（比如 arraybuffer→text）文本断言也看不出来；
//     · `fail` 回调里 `/timeout/i.test(errMsg)` 的判定，只有构造真实 errMsg 才能验。
//   ⇒ 本文件用**假 wx 对象**（记录入参 + 按 `wx.request` 的真实回调契约回包）真跑 `mpRequest`。
//
// 【★诚实边界（别当成"微信开发者工具已验证"）】
//   假 wx 复刻的是**文档契约**（`success({data,statusCode,header})` / `fail({errMsg})`），
//   不是真容器。真容器还有登录态、域名白名单、并发上限（10）等层——不在本判据覆盖内。
//   要覆盖那些，必须走 `test:e2e:mp`（真设备/模拟器）。
//
// 【覆盖什么】
//   ① 参数真的传给 `wx.request`（url/method/data/header/timeout/responseType）；
//   ② `success` ⇒ data/status/headers 正确映射；
//   ③ `fail` 里的 `timeout` ⇒ **独立错误码** `fetch.timeout`（不是笼统 failed）；
//   ④ `fail` 其他 ⇒ `fetch.failed`；
//   ⑤ **四个 S3 语义明确 unsupported**（savePath/onChunk/upload/signal）——不静默忽略；
//   ⑥ `params` 真的拼进 URL。
//
// 【★★#1130 教训：判据把被测行为桩掉了】本文件原先把 `ctx.encodedUrl` 桩成**恒等函数**
//   （`(url) => url`），于是 `params` 是否真的拼进 URL **永远测不出来**——而真实的 MP 腿当时
//   压根没调用它（`params` 整段丢弃），缺陷在假 wx 判据下完全隐形，最后是**真容器回显 query**
//   抓出来的。⇒ 现在 ctx **不传** encodedUrl（缺省用 `encodedFetchUrl` 真实现），并显式断言拼串结果。
import { describe, it, expect } from 'vitest'
import { mpRequest, encodedFetchUrl } from '../packages/api/src/capability-fetch-legs'

class TestCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}

/**
 * ★★#1130：**不桩 `encodedUrl`**——缺省就走模块里的 `encodedFetchUrl` 真实现。
 *   把位置相关行为桩成恒等，等于让判据绕开被测代码（本文件历史上就因此漏掉了 MP 腿丢 params）。
 */
const ctx = {
  CapError: TestCapError as unknown as new (code: string, message: string, cause?: unknown) => Error,
}

interface WxCall { opts: Record<string, unknown> }

/** 假 `wx`：记录调用，并用**真实回调契约**回包。 */
function wxStub(reply: { ok: true; data?: unknown; statusCode?: number; header?: Record<string, string> } | { ok: false; errMsg: string }): { wx: { request: (o: Record<string, unknown>) => void }; calls: WxCall[] } {
  const calls: WxCall[] = []
  const wx = {
    request: (opts: Record<string, unknown>): void => {
      calls.push({ opts })
      // 真实 `wx.request` 是异步回调；这里用微任务模拟（不引入定时器依赖）
      Promise.resolve().then(() => {
        if (reply.ok) {
          const success = opts.success as (r: unknown) => void
          success({ data: reply.data, statusCode: reply.statusCode ?? 200, header: reply.header ?? {} })
        } else {
          const fail = opts.fail as (e: unknown) => void
          fail({ errMsg: reply.errMsg })
        }
      })
    },
  }
  return { wx, calls }
}

describe('★#1127 MP 腿真运行 · 参数真的传给 wx.request', () => {
  it('★url / method / data / header / timeout / responseType 全部到位', async () => {
    const { wx, calls } = wxStub({ ok: true, data: 'ok' })
    await mpRequest(ctx, wx, {
      url: 'https://api.example.cn/x',
      method: 'POST',
      data: { a: 1 },
      headers: { 'X-T': 'v' },
      timeout: 8000,
      responseType: 'arraybuffer',
    })
    const o = calls[0].opts
    expect(o.url).toBe('https://api.example.cn/x')
    expect(o.method).toBe('POST')
    expect(o.data).toEqual({ a: 1 })
    expect(o.header).toEqual({ 'X-T': 'v' })
    // ★#1122 补的：timeout 此前被丢
    expect(o.timeout, '★timeout 未传给 wx.request').toBe(8000)
    // ★#1122 补的：responseType 映射（wx 只认 text/arraybuffer）
    expect(o.responseType, '★arraybuffer 未映射').toBe('arraybuffer')
  })

  it('responseType 缺省 ⇒ text（不是 undefined）', async () => {
    const { wx, calls } = wxStub({ ok: true, data: 'x' })
    await mpRequest(ctx, wx, { url: 'https://x.cn/a' })
    expect(calls[0].opts.responseType).toBe('text')
  })

  it('json 映射成 text（wx 没有 json 模式，交给上层解析）', async () => {
    const { wx, calls } = wxStub({ ok: true, data: { ok: 1 } })
    await mpRequest(ctx, wx, { url: 'https://x.cn/a', responseType: 'json' })
    expect(calls[0].opts.responseType).toBe('text')
  })

  it('★★params 真的拼进 URL（#1130 真容器抓出的缺陷：MP 腿曾整段丢弃）', async () => {
    const { wx, calls } = wxStub({ ok: true, data: 'x' })
    await mpRequest(ctx, wx, { url: 'https://x.cn/a', params: { a: '1', b: '两个' } })
    // 期望 = 模块导出的真实现算出的串（不是手写字符串——避免又造一份会分叉的副本）
    expect(calls[0].opts.url, '★params 未拼进 URL').toBe(encodedFetchUrl('https://x.cn/a', { a: '1', b: '两个' }))
    expect(String(calls[0].opts.url)).toContain('a=1')
    expect(String(calls[0].opts.url)).toContain('b=%E4%B8%A4%E4%B8%AA')
  })

  it('params 与已有 query 合并用 &（不产生 ? ?）', async () => {
    const { wx, calls } = wxStub({ ok: true, data: 'x' })
    await mpRequest(ctx, wx, { url: 'https://x.cn/a?z=0', params: { a: 1 } })
    const u = String(calls[0].opts.url)
    expect(u).toBe('https://x.cn/a?z=0&a=1')
    expect(u.split('?').length - 1, '★只该有一个 ?').toBe(1)
  })

  it('params 值为 undefined 的键被跳过（不发 undefined 文本）', async () => {
    const { wx, calls } = wxStub({ ok: true, data: 'x' })
    await mpRequest(ctx, wx, { url: 'https://x.cn/a', params: { a: 1, skip: undefined } })
    expect(String(calls[0].opts.url)).toBe('https://x.cn/a?a=1')
  })
})

describe('★#1127 MP 腿真运行 · 回调契约映射', () => {
  it('success ⇒ data / status / headers 正确', async () => {
    const { wx } = wxStub({ ok: true, data: { hello: 'mp' }, statusCode: 201, header: { 'X-R': '1' } })
    const r = await mpRequest(ctx, wx, { url: 'https://x.cn/a' })
    expect(r.status).toBe(201)
    expect(r.headers).toEqual({ 'X-R': '1' })
    expect(r.data).toEqual({ hello: 'mp' })
  })

  it('★★fail 里的 timeout ⇒ **独立错误码** `fetch.timeout`（业务据此判断重试）', async () => {
    const { wx } = wxStub({ ok: false, errMsg: 'request:fail timeout' })
    await expect(mpRequest(ctx, wx, { url: 'https://x.cn/a' })).rejects.toMatchObject({
      code: 'fetch.timeout',
    })
  })

  it('fail 其他原因 ⇒ `fetch.failed`', async () => {
    const { wx } = wxStub({ ok: false, errMsg: 'request:fail invalid url' })
    await expect(mpRequest(ctx, wx, { url: 'https://x.cn/a' })).rejects.toMatchObject({
      code: 'fetch.failed',
    })
  })

  it('缺 wx.request ⇒ `fetch.unsupported`（不抛别的）', async () => {
    await expect(mpRequest(ctx, {}, { url: 'https://x.cn/a' })).rejects.toMatchObject({
      code: 'fetch.unsupported',
    })
  })
})

describe('★#1127 MP 腿真运行 · 四个 S3 语义必须明确拒绝', () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ['savePath', { savePath: 'download/a' }],
    ['onChunk', { onChunk: (): void => {} }],
    ['upload', { upload: { path: 'a', fieldName: 'f', filename: 'a', boundary: 'B' } }],
    ['signal', { signal: { aborted: false } }],
  ]

  for (const [name, extra] of CASES) {
    it(`★${name} ⇒ unsupported（不静默忽略、不发起请求）`, async () => {
      const { wx, calls } = wxStub({ ok: true, data: 'x' })
      await expect(
        mpRequest(ctx, wx, { url: 'https://x.cn/a', ...extra }),
      ).rejects.toMatchObject({ code: 'fetch.unsupported' })
      // ★关键：**一个请求都不该发出去**（静默忽略的话这里会是 1）
      expect(calls.length, `★${name} 被静默忽略并真的发出了请求`).toBe(0)
    })
  }
})

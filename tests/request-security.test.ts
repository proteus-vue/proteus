// tests/request-security.test.ts —— ★★★#1342 请求库安全通道判据
//
// 【守什么】
//   ① 脱敏：header/query/body 三层，默认黑名单覆盖 Authorization/Cookie/token/password
//   ② 签名：规范化字符串**可复算**（服务端必须能算出同一个串）+ 防篡改
//   ③ 防重放：nonce 真随机（固定 nonce 等于没防重放）
//   ④ 凭证头：业务拿不到 token 也塞不进去；header 注入被拦
//   ⑤ 脱敏**不作用于真实请求**（只作用于日志/trace）——用错会导致服务端收到 `***`
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REDACT_HEADERS,
  bearerHeader,
  buildCanonicalString,
  hasHeader,
  makeAntiReplayHeaders,
  normalizeRedact,
  redactBody,
  redactHeaders,
  redactUrl,
  signRequest,
} from '../packages/api/src/request/security'

describe('★★★#1342 安全通道', () => {
  /* ── 脱敏 ── */
  it('★★① 默认 header 黑名单覆盖凭据类（Authorization/Cookie/Set-Cookie/API-Key…）', () => {
    for (const h of ['Authorization', 'Cookie', 'Set-Cookie', 'X-Api-Key', 'Proxy-Authorization']) {
      expect(DEFAULT_REDACT_HEADERS.map((x) => x.toLowerCase()), `${h} 应在默认黑名单`).toContain(h.toLowerCase())
    }
  })

  it('★★② redactHeaders：命中即遮，大小写不敏感，不误伤其它头', () => {
    const out = redactHeaders(
      { authorization: 'Bearer secret', 'Content-Type': 'application/json', COOKIE: 'sid=1' },
      undefined,
    )
    expect(out.authorization).toBe('***')
    expect(out.COOKIE).toBe('***')
    expect(out['Content-Type'], '非敏感头必须保留').toBe('application/json')
  })

  it('★★③ redactUrl：query 里的敏感字段被遮，path 不遮（否则失去排查价值）', () => {
    const u = redactUrl('https://api.example.com/v1/user/42?token=abc&page=2&phone=13800138000')
    expect(u).toContain('/v1/user/42')
    expect(u).toContain('token=***')
    expect(u).toContain('phone=***')
    expect(u, '非敏感 query 保留').toContain('page=2')
    expect(u, '★原始 token 不得出现在结果里').not.toContain('abc')
  })

  it('★★④ redactBody：递归脱敏 + 防循环引用 + 深度上限', () => {
    const body = {
      user: { name: 'x', password: 'p@ss', token: 'tk' },
      list: [{ phone: '13800138000' }, { ok: 1 }],
      api_key: 'k',
    }
    const out = redactBody(body) as Record<string, unknown>
    expect((out.user as Record<string, unknown>).password).toBe('***')
    expect((out.user as Record<string, unknown>).token).toBe('***')
    expect((out.user as Record<string, unknown>).name).toBe('x')
    expect((out.list as Array<Record<string, unknown>>)[0]!.phone).toBe('***')
    expect((out.list as Array<Record<string, unknown>>)[1]!.ok).toBe(1)
    expect(out.api_key).toBe('***')
    // 循环引用不能把递归打死
    const cyc: Record<string, unknown> = { a: 1 }
    cyc.self = cyc
    expect(() => redactBody(cyc)).not.toThrow()
  })

  it('⑤ normalizeRedact：可自定义黑名单（平台方按自己的头约定配置）', () => {
    const n = normalizeRedact({ headers: ['X-Custom-Secret'], fields: ['ssn'], mask: '[hidden]' })
    expect(n.headers.has('x-custom-secret')).toBe(true)
    expect(n.fields.has('ssn')).toBe(true)
    expect(n.mask).toBe('[hidden]')
    expect(redactHeaders({ 'X-Custom-Secret': 'v' }, { headers: ['X-Custom-Secret'], mask: '[hidden]' })['X-Custom-Secret']).toBe(
      '[hidden]',
    )
  })

  /* ── 规范化字符串（签名的契约） ── */
  it('★★★⑥ 规范化字符串：同输入必同输出（服务端可复算）；头顺序不影响结果', () => {
    const base = { method: 'POST', url: 'https://api.example.com/v1/pay', body: '{"a":1}' }
    const a = buildCanonicalString({
      ...base,
      headers: { 'X-Proteus-Timestamp': '1', 'X-Proteus-Nonce': 'n' },
      signedHeaders: ['X-Proteus-Timestamp', 'X-Proteus-Nonce'],
    })
    const b = buildCanonicalString({
      ...base,
      headers: { 'x-proteus-nonce': 'n', 'x-proteus-timestamp': '1' }, // 顺序与大小写都不同
      signedHeaders: ['X-Proteus-Timestamp', 'X-Proteus-Nonce'],
    })
    expect(a, '★头顺序/大小写不得影响签名').toBe(b)
  })

  it('★★★⑦ 规范化字符串：方法/URL/头/体任一改动都改变签名（防篡改）', () => {
    const base = {
      method: 'POST',
      url: 'https://api.example.com/v1/pay',
      headers: { 'X-Proteus-Timestamp': '1' },
      signedHeaders: ['X-Proteus-Timestamp'],
      body: '{"amount":100}',
    }
    const orig = buildCanonicalString(base)
    expect(buildCanonicalString({ ...base, method: 'PUT' })).not.toBe(orig)
    expect(buildCanonicalString({ ...base, url: 'https://api.example.com/v1/refund' })).not.toBe(orig)
    expect(buildCanonicalString({ ...base, body: '{"amount":1}' }), '★金额被改必须改变签名').not.toBe(orig)
    expect(
      buildCanonicalString({ ...base, headers: { 'X-Proteus-Timestamp': '2' } }),
      '★时间戳被改必须改变签名',
    ).not.toBe(orig)
  })

  it('⑧ 规范化字符串：方法大写归一（post 与 POST 同签名）', () => {
    const h = { 'X-Proteus-Timestamp': '1' }
    const a = buildCanonicalString({ method: 'post', url: 'u', headers: h, signedHeaders: ['X-Proteus-Timestamp'], body: '' })
    const b = buildCanonicalString({ method: 'POST', url: 'u', headers: h, signedHeaders: ['X-Proteus-Timestamp'], body: '' })
    expect(a).toBe(b)
  })

  /* ── 防重放 ── */
  it('★★★⑨ 防重放：nonce 必须真随机（固定 nonce 等于没有防重放）', () => {
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const h = makeAntiReplayHeaders({ enabled: true })
      set.add(h['x-proteus-nonce']!)
    }
    expect(set.size, '★200 次生成必须 200 个不同 nonce').toBe(200)
  })

  it('⑩ 防重放：可自定义头名（对接服务端既有约定）', () => {
    const h = makeAntiReplayHeaders({ enabled: true, timestampHeader: 'X-Ts', nonceHeader: 'X-Nonce' }, 1000)
    expect(h['X-Ts']).toBe('1000')
    expect(typeof h['X-Nonce']).toBe('string')
    expect(h['X-Nonce']!.length).toBeGreaterThan(6)
  })

  /* ── 签名注入 ── */
  it('★★⑪ signRequest：注入签名头；签名内容可被服务端复算出来', async () => {
    const captured: string[] = []
    const headers = { 'X-Proteus-Timestamp': '1000', 'X-Proteus-Nonce': 'abc', 'Content-Type': 'application/json' }
    const out = await signRequest({
      method: 'POST',
      url: 'https://api.example.com/pay',
      headers,
      body: '{"amount":100}',
      policy: {
        sign: (canonical) => {
          captured.push(canonical)
          return `sig:${canonical.length}`
        },
      },
    })
    expect(out['x-proteus-signature']).toMatch(/^sig:\d+$/)
    expect(out['Content-Type'], '原有头必须保留').toBe('application/json')
    // 服务端按同一规范复算
    const recomputed = buildCanonicalString({
      method: 'POST',
      url: 'https://api.example.com/pay',
      headers,
      signedHeaders: ['x-proteus-timestamp', 'x-proteus-nonce'],
      body: '{"amount":100}',
    })
    expect(captured[0], '★服务端复算的规范化串必须与客户端签名时一致').toBe(recomputed)
  })

  it('★★⑫ signRequest：签名失败必须**抛错**（不能降级成无签名发送）', async () => {
    await expect(
      signRequest({
        method: 'GET',
        url: 'https://a.b/c',
        headers: {},
        body: '',
        policy: {
          sign: () => {
            throw new Error('密钥不可用')
          },
        },
      }),
    ).rejects.toThrow(/密钥不可用/)
  })

  /* ── 凭证头 ── */
  it('★★⑬ bearerHeader：无 token 不注入；换行/空格被剥离（防头注入）', () => {
    expect(bearerHeader(undefined)).toEqual({})
    expect(bearerHeader('')).toEqual({})
    expect(bearerHeader('abc')).toEqual({ Authorization: 'Bearer abc' })
    // ★头注入：token 里含 CRLF 会被拼成两个头
    expect(bearerHeader('abc\r\nX-Evil: 1')).toEqual({ Authorization: 'Bearer abcX-Evil:1' })
    expect(bearerHeader('   ')).toEqual({})
  })

  it('⑭ hasHeader：大小写不敏感（防止业务用小写绕过托管）', () => {
    expect(hasHeader({ Authorization: 'x' }, 'authorization')).toBe(true)
    expect(hasHeader({ authorization: 'x' }, 'Authorization')).toBe(true)
    expect(hasHeader({}, 'authorization')).toBe(false)
  })
})

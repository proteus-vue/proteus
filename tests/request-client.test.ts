// tests/request-client.test.ts —— ★★★#1342 请求库门面集成判据
//
// 【守什么（这是"策略真的被串起来"的证据，不是单模块单测）】
//   ① 白名单在**发请求之前**拦（零网络成本）
//   ② 断路器打开后**不再发请求**
//   ③ 三态贯通：超时 ⇒ `unknown`（不是 failed）；建连失败 ⇒ `failed`
//   ④ URL 拼接（baseURL）在门面层完成，且**不污染 `FetchConfig`**（四层链纪律）
//   ⑤ 凭证托管：auth 有 token 才注入；`skipAuth` 可跳过
//   ⑥ 签名头被注入；签名失败 ⇒ 请求不发出
//   ⑦ 审计 + trace 拿到的是**脱敏后**数据
//   ⑧ freeze：实例不可变（防 axios.defaults 那类偷改）
//   ⑨ `requestOrThrow` 把 outcome 挂到错误上
import { describe, it, expect, vi } from 'vitest'
import { CapError } from '../packages/api/src/capability-types'
import { createRequestClient, joinUrl } from '../packages/api/src/request/client'

/** 构造一个可编程的假 hooks（记录每次调用的 url/config） */
function makeHooks(handler: (url: string, cfg: Record<string, unknown>, n: number) => unknown): {
  hooks: never
  calls: Array<{ url: string; cfg: Record<string, unknown> }>
} {
  const calls: Array<{ url: string; cfg: Record<string, unknown> }> = []
  const hooks = {
    useFetch: async (url: string, cfg: Record<string, unknown>) => {
      calls.push({ url, cfg })
      return handler(url, cfg, calls.length)
    },
  } as never
  return { hooks, calls }
}

const ok = (data: unknown = {}) => ({ ok: true as const, data, status: 200, headers: {}, meta: { attempts: 1 } })

describe('★★★#1342 请求库门面', () => {
  it('① joinUrl：baseURL 拼接（绝对地址不重复拼）', () => {
    expect(joinUrl('https://api.x.com', '/v1/a')).toBe('https://api.x.com/v1/a')
    expect(joinUrl('https://api.x.com/', '/v1/a')).toBe('https://api.x.com/v1/a')
    expect(joinUrl('https://api.x.com/', 'v1/a')).toBe('https://api.x.com/v1/a')
    expect(joinUrl('https://api.x.com', 'https://other.com/x'), '★已是绝对地址不拼').toBe('https://other.com/x')
    expect(joinUrl(undefined, '/v1/a')).toBe('/v1/a')
  })

  it('★★② 白名单在**发请求之前**拦（零网络成本）', async () => {
    const { hooks, calls } = makeHooks(() => ok())
    const audits: unknown[] = []
    const client = createRequestClient({
      hooks,
      baseURL: 'https://evil.com',
      tenant: { bizId: 'biz-A', allowedDomains: ['api.example.com'], onAudit: (e) => audits.push(e) },
    })
    const r = await client.get('/steal')
    expect(r.ok).toBe(false)
    expect(r.outcome).toBe('failed')
    if (!r.ok) {
      expect(r.error.code).toBe('request.forbidden')
      expect(r.meta.phase).toBe('rejected-local')
      expect(r.meta.sent, '★必须明确"未发出"').toBe(false)
    }
    expect(calls.length, '★白名单拒绝后不得发请求').toBe(0)
    expect(audits.length, '被拒也要留审计').toBe(1)
    expect(client.stats().rejectedLocal).toBe(1)
  })

  it('★★③ 断路器打开后不再发请求', async () => {
    // ★假 hooks 按 host 分支：down.com 失败、healthy.com 成功
    //   （首版写死全失败 ⇒ "别的 host 不受影响"那条假红——测试自身的缺陷，不是实现的）
    const { hooks, calls } = makeHooks((url) =>
      url.includes('down.com')
        ? { ok: false as const, error: new CapError('network.unreachable', 'down') }
        : ok(),
    )
    const client = createRequestClient({
      hooks,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      retry: { attempts: 0 },
    })
    await client.get('https://api.down.com/a')
    await client.get('https://api.down.com/b')
    const before = calls.length
    const r = await client.get('https://api.down.com/c')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('request.circuitOpen')
    expect(calls.length, '★断路器打开后不得再发').toBe(before)
    // 不同 host 不受影响
    const other = await client.get('https://api.healthy.com/x')
    expect(other.ok, '★别的 host 不受影响').toBe(true)
  })

  it('★★★④ 三态贯通：超时 ⇒ unknown；建连失败 ⇒ failed', async () => {
    const timeoutHooks = makeHooks(() => ({ ok: false as const, error: new CapError('fetch.timeout', 'timeout') }))
    const c1 = createRequestClient({ hooks: timeoutHooks.hooks })
    const r1 = await c1.post('/pay', { amount: 1 })
    expect(r1.ok).toBe(false)
    expect(r1.outcome, '★超时必须是 unknown，不是 failed').toBe('unknown')
    if (!r1.ok) {
      expect(r1.error.code).toBe('fetch.unknown')
      expect(r1.error.message).toMatch(/查单|未知/)
    }

    const netHooks = makeHooks(() => ({ ok: false as const, error: new CapError('network.unreachable', 'no route') }))
    const c2 = createRequestClient({ hooks: netHooks.hooks })
    const r2 = await c2.post('/pay', { amount: 1 })
    expect(r2.outcome, '★建连失败必须是 failed').toBe('failed')
    if (!r2.ok) expect(r2.error.code).toBe('network.unreachable')
    expect(r2.meta.phase).toBe('connect-failed')
  })

  it('★★★⑤ 门面层字段**不得**污染 FetchConfig（四层链纪律）', async () => {
    const { hooks, calls } = makeHooks(() => ok())
    const client = createRequestClient({
      hooks,
      baseURL: 'https://api.example.com',
      tenant: { bizId: 'biz-A' },
      retry: { attempts: 1 },
      idempotency: 'auto',
      timeout: { idle: 5000, deadline: 20_000 },
    })
    await client.post('/order', { a: 1 }, { idempotencyKey: 'k1', skipAuth: true, caller: 'x' })
    const cfg = calls[0]!.cfg
    // ★这些门面层字段必须被剥掉（否则会被 pipeline 当业务字段/或被当 body）
    for (const k of ['idempotencyKey', 'skipAuth', 'skipTenantCheck', 'allowOffline', 'caller']) {
      expect(cfg, `★门面字段 ${k} 泄漏进了 FetchConfig`).not.toHaveProperty(k)
    }
    // ★超时映射：idle → timeout，deadline → deadline
    expect(cfg.timeout).toBe(5000)
    expect(cfg.deadline).toBe(20_000)
    // ★幂等键走普通 header（不进线格式字段）
    const headers = cfg.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('k1')
    // ★URL 已拼好
    expect(calls[0]!.url).toBe('https://api.example.com/order')
  })

  it('★★⑥ 凭证托管：auth 有 token 才注入；skipAuth 跳过；业务给的 Authorization 优先', async () => {
    const { hooks, calls } = makeHooks(() => ok())
    let token: string | null = 'tk-1'
    const client = createRequestClient({
      hooks,
      auth: {
        getToken: () => token,
        setToken: (t: string | null) => {
          token = t
        },
        isAuthenticated: () => token !== null,
        subscribe: () => () => {},
      } as never,
    })
    await client.get('/a')
    expect((calls[0]!.cfg.headers as Record<string, string>).Authorization).toBe('Bearer tk-1')
    // skipAuth
    await client.get('/b', { skipAuth: true })
    expect((calls[1]!.cfg.headers as Record<string, string>).Authorization).toBeUndefined()
    // 业务显式给 Authorization ⇒ 不覆盖
    await client.get('/c', { headers: { Authorization: 'Custom xyz' } })
    expect((calls[2]!.cfg.headers as Record<string, string>).Authorization).toBe('Custom xyz')
    // 无 token ⇒ 不注入
    token = null
    await client.get('/d')
    expect((calls[3]!.cfg.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('★★⑦ 签名注入；签名失败 ⇒ 请求**不发出**', async () => {
    const { hooks, calls } = makeHooks(() => ok())
    const client = createRequestClient({
      hooks,
      signing: {
        sign: (canonical) => `sig-${canonical.length}`,
      },
    })
    await client.post('/pay', { amount: 1 })
    const h = calls[0]!.cfg.headers as Record<string, string>
    expect(h['x-proteus-signature']).toMatch(/^sig-\d+$/)

    // 签名抛错 ⇒ 不发出
    const bad = makeHooks(() => ok())
    const c2 = createRequestClient({
      hooks: bad.hooks,
      signing: {
        sign: () => {
          throw new Error('hsm down')
        },
      },
    })
    const r = await c2.post('/pay', { amount: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('request.signFailed')
    expect(bad.calls.length, '★签名失败绝不能无签名发送').toBe(0)
  })

  it('★★⑧ 审计与 trace 拿到的是**脱敏后**数据（不含原始 token / query 密钥）', async () => {
    const { hooks } = makeHooks(() => ok())
    const traces: Array<{ url: string; bizId?: string }> = []
    const audits: Array<{ url: string; host: string }> = []
    const client = createRequestClient({
      hooks,
      baseURL: 'https://api.example.com',
      tenant: { bizId: 'biz-A', onAudit: (e) => audits.push({ url: e.url, host: e.host }) },
      trace: (e) => traces.push({ url: e.url, bizId: e.bizId }),
    })
    await client.get('/v1/user/42?token=supersecret')
    expect(traces.length).toBeGreaterThan(0)
    for (const t of traces) {
      expect(t.url, '★trace 里不得出现原始 token').not.toContain('supersecret')
      expect(t.bizId).toBe('biz-A')
    }
    expect(audits.length).toBe(1)
    expect(audits[0]!.url, '★审计 URL 必须已脱敏 path').toContain('<redacted>')
    expect(audits[0]!.url).not.toContain('42')
    expect(audits[0]!.host).toBe('api.example.com')
  })

  it('★★⑨ 实例被 freeze（防 axios.defaults 那类全局偷改）', () => {
    const { hooks } = makeHooks(() => ok())
    const client = createRequestClient({ hooks })
    expect(Object.isFrozen(client)).toBe(true)
    expect(() => {
      ;(client as unknown as { get: unknown }).get = () => {}
    }).toThrow()
  })

  it('★⑩ requestOrThrow：失败时抛错，且错误上带 outcome/meta', async () => {
    const { hooks } = makeHooks(() => ({ ok: false as const, error: new CapError('fetch.timeout', 't') }))
    const client = createRequestClient({ hooks })
    try {
      await client.requestOrThrow('/x')
      throw new Error('should have thrown')
    } catch (e) {
      const err = e as CapError & { outcome?: string; meta?: { sent: boolean } }
      expect(err.code).toBe('fetch.unknown')
      expect(err.outcome).toBe('unknown')
      expect(err.meta?.sent).toBe(true)
    }
  })

  it('★⑪ task：abort 后结果为 unknown（已发出）', async () => {
    // ★用"永不自己 resolve"的 Promise 让 abort 真的发生在请求进行中
    //   （首版用 setTimeout 50ms，而 execute 里的 await 可能先完成 ⇒ 时序不稳）
    const { hooks } = makeHooks(() => new Promise(() => {}))
    const client = createRequestClient({ hooks })
    const t = client.task('/slow')
    expect(t.state).toBe('running')
    t.abort('user cancelled')
    const r = await t.result
    expect(r.ok).toBe(false)
    expect(r.outcome, '★已发出后取消 ⇒ unknown').toBe('unknown')
    if (!r.ok) expect(r.meta.phase).toBe('aborted-after-sent')
  }, 5000)

  it('★★⑫ stats：计数与读数（不含请求内容）', async () => {
    const { hooks } = makeHooks((_u, _c, n) =>
      n === 1 ? ok() : { ok: false as const, error: new CapError('network.unreachable', 'x') },
    )
    const client = createRequestClient({ hooks, tenant: { bizId: 'b' } })
    await client.get('https://a.com/1')
    await client.get('https://a.com/2')
    const s = client.stats()
    expect(s.bizId).toBe('b')
    expect(s.totals.requests).toBe(2)
    expect(s.totals.success).toBe(1)
    expect(s.totals.failed).toBe(1)
    expect(s.inflight, '全部结束后应为 0').toBe(0)
  })
})

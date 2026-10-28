// tests/request-tenant.test.ts —— ★★★#1342 多业务隔离判据
//
// 【守什么（这些都是"合规评审第一个会问"的问题）】
//   ① 域名白名单：`*.example.com` 只匹配一级子域（`a.b.example.com` 必须被拒）
//   ② 一个业务打满配额**不阻塞另一个业务**（隔离的技术含义）
//   ③ 审计只记脱敏后的最小信息（host + 前两段 path），不记 query/body
//   ④ 白名单未配 ⇒ 不拦（不能让现有业务全部被拦死）
//   ⑤ 额度树三级：全局 → 业务 → host，任一超限只影响自己
import { describe, it, expect } from 'vitest'
import {
  ConcurrencyGate,
  QuotaTree,
  createTenantContext,
  hostOf,
  isHostAllowed,
  makeAuditEntry,
  redactAuditUrl,
} from '../packages/api/src/request/tenant'

describe('★★★#1342 多业务隔离', () => {
  /* ── 域名白名单 ── */
  it('★① hostOf：不依赖 URL 构造器（App 精简引擎没有它）', () => {
    expect(hostOf('https://api.example.com/v1/x?y=1')).toBe('api.example.com')
    expect(hostOf('http://API.Example.COM:8080/x')).toBe('api.example.com')
    expect(hostOf('https://user:pw@api.example.com/x'), '★userinfo 要被剥掉').toBe('api.example.com')
    expect(hostOf('https://[::1]:8443/x')).toBe('[::1]')
    expect(hostOf('/relative/path')).toBe('')
  })

  it('★★★② 白名单：`*.example.com` 只匹配**一级**子域（深层必须显式配）', () => {
    const allow = ['*.example.com']
    expect(isHostAllowed('https://api.example.com/x', allow), '一级子域应通过').toBe(true)
    expect(isHostAllowed('https://example.com/x', allow), '★裸域不等于 *.example.com').toBe(false)
    expect(isHostAllowed('https://a.b.example.com/x', allow), '★两级子域必须被拒（防白名单被宽泛理解）').toBe(false)
    expect(isHostAllowed('https://evil.com/x', allow)).toBe(false)
  })

  it('★③ 白名单：精确匹配 + 协议前缀容忍 + 大小写不敏感', () => {
    expect(isHostAllowed('https://api.example.com/x', ['api.example.com'])).toBe(true)
    expect(isHostAllowed('https://api.example.com/x', ['https://api.example.com']), '配了协议前缀也要能用').toBe(true)
    expect(isHostAllowed('https://API.example.com/x', ['api.example.com'])).toBe(true)
    expect(isHostAllowed('https://other.example.com/x', ['api.example.com'])).toBe(false)
  })

  it('★★④ 白名单未配 ⇒ 不拦（否则现有业务全部被拦死）', () => {
    expect(isHostAllowed('https://anything.com/x', undefined)).toBe(true)
    expect(isHostAllowed('https://anything.com/x', [])).toBe(true)
  })

  it('★⑤ 白名单：`*` 全放行（平台内部用）；空 host 保守拒绝', () => {
    expect(isHostAllowed('https://any.com/x', ['*'])).toBe(true)
    // 相对 URL 且没 baseURL ⇒ host 为空 ⇒ 无法判定 ⇒ 拒（保守）
    expect(isHostAllowed('/relative', ['api.example.com']), '★无法判定时保守拒绝').toBe(false)
  })

  /* ── 并发闸门 ── */
  it('★★⑥ 闸门：limit 内放行，超限排队（不丢请求）', async () => {
    const gate = new ConcurrencyGate(2)
    const r1 = await gate.acquire()
    const r2 = await gate.acquire()
    expect(gate.inflight).toBe(2)
    let third: (() => void) | undefined
    const p3 = gate.acquire().then((rel) => {
      third = rel
    })
    expect(gate.queued, '第三个应排队').toBe(1)
    r1() // 释放一个 ⇒ 第三个拿到
    await p3
    expect(third).toBeTypeOf('function')
    expect(gate.inflight).toBe(2)
    r2()
    third!()
    expect(gate.inflight).toBe(0)
  })

  it('★★⑦ 闸门：释放幂等（重复释放不能把计数减成负数）', async () => {
    const gate = new ConcurrencyGate(1)
    const rel = await gate.acquire()
    expect(gate.inflight).toBe(1)
    rel()
    rel()
    rel()
    expect(gate.inflight, '★重复释放必须无效').toBe(0)
    // 再拿一次仍然正常
    const rel2 = await gate.acquire()
    expect(gate.inflight).toBe(1)
    rel2()
  })

  it('★★⑧ 闸门：排队中取消 ⇒ 立刻退出队列（不占位置）', async () => {
    const gate = new ConcurrencyGate(1)
    const rel = await gate.acquire()
    const sig: { aborted: boolean; onabort: ((r?: string) => void) | null } = { aborted: false, onabort: null }
    const p = gate.acquire(sig)
    expect(gate.queued).toBe(1)
    sig.onabort?.('caller aborted')
    await expect(p).rejects.toThrow(/caller aborted/)
    expect(gate.queued, '★取消后必须离开队列（否则永久占位）').toBe(0)
    rel()
  })

  it('★⑨ 闸门：limit=0 表示不限（直接返回 noop 释放）', async () => {
    const gate = new ConcurrencyGate(0)
    const rels = await Promise.all([gate.acquire(), gate.acquire(), gate.acquire()])
    expect(gate.queued).toBe(0)
    for (const r of rels) r()
  })

  /* ── 额度树（隔离的技术含义） ── */
  it('★★★⑩ 额度树：一个业务打满**不阻塞另一个业务**', async () => {
    const tree = new QuotaTree(10, 0) // 全局 10，host 不限
    const gA = tree.tenantGate('biz-A', 1)
    const gB = tree.tenantGate('biz-B', 1)
    const a1 = await gA.acquire()
    expect(gA.inflight).toBe(1)
    // biz-A 已满：它的第二个请求排队
    let a2Done = false
    void gA.acquire().then(() => {
      a2Done = true
    })
    // ★但 biz-B 完全不受影响
    const b1 = await gB.acquire()
    expect(gB.inflight).toBe(1)
    expect(a2Done, '★biz-A 排队不该影响 biz-B').toBe(false)
    a1()
    b1()
  })

  it('★⑪ 额度树：全局闸门独立于业务闸门（两级都要过）', async () => {
    const tree = new QuotaTree(1, 0)
    const g1 = await tree.global.acquire()
    let passed = false
    void tree.global.acquire().then(() => {
      passed = true
    })
    expect(passed, '★全局满了谁都得等').toBe(false)
    g1()
    expect(tree.snapshot().global).toBe(0)
  })

  it('⑫ 额度树：host 级闸门（hostLimit=0 时不下发限制）', async () => {
    const tree = new QuotaTree(10, 0)
    const hg = tree.hostGate('api.example.com')
    // 不限的 gate：拿 5 个都不排队
    const rels = await Promise.all([hg.acquire(), hg.acquire(), hg.acquire()])
    expect(hg.queued).toBe(0)
    for (const r of rels) r()
  })

  /* ── 审计（脱敏） ── */
  it('★★★⑬ 审计 URL：只留 origin + 前两段，其余 path 与 query 全遮（防 PII 泄漏）', () => {
    const u = redactAuditUrl('https://api.example.com/v1/order/123456/pay?token=abc')
    expect(u).toBe('https://api.example.com/v1/order/<redacted>')
    expect(u, '★订单号不得出现在审计里').not.toContain('123456')
    expect(u, '★query 不得出现在审计里').not.toContain('token')
    // 浅路径：不产生多余的 <redacted>
    expect(redactAuditUrl('https://api.example.com/ping')).toBe('https://api.example.com/ping')
    expect(redactAuditUrl('/relative')).toBe('<relative>')
  })

  it('★★⑭ 审计条目：不含 body、不含 header 原值、不含完整 path', () => {
    const e = makeAuditEntry({
      id: 'rq-1',
      bizId: 'order-center',
      url: 'https://api.example.com/v1/order/999/pay?sign=secret',
      method: 'post',
      outcome: 'success',
      status: 200,
      durationMs: 12.7,
      attempts: 2,
      cacheHit: false,
    })
    expect(e.method).toBe('POST')
    expect(e.host).toBe('api.example.com')
    expect(e.bizId).toBe('order-center')
    expect(e.durationMs).toBe(13)
    // ★审计的 `at` 用注入时钟（不依赖真实 `Date.now()`，避免跨秒边界抖动 —— 实测偶发过一次红）
    expect(e.at).toBeTypeOf('number')
    const json = JSON.stringify(e)
    expect(json, '★审计里不得出现订单号').not.toContain('999')
    expect(json, '★审计里不得出现签名').not.toContain('secret')
    expect(Object.keys(e)).not.toContain('body')
    expect(Object.keys(e)).not.toContain('headers')
  })

  /* ── 租户上下文 ── */
  it('★★⑮ createTenantContext：bizId 必填；未配 concurrency 则无独立闸门', () => {
    expect(createTenantContext(undefined)).toBeUndefined()
    expect(createTenantContext({ bizId: '' })).toBeUndefined()
    const ctx = createTenantContext({ bizId: 'biz-A', allowedDomains: ['api.example.com'] })
    expect(ctx).toBeDefined()
    expect(ctx!.gate, '未配 concurrency ⇒ 不额外限制').toBeUndefined()
    expect(ctx!.checkHost('https://api.example.com/x').allowed).toBe(true)
    expect(ctx!.checkHost('https://evil.com/x').allowed).toBe(false)
    const withGate = createTenantContext({ bizId: 'biz-B', concurrency: 2 })
    expect(withGate!.gate).toBeDefined()
  })

  it('★⑯ 租户上下文：onAudit 抛错不阻断业务（审计是旁路）', () => {
    const ctx = createTenantContext({
      bizId: 'biz',
      onAudit: () => {
        throw new Error('audit sink down')
      },
    })
    expect(() =>
      ctx!.audit(
        makeAuditEntry({
          id: 'x',
          bizId: 'biz',
          url: 'https://a.b/c',
          method: 'GET',
          outcome: 'success',
          durationMs: 1,
          attempts: 1,
        }),
      ),
    ).not.toThrow()
  })
})

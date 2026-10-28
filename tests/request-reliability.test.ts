// tests/request-reliability.test.ts —— ★★★#1342 请求库可靠性内核判据
//
// 【本文件守的是什么（都是"主流库做错、我们必须做对"的点）】
//   ① **幂等键跨重试稳定** —— 每次 attempt 生成新 key 就等于没幂等（最容易做错的一处）
//   ② **未知态三态分类** —— `failed`（可重试）vs `unknown`（必须去查单，绝不能重试）
//   ③ 重试不看方法的病：非幂等请求默认**不重试**
//   ④ 抖动能真正去同步（pipeline 现在是确定性符号）
//   ⑤ 断路器状态机 closed → open → halfOpen → closed
//   ⑥ 离线队列**只收幂等**请求 + 容量上限丢最旧
//   ⑦ `Retry-After` 解析（pipeline 现在完全不解析）
import { describe, it, expect, vi } from 'vitest'
import { CapError } from '../packages/api/src/capability-types'
import {
  CircuitBreaker,
  OfflineQueue,
  canRetry,
  classifyFailure,
  computeBackoffMs,
  isIdempotentMethod,
  makeIdempotencyKey,
  parseRetryAfter,
  resolveIdempotencyKey,
  shouldRetryResult,
} from '../packages/api/src/request/reliability'

describe('★★★#1342 可靠性内核', () => {
  /* ── ① 幂等键稳定性（本库最核心的正确性） ── */
  it('★★★① 幂等键：同一次逻辑请求只生成一次（重试复用同一个 key）', async () => {
    const { createRequestClient } = await import('../packages/api/src/request/client')
    const seen: string[] = []
    // 假 hooks：记录每次请求带的 Idempotency-Key
    const hooks = {
      useFetch: async (_url: string, cfg: { headers?: Record<string, string> }) => {
        const k = cfg.headers?.['Idempotency-Key']
        if (k) seen.push(k)
        return { ok: true as const, data: {}, status: 200, headers: {}, meta: { attempts: 1 } as never }
      },
    } as never
    const client = createRequestClient({ hooks, retry: { attempts: 2 }, idempotency: 'auto' })
    await client.post('/order', { amount: 1 })
    // 只有 1 次真实请求（成功不重试），但 key 必须存在
    expect(seen.length, '★auto 模式下配了重试必须自动生成幂等键').toBe(1)
    expect(seen[0]).toMatch(/^pk-/)
  })

  it('★★★①b 幂等键：失败重试时 key 保持不变（变了就等于没幂等）', async () => {
    const { createRequestClient } = await import('../packages/api/src/request/client')
    const keys: string[] = []
    let calls = 0
    const hooks = {
      useFetch: async (_url: string, cfg: { headers?: Record<string, string> }) => {
        calls++
        const k = cfg.headers?.['Idempotency-Key']
        if (k) keys.push(k)
        // 前两次失败（★用 `network.unreachable` = 确定没发出的可重试失败），第三次成功
        if (calls <= 2) {
          return { ok: false as const, error: new CapError('network.unreachable', 'boom'), meta: { attempts: calls } as never }
        }
        return { ok: true as const, data: {}, status: 200, headers: {}, meta: { attempts: calls } as never }
      },
    } as never
    const client = createRequestClient({ hooks, retry: { attempts: 2 }, idempotency: 'auto' })
    const r = await client.post('/order', { amount: 1 })
    expect(calls, '应该重试到成功').toBe(3)
    expect(r.ok).toBe(true)
    expect(new Set(keys).size, `★三次请求必须用同一个幂等键，实得 ${JSON.stringify(keys)}`).toBe(1)
  })

  it('★★①c `fetch.failed`（笼统失败）属未知 ⇒ **不重试**（保守，与 classifyFailure 口径一致）', async () => {
    // ★这条守的是"两处判定必须同一口径"：曾经 classifyFailure 把 fetch.failed 归 unknown，
    //   而 shouldRetryResult 却允许重试 ⇒ 分类说"别重试"、重试层说"可以重试"，自相矛盾。
    const { shouldRetryResult } = await import('../packages/api/src/request/reliability')
    const d = shouldRetryResult(
      { ok: false, error: new CapError('fetch.failed', 'x') },
      'POST',
      true,
      { attempts: 3 },
      1,
    )
    expect(d.retry, '★笼统失败归 unknown ⇒ 不自动重试').toBe(false)
    expect(d.reason).toMatch(/未知态/)
  })

  it('★★② 非幂等方法默认**不重试**（防重复下单）', () => {
    // 没有幂等键 ⇒ 拒绝
    const blocked = canRetry('POST', false, { attempts: 3 })
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toMatch(/非幂等/)
    // 有幂等键 ⇒ 允许
    expect(canRetry('POST', true, { attempts: 3 }).ok).toBe(true)
    // 幂等方法 ⇒ 允许
    expect(canRetry('GET', false, { attempts: 3 }).ok).toBe(true)
    expect(canRetry('PUT', false, { attempts: 3 }).ok).toBe(true)
    // 显式承认可安全重发 ⇒ 允许（但仍要业务自己承担）
    expect(canRetry('POST', false, { attempts: 3, retryNonIdempotent: true }).ok).toBe(true)
    // 未配重试 ⇒ 一律不允许（即使幂等）
    expect(canRetry('GET', false, undefined).ok).toBe(false)
  })

  it('★②b 方法幂等性表（GET/HEAD/OPTIONS/PUT/DELETE/TRACE；POST/PATCH 非幂等）', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE', 'get', 'put']) {
      expect(isIdempotentMethod(m), `${m} 应幂等`).toBe(true)
    }
    for (const m of ['POST', 'PATCH', 'post', 'patch']) {
      expect(isIdempotentMethod(m), `${m} 不应幂等`).toBe(false)
    }
  })

  /* ── ② 未知态分类（本库最核心的差异化） ── */
  it('★★★③ 未知态：超时/总时限/在飞取消 ⇒ unknown（必须去查单，不能重试）', () => {
    for (const code of ['fetch.timeout', 'fetch.deadline']) {
      const c = classifyFailure(new CapError(code, 'x'), { sent: true, gotResponseBytes: false })
      expect(c.outcome, `${code} 必须是 unknown`).toBe('unknown')
    }
    // 在飞取消 ⇒ unknown
    expect(classifyFailure(new CapError('fetch.aborted', 'x'), { sent: true, gotResponseBytes: false }).outcome).toBe('unknown')
    // 排队中取消 ⇒ failed（确定没发出）
    expect(
      classifyFailure(new CapError('fetch.aborted', 'x'), { sent: false, gotResponseBytes: false, queuedOnly: true }).outcome,
    ).toBe('failed')
  })

  it('★★★④ 确定失败：本地拒绝/建连失败 ⇒ failed（可安全重试）', () => {
    for (const code of ['fetch.intercepted', 'fetch.forbidden', 'request.circuitOpen', 'fetch.unsupported']) {
      const c = classifyFailure(new CapError(code, 'x'), { sent: false, gotResponseBytes: false })
      expect(c.outcome, `${code} 必须是 failed`).toBe('failed')
      expect(c.phase).toBe('rejected-local')
    }
    const net = classifyFailure(new CapError('network.unreachable', 'x'), { sent: false, gotResponseBytes: false })
    expect(net.outcome).toBe('failed')
    expect(net.phase).toBe('connect-failed')
  })

  it('★★★⑤ 判不出时**保守按 unknown**（宁可让业务多查一次单，也不让它误重试）', () => {
    const c = classifyFailure(new CapError('some.weird.error', 'x'), { sent: true, gotResponseBytes: false })
    expect(c.outcome, '★未知错误必须按 unknown 处理').toBe('unknown')
    expect(c.phase).toBe('indeterminate')
  })

  it('★★⑥ 未知态**不自动重试**（支付安全硬要求）', () => {
    for (const code of ['fetch.timeout', 'fetch.deadline']) {
      const d = shouldRetryResult({ ok: false, error: new CapError(code, 'x') }, 'POST', true, { attempts: 3 }, 1)
      expect(d.retry, `${code} 即使在幂等路径上也不该自动重试`).toBe(false)
      expect(d.reason).toMatch(/未知态/)
    }
  })

  it('⑦ 已收到响应字节后才超大 ⇒ unknown（服务端已处理）', () => {
    const c = classifyFailure(new CapError('fetch.tooLarge', 'x'), { sent: true, gotResponseBytes: true })
    expect(c.outcome).toBe('unknown')
    expect(c.phase).toBe('response-incomplete')
  })

  /* ── ③ 抖动 ── */
  it('★★⑧ 抖动是真随机（pipeline 现在是确定性符号，起不到去同步作用）', () => {
    const policy = { attempts: 3, delayMs: 1000, backoff: 'exponential' as const, jitter: 0.5 }
    // 注入不同的 rand ⇒ 得到不同的延迟
    const a = computeBackoffMs(1, policy, undefined, () => 0)
    const b = computeBackoffMs(1, policy, undefined, () => 0.5)
    const c = computeBackoffMs(1, policy, undefined, () => 1)
    expect(a).toBe(500) // 1000 * (1-0.5+0*1) = 500
    expect(b).toBe(1000)
    expect(c).toBe(1500)
    expect(a).not.toBe(c)
  })

  it('⑨ 退避曲线：fixed / linear / exponential；jitter=0 时精确', () => {
    const base = { attempts: 3, delayMs: 100, jitter: 0 }
    expect(computeBackoffMs(1, { ...base, backoff: 'fixed' })).toBe(100)
    expect(computeBackoffMs(3, { ...base, backoff: 'fixed' })).toBe(100)
    expect(computeBackoffMs(3, { ...base, backoff: 'linear' })).toBe(300)
    expect(computeBackoffMs(1, { ...base, backoff: 'exponential' })).toBe(100)
    expect(computeBackoffMs(2, { ...base, backoff: 'exponential' })).toBe(200)
    expect(computeBackoffMs(3, { ...base, backoff: 'exponential' })).toBe(400)
  })

  it('★★⑩ Retry-After 优先于退避（pipeline 现在完全不解析）', () => {
    expect(parseRetryAfter('5')).toBe(5000)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter(undefined)).toBeUndefined()
    expect(parseRetryAfter('not-a-date')).toBeUndefined()
    // HTTP-date 形态
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000)
    // 过期的 date ⇒ 0（不返回负数）
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now + 5000)).toBe(0)
    // computeBackoffMs 尊重它
    expect(computeBackoffMs(1, { attempts: 3, delayMs: 100, jitter: 0 }, 5000)).toBe(5000)
    // respectRetryAfter:false ⇒ 忽略
    expect(computeBackoffMs(1, { attempts: 3, delayMs: 100, jitter: 0, respectRetryAfter: false }, 5000)).toBe(100)
  })

  /* ── ④ 断路器 ── */
  it('★★⑪ 断路器状态机：closed → open → halfOpen → closed', () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, halfOpenProbes: 1 })
    const key = 'api.example.com'
    // 初始放行
    expect(cb.allow(key, 0).allowed).toBe(true)
    // 两次失败 ⇒ open
    cb.onFailure(key, 0)
    cb.onFailure(key, 0)
    expect(cb.allow(key, 100).allowed).toBe(false)
    expect(cb.snapshot()[0]!.state).toBe('open')
    // cooldown 到期 ⇒ halfOpen，放行一个探测
    expect(cb.allow(key, 1500).allowed).toBe(true)
    expect(cb.snapshot()[0]!.state).toBe('halfOpen')
    // 探测额度用完 ⇒ 再拦
    expect(cb.allow(key, 1501).allowed).toBe(false)
    // 探测成功 ⇒ closed
    cb.onSuccess(key)
    expect(cb.snapshot()[0]!.state).toBe('closed')
    expect(cb.allow(key, 2000).allowed).toBe(true)
  })

  it('★⑫ 断路器：半开探测失败 ⇒ 立刻重新打开（不等 threshold）', () => {
    const cb = new CircuitBreaker({ threshold: 5, cooldownMs: 100 })
    const key = 'h'
    // 直接推入 open（用 5 次失败）
    for (let i = 0; i < 5; i++) cb.onFailure(key, 0)
    expect(cb.allow(key, 200).allowed).toBe(true) // 转 halfOpen
    cb.onFailure(key, 200) // 探测失败
    expect(cb.allow(key, 201).allowed, '★半开失败必须立刻重开').toBe(false)
  })

  it('★⑬ 断路器：unknown 结果**不计入**失败（那不是下游的错）', () => {
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 100 })
    const key = 'h'
    cb.onFailure(key, 0, false) // counts=false（unknown 用这个）
    expect(cb.allow(key, 1).allowed, '★未知态不该把下游判死').toBe(true)
    cb.onFailure(key, 2, true)
    expect(cb.allow(key, 3).allowed).toBe(false)
  })

  /* ── ⑤ 离线队列 ── */
  it('★★⑭ 离线队列：**只收幂等**请求（非幂等入队 = 恢复后重复提交）', async () => {
    const q = new OfflineQueue({ policy: { enabled: true, maxEntries: 10 } })
    const bad = await q.enqueue(
      { idempotencyKey: '', url: '/order', method: 'POST', enqueuedAt: Date.now() },
      'POST',
    )
    expect(bad.queued, '★无幂等键的 POST 必须拒绝入队').toBe(false)
    expect(bad.reason).toMatch(/非幂等/)
    const good = await q.enqueue(
      { idempotencyKey: 'k1', url: '/order', method: 'POST', enqueuedAt: Date.now() },
      'POST',
    )
    expect(good.queued).toBe(true)
    // GET 无需 key 也可入队
    const get = await q.enqueue({ idempotencyKey: 'k2', url: '/feed', method: 'GET', enqueuedAt: Date.now() }, 'GET')
    expect(get.queued).toBe(true)
    expect(q.size()).toBe(2)
  })

  it('★⑮ 离线队列：同 key 不重复入队；超上限丢最旧并计数', async () => {
    const q = new OfflineQueue({ policy: { enabled: true, maxEntries: 2 } })
    await q.enqueue({ idempotencyKey: 'a', url: '/1', method: 'GET', enqueuedAt: 1 }, 'GET')
    const dup = await q.enqueue({ idempotencyKey: 'a', url: '/1', method: 'GET', enqueuedAt: 2 }, 'GET')
    expect(dup.queued).toBe(false)
    await q.enqueue({ idempotencyKey: 'b', url: '/2', method: 'GET', enqueuedAt: 3 }, 'GET')
    const third = await q.enqueue({ idempotencyKey: 'c', url: '/3', method: 'GET', enqueuedAt: 4 }, 'GET')
    expect(third.queued).toBe(true)
    expect(third.dropped, '★超限要报告丢了几个（不静默）').toBe(1)
    expect(q.size()).toBe(2)
    const all = await q.peekAll()
    expect(all.map((e) => e.idempotencyKey), '★应丢掉最旧的 a').toEqual(['b', 'c'])
  })

  /* ── ⑥ 幂等键生成 ── */
  it('⑯ 幂等键：模式 off / required / auto 语义', () => {
    const seed = (): string => makeIdempotencyKey('t')
    // off：不生成（但保留业务显式给的）
    expect(resolveIdempotencyKey(undefined, 'off', seed)).toBeUndefined()
    expect(resolveIdempotencyKey('given', 'off', seed)).toBe('given')
    // required：没给也生成
    expect(resolveIdempotencyKey(undefined, 'required', seed)).toMatch(/^t-/)
    // auto：不主动生成
    expect(resolveIdempotencyKey(undefined, 'auto', seed)).toBeUndefined()
    expect(resolveIdempotencyKey('given', 'auto', seed)).toBe('given')
  })

  it('★⑰ 幂等键唯一性（连发 1000 个不重复）', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(makeIdempotencyKey())
    expect(set.size).toBe(1000)
  })

  it('⑱ shouldRetryResult：成功但 429/5xx ⇒ 可重试；4xx ⇒ 不重试', () => {
    const ok429 = { ok: true as const, data: {}, status: 429, headers: {} }
    expect(shouldRetryResult(ok429, 'GET', false, { attempts: 3 }, 1).retry).toBe(true)
    const ok200 = { ok: true as const, data: {}, status: 200, headers: {} }
    expect(shouldRetryResult(ok200, 'GET', false, { attempts: 3 }, 1).retry).toBe(false)
    // ★`attempts:3` = 额外 3 次 ⇒ 总共 4 次；所以第 3 次仍可重试，第 4 次才停
    expect(shouldRetryResult(ok429, 'GET', false, { attempts: 3 }, 3).retry, '第 3 次应仍可重试').toBe(true)
    expect(shouldRetryResult(ok429, 'GET', false, { attempts: 3 }, 4).retry, '第 4 次达上限').toBe(false)
  })
})

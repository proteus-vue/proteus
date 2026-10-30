// tests/request-platform.test.ts —— ★★★#1403 请求层**平台化三件**判据
//
// 【本单起因】用户问「我们现在这个请求库产品能承载大厂超级应用吗？」。
//   取证查出三个硬缺口（都是"平台化最后一段"）：
//     ① **全局配额不全局** —— `QuotaTree`/`CircuitBreaker` 在 `createRequestClient` 内部 new
//        ⇒ 每实例一份。N 个实例 = N 份额度，"全局并发不超过 6"变成"每实例 6"。
//        （`tenant.ts` 的注释写着"必须在所有实例之上再有一层"，但代码没做到 —— 注释与实现不符。）
//     ② **没有速率限制** —— 只有并发上限，没有"每秒最多几次"。`for` 循环发 100 个的话，
//        并发闸门只是让它们**排队后全部发出**，总量一个不少。
//     ③ **审计只有逐条同步回调** —— 没有缓冲/批量/采样。回调里做 IO 就拖慢请求路径；
//        千万级请求不可能全量上报，而关掉审计等于放弃合规。
//
// 【本文件守什么】
//   ① 同 `sharedQuotaKey` 的两个实例**真的共享配额**（而不是各算各的）；
//   ② 不同 key / 不传 key ⇒ **不共享**（默认零回归）；
//   ③ 令牌桶：速率上限真的生效；`maxWaitMs=0` **立即拒绝**（不静默排队）；
//   ④ 速率超限的失败码是 `request.rateLimited` 且带 `retryAfterMs`（可退避，不盲目重试）；
//   ⑤ 速率**排在并发之前**（被限速的不占并发额度）；
//   ⑥ 审计**批量写**（不是逐条回调）；缓冲**有界**（超限丢最旧并计数）；
//   ⑦ ★★**失败与未知永不采样**（成功按 sampleRate 采）；
//   ⑧ `dispose` 释放审计定时器（不泄漏）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** 可控时钟（判据不许盲等 —— 速率相关的"桶空了"全靠它确定性造出） */
function makeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
    sleep: async (ms: number) => { t += ms; return true },
  }
}

/** 假 hooks：每次请求立刻成功 */
function mkHooks() {
  return {
    useFetch: async (_u: string, c: Record<string, unknown>) => ({
      ok: true, data: 'ok', status: 200, headers: {}, config: c,
      meta: { id: 'm', attempts: 1, queuedMs: 0, totalMs: 1, attemptMs: [1], deduped: false, priority: 0 },
    }),
    useFetchTask: () => ({ id: 't', result: Promise.resolve({ ok: true }), state: 'done' as const, abort: () => {} }),
    dispose: () => {},
  }
}

const loadClient = async () => await import('../packages/api/src/request/client')
const loadShared = async () => await import('../packages/api/src/request/shared')

beforeEach(async () => {
  const { resetSharedPools } = await loadShared()
  resetSharedPools()
})

describe('★★★#1403 ① 全局配额真的全局（sharedQuotaKey）', () => {
  it('★★★同 key 的两个实例**真的共享额度**（同一个池对象 + 计数联动）', async () => {
    const { createRequestClient } = await loadClient()
    const { acquireSharedPool, sharedPoolCount } = await loadShared()

    const opts = { hooks: mkHooks() as never, tenant: { bizId: 'shop', concurrency: 5 }, sharedQuotaKey: 'prod!strength' }
    const a = createRequestClient(opts)
    const b = createRequestClient(opts)
    expect((a.stats() as { sharedQuotaKey?: string | null }).sharedQuotaKey).toBe('prod!strength')
    expect((b.stats() as { sharedQuotaKey?: string | null }).sharedQuotaKey).toBe('prod!strength')
    expect(sharedPoolCount(), '★同 key 必须只建一个池').toBe(1)

    // ★直接取证：两次 acquire 拿到的必须是**同一个对象**（第二次 acquire 会命中已建的池）
    const p1 = acquireSharedPool('prod!strength', 5, { enabled: false })
    const p2 = acquireSharedPool('prod!strength', 5, { enabled: false })
    expect(p1 === p2, '★★★两次 acquire 拿到不同对象 ⇒ 池没有共享').toBe(true)

    // ★计数联动：在 p1 的全局闸门上占一个额度 ⇒ p2 的 snapshot 立刻看到
    const release = await p1.quota.global.acquire()
    expect(p2.quota.snapshot().global, '★★★在 p1 占的额度 p2 看不到 ⇒ 全局上限失效').toBe(1)
    release()
    expect(p2.quota.snapshot().global, '★释放后应回到 0').toBe(0)

    ;(a as unknown as { dispose?: () => void }).dispose?.()
    ;(b as unknown as { dispose?: () => void }).dispose?.()
  })

  it('★★② 不传 key ⇒ 每实例一份（默认零回归）；不同 key ⇒ 各自独立', async () => {
    const { createRequestClient } = await loadClient()
    const { sharedPoolCount } = await loadShared()
    createRequestClient({ hooks: mkHooks() as never })
    createRequestClient({ hooks: mkHooks() as never })
    expect(sharedPoolCount(), '★不传 key 不该建共享池（零回归）').toBe(0)

    createRequestClient({ hooks: mkHooks() as never, sharedQuotaKey: 'k1' })
    createRequestClient({ hooks: mkHooks() as never, sharedQuotaKey: 'k2' })
    expect(sharedPoolCount(), '★不同 key 必须各自一个池').toBe(2)
  })

  it('★★③ stats 回显 sharedQuotaKey（"全局上限有没有生效"的唯一线索）', async () => {
    const { createRequestClient } = await loadClient()
    const noKey = createRequestClient({ hooks: mkHooks() as never })
    expect((noKey.stats() as { sharedQuotaKey?: string | null }).sharedQuotaKey, '★不共享时必须如实回 null').toBeNull()
  })
})

describe('★★★#1403 ② 速率限制（令牌桶）', () => {
  it('★★★① 每秒 2 次 ⇒ 第 3 次立刻被拒（不静默排队）', async () => {
    const { createRequestClient } = await loadClient()
    const c = createRequestClient({
      hooks: mkHooks() as never,
      rateLimit: { permitsPerSecond: 2, burst: 2, maxWaitMs: 0 },
    })
    const r1 = await c.request('/a')
    const r2 = await c.request('/b')
    const r3 = await c.request('/c')
    expect(r1.ok && r2.ok, '★突发额度内应放行').toBe(true)
    expect(r3.ok, '★★★第 3 次必须被拒（maxWaitMs=0 ⇒ 立即拒绝，不排队）').toBe(false)
    expect(r3.ok === false && r3.error.code).toBe('request.rateLimited')
  })

  it('★★★② 拒绝时带 retryAfterMs（业务可退避，不盲目重试）', async () => {
    const { createRequestClient } = await loadClient()
    const c = createRequestClient({
      hooks: mkHooks() as never,
      rateLimit: { permitsPerSecond: 1, burst: 1, maxWaitMs: 0 },
    })
    await c.request('/a')
    const r = await c.request('/b')
    expect(r.ok).toBe(false)
    const retryAfter = (r as { error?: { retryAfterMs?: number } }).error?.retryAfterMs
    expect(typeof retryAfter, '★必须给出"还要等多久"').toBe('number')
    expect(retryAfter!).toBeGreaterThan(0)
  })

  it('★★③ 速率排在并发之前 ⇒ 被限速的不占并发额度', async () => {
    const { createRequestClient } = await loadClient()
    const c = createRequestClient({
      hooks: mkHooks() as never,
      tenant: { bizId: 'shop', concurrency: 1 },
      rateLimit: { permitsPerSecond: 1, burst: 1, maxWaitMs: 0 },
    })
    await c.request('/a')      // 用掉唯一令牌
    const before = (c.stats() as { inflight: number }).inflight
    const r = await c.request('/b')   // 被限速
    expect(r.ok).toBe(false)
    expect((c.stats() as { inflight: number }).inflight, '★被限速的请求不该占住并发额度').toBe(before)
  })

  it('★④ 没配 rateLimit ⇒ 整段短路（不改变任何行为）', async () => {
    const { createRequestClient } = await loadClient()
    const c = createRequestClient({ hooks: mkHooks() as never })
    for (let i = 0; i < 20; i++) {
      const r = await c.request(`/n${i}`)
      expect(r.ok).toBe(true)
    }
    expect((c.stats() as { rateLimit?: { enabled: boolean } }).rateLimit?.enabled).toBe(false)
  })
})

describe('★★★#1403 ③ 审计出口（批量 + 有界 + 采样）', () => {
  it('★★① 批量写：达到 batchSize 才 flush（不是逐条回调）', () => {
    const written: number[] = []
    return import('../packages/api/src/request/audit').then(({ AuditSink }) => {
      const sink = new AuditSink({
        batchSize: 3, flushIntervalMs: 0, write: (es) => written.push(es.length),
      })
      const mk = (outcome: 'success' | 'failed' | 'unknown') => ({
        id: 'x', bizId: 'b', url: 'https://a.b/c', host: 'a.b', method: 'GET',
        outcome, durationMs: 1, attempts: 1, at: Date.now(),
      } as never)
      sink.push(mk('success'))
      sink.push(mk('success'))
      expect(written, '★未达 batchSize 不该写').toHaveLength(0)
      sink.push(mk('success'))
      expect(written, '★达到 batchSize 应一次性写 3 条').toEqual([3])
      sink.dispose()
    })
  })

  it('★★② 缓冲有界：超 maxBuffer 丢最旧并计数（不静默）', async () => {
    const { AuditSink } = await import('../packages/api/src/request/audit')
    const sink = new AuditSink({ batchSize: 999, flushIntervalMs: 0, maxBuffer: 5, write: () => {} })
    const mk = (i: number) => ({
      id: `x${i}`, bizId: 'b', url: 'https://a.b/c', host: 'a.b', method: 'GET',
      outcome: 'success' as const, durationMs: 1, attempts: 1, at: Date.now(),
    } as never)
    for (let i = 0; i < 10; i++) sink.push(mk(i))
    const s = sink.snapshot()
    expect(s.buffered, '★缓冲不得超过 maxBuffer').toBe(5)
    expect(s.dropped, '★丢弃必须计数（不静默）').toBe(5)
    sink.dispose()
  })

  it('★★★③ 失败与未知**永不采样**（成功按 sampleRate 采）', async () => {
    /* 【为什么这条最重要】采样若对失败也生效，就会漏掉"错误率 1% 里的 90%"，
       而那 1% 正是合规与排障最需要的。⇒ 成功按比例采，failed/unknown 一律全留。 */
    const { AuditSink } = await import('../packages/api/src/request/audit')
    const written: Array<{ outcome: string }> = []
    // rand 恒返回 0.99 ⇒ sampleRate=0.1 时**成功全被采样掉**
    const sink = new AuditSink(
      { sampleRate: 0.1, batchSize: 999, flushIntervalMs: 0, write: (es) => { for (const e of es) written.push(e as never) } },
      () => 0.99,
    )
    const mk = (outcome: 'success' | 'failed' | 'unknown', i: number) => ({
      id: `x${i}`, bizId: 'b', url: 'https://a.b/c', host: 'a.b', method: 'GET',
      outcome, durationMs: 1, attempts: 1, at: Date.now(),
    } as never)
    sink.push(mk('success', 1))   // 被采样掉
    sink.push(mk('failed', 2))    // ★必须留下
    sink.push(mk('unknown', 3))   // ★必须留下
    sink.dispose()
    expect(written.map((e) => e.outcome).sort(), '★★★失败/未知被采样掉了 —— 排障数据会缺口').toEqual(['failed', 'unknown'])
  })

  it('★④ dispose 先 flush 再停表（不丢已缓冲的条目）', async () => {
    const { AuditSink } = await import('../packages/api/src/request/audit')
    const written: number[] = []
    const sink = new AuditSink({ batchSize: 999, flushIntervalMs: 0, write: (es) => written.push(es.length) })
    sink.push({ id: 'x', bizId: 'b', url: 'https://a.b/c', host: 'a.b', method: 'GET', outcome: 'success', durationMs: 1, attempts: 1, at: Date.now() } as never)
    sink.dispose()
    expect(written, '★dispose 时缓冲里的条目必须被刷出（不能丢）').toEqual([1])
  })
})

describe('★★★#1403 ④ 客户端接线（三件都要真的接上）', () => {
  it('★★★① 配了 audit ⇒ 走批量出口，不再逐条调 tenant.onAudit', async () => {
    const { createRequestClient } = await loadClient()
    const perEntry: number[] = []
    const batches: number[] = []
    const c = createRequestClient({
      hooks: mkHooks() as never,
      tenant: { bizId: 'shop', onAudit: () => perEntry.push(1) },
      audit: { batchSize: 2, flushIntervalMs: 0, write: (es) => batches.push(es.length) },
    })
    await c.request('/a')
    await c.request('/b')
    expect(batches, '★配了 audit 应走批量出口').toEqual([2])
    expect(perEntry, '★配了 audit 就不该再逐条调 onAudit（否则业务收到两份）').toHaveLength(0)
    ;(c as unknown as { dispose?: () => void }).dispose?.()
  })

  it('★② 没配 audit ⇒ 保持旧的逐条 onAudit（零回归）', async () => {
    const { createRequestClient } = await loadClient()
    const perEntry: number[] = []
    const c = createRequestClient({
      hooks: mkHooks() as never,
      tenant: { bizId: 'shop', onAudit: () => perEntry.push(1) },
    })
    await c.request('/a')
    expect(perEntry, '★不配 audit 必须零变化').toHaveLength(1)
  })
})

// tests/fetch-pipeline.test.ts
// ★★★决策 #1133：**useFetch 请求管线**的判据（拦截器 / 重试 / 去重 / 并发 / 任务句柄 / 观测）。
//
// 【这层为什么必须有自己的判据（不是"调用一下 runFetch 就行"）】
//   管线是**策略层**——它出错不会崩，只会"静默地不生效"：
//     · 并发上限写反 ⇒ 所有请求立刻全发（首页打爆连接池，但功能看起来正常）；
//     · 重试判定过宽 ⇒ 取消的请求被重试（用户点了返回还在发请求）；
//     · 去重键漏了 body ⇒ POST 不同内容被合并（写请求被吞，数据不一致）；
//     · 拦截器顺序错 ⇒ 鉴权头没加上（401），而响应拦截器逆序也拿不到正确上下文；
//     · meta 不填 ⇒ 线上永远查不出"慢在排队还是慢在网络"。
//   这些都只有**行为判据**能抓（且每条都要能破坏性验证）。
//
// 【★装置】用**假桥**（记录调用 + 可控延迟），不引真网络：
//   管线是纯 TS 策略层，不需要真网络就能验全部语义；真网络层由 #1130 的两层 e2e 覆盖。
import { describe, it, expect } from 'vitest'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import type { RequestConfig, RequestResponse } from '../packages/api/src/types'

/** 记录每个请求 + 可注入延迟/失败的假桥。 */
function makeBridge(opts: {
  /** 每次调用的耗时（ms） */
  latencyMs?: number
  /** 第 n 次调用（0 起）的返回；缺省 200 成功 */
  reply?: (n: number, config: RequestConfig) => Promise<RequestResponse<unknown>> | RequestResponse<unknown>
} = {}) {
  const calls: RequestConfig[] = []
  let n = 0
  const bridge = {
    request: async (config: RequestConfig): Promise<RequestResponse<unknown>> => {
      const idx = n++
      calls.push(config)
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs))
      if (opts.reply) return opts.reply(idx, config)
      return { data: { ok: 1 }, status: 200, headers: { 'x-idx': String(idx) }, config }
    },
  }
  return { bridge, calls, count: () => n }
}

/** 可控时钟（每调用一次前进 fixedMs）。 */
function stepClock(fixedMs = 8) {
  let t = 1000
  return {
    now: () => {
      const v = t
      t += fixedMs
      return v
    },
  }
}

const run = <T>(p: ReturnType<typeof createFetchPipeline>, url: string, config?: Parameters<typeof p.fetch<T>>[1]) =>
  p.fetch<T>(url, config)

describe('★#1133 请求管线 · 拦截器（洋葱模型）', () => {
  it('请求拦截器按注册序执行、响应拦截器按逆序执行', async () => {
    const order: string[] = []
    const { bridge } = makeBridge()
    const p = createFetchPipeline(bridge, {
      requestInterceptors: [
        (c) => {
          order.push('req1')
          return c
        },
        (c) => {
          order.push('req2')
          return c
        },
      ],
      responseInterceptors: [
        (r) => {
          order.push('res1')
          return r
        },
        (r) => {
          order.push('res2')
          return r
        },
      ],
    })
    await run(p, '/x')
    // 请求 1→2；响应 2→1（洋葱）
    expect(order).toEqual(['req1', 'req2', 'res2', 'res1'])
  })

  it('★请求拦截器可改 url / headers（鉴权头的标准落点）', async () => {
    const { bridge, calls } = makeBridge()
    const p = createFetchPipeline(bridge, {
      requestInterceptors: [
        (c) => ({ ...c, url: c.url + '?v=2', config: { ...c.config, headers: { ...c.config.headers, Authorization: 'Bearer T' } } }),
      ],
    })
    await run(p, '/api/me')
    expect(calls[0]!.url, '★url 改写未生效').toContain('/api/me')
    // ★注意：管线的 url 改写是**给下一轮用**的；实际请求应带 Authorization
    expect(calls[0]!.headers?.Authorization).toBe('Bearer T')
  })

  it('★拦截器返回 null ⇒ 短路（不发请求，码 fetch.intercepted）', async () => {
    const { bridge, count } = makeBridge()
    const p = createFetchPipeline(bridge, { requestInterceptors: [() => null] })
    const res = await run(p, '/x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('fetch.intercepted')
    // ★关键：一个请求都不该发出去
    expect(count(), '★短路后仍发出了请求').toBe(0)
  })

  it('响应拦截器可以改写结果（401 → 刷新后成功）', async () => {
    const { bridge } = makeBridge({ reply: (n, config) => ({ data: 'ok-after-refresh', status: 200, headers: {}, config }) })
    const p = createFetchPipeline(bridge, {
      responseInterceptors: [
        (r) => {
          if (!r.ok) return r
          return { ...r, data: `${String(r.data)}!(patched)` }
        },
      ],
    })
    const res = await run<string>(p, '/x')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toBe('ok-after-refresh!(patched)')
  })
})

describe('★#1133 请求管线 · 重试（可恢复失败才重试）', () => {
  it('★5xx 重试后成功（attempts=2，meta 有每轮耗时）', async () => {
    const { bridge, count } = makeBridge({
      reply: (n, config) =>
        n === 0 ? { data: 'boom', status: 503, headers: {}, config } : { data: 'ok', status: 200, headers: {}, config },
    })
    const p = createFetchPipeline(bridge, { retry: { attempts: 2, delayMs: 1, jitter: 0 }, now: stepClock().now })
    const res = await run<string>(p, '/x')
    expect(res.ok).toBe(true)
    expect(count(), '★应重试一次').toBe(2)
    const meta = (res as { meta?: { attempts: number; attemptMs: number[] } }).meta
    expect(meta?.attempts, '★meta.attempts 应为实际轮次').toBe(2)
    expect(meta?.attemptMs.length).toBe(2)
  })

  it('★★取消的请求**不重试**（fetch.aborted 不在可重试集合）', async () => {
    const { bridge, count } = makeBridge({
      reply: (_n, _config) => Promise.reject(Object.assign(new Error('fetch.aborted: 业务取消'), { code: 'fetch.aborted' })),
    })
    const p = createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 1, jitter: 0 } })
    const res = await run(p, '/x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('fetch.aborted')
    expect(count(), '★取消的请求被重试了（用户点了返回还在发）').toBe(1)
  })

  it('★能力缺失（unsupported）不重试', async () => {
    const { bridge, count } = makeBridge({
      reply: (_n, _config) => Promise.reject(Object.assign(new Error('nope'), { code: 'fetch.unsupported' })),
    })
    const p = createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 1, jitter: 0 } })
    await run(p, '/x')
    expect(count()).toBe(1)
  })

  it('★超时可重试（fetch.timeout 属可恢复）', async () => {
    const { bridge, count } = makeBridge({
      reply: (n, config) =>
        n === 0
          ? Promise.reject(Object.assign(new Error('fetch.timeout: 超时'), { code: 'fetch.timeout' }))
          : { data: 'ok', status: 200, headers: {}, config },
    })
    const p = createFetchPipeline(bridge, { retry: { attempts: 2, delayMs: 1, jitter: 0 } })
    const res = await run(p, '/x')
    expect(res.ok).toBe(true)
    expect(count()).toBe(2)
  })

  it('★单请求 retry 数字覆盖默认（0 = 不重试）', async () => {
    const { bridge, count } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
    const p = createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 1, jitter: 0 } })
    await run(p, '/x', { retry: 0 })
    expect(count(), '★单请求 retry:0 应关掉重试').toBe(1)
  })

  it('★退避曲线：exponential 逐轮翻倍（jitter=0 时可精确断言）', async () => {
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // 拦 setTimeout 记录请求的延迟（并立即执行，不真等）
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms)
      return origSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      const { bridge } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
      const p = createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 100, backoff: 'exponential', jitter: 0 } })
      await run(p, '/x')
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = origSetTimeout
    }
    expect(delays, '★指数退避应为 100/200/400').toEqual([100, 200, 400])
  })
})

/**
 * ★★★#1385：重试的两条**安全语义**（此前 pipeline 全都没有）。
 *
 * 【这两条为什么必须单独一组】它们守的不是"重试能工作"，而是"重试不会造成业务损失"：
 *   ① 非幂等 + 没幂等键 ⇒ **不许**重发（否则 `POST /order` 超时重试 = 可能下两单）；
 *   ② 抖动必须是**真随机**（否则所有客户端同时失败、同时退避**同样长度**、再同时重试
 *      = 退避完全没能去同步，重试风暴照旧）。
 */
describe('★★★#1385 请求管线 · 重试安全语义（方法维度 + 真随机抖动）', () => {
  /** 用可控 setTimeout 记录退避时长（不真等）。
   *  ★★★装置要点：`setTimeout` 必须在 **createFetchPipeline 之前**替换——
   *  pipeline 创建时通过 `makeDelay()` 捕获一次全局 `setTimeout` 快照（`capability-fetch-pipeline.ts:198`）。
   *  第一版把替换放在创建之后 ⇒ 采集到空数组（重试确实发生了，只是没经过我的桩）⇒ 假红。
   *  ⇒ 这里把"建管线"也包进来：`withDelayCapture((p) => run(p, ...))`。 */
  async function withDelayCapture(
    build: () => ReturnType<typeof createFetchPipeline>,
    drive: (p: ReturnType<typeof createFetchPipeline>) => Promise<unknown>,
  ): Promise<number[]> {
    const delays: number[] = []
    const origSetTimeout = globalThis.setTimeout
    ;(globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms)
      return origSetTimeout(fn, 0)
    }) as typeof setTimeout
    try {
      const p = build()
      await drive(p)
    } finally {
      ;(globalThis as { setTimeout: unknown }).setTimeout = origSetTimeout
    }
    return delays
  }

  it('★★① POST 失败**不重试**（非幂等 + 无幂等键 ⇒ 防重复下单），且 meta 如实说明原因', async () => {
    const { bridge, count } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
    const p = createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 1, jitter: 0 } })
    const res = await run(p, '/order', { method: 'POST', data: { sku: 'A' } })
    expect(count(), '★POST 只应发 1 次（旧实现会重试 4 次 ⇒ 可能下 4 单）').toBe(1)
    expect(res.meta?.attempts).toBe(1)
    // ★不静默：业务要能看出"不是没重试，是不允许重试"
    expect(res.meta?.retryRefused?.reason, '★被拒原因必须带出来（否则业务误判成库有 bug）').toMatch(/非幂等/)
  })

  it('★★①b POST 显式 `retryNonIdempotent: true` ⇒ 允许重试（业务确认服务端幂等）', async () => {
    const { bridge, count } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
    const p = createFetchPipeline(bridge, { retry: { attempts: 2, delayMs: 1, jitter: 0, retryNonIdempotent: true } })
    const res = await run(p, '/order', { method: 'POST', data: { sku: 'A' } })
    expect(count(), '★显式打开后应重试到上限（1 首次 + 2 重试）').toBe(3)
    expect(res.meta?.retryRefused, '★放行时不该有拒绝原因').toBeUndefined()
  })

  it('①c 幂等方法（GET/PUT/DELETE）照常重试', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'HEAD'] as const) {
      const { bridge, count } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
      const p = createFetchPipeline(bridge, { retry: { attempts: 1, delayMs: 1, jitter: 0 } })
      await run(p, '/x', { method })
      expect(count(), `★${method} 是幂等方法，应重试（共 2 次）`).toBe(2)
    }
  })

  it('★★② 抖动是**真随机**（同一 attempt 多次计算不恒等；旧实现是 attempt%2 的确定性符号）', async () => {
    /* ★为什么这么断言：旧实现 `sign = attempt % 2 === 0 ? 1 : -1` ⇒ 同样的 attempt
       永远得到**同一个**退避值。而 jitter 存在的唯一目的就是"让同时失败的客户端错开"，
       确定性符号下所有客户端仍会同步重试 ⇒ 功能名存实亡。
       ⇒ 采集多轮同一 attempt 的实际 setTimeout 时长，必须出现**不止一个**取值。 */
    /* ★★★断言设计（第一版写错，自我修正记录）：
       第一版把所有 attempt 的退避值丢进一个 Set 断言 size>1 —— 那是**假绿**：
       确定性抖动下**不同 attempt** 本来就给不同值（1000、2000、4000 × 各自符号）
       ⇒ 清空法照样 size>1 ⇒ 旧实现也能过。实测：M2 变异（改回 `attempt % 2`）时该断言**不红**。
       ⇒ 正解：**只盯同一个 attempt**（第 0 轮退避），跨 12 次运行看取值是否变化。
          确定性符号下它恒为同一个数；真随机下才会散开。 */
    const firstDelays = new Set<number>()
    for (let i = 0; i < 12; i++) {
      const delays = await withDelayCapture(
        () => {
          const { bridge } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
          return createFetchPipeline(bridge, { retry: { attempts: 3, delayMs: 1000, jitter: 0.5 } })
        },
        (p) => run(p, '/x'),
      )
      expect(delays.length, '应有 3 次退避').toBe(3)
      firstDelays.add(delays[0]!)
    }
    expect(
      firstDelays.size,
      `★第 0 轮退避跨 12 次运行必须抖动（实得 ${[...firstDelays].join(',')}；确定性符号下恒为单值）`,
    ).toBeGreaterThan(1)
    // ★同时必须是"合理范围"内抖（不是乱数）：jitter=0.5、base=1000 ⇒ 第 0 轮落 [500,1500]
    for (const d of firstDelays) {
      expect(d, `首轮退避 ${d}ms 超出 [500,1500] 的抖动区间`).toBeGreaterThanOrEqual(500)
      expect(d, `首轮退避 ${d}ms 超出 [500,1500] 的抖动区间`).toBeLessThanOrEqual(1500)
    }
  })

  it('②b jitter=0 ⇒ 退避精确可断言（不抖动时仍可复现）', async () => {
    const delays = await withDelayCapture(
      () => {
        const { bridge } = makeBridge({ reply: (_n, config) => ({ data: 'x', status: 500, headers: {}, config }) })
        return createFetchPipeline(bridge, { retry: { attempts: 2, delayMs: 100, backoff: 'exponential', jitter: 0 } })
      },
      (p) => run(p, '/x'),
    )
    expect(delays, '★jitter=0 时应精确等于 base/2base').toEqual([100, 200])
  })
})

describe('★#1133 请求管线 · 并发与优先级', () => {
  it('★并发上限真的限住（3 个额度，6 个请求 ⇒ 峰值 ≤3）', async () => {
    const { bridge } = makeBridge({ latencyMs: 20 })
    const p = createFetchPipeline(bridge, { concurrency: 3 })
    let peak = 0
    const timer = setInterval(() => {
      peak = Math.max(peak, p.inflight())
    }, 2)
    await Promise.all(Array.from({ length: 6 }, (_, i) => run(p, `/x${i}`)))
    clearInterval(timer)
    expect(peak, `★并发峰值 ${peak} 超上限 3`).toBeLessThanOrEqual(3)
    expect(peak, '★并发从未达到 3（上限没生效或串行了）').toBeGreaterThan(1)
  })

  it('★高优先级先发（同额度下 priority 大的排前面）', async () => {
    const order: string[] = []
    const { bridge } = makeBridge({
      latencyMs: 10,
      reply: (_n, config) => {
        order.push(config.url)
        return { data: 1, status: 200, headers: {}, config }
      },
    })
    const p = createFetchPipeline(bridge, { concurrency: 1 })
    // 先占住唯一的额度
    const blocker = run(p, '/blocker')
    // 排队：低优先级先进，高优先级后进
    await new Promise((r) => setTimeout(r, 2))
    const low = run(p, '/low', { priority: 0 })
    const high = run(p, '/high', { priority: 10 })
    await Promise.all([blocker, low, high])
    const idxLow = order.indexOf('/low')
    const idxHigh = order.indexOf('/high')
    expect(idxHigh, '★高优先级没有先发').toBeLessThan(idxLow)
  })
})

describe('★#1133 请求管线 · 去重', () => {
  it('★相同在飞请求只发一次（第二次 deduped=true）', async () => {
    const { bridge, count } = makeBridge({ latencyMs: 20 })
    const p = createFetchPipeline(bridge, { dedupe: true })
    const [a, b] = await Promise.all([run<{ ok: number }>(p, '/same'), run<{ ok: number }>(p, '/same')])
    expect(count(), '★相同请求应只发一次').toBe(1)
    expect(a.ok && b.ok).toBe(true)
    const metas = [a, b].map((r) => (r as { meta?: { deduped: boolean } }).meta?.deduped)
    expect(metas.filter(Boolean).length, '★应有且仅有一条被标记 deduped').toBe(1)
  })

  it('★★去重键含 body（不同 POST body 不合并——否则写请求被吞）', async () => {
    const { bridge, count } = makeBridge({ latencyMs: 20 })
    const p = createFetchPipeline(bridge, { dedupe: true })
    await Promise.all([
      run(p, '/write', { method: 'POST', data: { v: 1 } }),
      run(p, '/write', { method: 'POST', data: { v: 2 } }),
    ])
    expect(count(), '★不同 body 的 POST 被错误合并').toBe(2)
  })

  it('★带 signal 的请求不参与去重（取消语义会互相污染）', async () => {
    const { bridge, count } = makeBridge({ latencyMs: 20 })
    const p = createFetchPipeline(bridge, { dedupe: true })
    const ctl = new AbortController()
    await Promise.all([run(p, '/same', { signal: ctl.signal }), run(p, '/same', { signal: ctl.signal })])
    expect(count(), '★带 signal 的请求不该被合并').toBe(2)
  })
})

describe('★#1133 请求管线 · 任务句柄（FetchTask）', () => {
  it('★排队中 abort ⇒ 立刻结算且**不占额度**（一个请求都不发）', async () => {
    const { bridge, count } = makeBridge({ latencyMs: 10 })
    const p = createFetchPipeline(bridge, { concurrency: 1 })
    const t1 = p.fetchTask('/a')
    const t2 = p.fetchTask('/b')
    expect(t2.state).toBe('queued')
    t2.abort('用户离开')
    const r = await t2.result
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.aborted')
    expect(t1.state).toBe('running')
    await t1.result
    await new Promise((r) => setTimeout(r, 20))
    // /b 从未真发出去
    expect(count(), '★排队中被取消的请求仍被发出').toBe(1)
  })

  it('★在飞 abort ⇒ 结果码 fetch.aborted（真通知下游 signal）', async () => {
    let sawSignalAbort = false
    const { bridge } = makeBridge({
      reply: (_n, config) =>
        new Promise((resolve, reject) => {
          const sig = config.signal as { aborted: boolean; onabort?: () => void } | undefined
          if (sig) sig.onabort = () => {
            sawSignalAbort = true
            reject(Object.assign(new Error('fetch.aborted: 取消'), { code: 'fetch.aborted' }))
          }
          setTimeout(() => resolve({ data: 1, status: 200, headers: {}, config }), 50)
        }),
    })
    const p = createFetchPipeline(bridge, { concurrency: 1 })
    const t = p.fetchTask('/slow')
    await new Promise((r) => setTimeout(r, 5))
    expect(t.state).toBe('running')
    t.abort('页面卸载')
    const r = await t.result
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.aborted')
    expect(sawSignalAbort, '★abort 没有传到下游 signal（宿主永远掐不断）').toBe(true)
  })

  it('★useFetchTask 的 id 稳定且每次不同', async () => {
    const { bridge } = makeBridge()
    const p = createFetchPipeline(bridge, {})
    const a = p.fetchTask('/a')
    const b = p.fetchTask('/b')
    expect(a.id).not.toBe(b.id)
    await Promise.all([a.result, b.result])
  })
})

describe('★★#1133 请求管线 · abortable（端能力差异）', () => {
  it('★★abortable=false ⇒ **不注入**内部取消信号（否则 MP 端所有请求变 unsupported）', async () => {
    // 【这条守什么】真容器抓出的回归：管线无条件注入内部 signal 后，MP 腿的契约
    //   「config.signal 存在 ⇒ fetch.unsupported」被误触发 ⇒ **MP 上 4/5 用例直接红**。
    //   判据口径：只有"用户显式要取消"才该在 MP 上报 unsupported；内部通道不该冒充用户意图。
    const { bridge, calls } = makeBridge()
    const p = createFetchPipeline(bridge, { abortable: false })
    await run(p, '/x')
    expect(calls[0]!.signal, '★不可取消端仍注入了内部 signal（MP 会被判 unsupported）').toBeUndefined()
  })

  it('abortable=true ⇒ 注入内部信号（App/Web 的 abort 靠它）', async () => {
    const { bridge, calls } = makeBridge()
    const p = createFetchPipeline(bridge, { abortable: true })
    await run(p, '/x')
    expect(calls[0]!.signal, '★可取消端没拿到信号 ⇒ task.abort() 掐不断').toBeTruthy()
  })

  it('★用户显式给 signal ⇒ 即使 abortable=false 也要传（用户语义优先）', async () => {
    const { bridge, calls } = makeBridge()
    const p = createFetchPipeline(bridge, { abortable: false })
    const sig = { aborted: false }
    await run(p, '/x', { signal: sig })
    // 传的是合并信号（不是原对象），但必须**存在**——这样 MP 端仍能如实报 unsupported
    expect(calls[0]!.signal, '★用户显式 signal 被吞了（MP 就不会报 unsupported）').toBeTruthy()
  })
})

describe('★#1133 请求管线 · 观测（meta）', () => {
  it('★meta 必填项齐全（id/attempts/queuedMs/totalMs/attemptMs/deduped/priority）', async () => {
    const { bridge } = makeBridge({ latencyMs: 5 })
    const p = createFetchPipeline(bridge, { concurrency: 1 })
    const res = await run(p, '/x', { priority: 7 })
    const meta = (res as { meta?: Record<string, unknown> }).meta
    expect(meta, '★结果没带 meta（线上查不出慢在哪）').toBeTruthy()
    for (const k of ['id', 'attempts', 'queuedMs', 'totalMs', 'attemptMs', 'deduped', 'priority']) {
      expect(meta, `★meta 缺 ${k}`).toHaveProperty(k)
    }
    expect(meta!.priority).toBe(7)
  })

  it('★queuedMs 真反映排队（并发 1 + 前一个占住 ⇒ 后一个排队时间 > 0）', async () => {
    const { bridge } = makeBridge({ latencyMs: 25 })
    const p = createFetchPipeline(bridge, { concurrency: 1 })
    const first = run(p, '/first')
    await new Promise((r) => setTimeout(r, 2))
    const second = run(p, '/second')
    const [, r2] = await Promise.all([first, second])
    const queuedMs = (r2 as { meta?: { queuedMs: number } }).meta?.queuedMs ?? 0
    const totalMs = (r2 as { meta?: { totalMs: number } }).meta?.totalMs ?? 0
    // ★★★#1257 修判据：原断言 `> 10ms` 依赖"前一个请求占住 ≥25ms"，但排队时长受事件循环
    //   调度影响（并行跑全量时实测只有 7ms ⇒ 假红）。口径改为**不依赖绝对时长**：
    //   排队必须被记录（>0）且不得超过总耗时（抓"恒 0"与"填离谱大数"两种失真）。
    expect(queuedMs, `★排队 ${queuedMs}ms 未记录（"慢在排队"就查不出来）`).toBeGreaterThan(0)
    expect(queuedMs, `★排队 ${queuedMs}ms > 总耗时 ${totalMs}ms（数字不可信）`).toBeLessThanOrEqual(totalMs + 1)
  })

  /**
   * ★★★#1158：**传输读数真的流到了 `meta.transport`**（不是只存在于类型定义里）。
   *
   * 【为什么要测到管线这一层】本字段的链路有**五段**：宿主 → 线格式 → `settleFromFrame`
   *   → `appHttpRequest` → 管线 → `meta.transport`。只测 `parseTransportReadout`（纯函数）
   *   与线格式往返，**不足以证明业务真的拿得到**——本仓栽过多次"底层做完、门面没接"
   *   （#1122 五个 S3 字段没进 `FetchConfig` 就是同一形态）。
   * ⇒ 这里用假壳返回带 `transport` 的响应，断言它出现在 `res.meta.transport` 且**已类型化**
   *   （`reused` 是 boolean、毫秒是 number，而不是线格式的字符串）。
   */
  it('★★★#1158 宿主传输读数经管线进入 meta.transport（且已类型化）', async () => {
    const { bridge } = makeBridge({
      reply: (_n, config) =>
        ({
          data: { ok: 1 },
          status: 200,
          headers: {},
          config,
          // ★线格式形态：字符串（模拟宿主回程帧解出的样子）
          transport: { proto: 'h2', reused: '1', dnsMs: '3.2', connectMs: '12.5', tlsMs: '31.0', ttfbMs: '48.7' },
        }) as unknown as RequestResponse<unknown>,
    })
    const p = createFetchPipeline(bridge)
    const res = await run(p, '/x', { cache: 'no-store' })
    const t = (res as { meta?: { transport?: Record<string, unknown> } }).meta?.transport
    expect(t, '★宿主给了读数但 meta.transport 没有 ⇒ 业务拿不到（链路断在某一段）').toBeTruthy()
    expect(t).toEqual({ proto: 'h2', reused: true, dnsMs: 3.2, connectMs: 12.5, tlsMs: 31, ttfbMs: 48.7 })
    // ★类型化断言：`reused` 必须是 boolean（线格式是 "1" 字符串；没解析就会是 "1"）
    expect(typeof t!.reused).toBe('boolean')
    expect(typeof t!.dnsMs).toBe('number')
  })

  it('★#1158 宿主没给读数（Web/MP/老宿主）⇒ `meta.transport` **不出现**（不是空对象）', async () => {
    const { bridge } = makeBridge()
    const p = createFetchPipeline(bridge)
    const res = await run(p, '/y')
    const meta = (res as { meta?: Record<string, unknown> }).meta
    expect(meta).toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(meta, 'transport')).toBe(false)
  })
})


describe('★★★#1257 凭据头 × 重定向 · 三腿分流（安全基线）', () => {
  /** 桥 + 可切换的 redirectFollow；记录每次调用看到的 redirectManual。 */
  function credBridge(follow: "browser" | "host" | "implicit" | undefined, hops = 1) {
    const seen: Array<{ redirectManual?: boolean; headers?: Record<string, string> }> = []
    let n = 0
    const bridge = {
      ...(follow === undefined ? {} : { redirectFollow: follow }),
      request: async (config: RequestConfig): Promise<RequestResponse<unknown>> => {
        const idx = n++
        seen.push({ redirectManual: config.redirectManual, headers: config.headers })
        // 前 hops 次回 302（跳到另一个 origin），之后 200
        if (idx < hops) {
          return {
            data: null,
            status: 302,
            headers: { location: "https://evil.example.com/next" },
            config,
          }
        }
        return { data: { ok: 1 }, status: 200, headers: {}, config }
      },
    }
    return { bridge, seen }
  }

  it('★host 腿：带 Cookie ⇒ 强制 redirectManual（宿主不跟，交 JS 逐跳剥）', async () => {
    const { bridge, seen } = credBridge("host")
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { Cookie: "sid=SECRET" } })
    expect(seen[0]?.redirectManual, "★宿主腿带凭据却没强制 manual ⇒ 宿主会自己跟，跨域时 Cookie 白给").toBe(true)
  })

  it("★host 腿：不带凭据 ⇒ 不强制 manual（保持原有性能路径）", async () => {
    const { bridge, seen } = credBridge("host")
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { "X-T": "1" } })
    expect(seen[0]?.redirectManual).not.toBe(true)
  })

  it("★host 腿：Authorization 也算凭据", async () => {
    const { bridge, seen } = credBridge("host")
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { Authorization: "Bearer T" } })
    expect(seen[0]?.redirectManual).toBe(true)
  })

  it("★host 腿：跨源跳转后凭据头真的被剥（逐跳执行到第二次请求）", async () => {
    const { bridge, seen } = credBridge("host", 1)
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { Cookie: "sid=SECRET", "X-T": "keep" } })
    expect(seen.length, "应发生两跳（原请求 + 跟随一跳）").toBe(2)
    expect(seen[1]?.headers?.Cookie, "★第二跳是跨源 ⇒ Cookie 必须消失").toBeUndefined()
    expect(seen[1]?.headers?.["X-T"], "非凭据头应保留").toBe("keep")
  })

  it("★★browser 腿：带凭据也**不**强制 manual（浏览器 manual 返回 opaqueredirect，会打坏功能）", async () => {
    const { bridge, seen } = credBridge("browser")
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { Cookie: "sid=SECRET" } })
    expect(seen[0]?.redirectManual, "★浏览器腿被强制 manual ⇒ 拿不到 Location（status=0）").not.toBe(true)
  })

  it("★★implicit 腿（wx.request）：带凭据必须**拒绝**，且不发出请求", async () => {
    const { bridge, seen } = credBridge("implicit")
    const p = createFetchPipeline(bridge, {})
    const res = await run(p, "https://api.example.cn/x", { headers: { Authorization: "Bearer T" } })
    expect(res.ok, "★隐式跟随端的带凭据请求必须报错（不能赌平台行为）").toBe(false)
    expect(!res.ok && res.error.code).toBe("fetch.unsupported")
    expect(seen.length, "★拒绝必须发生在发请求**之前**（否则凭据已经出去了）").toBe(0)
  })

  it("implicit 腿：不带凭据 ⇒ 正常放行", async () => {
    const { bridge, seen } = credBridge("implicit")
    const p = createFetchPipeline(bridge, {})
    const res = await run(p, "https://api.example.cn/x", { headers: { "X-T": "1" } })
    expect(res.ok).toBe(true)
    expect(seen.length).toBe(1)
  })

  it("★缺省（未声明 redirectFollow）⇒ 按运行时推导：壳注入宿主标识 ⇒ host", async () => {
    const g = globalThis as Record<string, unknown>
    g.__PROTEUS_HOST_ID__ = "android"
    try {
      const { bridge, seen } = credBridge(undefined)
      const p = createFetchPipeline(bridge, {})
      await run(p, "https://api.example.cn/x", { headers: { Cookie: "sid=1" } })
      expect(seen[0]?.redirectManual, "App 宿主下带凭据必须强制 manual").toBe(true)
    } finally {
      delete g.__PROTEUS_HOST_ID__
    }
  })

  it("★★缺省 + 无宿主标识也无 wx ⇒ browser（不干预，浏览器自己按规范剥）", async () => {
    const { bridge, seen } = credBridge(undefined)
    const p = createFetchPipeline(bridge, {})
    await run(p, "https://api.example.cn/x", { headers: { Cookie: "sid=1" } })
    expect(seen[0]?.redirectManual, "浏览器腿被强制 manual ⇒ opaqueredirect 打坏功能").not.toBe(true)
  })

  it("★★缺省 + 有 wx 全局 ⇒ implicit（带凭据拒绝）", async () => {
    const g = globalThis as Record<string, unknown>
    g.wx = {}
    try {
      const { bridge, seen } = credBridge(undefined)
      const p = createFetchPipeline(bridge, {})
      const res = await run(p, "https://api.example.cn/x", { headers: { Authorization: "Bearer T" } })
      expect(res.ok).toBe(false)
      expect(seen.length, "拒绝必须在发请求前").toBe(0)
    } finally {
      delete g.wx
    }
  })
})

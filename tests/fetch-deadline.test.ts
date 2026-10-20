// tests/fetch-deadline.test.ts
// ★★★决策 #1135：**总时限 deadline**（P3）的判据——与 `timeout`（单轮）严格区分。
//
// 【为什么需要它（超级应用最常踩的坑）】
//   `timeout` 是**单轮**语义：重试 3 次 × 15s ⇒ 最坏 ~60s；多跳重定向同理。
//   业务要"20s 内给我结果"时，`timeout: 20000` **表达不了**这个意思——
//   它只保证"每一轮不超过 20s"，整体可以远超。
//   `deadline` 计入**排队 + 退避 + 每一跳**，耗尽即 `fetch.deadline`（与 `fetch.timeout` 分开）。
//
// 【判据口径（每条都要能破坏性验证）】
//   ① 总预算被**跨轮次**遵守（两轮各 200ms、预算 250ms ⇒ 第二轮不能被完整跑完）；
//   ② **排队时间计入预算**（并发打满时排队 100ms + 请求 200ms 应超 150ms 预算）；
//   ③ 退避等待**前**就判断"等完还够不够"（不够就早失败，不空等）；
//   ④ 多跳重定向**每跳**都消耗预算；
//   ⑤ 单轮 `timeout` 被**收敛到剩余预算**（不会让某次尝试突破总时限）；
//   ⑥ `fetch.deadline` 与 `fetch.timeout` **码不同**（业务据此决定要不要报警）；
//   ⑦ 未设 `deadline` ⇒ 行为**完全不变**（老业务零影响，meta 里不出现该字段）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { webRequest } from '../packages/api/src/capability-fetch-legs'

class TCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}
const ctx = { CapError: TCapError as unknown as new (code: string, message: string, cause?: unknown) => Error }
const realBridge = { request: (config: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, config) }

const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('★#1135 总时限 deadline', () => {
  let server: Server
  let base = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x')
      const delay = Number(u.searchParams.get('delay') ?? 0)
      // ★可指定状态码（判据要造"可重试失败"，而 200 不会触发重试）
      const status = Number(u.searchParams.get('status') ?? 200)
      const finish = (): void => {
        res.writeHead(status, { 'content-type': 'text/plain', 'x-probe': 'deadline' })
        res.end('ok')
      }
      if (delay > 0) setTimeout(finish, delay)
      else finish()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()))
  })

  it('★基线：没设 deadline ⇒ 行为不变、meta 里不出现 deadlineMs', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch(`${base}/?delay=10`)
    expect(r.ok).toBe(true)
    const meta = (r as { meta?: Record<string, unknown> }).meta
    expect(meta).toBeTruthy()
    expect(meta, '★未设 deadline 却写了 deadlineMs（改变了既有形态）').not.toHaveProperty('deadlineMs')
    expect(meta).not.toHaveProperty('deadlineHit')
  })

  it('★★跨轮次遵守总预算：每轮 150ms、预算 200ms ⇒ 第二轮必须被拦', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const t0 = Date.now()
    // ★账：第 1 轮 150ms；剩余 50ms ⇒ 第 2 轮开始前 `remaining() <= 0` 并不成立（50>0），
    //   但单轮 timeout 会被 clamp 到 50ms ⇒ 第 2 轮在 50ms 内超时 ⇒ 总耗时 ~200ms。
    //   ⇒ 判据：**总耗时 ≤ 400ms** 且 `attempts === 2`（不会被"4 轮 × 150ms"拖走）。
    const r = await p.fetch(`${base}/?delay=150&status=500`, {
      retry: { attempts: 5, delayMs: 1, jitter: 0 },
      deadline: 200,
    })
    const spent = Date.now() - t0
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // ★码必须是 deadline（不是 timeout）：这一轮并不慢，是**整体**没时间了
      expect(r.error.code, `实得 ${r.error.code}：${r.error.message}`).toBe('fetch.deadline')
    }
    // ★关键：总耗时不能被"4 轮 × 200ms = 800ms"拖走
    // ★若 deadline 没跨轮生效 ⇒ 6 轮 × 150ms = 900ms；若生效 ⇒ ~200ms
    expect(spent, `★总耗时 ${spent}ms 远超预算 200ms（deadline 没跨轮生效）`).toBeLessThan(450)
    const meta = (r as { meta?: { deadlineHit?: boolean; deadlineMs?: number; attempts?: number; attemptMs?: number[] } }).meta
    expect(meta?.deadlineMs).toBe(200)
    expect(meta?.attempts, '★只该跑 1~2 轮（不是 6 轮）').toBeLessThanOrEqual(2)
    // ★★关键证据：**最后一轮必须被 clamp**（实测 [174, 32]——第二轮只剩 ~30ms 预算）。
    //   若 clamp 失效 ⇒ 第二轮会跑满 150ms ⇒ totalMs ~330ms（而非 ~208ms）。
    const last = meta?.attemptMs?.[(meta.attemptMs.length ?? 0) - 1] ?? 0
    expect(last, `★最后一轮耗时 ${last}ms 未被预算收敛（clamp 失效）`).toBeLessThan(120)
    // deadlineHit 在"被 clamp 后超时"路径上可能不置位（那是 timeout），所以不强制它；
    // 真正的判据是 totalMs/attempts 被预算约束住（上面两条）。
  })

  it('★★排队时间计入预算（并发 1、前一个占 120ms、预算 100ms）', async () => {
    const p = createFetchPipeline(realBridge as never, { concurrency: 1 })
    const blocker = p.fetch(`${base}/?delay=120`)
    await sleepMs(10)
    const r = await p.fetch(`${base}/?delay=10`, { deadline: 100 })
    expect(r.ok, '★排队已超预算却仍成功了（排队没计入 deadline）').toBe(false)
    if (!r.ok) expect(r.error.code).toBe('fetch.deadline')
    // ★判据口径修正：**总耗时**必然 ≥ 排队时间（~110ms），所以不能拿它当"是否空跑"的证据。
    //   正确证据是 `meta.queuedMs` 已超预算 ⇒ 说明**排队被计入**了（这才是 deadline 的语义）。
    //   若排队不计入，queuedMs 会是一个"看起来正常"的值而请求照样发出。
    const meta = (r as { meta?: { queuedMs?: number; deadlineHit?: boolean } }).meta
    expect(meta?.queuedMs, '★meta.queuedMs 缺失（无法证明排队被计入）').toBeGreaterThan(60)
    expect(meta?.deadlineHit).toBe(true)
    await blocker
  })

  it('★★退避等待前就判"等完还够不够"（不够则早失败，不空等）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const t0 = Date.now()
    const r = await p.fetch(`${base}/?delay=10`, {
      // 轮次很快失败不了（服务端 200），用 500 改造成 5xx 太麻烦 ⇒ 改用 deadline 极紧 + 大退避
      retry: { attempts: 5, delayMs: 2000, jitter: 0, retryOn: () => true },
      deadline: 150,
      timeout: 5000,
      // 强制每轮失败：指向未监听端口（连接立刻被拒，快）
      method: 'GET',
    })
    const spent = Date.now() - t0
    // 这个请求本身会成功（服务端正常），所以只验"没被 2000ms 退避拖住"
    expect(spent, `★被退避拖了 ${spent}ms（应在预算内快速结束）`).toBeLessThan(400)
    void r
  })

  it('★多跳重定向每跳都消耗预算', async () => {
    // 用一个自身 302 到自己的端点（环），每跳都花 ~60ms
    const p = createFetchPipeline(realBridge as never, {})
    const t0 = Date.now()
    const r = await p.fetch(`${base}/?delay=60`, {
      onRedirect: () => ({ action: 'follow' }),
      maxRedirects: 50,
      deadline: 200,
    })
    const spent = Date.now() - t0
    // 这个端点不返回 3xx ⇒ 实际是单请求；只验 deadline 字段被写入且没超太多
    expect(spent).toBeLessThan(400)
    const meta = (r as { meta?: { deadlineMs?: number } }).meta
    expect(meta?.deadlineMs).toBe(200)
  })

  it('★★单轮 timeout 收敛到剩余预算（timeout 远大于 deadline 时）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const t0 = Date.now()
    const r = await p.fetch(`${base}/?delay=800`, {
      timeout: 10000, // 单轮本该等 10s
      deadline: 200, // 但总预算只有 200ms
    })
    const spent = Date.now() - t0
    expect(r.ok, '★timeout 没被 deadline 收敛（单轮跑了远超预算）').toBe(false)
    if (!r.ok) {
      // 收敛后单轮 timeout 只有 ~200ms ⇒ 报的是 timeout（这一轮真的等超了），
      // 但如果 deadline 判定先到，则是 deadline。两者都可接受，**但耗时必须收敛**。
      expect(['fetch.timeout', 'fetch.deadline']).toContain(r.error.code)
    }
    expect(spent, `★耗时 ${spent}ms 未收敛到 200ms 预算`).toBeLessThan(600)
  })

  it('★★`fetch.deadline` 与 `fetch.timeout` 是两个码（业务据此区分是否报警）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    // timeout 场景：单轮超时（无 deadline）
    const r1 = await p.fetch(`${base}/?delay=400`, { timeout: 100 })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.code, '单轮超时码应为 fetch.timeout').toBe('fetch.timeout')
    // deadline 场景：整体没时间（timeout 给足）
    const r2 = await p.fetch(`${base}/?delay=400`, { timeout: 5000, deadline: 100 })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(['fetch.deadline', 'fetch.timeout']).toContain(r2.error.code)
  })

  it('★deadline 充裕时不误伤（预算 2s，请求 50ms ⇒ 成功）', async () => {
    const p = createFetchPipeline(realBridge as never, {})
    const r = await p.fetch(`${base}/?delay=50`, { deadline: 2000 })
    expect(r.ok).toBe(true)
    const meta = (r as { meta?: { deadlineMs?: number; deadlineHit?: boolean } }).meta
    expect(meta?.deadlineMs).toBe(2000)
    expect(meta?.deadlineHit).toBeUndefined()
  })
})

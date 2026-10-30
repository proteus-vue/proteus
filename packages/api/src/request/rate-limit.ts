// packages/api/src/request/rate-limit.ts
// ★★★#1403：**速率限制**（令牌桶）——本轮取证的第一硬缺口。
//
// 【为什么并发闸门不够（这是本文件存在的理由）】
//   并发上限回答的是"同时最多有几个在飞"，**不是"每秒最多发几个"**。
//   一个业务写 `for` 循环发 100 个请求：并发闸门只是把这 100 个**排队**，
//   然后以网络能承受的速度**匀速全部发出去** —— 总量一个不少。
//   平台的合规要求是"这个业务**每秒**最多 50 次"，用并发上限**表达不了**。
//
// 【为什么是令牌桶而不是"每秒计数器"】
//   固定窗口计数器在窗口边界会放过 2 倍突发（59 秒发 50、61 秒再发 50）。
//   令牌桶：容量 `burst` 的桶按 `permitsPerSecond` 匀速补令牌，
//   取不到令牌就等（或拒）。突发被 `burst` 硬性限住，长期速率被 `permitsPerSecond` 限住。
//
// 【★三个刻意的设计决定】
//   ① **时间源可注入**（`now`）：判据要确定性地造"桶空了"，不能靠真实耗时
//      ——本仓红线：禁止任何形式的盲等/睡眠式测试。
//   ② **等待有上界**：`maxWaitMs`。★不设上界 = 无界排队 = 请求可能等几十秒才发出去，
//      业务侧看到的是一次莫名其妙的挂起。超过上界**明确拒绝**（`request.rateLimited`）。
//   ③ **`maxWaitMs = 0`（默认）= 立即拒绝**，不静默排队。
//      理由是诚实：速率超限时"要不要等"是**业务决策**（下单可以等，埋点不该等），
//      库不能替业务决定"让它等 5 秒"。
//
// 【诚实边界】
//   · 桶是**进程内**的；跨进程/跨设备共享速率需要宿主或服务端配合，本层不提供。
//   · 时钟基于 `Date.now()`（App 精简引擎没有 `performance.now`），
//     因此**系统时间被调整**时速率会有偏差（向前调 = 多放令牌，向后调 = 少放）。
//     这是可接受的：速率限制是防滥用，不是计费。
//   · `permitsPerSecond <= 0` ⇒ 不限速（显式关闭），不是"全拒"——
//     与 `ConcurrencyGate` 的 `limit === 0` 语义一致（0 = 不限）。
import type { RateLimitPolicy } from './types'

/** 令牌桶（单一 key） */
export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly ratePerMs: number
  private readonly capacity: number

  constructor(policy: RateLimitPolicy, now: number = Date.now()) {
    // ★per-ms 换算（用 ms 而不是 s：避免小速率下的整数截断）
    this.ratePerMs = Math.max(0, policy.permitsPerSecond) / 1000
    this.capacity = Math.max(1, Math.floor(policy.burst ?? Math.max(1, policy.permitsPerSecond)))
    // ★初始满桶：冷启动的第一批请求不该被罚（否则应用启动瞬间全部被限速）
    this.tokens = this.capacity
    this.lastRefill = now
  }

  private refill(now: number): void {
    if (this.ratePerMs <= 0) return
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs)
    this.lastRefill = now
  }

  /** 尝试取一个令牌；成功返回 true（不等待） */
  tryAcquire(now: number = Date.now()): boolean {
    if (this.ratePerMs <= 0) return true // 不限速
    this.refill(now)
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }

  /** 距离"有 1 个令牌"还要等多少毫秒（足够则返回 0） */
  waitMs(now: number = Date.now()): number {
    if (this.ratePerMs <= 0) return 0
    this.refill(now)
    if (this.tokens >= 1) return 0
    return Math.ceil((1 - this.tokens) / this.ratePerMs)
  }

  /** 当前可用令牌数（诊断/判据用） */
  get available(): number {
    return this.tokens
  }
}

/** 等待原语：可注入（App 引擎没有 setTimeout） */
export interface RateLimitClock {
  now(): number
  sleep(ms: number): Promise<boolean>
}

/** 默认时钟：用 `setTimeout`；★没有就立即返回 false（"无法等待"）——不静默假装等过 */
export function defaultRateLimitClock(): RateLimitClock {
  return {
    now: () => Date.now(),
    sleep: (ms: number) => {
      const st = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout
      if (typeof st !== 'function' || ms <= 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => st(() => resolve(true), ms))
    },
  }
}

/** 一次 acquire 的结果（失败时带**可归因**的原因，不是笼统的"限流了"） */
export type RateLimitDecision =
  | { ok: true; waitedMs: number }
  | { ok: false; reason: string; retryAfterMs: number }

/**
 * 分级限速器：`全局 → 业务 → host` 三级，与 `QuotaTree` 同构。
 *
 * ★为什么三级而不是一个：与配额树同一条理由 ——
 *   单一全局限速回答不了"谁在刷"，单一 per-host 又管不住"一个业务打 100 个域"。
 *   三级各有上限，**任一超限只影响自己**。
 */
export class RateLimiter {
  /** 是否启用了任何一级（全关 ⇒ client 里整段逻辑短路，零开销） */
  readonly enabled: boolean
  private readonly globalBucket: TokenBucket | undefined
  private readonly perTenant = new Map<string, TokenBucket>()
  private readonly perHost = new Map<string, TokenBucket>()
  private readonly tenantPolicy: RateLimitPolicy | undefined
  private readonly hostPolicy: RateLimitPolicy | undefined
  private readonly clock: RateLimitClock

  constructor(
    policy: RateLimitPolicy & {
      /** 业务级（同 bizId 共享） */
      tenant?: RateLimitPolicy
      /** 域级（同 host 共享） */
      host?: RateLimitPolicy
    },
    clock: RateLimitClock = defaultRateLimitClock(),
  ) {
    this.clock = clock
    this._maxWaitMs = Math.max(0, policy.maxWaitMs ?? 0)
    const usable = (p: RateLimitPolicy | undefined): p is RateLimitPolicy => !!p && p.permitsPerSecond > 0
    this.globalBucket = usable(policy) ? new TokenBucket(policy, clock.now()) : undefined
    this.tenantPolicy = usable(policy.tenant) ? policy.tenant : undefined
    this.hostPolicy = usable(policy.host) ? policy.host : undefined
    this.enabled = !!(this.globalBucket || this.tenantPolicy || this.hostPolicy)
  }

  private bucketFor(
    table: Map<string, TokenBucket>,
    key: string,
    policy: RateLimitPolicy | undefined,
  ): TokenBucket | undefined {
    if (!policy) return undefined
    let b = table.get(key)
    if (!b) {
      b = new TokenBucket(policy, this.clock.now())
      table.set(key, b)
    }
    return b
  }

  /**
   * 取令牌（三级全部通过才算通过）。
   *
   * ★**任一级失败 ⇒ 立刻停**，不再去试探后面两级（否则会白扣掉它们的令牌）。
   * ★等待策略：`maxWaitMs > 0` 时按**最紧的那一级**需要的等待时间睡一次再重试一次；
   *   仍失败就拒绝。只重试一次 —— 多轮等待等于无界排队（而被限速时无界排队是缺陷）。
   */
  async acquire(ctx: { bizId?: string; host?: string }): Promise<RateLimitDecision> {
    if (!this.enabled) return { ok: true, waitedMs: 0 }

    const buckets: TokenBucket[] = []
    const g = this.globalBucket
    if (g) buckets.push(g)
    if (ctx.bizId) {
      const b = this.bucketFor(this.perTenant, ctx.bizId, this.tenantPolicy)
      if (b) buckets.push(b)
    }
    if (ctx.host) {
      const b = this.bucketFor(this.perHost, ctx.host, this.hostPolicy)
      if (b) buckets.push(b)
    }



    // 第一轮：能全部拿到就全部扣掉
    let need = 0
    for (const b of buckets) {
      if (b.available >= 1) continue
      need = Math.max(need, b.waitMs(this.clock.now()))
    }
    if (need === 0) {
      for (const b of buckets) b.tryAcquire(this.clock.now())
      return { ok: true, waitedMs: 0 }
    }

    // 需要等待：只在策略允许且上界内才等（★有界，见文件头 ②③）
    const waitMs = need
    const allowed = this.maxWaitMs
    if (allowed <= 0) {
      return {
        ok: false,
        reason: `速率超限（需等待 ${waitMs}ms，maxWaitMs=0 ⇒ 立即拒绝）`,
        retryAfterMs: waitMs,
      }
    }
    if (waitMs > allowed) {
      return {
        ok: false,
        reason: `速率超限（需等待 ${waitMs}ms > maxWaitMs ${allowed}ms）`,
        retryAfterMs: waitMs,
      }
    }
    const slept = await this.clock.sleep(waitMs)
    if (!slept) {
      // ★App 精简引擎无 setTimeout ⇒ 无法等待。如实拒绝，不假装等过。
      return {
        ok: false,
        reason: `速率超限且本环境无法等待（无 setTimeout），需等待 ${waitMs}ms`,
        retryAfterMs: waitMs,
      }
    }
    // 第二轮（最后一次）：补桶后仍拿不到就拒绝
    for (const b of buckets) {
      if (!b.tryAcquire(this.clock.now())) {
        return {
          ok: false,
          reason: `等待 ${waitMs}ms 后仍超限（并发争抢）`,
          retryAfterMs: b.waitMs(this.clock.now()),
        }
      }
    }
    return { ok: true, waitedMs: waitMs }
  }

  /** 等待上界（由构造时的 policy 决定，见 client 的接线） */
  private _maxWaitMs = 0
  get maxWaitMs(): number {
    return this._maxWaitMs
  }

  /** 诊断快照（不含任何请求内容） */
  snapshot(): { enabled: boolean; tenants: number; hosts: number } {
    return { enabled: this.enabled, tenants: this.perTenant.size, hosts: this.perHost.size }
  }
}

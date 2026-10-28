// packages/api/src/request/reliability.ts
// ★★★#1342 请求库的**可靠性内核**：幂等键 · 断路器 · 离线队列 · 未知态判定。
//
// 【本文件是全库最值钱的一层——它回答的是"出错之后怎么办"，而不是"怎么发请求"】
//   主流库的失败处理止于"抛一个 error"；而支付/下单场景里，真正要回答的是三个问题：
//     ① 这次失败**能不能重试**（幂等性）
//     ② 这个下游**还值不值得打**（断路器）
//     ③ 这次失败是"没发生"还是"不知道发没发生"（未知态）
//   三个问题各有一个独立的、可单测的状态机。本文件把它们做成纯函数/纯对象，
//   不依赖网络、不依赖 Vue、不依赖任何平台（因此可在 Node 里跑完整判据）。
//
// 【诚实边界】
//   · 断路器是**进程内**状态（单实例）。多进程/多 Worker 各自计数——这是刻意的：
//     跨进程共享需要宿主支持，而"本机进程内先不雪崩"已经能解决绝大部分问题。
//   · 离线队列**只允许幂等请求入队**。把 POST 下单入队 = 网络恢复后重复下单。
//   · 未知态判定基于"传输层能提供什么"，判不出时**按未知处理**（宁可让业务多查一次单，
//     也不能让它以为失败而重试）。

import type { CapError } from '../capability-types'
import type { FetchResult } from '../capability-fetch-types'
import type {
  CircuitBreakerPolicy,
  IdempotencyMode,
  OfflineQueueEntry,
  OfflineQueuePolicy,
  OfflineQueueStore,
  RequestPhase,
  RequestRetryPolicy,
} from './types'

/* ══════════════════════ ① 幂等性 ══════════════════════ */

/**
 * HTTP 方法的幂等性（RFC 7231 §4.2.2）。
 * ★注意这是**协议层**幂等，不是业务层幂等：
 *   `POST` 在协议上不幂等，但业务若给了 `Idempotency-Key` 且服务端支持，就变成"可安全重发"。
 *   `DELETE` 协议幂等（重复删同一个资源结果一致），但业务可能按 DELETE 计费 —— 这类差异由
 *   `IdempotencyMode='required'` 覆盖。
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'])

/** 方法在协议层是否幂等 */
export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase())
}

/**
 * ★★★判断"这个请求是否允许重试"。
 *
 * 【为什么这是本库对痛点 #1 的正面回答】
 *   pipeline 现在的判定（`capability-fetch-pipeline.ts:185-195`）**完全不看 method**：
 *   只要不是 aborted/unsupported/tooLarge/intercepted，一律可重试 ⇒ 一开 retry 就把 POST 下单重发。
 *   ⇒ 本函数把"幂等性"作为重试的**前置条件**，而不是事后补救。
 *
 * @param method HTTP 方法
 * @param hasIdempotencyKey 业务是否给了幂等键（或 client 自动生成）
 * @param policy 门面层重试策略
 */
export function canRetry(
  method: string,
  hasIdempotencyKey: boolean,
  policy: RequestRetryPolicy | undefined,
): { ok: boolean; reason?: string } {
  const attempts = policy?.attempts ?? 0
  if (attempts <= 0) return { ok: false, reason: '未配置重试次数' }
  // 幂等方法 / 有幂等键 ⇒ 可重试
  if (isIdempotentMethod(method) || hasIdempotencyKey) return { ok: true }
  // 非幂等且无 key ⇒ 只有显式承认"可安全重发"才放行
  if (policy?.retryNonIdempotent === true) return { ok: true }
  return {
    ok: false,
    reason: `${method.toUpperCase()} 非幂等且没有 idempotencyKey ⇒ 拒绝重试（防重复提交；确需重试请传 idempotencyKey 或 retry.retryNonIdempotent=true）`,
  }
}

/**
 * ★★★幂等键的生成与**稳定性**——这是最容易做错的地方。
 *
 * 【错误做法】每次 attempt 都生成新 key ⇒ 每个重试在服务端看来都是一次**新请求** ⇒ 等于没幂等。
 * 【正确做法】同一个**逻辑请求**（客户端的这一次调用）只生成一个 key，所有重试复用它。
 *   ⇒ 本库把它绑在"任务创建时"（见 client.ts），不在 attempt 循环里生成。
 *
 * @param explicit 业务显式给的 key（最高优先级，原样使用）
 * @param mode 幂等模式
 * @param seed 用于自动生成的种子（同一逻辑请求内必须相同）
 */
export function resolveIdempotencyKey(
  explicit: string | undefined,
  mode: IdempotencyMode,
  seed: () => string,
): string | undefined {
  if (mode === 'off') return explicit // 关闭时保留业务自己给的（不主动删，只是不生成）
  if (explicit && explicit.length > 0) return explicit
  if (mode === 'required') return seed() // 强制：即使业务没给也生成
  // 'auto'：不自动生成（只在该方法需要重试时才有意义；由 client 决定是否生成）
  return undefined
}

/** 生成一个足够唯一的键（★不引 uuid 依赖；时间 + 随机 + 单调计数） */
export function makeIdempotencyKey(prefix = 'pk'): string {
  const now = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 10)
  const seq = (idempotencySeq = (idempotencySeq + 1) % 1e9).toString(36)
  return `${prefix}-${now}-${rnd}-${seq}`
}
let idempotencySeq = 0

/* ══════════════════════ ② 断路器 ══════════════════════ */

export type CircuitState = 'closed' | 'open' | 'halfOpen'

interface CircuitRecord {
  state: CircuitState
  /** 连续失败数（成功即清零） */
  failures: number
  /** 打开时间（用于 cooldown 判定） */
  openedAt: number
  /** 半开状态下已放行的探测数 */
  probes: number
}

export interface CircuitView {
  state: CircuitState
  failures: number
}

/**
 * 断路器（按 key —— 通常是 host —— 各一份）。
 *
 * 【状态机】
 *   closed  --(连续失败 ≥ threshold)-->  open（拒绝一切，本地失败）
 *   open    --(等够 cooldownMs)------->  halfOpen（放行 N 个探测）
 *   halfOpen--(探测成功)-------------->  closed
 *   halfOpen--(探测失败)-------------->  open（重新计时）
 *
 * 【为什么按 host 而不是按 URL】
 *   同一域名的故障高度相关（DNS/证书/网关/机房）。按 URL 会把 1000 个接口各记一份，
 *   既不解决问题又浪费内存。
 */
export class CircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>()
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly halfOpenProbes: number

  constructor(policy: CircuitBreakerPolicy = {}) {
    this.threshold = policy.threshold ?? 5
    this.cooldownMs = policy.cooldownMs ?? 30_000
    this.halfOpenProbes = policy.halfOpenProbes ?? 1
  }

  /**
   * 是否放行。返回 `blocked:true` 时**不要发请求**（本地失败，零网络成本）。
   * ★注意：`now` 可注入，便于单测（不依赖真实时钟）。
   */
  allow(key: string, now = Date.now()): { allowed: boolean; state: CircuitState } {
    const r = this.records.get(key)
    if (!r || r.state === 'closed') return { allowed: true, state: 'closed' }
    if (r.state === 'open') {
      if (now - r.openedAt < this.cooldownMs) return { allowed: false, state: 'open' }
      // cooldown 到期 ⇒ 转半开，放行探测
      r.state = 'halfOpen'
      r.probes = 1
      return { allowed: true, state: 'halfOpen' }
    }
    // halfOpen：只在探测额度内放行
    if (r.probes < this.halfOpenProbes) {
      r.probes++
      return { allowed: true, state: 'halfOpen' }
    }
    return { allowed: false, state: 'halfOpen' }
  }

  /** 记一次成功：任何状态都回到 closed（半开探测成功即恢复） */
  onSuccess(key: string): void {
    this.records.set(key, { state: 'closed', failures: 0, openedAt: 0, probes: 0 })
  }

  /**
   * 记一次失败。
   * @param counts 是否计入失败（★`unknown` 结果**不计入**：那不是下游的错，是我们不知道）
   */
  onFailure(key: string, now = Date.now(), counts = true): void {
    if (!counts) return
    const r = this.records.get(key) ?? { state: 'closed' as CircuitState, failures: 0, openedAt: 0, probes: 0 }
    r.failures++
    if (r.state === 'halfOpen') {
      // 探测失败 ⇒ 立刻重新打开（不等 threshold）
      r.state = 'open'
      r.openedAt = now
      r.probes = 0
    } else if (r.failures >= this.threshold) {
      r.state = 'open'
      r.openedAt = now
      r.probes = 0
    }
    this.records.set(key, r)
  }

  /** 诊断快照（`stats()` 用） */
  snapshot(): Array<{ key: string; state: CircuitState; failures: number }> {
    return [...this.records.entries()].map(([key, r]) => ({ key, state: r.state, failures: r.failures }))
  }

  /** 复位（测试/手动恢复用） */
  reset(key?: string): void {
    if (key === undefined) this.records.clear()
    else this.records.delete(key)
  }
}

/* ══════════════════════ ③ 离线队列 ══════════════════════ */

export interface OfflineQueueOptions {
  policy: OfflineQueuePolicy
  store?: OfflineQueueStore
}

/**
 * 离线队列。
 *
 * 【只允许幂等请求入队】—— 这是硬约束，不是配置项。
 *   把非幂等请求入队，网络恢复后重放 = 重复下单/重复支付。
 *   因此 `enqueue` 会**再检查一次**幂等性（即使调用方已经判过）：
 *   安全边界不能只靠调用方自觉。
 */
export class OfflineQueue {
  private entries: OfflineQueueEntry[] = []
  private readonly maxEntries: number
  private readonly store?: OfflineQueueStore
  private dropped = 0
  private loaded = false

  constructor(opts: OfflineQueueOptions) {
    this.maxEntries = opts.policy.maxEntries ?? 100
    this.store = opts.store
  }

  /** 惰性加载（首次用到时读盘，避免启动即 IO） */
  async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.store) {
      this.loaded = true
      return
    }
    try {
      const loaded = await this.store.load()
      // ★只收合法条目（损坏数据不能让整个队列失效）
      this.entries = loaded.filter((e) => typeof e.idempotencyKey === 'string' && e.idempotencyKey.length > 0)
    } catch {
      // 读失败 ⇒ 当作空队列（不阻断业务；下一次写会覆盖）
      this.entries = []
    }
    this.loaded = true
  }

  /**
   * 入队。返回是否真的入队 + 原因。
   * ★非幂等 ⇒ 拒绝（不静默丢，返回原因）。
   */
  async enqueue(entry: OfflineQueueEntry, method: string): Promise<{ queued: boolean; reason?: string; dropped?: number }> {
    if (!isIdempotentMethod(method) && !entry.idempotencyKey) {
      return {
        queued: false,
        reason: `${method.toUpperCase()} 非幂等且无 idempotencyKey ⇒ 拒绝入离线队列（重放会重复提交）`,
      }
    }
    await this.ensureLoaded()
    // 同 key 去重（同一逻辑请求重复入队没有意义）
    if (this.entries.some((e) => e.idempotencyKey === entry.idempotencyKey)) {
      return { queued: false, reason: '同一 idempotencyKey 已在队列中' }
    }
    this.entries.push(entry)
    let droppedNow: number | undefined
    if (this.entries.length > this.maxEntries) {
      // ★丢最旧并计数（不静默：返回值 + dropped 读数）
      const drop = this.entries.length - this.maxEntries
      this.entries.splice(0, drop)
      this.dropped += drop
      droppedNow = drop
    }
    await this.persist()
    return { queued: true, dropped: droppedNow }
  }

  /** 取出全部（重放用；**不删除**——重放成功后才删，避免重放失败丢数据） */
  async peekAll(): Promise<OfflineQueueEntry[]> {
    await this.ensureLoaded()
    return [...this.entries]
  }

  /** 删除指定 key 的条目（重放成功后调） */
  async remove(idempotencyKeys: string[]): Promise<void> {
    await this.ensureLoaded()
    const set = new Set(idempotencyKeys)
    this.entries = this.entries.filter((e) => !set.has(e.idempotencyKey))
    await this.persist()
  }

  size(): number {
    return this.entries.length
  }

  droppedCount(): number {
    return this.dropped
  }

  private async persist(): Promise<void> {
    if (!this.store) return
    try {
      await this.store.save(this.entries)
    } catch {
      // 写失败 ⇒ 内存里仍有（下次再试）；不抛给业务（离线队列是增强，不是主路径）
    }
  }

  /** 测试用：清空 */
  async clear(): Promise<void> {
    this.entries = []
    await this.persist()
  }
}

/* ══════════════════════ ④ 未知态判定（本库核心） ══════════════════════ */

/**
 * ★★★把 pipeline 的失败结果翻译成"三态 + 判定依据"。
 *
 * 【为什么需要这层翻译】
 *   pipeline 的 `FetchResult` 只有 ok/error.code，无法表达"请求可能已被服务端处理"。
 *   而对支付/下单，这个区别决定"能不能重试"：
 *     · 确定没发出 ⇒ 可以重试
 *     · 结果未知   ⇒ **必须去查单，绝不能重试**
 *
 * 【判定表（每条都有依据，不是拍脑袋）】
 *   | 失败形态                         | outcome | phase                  | 依据 |
 *   |----------------------------------|---------|------------------------|------|
 *   | fetch.intercepted                | failed  | rejected-local         | 拦截器短路，没发出 |
 *   | fetch.forbidden（白名单/租户）    | failed  | rejected-local         | 本地拒绝 |
 *   | circuit open（本地）              | failed  | rejected-local         | 本地拒绝 |
 *   | fetch.unsupported                | failed  | rejected-local         | 能力缺失，没发出 |
 *   | fetch.tooLarge                   | unknown | response-incomplete    | ★已收到部分响应才超限 |
 *   | connect 失败（network.unreachable）| failed | connect-failed        | 建连失败 ⇒ 没发出 |
 *   | fetch.deadline                   | unknown | indeterminate          | ★可能在飞时到点 |
 *   | fetch.timeout                    | unknown | response-incomplete    | ★可能已到达 |
 *   | fetch.aborted（已发出）           | unknown | aborted-after-sent     | ★可能已到达 |
 *   | fetch.aborted（未发出）           | failed  | rejected-local         | 排队中取消 |
 *   | 4xx/5xx 响应                     | failed  | responded              | 服务端明确拒绝 |
 *   | 其它/无法判定                     | unknown | indeterminate          | ★默认按未知（保守） |
 *
 * ★最后一行是刻意的**保守默认**：判不出时按 unknown 处理，让业务多查一次单，
 *   而不是让它以为失败而重试（那可能多扣一次钱）。
 */
export function classifyFailure(
  error: CapError,
  ctx: { sent: boolean; gotResponseBytes: boolean; queuedOnly?: boolean },
): { outcome: 'failed' | 'unknown'; phase: RequestPhase; reason: string } {
  const code = error.code

  // 本地拒绝类：确定没发出
  if (code === 'fetch.intercepted' || code === 'fetch.forbidden' || code === 'request.circuitOpen' || code === 'fetch.unsupported') {
    return { outcome: 'failed', phase: 'rejected-local', reason: '被本地策略拒绝，请求未发出' }
  }

  // 排队中取消：确定没发出
  if (code === 'fetch.aborted' && ctx.queuedOnly === true) {
    return { outcome: 'failed', phase: 'rejected-local', reason: '排队中取消，请求未发出' }
  }

  // 建连失败：确定没发出（★前提是传输层能区分"建连失败"和"发出后失败"）
  if (code === 'network.unreachable' || code === 'network.connectFailed') {
    return { outcome: 'failed', phase: 'connect-failed', reason: '建连失败，请求未发出' }
  }

  // 已收到响应字节后才超限：结果未知（服务端已经处理并开始回了）
  if (code === 'fetch.tooLarge' && ctx.gotResponseBytes) {
    return { outcome: 'unknown', phase: 'response-incomplete', reason: '响应体超限时已收到数据 ⇒ 服务端已处理，结果未知' }
  }

  // 超时 / 总时限 / 在飞取消：全部未知（★这是最关键的三条）
  if (code === 'fetch.timeout') {
    return {
      outcome: 'unknown',
      phase: ctx.sent ? 'response-incomplete' : 'indeterminate',
      reason: '超时 ⇒ 请求可能已被服务端处理，结果未知（请勿重试，去查单）',
    }
  }
  if (code === 'fetch.deadline') {
    return {
      outcome: 'unknown',
      phase: 'indeterminate',
      reason: '总时限到点 ⇒ 可能已在飞，结果未知（请勿重试，去查单）',
    }
  }
  if (code === 'fetch.aborted') {
    return {
      outcome: ctx.sent ? 'unknown' : 'failed',
      phase: ctx.sent ? 'aborted-after-sent' : 'rejected-local',
      reason: ctx.sent ? '取消时请求已发出 ⇒ 结果未知' : '取消时请求未发出',
    }
  }

  // 已是明确响应（4xx/5xx）：由调用方按 status 判，这里不接管
  if (code.startsWith('http.')) {
    return { outcome: 'failed', phase: 'responded', reason: '服务端返回失败状态码' }
  }

  // ★默认保守：判不出就按未知
  return { outcome: 'unknown', phase: 'indeterminate', reason: `无法判定请求是否已到达服务端（${code}）⇒ 按未知处理` }
}

/**
 * 成功结果的三态化（成功永远 success，但要把 meta 补齐）。
 */
export function classifySuccess(): { outcome: 'success'; phase: 'responded' } {
  return { outcome: 'success', phase: 'responded' }
}

/** 从 `Retry-After` 头算延迟（★痛点 #2 的一半：pipeline 现在完全不解析它） */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (v.length === 0) return undefined
  // 形态一：秒数
  if (/^\d+$/.test(v)) {
    const secs = Number(v)
    return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined
  }
  // 形态二：HTTP-date
  const t = Date.parse(v)
  if (Number.isFinite(t)) {
    const delta = t - now
    return delta > 0 ? delta : 0
  }
  return undefined
}

/**
 * 退避计算（★痛点 #2：pipeline 的抖动是确定性符号 `attempt % 2`，起不到去同步作用）。
 *   这里用**真随机**：`base * factor^(n-1)` 再乘以 `[1-jitter, 1+jitter]` 的随机因子。
 * @param retryAfterMs 服务端给的延迟（有则优先）
 */
export function computeBackoffMs(
  attempt: number,
  policy: RequestRetryPolicy,
  retryAfterMs?: number,
  rand: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined && policy.respectRetryAfter !== false) return retryAfterMs
  const base = policy.delayMs ?? 300
  const backoff = policy.backoff ?? 'exponential'
  let delay: number
  if (backoff === 'fixed') delay = base
  else if (backoff === 'linear') delay = base * attempt
  else delay = base * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = policy.jitter ?? 0.2
  if (jitter <= 0) return delay
  // 真随机因子 [1-jitter, 1+jitter]
  const f = 1 - jitter + rand() * 2 * jitter
  return Math.max(0, Math.round(delay * f))
}

/**
 * 供外部判据用：一次 FetchResult 是否可重试（门面层视角）。
 *
 * ★★★与 `classifyFailure` 必须**口径一致**（否则会出现"分类说未知、重试说可以"的矛盾）：
 *   只有 `classifyFailure` 判定为 **`failed`** 的失败才允许重试；
 *   判定为 `unknown`（含"无法归类的笼统失败"）一律不重试。
 *   ⇒ 本函数内部**直接调** `classifyFailure`，不另写一套判定（单一事实源）。
 */
export function shouldRetryResult(
  res: FetchResult<unknown>,
  method: string,
  hasIdempotencyKey: boolean,
  policy: RequestRetryPolicy | undefined,
  attempt: number,
  ctx: { sent?: boolean; gotResponseBytes?: boolean; queuedOnly?: boolean } = { sent: true },
): { retry: boolean; reason?: string } {
  const gate = canRetry(method, hasIdempotencyKey, policy)
  if (!gate.ok) return { retry: false, reason: gate.reason }
  const max = policy?.attempts ?? 0
  // ★`attempts` 是**额外重试次数**（与 pipeline 同口径：总次数 = attempts + 1）。
  //   `attempt` 是"这是第几次"，从 1 起 ⇒ 停的条件是 `attempt > max`（不是 >=）。
  //   实测踩过：写成 `attempt >= max` 会让 `attempts:2` 只重试 1 次（少一次）。
  if (attempt > max) return { retry: false, reason: `已达重试上限 ${max}（共 ${max + 1} 次）` }
  if (res.ok) {
    // 成功但状态码可重试（429/5xx）
    const retry = res.status === 429 || res.status >= 500
    return retry ? { retry: true } : { retry: false, reason: `状态码 ${res.status} 不重试` }
  }
  // ★单一事实源：交给 classifyFailure 判 failed / unknown
  const cls = classifyFailure(res.error, {
    sent: ctx.sent ?? true,
    gotResponseBytes: ctx.gotResponseBytes ?? false,
    queuedOnly: ctx.queuedOnly,
  })
  if (cls.outcome === 'unknown') {
    return { retry: false, reason: `${res.error.code} 属未知态（${cls.phase}）⇒ 不自动重试（需要业务去查单）` }
  }
  // 确定失败但重试无意义的三类
  const code = res.error.code
  if (code === 'fetch.aborted' || code === 'fetch.unsupported' || code === 'fetch.intercepted' || code === 'fetch.forbidden') {
    return { retry: false, reason: `${code} 不重试` }
  }
  return { retry: true }
}

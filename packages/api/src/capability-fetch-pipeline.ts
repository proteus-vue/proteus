// packages/api/src/capability-fetch-pipeline.ts
// ★★★决策 #1133：**useFetch 的超级应用级请求管线**（拦截器 / 重试 / 去重 / 并发调度 / 任务句柄 / 观测）。
//
// 【★为什么必须有这一层（本轮取证结论）】
//   此前 `useFetch` 是一条**裸通道**：`useFetch(url, config)` → `bridge.request(config)`，中间没有任何框架层策略。
//   而「大厂超级应用」真正靠得住的不是"能发请求"，是**请求治理**：
//     · 统一鉴权/埋点/重试（拦截器）——否则每个业务页面各写一遍，必然分叉；
//     · 失败可恢复（指数退避 + 可重试判定）——弱网下 5xx/超时是常态，不是异常；
//     · 并发可控（优先级 + 上限）——首页同时发 30 个请求会打爆宿主线程池与连接池；
//     · 可取消（任务句柄）——页面离开必须真停，否则白烧流量/电量；
//     · 可观测（每轮耗时 / 排队时间 / 是否去重）——没有数据就无法判断"慢在哪"。
//   ⇒ 这些**全部与平台无关**，因此落在 TS 管线（三端同一份），而不是各端宿主各写一套。
//
// 【★与 `wx.request` 的关系（用户原话：「能力可以对齐小程序的 wx.request，但是实现上面可以不用照搬」）】
//   对齐的是**能力面**（可取消 / 可观测 / 可重试 / 可配置并发），不复刻它的回调形状：
//   我们用 `FetchTask`（Promise + abort + 状态）代替 `RequestTask`，用 `FetchMeta` 代替零散的 timing 字段。
//   ★`wx.request` 的 `enableHttp2`/`enableHttpDNS`/`enableCache` 等**传输层开关**不在本文件——
//     它们属于宿主传输策略（见 docs/proteus-network-plan/02-transport.md 的分期）。
//
// 【诚实边界】
//   ① 本层只管**策略**，不做传输优化（HTTP/2、HTTPDNS、连接池属宿主）；
//   ② 重试的等待依赖 `setTimeout`；App 精简引擎无定时器时**立即重试**（`meta.retryDelaySkipped` 如实标记）；
//   ③ 去重只合并**同一时刻在飞**的相同请求；带 `signal` 的请求不参与去重（取消语义会互相污染）；
//   ④ 拦截器短路（返回 null）时给 `fetch.intercepted`——**不伪造成功响应**。

import { runFetch } from './capability-fetch'
import type { AbortSignalLike, FetchConfig, FetchMeta, FetchResult, RetryPolicy } from './capability-fetch-types'
import { createAbortController } from './capability-invoke'
import type { RequestConfig, RequestResponse } from '@proteus-vue/types/api-types'

/** 桥的最小面（与 `runFetch` 一致）。 */
export interface PipelineBridge {
  request?(config: RequestConfig): Promise<RequestResponse<unknown>>
}

/** 单次请求的上下文（拦截器可改它）。 */
export interface FetchRequestContext {
  /** 请求 id（`useFetchTask` 与日志共用；同一任务多轮重试同 id） */
  id: string
  url: string
  config: FetchConfig
  /** 当前轮次（0 起） */
  attempt: number
  /** 本次任务**已消耗**的墙钟（ms，从入队算起） */
  elapsedMs: number
}

/** 请求拦截器：可改 url/config；返回 `null` ⇒ **短路**（不发请求，结果码 `fetch.intercepted`）。 */
export type RequestInterceptor = (
  ctx: FetchRequestContext,
) => FetchRequestContext | null | Promise<FetchRequestContext | null>

/** 响应拦截器（成功与失败都会经过；可改写结果，如 401 触发刷新后重试）。 */
export type ResponseInterceptor = (
  res: FetchResult<unknown>,
  ctx: FetchRequestContext,
) => FetchResult<unknown> | Promise<FetchResult<unknown>>

/** 管线配置（`createCapabilityHooks(bridge, { fetch: {...} })` 传入）。 */
export interface FetchPipelineOptions {
  /** 并发上限（默认 10，与 `wx.request` 的默认并发一致；0 = 不限） */
  concurrency?: number
  /** 默认重试策略（可被单请求 `config.retry` 覆盖成数字 = 次数） */
  retry?: RetryPolicy
  /** 去重：同一时刻在飞的相同请求共享结果（默认 false） */
  dedupe?: boolean
  /** 请求/响应拦截器（请求按注册序、响应按**逆序**执行——洋葱模型） */
  requestInterceptors?: RequestInterceptor[]
  responseInterceptors?: ResponseInterceptor[]
  /** 时钟注入（判据用；默认 `Date.now`） */
  now?: () => number
  /**
   * ★★★#1133：该端的桥**是否支持取消信号**（默认 `true`；微信小程序传 `false`）。
   *
   * 【为什么必须有这个开关（真容器抓出的回归）】管线要给 `useFetchTask().abort()` 铺路，
   *   就必须把**内部**取消信号传给下游。而 MP 腿（`capability-fetch-legs.mpRequest`）的契约是
   *   「`config.signal` 存在 ⇒ `fetch.unsupported`」（`wx.request` 没有 abort 语义）。
   *   ⇒ 管线无条件注入内部信号后，**MP 上所有请求都变成 unsupported**（真容器 4/5 直接红）。
   *   ★判据口径：**只有"用户显式要求取消"才该在 MP 上报 unsupported**；
   *     管线内部的取消通道不该冒充用户意图。
   */
  abortable?: boolean
}

/** 任务状态（`FetchTask.state`）。 */
export type FetchTaskState = 'queued' | 'running' | 'done'

/** ★请求任务句柄（对齐 `wx.request` 的 `RequestTask`，但用 Promise 形状）。 */
export interface FetchTask<T> {
  /** 任务 id（日志/埋点用） */
  readonly id: string
  /** 最终结果（**不抛**；失败以 `ok:false` 表达，与 `useFetch` 一致） */
  readonly result: Promise<FetchResult<T>>
  /** 当前状态 */
  readonly state: FetchTaskState
  /** 取消：排队中 ⇒ 直接失败（不占并发额度）；在飞 ⇒ 尽力通知宿主中止 */
  abort(reason?: string): void
}

/** 单请求可覆盖的管线字段（`useFetch(url, { retry, priority })`）。 */
export interface FetchPipelineConfigExt {
  /** 重试：数字 = 额外次数；对象 = 覆盖默认策略 */
  retry?: number | RetryPolicy
  /** 排队优先级（越大越先发；默认 0） */
  priority?: number
}

const DEFAULT_RETRY_ON = (res: FetchResult<unknown>): boolean => {
  if (!res.ok) {
    const code = res.error.code
    // ★不重试：取消（业务主动）/ 能力缺失（重试也一样）/ 体积超限（重试也一样）/ 被拦截器短路
    if (code === 'fetch.aborted' || code === 'fetch.unsupported' || code === 'fetch.tooLarge' || code === 'fetch.intercepted') {
      return false
    }
    return true // 其余（timeout / failed）可重试
  }
  return res.status === 429 || res.status >= 500
}

/** 可注入时钟的延时（无 `setTimeout` 的 App 精简引擎 ⇒ 立即返回并标记）。 */
function makeDelay(): { delay: (ms: number) => Promise<boolean> } {
  const st = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout
  if (typeof st !== 'function') return { delay: async () => false }
  return { delay: (ms) => new Promise<boolean>((resolve) => st(() => resolve(true), ms)) }
}

function backoffOf(p: RetryPolicy, attempt: number): number {
  const base = p.delayMs ?? 300
  const curve = p.backoff ?? 'exponential'
  const raw = curve === 'fixed' ? base : curve === 'linear' ? base * (attempt + 1) : base * Math.pow(2, attempt)
  const jitter = p.jitter ?? 0.2
  if (jitter <= 0) return raw
  // 确定性抖动（不引随机数——判据可复现）：按 attempt 交替 ±jitter
  const sign = attempt % 2 === 0 ? 1 : -1
  return Math.max(0, Math.round(raw * (1 + sign * jitter)))
}

/** 去重键：方法 + URL + query + body（**不含** headers——鉴权头由拦截器加，同资源应共享）。 */
function dedupeKey(url: string, config: FetchConfig): string {
  const p = config.params
  const params = p
    ? Object.keys(p)
        .filter((k) => p[k] !== undefined)
        .sort()
        .map((k) => `${k}=${String(p[k])}`)
        .join('&')
    : ''
  let body = ''
  if (config.data !== undefined) {
    try {
      body = JSON.stringify(config.data)
    } catch {
      body = String(config.data)
    }
  }
  return `${config.method ?? 'GET'} ${url}?${params} ${body}`
}

/** 可被宿主设置 `onabort` 的合并信号（`attachAbort` 依赖这个赋值通道）。 */
interface LinkedSignal extends AbortSignalLike {
  onabort?: () => void
  /** ★两种挂法都要支持：App 腿用赋值、Web 腿用 addEventListener（见 linkSignals） */
  addEventListener?: (type: string, fn: () => void) => void
  removeEventListener?: (type: string, fn: () => void) => void
}

/**
 * 把多个取消信号并成一条（任一为真即真）。
 *
 * ★★★必须保留 `onabort` **可写**：`capability-invoke.attachAbort` 是 `signal.onabort = doAbort`
 *   挂取消的（App 端取消靠它发 `http.cancel`）。若这里返回一个只有 getter 的对象，
 *   App 的取消会**静默失效**（请求发出去了但掐不断）——所以合并对象必须转发 onabort。
 */
function linkSignals(parts: Array<AbortSignalLike | undefined>): LinkedSignal {
  const alive = parts.filter((s): s is AbortSignalLike => Boolean(s))
  // ★★★必须**原样返回单信号**（不能包装）：下游（`capability-invoke.attachAbort` 与
  //   `capability-fetch-legs.webRequest`）分别靠 `signal.onabort = fn` 与
  //   `signal.addEventListener('abort', fn)` 挂取消。包装成普通对象会让这两种挂法都失效。
  if (alive.length === 1) return alive[0] as LinkedSignal

  const listeners = new Set<() => void>()
  function emit(): void {
    merged.onabort?.()
    for (const fn of listeners) {
      try {
        fn()
      } catch {
        /* 监听器异常不影响其它监听器（与 DOM 事件语义一致） */
      }
    }
  }

  const merged: LinkedSignal = {
    get aborted() {
      return alive.some((s) => s.aborted === true)
    },
    onabort: undefined,
    // ★★★#1133 修：合并信号必须**同时支持两种挂法**（onabort 赋值 / addEventListener）。
    //   实测抓出：少了 addEventListener ⇒ Web 腿（`webRequest` 走它）的取消**永远挂不上**
    //   ⇒ 真浏览器 e2e 的 abort 用例直接挂到超时。
    addEventListener: (_type: string, fn: () => void) => {
      listeners.add(fn)
    },
    removeEventListener: (_type: string, fn: () => void) => {
      listeners.delete(fn)
    },
  }

  for (const s of alive) {
    const sig = s as AbortSignalLike & { onabort?: () => void; addEventListener?: (t: string, f: () => void) => void }
    if (typeof sig.addEventListener === 'function') {
      // 原生 AbortSignal（Web / 标准实现）
      sig.addEventListener('abort', emit)
    } else {
      // 裸对象 `{ aborted }`（`AbortSignalLike` 最小契约）或 App 侧 createAbortController 产物：
      // ★不能写 `else if ('onabort' in sig)` —— 业务常传 `{ aborted: false }`，`in` 判假 ⇒ relay 挂不上
      const prev = sig.onabort
      sig.onabort = () => {
        prev?.()
        emit()
      }
    }
  }
  return merged
}

/** 任务内部可变状态（execute 与 abort 共享）。 */
interface TaskCtl {
  aborted: boolean
  abortReason: string | undefined
  queuedMs: number
  /** 传给下游的取消信号（已合并用户信号） */
  signal: LinkedSignal
}

interface QueueEntry {
  seq: number
  priority: number
  run: () => void
}

/**
 * 建一条请求管线（每个 `CapabilityHooks` 实例一条——并发额度**按实例**计，不跨页面共享）。
 */
export function createFetchPipeline(
  bridge: PipelineBridge,
  opts: FetchPipelineOptions = {},
): {
  fetch<T>(url: string, config?: FetchConfig): Promise<FetchResult<T>>
  fetchTask<T>(url: string, config?: FetchConfig): FetchTask<T>
  /** 当前在飞数（观测/判据用） */
  inflight(): number
  /** 当前排队数（观测/判据用） */
  queued(): number
} {
  const now = opts.now ?? Date.now
  const limit = Math.max(0, opts.concurrency ?? 10)
  const abortable = opts.abortable ?? true
  const { delay } = makeDelay()
  const reqInterceptors = opts.requestInterceptors ?? []
  const resInterceptors = opts.responseInterceptors ?? []
  const inflightMap = new Map<string, Promise<FetchResult<unknown>>>()
  const queue: QueueEntry[] = []
  let running = 0
  let seq = 0
  let enqSeq = 0

  /** 调度器：有额度就取**优先级最高**的排队项（同优先级 FIFO）。 */
  function pump(): void {
    // ★写成"先判额度、再取项"的两段（而不是 while 条件里重复读 running）：
    //   ① 条件只读一次，语义=「本轮还有没有额度」；② 每次循环必消耗一个排队项，
    //     无项即 return ⇒ 不存在空转（与 lint 的 no-unmodified-loop-condition 同源顾虑）。
    for (;;) {
      if (limit !== 0 && running >= limit) return
      let best = -1
      for (let i = 0; i < queue.length; i++) {
        const a = queue[i]!
        const b = best >= 0 ? queue[best]! : null
        if (!b || a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i
      }
      const next = best >= 0 ? queue.splice(best, 1)[0] : undefined
      if (!next) return
      running++
      next.run()
    }
  }

  function normalizeRetry(config: FetchConfig, base?: RetryPolicy): RetryPolicy {
    const r = config.retry
    if (typeof r === 'number') return { ...(base ?? {}), attempts: r }
    return { ...(base ?? {}), ...((r as RetryPolicy | undefined) ?? {}) }
  }

  async function execute<T>(
    id: string,
    url: string,
    config: FetchConfig,
    priority: number,
    task: TaskCtl,
    queuedMs: number,
    startedAt: number,
  ): Promise<FetchResult<T>> {
    const retryCfg = normalizeRetry(config, opts.retry)
    const maxAttempts = (retryCfg.attempts ?? 0) + 1
    const ctx: FetchRequestContext = { id, url, config, attempt: 0, elapsedMs: 0 }
    const attemptMs: number[] = []
    let retryDelaySkipped = false
    const deduped = false

    // ① 请求拦截器（洋葱入口）
    let curUrl = url
    let curConfig: FetchConfig = config
    for (const fn of reqInterceptors) {
      const out = await fn({ ...ctx, url: curUrl, config: curConfig, elapsedMs: now() - startedAt })
      if (out === null) {
        return {
          ok: false,
          error: { code: 'fetch.intercepted', message: '请求被拦截器短路' } as never,
          meta: { id, attempts: 0, queuedMs, totalMs: Math.round(now() - startedAt), attemptMs: [], deduped: false, priority },
        }
      }
      curUrl = out.url
      curConfig = out.config
    }

    let last: FetchResult<T> | null = null
    // ★信号链只在"用户信号变了"时重建（拦截器每轮可能改 config.signal）——
    //   每轮重建会不断 chain 上一层的 relay ⇒ 重试多次后 onabort 回调堆积。
    // ★★无用户信号时：只有 `abortable` 端才注入内部信号（MP 注入会被判 unsupported，见 options 说明）
    const buildSignal = (): LinkedSignal | undefined =>
      curConfig.signal ? linkSignals([task.signal, curConfig.signal]) : abortable ? task.signal : undefined
    let linkedSig: LinkedSignal | undefined = buildSignal()
    let linkedFrom = curConfig.signal
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (task.aborted) {
        last = {
          ok: false,
          error: { code: 'fetch.aborted', message: `请求已取消（${task.abortReason ?? '业务主动'}）` } as never,
        }
        break
      }
      const t0 = now()
      // ② 分发（信号 = 任务内部信号 ∪ 拦截器改写后的用户信号）
      let res: FetchResult<unknown>
      try {
        if (curConfig.signal !== linkedFrom) {
          linkedSig = buildSignal()
          linkedFrom = curConfig.signal
        }
        res = await runFetch<unknown>(bridge, curUrl, { ...curConfig, signal: linkedSig })
      } catch (e) {
        res = { ok: false, error: { code: 'fetch.failed', message: e instanceof Error ? e.message : String(e) } as never }
      }
      attemptMs.push(Math.round(now() - t0))
      // ③ 响应拦截器（逆序，洋葱出口）
      for (let i = resInterceptors.length - 1; i >= 0; i--) {
        res = await resInterceptors[i]!(res, {
          ...ctx,
          url: curUrl,
          config: curConfig,
          attempt,
          elapsedMs: now() - startedAt,
        })
      }
      last = res as FetchResult<T>
      // ④ 可重试判定
      //   ★★★这里**不能写 `if (last.ok) break`**：HTTP 429/5xx 在 `runFetch` 里是 `ok:true` +
      //   status（不是异常）⇒ 先 break 就永远不重试。判定交给 `retryOn`（默认对 429/5xx 返 true）。
      const shouldRetry = (retryCfg.retryOn ?? DEFAULT_RETRY_ON)(res, attempt)
      if (!task.aborted && attempt + 1 < maxAttempts && shouldRetry) {
        const waited = await delay(backoffOf(retryCfg, attempt))
        if (!waited) retryDelaySkipped = true
        continue
      }
      break
    }

    const meta: FetchMeta = {
      id,
      attempts: attemptMs.length,
      queuedMs,
      totalMs: Math.round(now() - startedAt),
      attemptMs,
      deduped,
      priority,
      ...(retryDelaySkipped ? { retryDelaySkipped: true } : {}),
    }
    const body: FetchResult<T> = last ?? {
      ok: false,
      error: { code: 'fetch.failed', message: '请求未执行' } as never,
    }
    // ★meta 附加在两条分支上（不改变既有字段，向后兼容）
    return { ...body, meta } as FetchResult<T>
  }

  function fetchTask<T>(url: string, config: FetchConfig = {}): FetchTask<T> {
    const id = `f${++seq}`
    const priority = config.priority ?? 0
    const abortCtl = createAbortController()
    const userSig = config.signal
    // ★★不要在这里给 abortCtl.signal.onabort 赋"转发到 signal.onabort"——无用户信号时
    //   `linkSignals` 直接返回 `abortCtl.signal` 本身，那就成了**自我递归**（实测 RangeError 爆栈）。
    //   ★无用户信号且该端不可取消 ⇒ 用内部信号本体（不合并，也就不挂 relay）。
    const signal: LinkedSignal = userSig ? linkSignals([abortCtl.signal, userSig]) : (abortCtl.signal as LinkedSignal)
    if (userSig && userSig.aborted) abortCtl.abort()
    const task: TaskCtl = { aborted: false, abortReason: undefined, queuedMs: 0, signal }

    let state: FetchTaskState = 'queued'
    let resolveOuter: (v: FetchResult<T>) => void = () => undefined
    const result = new Promise<FetchResult<T>>((r) => (resolveOuter = r))
    let didRun = false

    const finish = (v: FetchResult<T>): void => {
      state = 'done'
      if (didRun) {
        didRun = false
        running = Math.max(0, running - 1)
        pump()
      }
      resolveOuter(v)
    }

    // ★去重：只合并"无用户信号"的相同在飞请求
    const key = opts.dedupe && !userSig ? dedupeKey(url, config) : ''
    if (key) {
      const shared = inflightMap.get(key)
      if (shared) {
        state = 'running'
        void shared.then((v) => {
          const m = (v as { meta?: FetchMeta }).meta
          state = 'done'
          resolveOuter({
            ...(v as FetchResult<T>),
            meta: { ...(m ?? { id, attempts: 0, queuedMs: 0, totalMs: 0, attemptMs: [], deduped: false, priority }), deduped: true },
          } as FetchResult<T>)
        })
        return { id, result, get state() { return state }, abort: () => undefined }
      }
    }

    const entry: QueueEntry = {
      seq: ++enqSeq,
      priority,
      run: () => {
        didRun = true
        state = 'running'
        const startedAt = now()
        const queuedMs = Math.round(startedAt - enqueuedAt)
        task.queuedMs = queuedMs
        const p = execute<T>(id, url, config, priority, task, queuedMs, startedAt)
        if (key) inflightMap.set(key, p as Promise<FetchResult<unknown>>)
        void p.then(
          (v) => {
            if (key) inflightMap.delete(key)
            finish(v)
          },
          (e) => {
            if (key) inflightMap.delete(key)
            finish({ ok: false, error: { code: 'fetch.failed', message: e instanceof Error ? e.message : String(e) } as never })
          },
        )
      },
    }
    const enqueuedAt = now()
    queue.push(entry)
    pump()

    return {
      id,
      result,
      get state() {
        return state
      },
      abort(reason?: string) {
        if (task.aborted) return
        task.aborted = true
        task.abortReason = reason
        // ① 还没被调度 ⇒ 从队列摘掉并直接结算（不占额度）
        const i = queue.indexOf(entry)
        if (i >= 0) {
          queue.splice(i, 1)
          abortCtl.abort()
          finish({
            ok: false,
            error: { code: 'fetch.aborted', message: `请求已取消（${reason ?? '业务主动'}）` } as never,
            meta: { id, attempts: 0, queuedMs: 0, totalMs: Math.round(now() - enqueuedAt), attemptMs: [], deduped: false, priority },
          })
          return
        }
        // ② 在飞 ⇒ 通知宿主（attachAbort 从 signal.onabort 走）
        abortCtl.abort()
      },
    }
  }

  return {
    fetch: <T>(url: string, config?: FetchConfig) => fetchTask<T>(url, config).result,
    fetchTask,
    inflight: () => running,
    queued: () => queue.length,
  }
}

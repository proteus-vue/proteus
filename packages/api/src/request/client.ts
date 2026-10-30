// packages/api/src/request/client.ts
// ★★★#1342 请求库门面：`createRequestClient()` —— 平台方配置一次，业务只发请求。
//
// 【本文件的唯一职责：把「策略」串起来，不实现任何策略本身】
//   幂等/断路器/离线/脱敏/签名/白名单/配额 各自在自己的文件里、
//   传输与 HTTP 语义全在 `capability-fetch-pipeline`（本库**不碰传输**）。
//   ⇒ 本文件只做三件事：① 决策顺序 ② 三态归一 ③ 观测/审计接线。
//
// 【决策顺序（这个顺序本身就是契约，改动即改变语义）】
//   1. **本地拒绝层**（零网络成本，先拦）：
//      URL 拼接 → 域名白名单 → 断路器 → 幂等性/重试可行性预判
//   2. **凭证与安全注入**：auth → 防重放头 → 签名 → 脱敏（脱敏只作用于日志/trace，不作用于真实请求）
//   3. **并发闸门**：全局 → 业务 → host（三级）
//   4. **执行**（交给 pipeline，含它自己的拦截器/重试/缓存/deadline/取消）
//   5. **三态归一**：失败 → `classifyFailure` 判 failed / unknown
//   6. **观测**：审计 + trace（都已脱敏）
//
// 【为什么不自己重试、自己缓存】
//   pipeline 已经有：重试（含退避/抖动/retryOn）、HTTP 缓存（RFC 9111 + 5861 + L2）、
//   并发队列、优先级、去重、deadline、取消、传输读数。
//   本库若再实现一遍，就会出现"两套重试""两套缓存命中"——正是现在三套入口的病根。
//   ⇒ 本库**只在 pipeline 之上做它做不到的事**（未知态、租户、离线、签名、审计）。

import { createCapabilityHooks } from '../capability'
import type { CapabilityHooks } from '../capability'
import type { FetchConfig, FetchResult } from '../capability-fetch-types'
import { CapError } from '../capability-types'
import type { AuthManager } from '../auth'
import {
  CircuitBreaker,
  OfflineQueue,
  canRetry,
  classifyFailure,
  classifySuccess,
  computeBackoffMs,
  makeIdempotencyKey,
  parseRetryAfter,
  resolveIdempotencyKey,
  shouldRetryResult,
} from './reliability'
import {
  bearerHeader,
  hasHeader,
  makeAntiReplayHeaders,
  redactBody,
  redactHeaders,
  redactUrl,
  signRequest,
} from './security'
import { QuotaTree, createTenantContext, makeAuditEntry } from './tenant'
// ★★★#1403：平台化三件（共享配额池 / 速率限制 / 审计出口）
import { AuditSink } from './audit'
import { RateLimiter } from './rate-limit'
import { acquireSharedPool } from './shared'
import type { TenantContext } from './tenant'
import type {
  OfflineQueueEntry,
  RequestAuditEntry,
  RequestClient,
  RequestClientOptions,
  RequestClientStats,
  RequestMeta,
  RequestOptions,
  RequestOutcome,
  RequestPhase,
  RequestResult,
  RequestTask,
  RequestTimeoutPolicy,
  RequestTraceEvent,
} from './types'

/** 默认并发（与 `M7.3` 文档的"全局 6"对齐；pipeline 的实例级 10 仍生效，这是叠加） */
const DEFAULT_GLOBAL_CONCURRENCY = 6

/**
 * ★★★#1342 C2：**适配器腿**——把 `IRequestAdapter`（wx/web 两套原生实现）接成
 * `hooks` 形状，让 `createApi` 能委托本库而**不丢它自己的适配器**。
 *
 * 【为什么需要这一层（不能直接把 adapter 塞进 hooks）】
 *   `hooks.useFetch` 的契约是 `FetchConfig → FetchResult`（不抛、带 meta）；
 *   而 `IRequestAdapter.request` 的契约是 `RequestConfig → RequestResponse`（**会抛** `ApiError`）。
 *   两者错误模型相反 ⇒ 必须做一次翻译，**不能**让 `createApi` 直接透传（那就丢了三态与重试）。
 *
 * 【已知边界（如实登记）】
 *   适配器腿没有 pipeline 的 HTTP 缓存/优先级/deadline，也没有 `meta.transport` 读数
 *   ——那些是能力桥腿（App）独有的。适配器腿拿到的是 `meta.attempts` 由本库补。
 */
export function adapterToHooks(
  request: (config: {
    url: string
    method?: string
    headers?: Record<string, string>
    data?: unknown
    params?: Record<string, unknown>
    timeout?: number
  }) => Promise<{ data: unknown; status: number; headers: Record<string, string> }>,
): CapabilityHooks {
  return {
    useFetch: async (url: string, cfg: FetchConfig) => {
      try {
        const res = await request({
          url,
          method: cfg.method,
          headers: cfg.headers,
          data: cfg.data,
          params: cfg.params,
          timeout: cfg.timeout,
        })
        return { ok: true as const, data: res.data, status: res.status, headers: res.headers, meta: { attempts: 1 } as never }
      } catch (e) {
        // ★把抛出的错误翻成 `FetchResult`（本库内部只认 FetchResult）
        const code = (e as { code?: string })?.code
        // 适配器的 `TIMEOUT`/`NETWORK_ERROR` 映射到 pipeline 的错误码族，才能被 classifyFailure 正确分档
        const mapped =
          code === 'TIMEOUT' ? 'fetch.timeout' : code === 'NETWORK_ERROR' ? 'network.unreachable' : 'fetch.failed'
        return {
          ok: false as const,
          error: new CapError(mapped, e instanceof Error ? e.message : String(e)),
          meta: { attempts: 1 } as never,
        }
      }
    },
  } as unknown as CapabilityHooks
}

/** 把三层超时归一成 pipeline 的两个字段（pipeline 只有单轮 timeout + 总 deadline） */
function normalizeTimeout(
  t: RequestTimeoutPolicy | number | undefined,
  fallbackIdle = 15_000,
): { idle: number; deadline?: number } {
  if (t === undefined) return { idle: fallbackIdle }
  if (typeof t === 'number') return { idle: t }
  return { idle: t.idle ?? fallbackIdle, deadline: t.deadline }
}

/** 拼 URL（★只在门面层做，不进 `FetchConfig`——避免污染四层线格式白名单） */
export function joinUrl(baseURL: string | undefined, url: string): string {
  if (!baseURL || baseURL.length === 0) return url
  // 已是绝对地址 ⇒ 不拼
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) return url
  const b = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
  const u = url.startsWith('/') ? url : `/${url}`
  return b + u
}

/** 请求体序列化（★签名要用**同一份字符串**，所以只算一次） */
function serializeBody(data: unknown): string {
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

/**
 * 创建请求客户端。
 *
 * ★实例创建后**不可变**（冻结）：要改配置就新建实例。
 *   这是对痛点 #13 的结构性回答——没有"全局可变默认值"这种东西可被业务偷改。
 */
export function createRequestClient(options: RequestClientOptions = {}): RequestClient {
  /**
   * ★★★#1398：拦截器 → 内核管线（本层只做映射，不重实现）
   *
   * 【三种情况，且**不静默**】：
   *   ① 没传 hooks + 传了 interceptors ⇒ 自建 hooks 时把拦截器塞进 `fetch.*Interceptors`
   *      ⇒ 走内核原生实现（含"配了拦截器就跳过去重"的保护）。
   *   ② 传了 hooks + 没传 interceptors ⇒ 原行为，零变化。
   *   ③ **传了 hooks + 又传 interceptors ⇒ 明确报错**。
   *      理由：`CapabilityHooks` 不暴露管线配置，本层无法把拦截器注入**已建好**的管线。
   *      ★为什么不静默忽略：那正是本单要修的缺陷形态（`createRequestClient({ interceptors })`
   *        拦截器调用 0 次、毫无提示）。静默的"配了但没生效"比报错难查十倍。
   *      错误信息给两条可执行出路，不让业务自己猜。
   */
  const wantsInterceptors =
    (options.interceptors?.request?.length ?? 0) > 0 || (options.interceptors?.response?.length ?? 0) > 0
  let hooks: CapabilityHooks
  if (options.hooks) {
    if (wantsInterceptors) {
      throw new Error(
        'request.interceptors.conflict: 同时传了 hooks 与 interceptors —— 本层无法把拦截器注入已建好的管线。'
        + '二选一：① 不传 hooks（让 client 自建，interceptors 自动生效）；'
        + '② 自己 createCapabilityHooks(undefined, { fetch: { requestInterceptors, responseInterceptors } })，'
        + '再把结果作为 hooks 传入。',
      )
    }
    hooks = options.hooks
  } else if (wantsInterceptors) {
    hooks = createCapabilityHooks(undefined, {
      fetch: {
        requestInterceptors: options.interceptors?.request as never,
        responseInterceptors: options.interceptors?.response as never,
      },
    })
  } else {
    hooks = createCapabilityHooks()
  }
  const baseURL = options.baseURL
  const defaultHeaders = { ...(options.headers ?? {}) }
  const retryPolicy = options.retry
  const idemMode = options.idempotency ?? 'auto'
  const auth: AuthManager | undefined = options.auth
  const redactPolicy = options.redact
  const tenant: TenantContext | undefined = createTenantContext(options.tenant)
  /**
   * ★★★#1403：**配额树与断路器的归属**
   *
   * 传了 `sharedQuotaKey` ⇒ 从**跨实例注册表**取（同 key 的多个 client 共用一份）；
   * 不传 ⇒ 每实例一份（**默认**，零回归 —— 见 types.ts 里为什么不改默认）。
   */
  const sharedKey = options.sharedQuotaKey?.trim()
  const globalLimit = options.tenant?.concurrency ?? DEFAULT_GLOBAL_CONCURRENCY
  const wantBreaker = options.circuitBreaker !== false
  const shared = sharedKey
    ? acquireSharedPool(sharedKey, globalLimit, {
        enabled: wantBreaker,
        options: (options.circuitBreaker === false ? {} : (options.circuitBreaker ?? {})) as Record<string, unknown>,
      })
    : undefined
  const breaker = shared
    ? shared.breaker
    : (wantBreaker ? new CircuitBreaker((options.circuitBreaker === false ? {} : (options.circuitBreaker ?? {}))) : undefined)
  const quota: QuotaTree = shared ? shared.quota : new QuotaTree(globalLimit)
  /**
   * ★★★#1403：**速率限制**（与并发是两件事 —— 见 types.ts 的说明）。
   * 未配 ⇒ `RateLimiter.enabled === false`，请求路径上整段短路（零开销）。
   */
  const limiter = new RateLimiter(options.rateLimit ?? { permitsPerSecond: 0 })
  /**
   * ★★★#1403：**审计出口**（缓冲 + 批量 + 采样）。
   * 配了 `audit` ⇒ 走批量出口；没配 ⇒ 保持旧的逐条 `tenant.onAudit` 回调（零回归）。
   */
  const auditSink = options.audit ? new AuditSink(options.audit) : undefined
  const offlineEnabled = options.offlineQueue?.enabled === true
  const offline = offlineEnabled ? new OfflineQueue({ policy: options.offlineQueue!, store: options.offlineQueue!.store }) : undefined
  const defaultTimeout = normalizeTimeout(options.timeout)

  // —— 计数（诊断用；不含请求内容）——
  const totals = { requests: 0, success: 0, failed: 0, unknown: 0 }
  let rejectedLocal = 0

  /**
   * ★★★#1344：**网络恢复 ⇒ 自动重放**（`offlineQueue.autoFlush`）。
   *
   * 【修的是什么（本轮取证发现）】类型里写着"恢复后按序重放"，而
   *   `flushOfflineQueue()` 此前**没有任何调用方** —— 业务必须自己记得调，
   *   而绝大多数不会 ⇒ 断网时入队的请求**永久躺在队列里**（"离线黑洞"）。
   *   ★本仓反复抓的同一形态：类型/API 都在，缺的是最后一根驱动线。
   *
   * 【为什么放在这里而不是交给业务】业务会在 20 个页面各写一遍"网恢复就 flush"，
   *   而那些副本一定会漂移（忘记 await / 忘记去重 / 连写错事件名）。
   *   平台方一次配好，业务零负担 —— 这才叫"治理层"。
   *
   * 【防重入】网络抖动会连发多次恢复事件 ⇒ 用 `flushing` 闸门，一次只跑一轮；
   *   期间再次触发只记一个"待补跑"标记，本轮结束后补一次（不丢事件、不并发重放）。
   */
  let unsubNet: (() => void) | undefined
  let flushing = false
  let flushPending = false

  function emitTrace(e: RequestTraceEvent): void {
    if (options.trace) {
      try {
        options.trace(e)
      } catch {
        // ★trace 回调抛错不能影响请求（观测是旁路）
      }
    }
  }

  function audit(entry: RequestAuditEntry): void {
    /**
     * ★★★#1403：配了 `audit` ⇒ 走**批量出口**（缓冲/采样/批量写）；
     *   否则保持旧的逐条 `tenant.onAudit`（**零回归** —— 不配就完全同以前）。
     * ★两者不叠加：配了 audit 就不调 onAudit（否则业务会收到两份，去重责任落到业务侧）。
     */
    if (auditSink) {
      auditSink.push(entry)
      return
    }
    if (tenant) {
      try {
        tenant.audit(entry)
      } catch {
        // 同上
      }
    }
  }

  /**
   * 核心执行（一次逻辑请求 = 一次调用；内部可能含多次 attempt，由 pipeline 重试）。
   *
   * ★注意：本函数**不抛**——所有失败都以 `RequestResult` 表达（G-32.3）。
   */
  async function execute<T>(url: string, opts: RequestOptions, attemptNo = 1): Promise<RequestResult<T>> {
    const startedAt = Date.now()
    const requestId = `rq-${(requestSeq = (requestSeq + 1) % 1e9).toString(36)}-${startedAt.toString(36)}`
    const method = (opts.method ?? 'GET').toUpperCase()
    const fullUrl = joinUrl(baseURL, url)
    const host = hostOfSafe(fullUrl)
    let phase: RequestPhase = 'indeterminate'
    let sent = false
    let attempts = 0
    let releaseGates: Array<() => void> = []

    const finish = (
      outcome: RequestOutcome,
      payload: { data?: unknown; status?: number; headers?: Record<string, string>; error?: { code: string; message: string }; phase: RequestPhase; sent: boolean; pipelineMeta?: FetchResult<unknown>['meta']; idemKey?: string; cacheHit?: boolean },
    ): RequestResult<T> => {
      const durationMs = Date.now() - startedAt
      const meta: RequestMeta = {
        requestId,
        bizId: tenant?.bizId,
        outcome,
        phase: payload.phase,
        sent: payload.sent,
        attempts,
        durationMs,
        idempotencyKey: payload.idemKey,
        cacheHit: payload.cacheHit,
        pipeline: payload.pipelineMeta,
      }
      if (outcome === 'success') totals.success++
      else if (outcome === 'failed') totals.failed++
      else totals.unknown++

      // 审计 + trace（★都走脱敏）
      const auditEntry = makeAuditEntry({
        id: requestId,
        bizId: tenant?.bizId ?? '(none)',
        url: fullUrl,
        method,
        outcome,
        status: payload.status,
        durationMs,
        attempts,
        errorCode: payload.error?.code,
        cacheHit: payload.cacheHit,
      })
      audit(auditEntry)
      emitTrace({
        requestId,
        bizId: tenant?.bizId,
        phase: outcome === 'success' ? 'end' : 'error',
        method,
        url: redactUrl(fullUrl, redactPolicy),
        outcome,
        status: payload.status,
        durationMs,
        errorCode: payload.error?.code,
      })

      if (outcome === 'success') {
        return {
          ok: true,
          outcome: 'success',
          data: payload.data as T,
          status: payload.status ?? 200,
          headers: payload.headers ?? {},
          meta,
        }
      }
      return {
        ok: false,
        outcome,
        error: payload.error ?? { code: 'fetch.failed', message: '未知失败' },
        status: payload.status,
        meta,
      }
    }

    // ── 1. 本地拒绝层 ────────────────────────────────────────────
    // ① 域名白名单（合规第一道；★平台内部可用 skipTenantCheck 绕过）
    if (tenant && !opts.skipTenantCheck) {
      const chk = tenant.checkHost(fullUrl)
      if (!chk.allowed) {
        rejectedLocal++
        return finish('failed', {
          error: {
            code: 'request.forbidden',
            message: `域名 ${chk.host || '(无法解析)'} 不在业务 ${tenant.bizId} 的白名单内`,
          },
          phase: 'rejected-local',
          sent: false,
        })
      }
    }

    // ② 断路器（★按 host；开了就本地失败，零网络成本）
    if (breaker && host.length > 0) {
      const gate = breaker.allow(host)
      if (!gate.allowed) {
        rejectedLocal++
        return finish('failed', {
          error: { code: 'request.circuitOpen', message: `下游 ${host} 断路器打开（连续失败过多，cooldown 内不发送）` },
          phase: 'rejected-local',
          sent: false,
        })
      }
    }

    // ③ 幂等键（★在**任务创建时**生成一次，所有重试复用——这是幂等的正确性前提）
    const idempotencyKey = resolveIdempotencyKey(
      opts.idempotencyKey,
      idemMode,
      () => makeIdempotencyKey(),
    )
    // `auto` 模式：非幂等方法且配了重试 ⇒ 自动生成 key（否则重试会被 canRetry 拒绝，等于没重试）
    const effectiveIdemKey =
      idempotencyKey ??
      (idemMode === 'auto' && (retryPolicy?.attempts ?? 0) > 0 && !isIdempotentSafe(method)
        ? makeIdempotencyKey()
        : undefined)

    // ④ 重试可行性预判（★非幂等无 key ⇒ 直接把 retry 降为 0，而不是重试到一半才失败）
    const retryGate = canRetry(method, effectiveIdemKey !== undefined, opts.retry ?? retryPolicy)
    const attemptsAllowed = retryGate.ok ? (opts.retry?.attempts ?? retryPolicy?.attempts ?? 0) : 0

    // ── 2. 凭证与安全注入 ───────────────────────────────────────
    let headers: Record<string, string> = { ...defaultHeaders, ...(opts.headers ?? {}) }
    if (!opts.skipAuth && auth) {
      try {
        const token = auth.getToken()
        if (token && !hasHeader(headers, 'authorization')) headers = { ...headers, ...bearerHeader(token) }
      } catch {
        // auth 读失败不阻断（可能是未登录）
      }
    }
    const bodyStr = serializeBody(opts.data)

    // 防重放头（★只有同时配了 signing 才有意义——否则只是加了两个没保护的头）
    if (options.antiReplay?.enabled === true && options.signing) {
      headers = { ...headers, ...makeAntiReplayHeaders(options.antiReplay) }
    }

    // 签名（★必须对**真实**内容签名；脱敏只用于日志）
    if (options.signing) {
      try {
        headers = await signRequest({
          method,
          url: fullUrl,
          headers,
          body: bodyStr,
          policy: options.signing,
          antiReplay: options.antiReplay,
        })
      } catch (e) {
        // ★签名失败**不能**降级成无签名发送（那会让服务端 401，更难排查）
        return finish('failed', {
          error: { code: 'request.signFailed', message: `请求签名失败：${e instanceof Error ? e.message : String(e)}` },
          phase: 'rejected-local',
          sent: false,
        })
      }
    }

    /**
     * ── 3a. 速率限制（★排在并发闸门**之前**）──────────────────────
     *
     * 【为什么先限速再排队】
     *   反过来的话：被限速的请求先占住并发额度、等完再被拒 ⇒ 白白挤掉别人的额度，
     *   而且"排队 5 秒后被限速"对业务是最糟的体验。
     *   速率是**更便宜的前置判断**（纯计算，无副作用）⇒ 不过就立刻返回，不占任何额度。
     * ★`limiter.enabled === false`（没配）时整段短路，零开销。
     */
    if (limiter.enabled) {
      const decision = await limiter.acquire({ bizId: tenant?.bizId, host })
      if (!decision.ok) {
        rejectedLocal++
        return finish('failed', {
          error: {
            code: 'request.rateLimited',
            message: decision.reason,
            // ★把"还要等多久"给业务：可据此退避，而不是盲目重试
            retryAfterMs: decision.retryAfterMs,
          } as never,
          phase: 'rejected-local',
          sent: false,
        })
      }
    }

    // ── 3b. 并发闸门（全局 → 业务 → host） ──────────────────────
    try {
      const gGate = await quota.global.acquire(opts.signal ?? undefined)
      releaseGates.push(gGate)
      if (tenant?.gate) {
        const tGate = await tenant.gate.acquire(opts.signal ?? undefined)
        releaseGates.push(tGate)
      }
      if (host.length > 0) {
        const hGate = await quota.hostGate(host).acquire(opts.signal ?? undefined)
        releaseGates.push(hGate)
      }
    } catch (e) {
      // 排队中被取消 ⇒ 确定没发出
      return finish('failed', {
        error: { code: 'fetch.aborted', message: e instanceof Error ? e.message : '排队中取消' },
        phase: 'rejected-local',
        sent: false,
        idemKey: effectiveIdemKey,
      })
    }

    // ── 4. 执行（pipeline） ────────────────────────────────────
    const timeout = normalizeTimeout(opts.timeout ?? options.timeout, defaultTimeout.idle)
    const deadline = timeout.deadline ?? defaultTimeout.deadline
    const cfg: FetchConfig = {
      ...opts,
      // ★`method` 的类型是 `HttpMethod` 联合；门面层允许任意字符串（大小写归一），转成它
      method: method as FetchConfig['method'],
      headers,
      // ★幂等键作为业务头下发（服务端按此去重）；不进线格式字段，走普通 header
      ...(effectiveIdemKey ? { headers: { ...headers, 'Idempotency-Key': effectiveIdemKey } } : {}),
      timeout: timeout.idle,
      ...(deadline !== undefined ? { deadline } : {}),
      // ★retry 交给 pipeline（它有自己的退避/抖动/retryOn）；本库只负责"能不能重试"这个前置门
      retry: attemptsAllowed > 0 ? attemptsAllowed : 0,
      /**
       * ★★★#1385：把"本请求可安全重发"这条**只有门面层知道的信息**传下去。
       *
       * 【为什么必须传】pipeline 看不到 `idempotencyKey`（架构约束：门面层字段不进 FetchConfig），
       *   而它现在按 HTTP 语义**默认拒绝对非幂等方法重试**（防重复下单）。
       *   若不带这条，`createApi` 里**有幂等键的 POST 也会被拦**——
       *   那等于把一个已经安全的场景判成不安全（过度保守，业务会以为"重试坏了"）。
       *   门面层已经用 `canRetry` 判过一次（`attemptsAllowed`），这里只是把结论告诉下一层。
       */
      ...(attemptsAllowed > 0 && (effectiveIdemKey !== undefined || !isIdempotentSafe(method))
        ? { retryNonIdempotent: true }
        : {}),
      // 清掉门面层字段，防止误透传（★这一步是硬要求：pipeline 会把这些当业务字段）
      ...({} as Record<string, never>),
    }
    delete (cfg as Record<string, unknown>).idempotencyKey
    delete (cfg as Record<string, unknown>).skipAuth
    delete (cfg as Record<string, unknown>).skipTenantCheck
    delete (cfg as Record<string, unknown>).allowOffline
    delete (cfg as Record<string, unknown>).caller

    let result: FetchResult<T>
    try {
      // ★真正发出前先标记 sent：pipeline 内部的任何失败都发生在这之后
      sent = true
      emitTrace({
        requestId,
        bizId: tenant?.bizId,
        phase: 'start',
        method,
        url: redactUrl(fullUrl, redactPolicy),
      })
      /* ★★★#1342 取消：必须**真的**中断在飞的 useFetch，而不是只把 signal 传下去。
         实测踩过：只在 cfg 里带 signal 时，若 pipeline 腿不支持（如鸿蒙同步 napi、
         或被假桥忽略），`abort()` 就变成了"置个标志位"——请求照跑、结果照回。
         ⇒ 这里用 **Promise.race（请求 vs 取消）** 做门面层兜底：取消优于结果。
         ★取消后的三态：已发出 ⇒ `unknown`（可能已被服务端处理），由 classifyFailure 判。 */
      const inflight = hooks.useFetch<T>(fullUrl, cfg)
      const aborted = waitAbort(opts.signal)
      result = aborted ? ((await Promise.race([inflight, aborted])) as FetchResult<T>) : await inflight
    } catch (e) {
      // useFetch 本身不抛；真抛了说明是框架 bug ⇒ 按未知处理（保守）
      const err = e instanceof CapError ? e : new CapError('fetch.failed', e instanceof Error ? e.message : String(e))
      const cls = classifyFailure(err, { sent, gotResponseBytes: false })
      return finish(cls.outcome, {
        error: { code: cls.outcome === 'unknown' ? 'fetch.unknown' : err.code, message: cls.reason },
        phase: cls.phase,
        sent,
        idemKey: effectiveIdemKey,
      })
    } finally {
      for (const r of releaseGates) r()
      releaseGates = []
    }

    /* ★尝试次数的**唯一来源是本地计数器**（不从 `result.meta.attempts` 读）：
       适配器腿（`adapterToHooks`）的返回值没有 pipeline meta ⇒ 若从 meta 读会恒为 1，
       进而让"是否达上限"永远判 false ⇒ **无限重试**（实测推演过这条链）。
       pipeline 腿自己也会重试，但它的 attempts 会计入 meta；两者取**较大者**才不会重复计数。 */
    attempts = Math.max(attemptNo, result.meta?.attempts ?? 1)

    // ── 5. 三态归一 ────────────────────────────────────────────
    if (result.ok) {
      if (breaker && host.length > 0) breaker.onSuccess(host)
      const cls = classifySuccess()
      return finish('success', {
        data: result.data,
        status: result.status,
        headers: result.headers,
        phase: cls.phase,
        sent: true,
        pipelineMeta: result.meta,
        idemKey: effectiveIdemKey,
        cacheHit: result.meta?.cache?.status === 'hit' || result.meta?.cache?.status === 'revalidated',
      })
    }

    // 失败：判 failed / unknown
    // ★失败分支没有 `status`（`FetchResult` 的失败形状只有 error）⇒ "是否收到响应字节"
    //   只能从错误码推断（`http.*` = 明确响应；其余 = 不知道）。这是类型契约的真实边界，不假装有值。
    const gotBytes = result.error.code.startsWith('http.')
    const cls = classifyFailure(result.error, { sent, gotResponseBytes: gotBytes })

    // 断路器：只有"确定失败"才计入（★未知态不是下游的错）
    if (breaker && host.length > 0) breaker.onFailure(host, Date.now(), cls.outcome === 'failed')

    // 离线队列（★只在"确定没发出"且允许入队时）
    if (offline && cls.outcome === 'failed' && cls.phase === 'connect-failed' && opts.allowOffline !== false) {
      const entry: OfflineQueueEntry = {
        idempotencyKey: effectiveIdemKey ?? makeIdempotencyKey('offline'),
        url: fullUrl,
        method,
        headers: redactHeaders(headers, redactPolicy), // ★队列里不存原始凭据
        body: bodyStr.length > 0 && bodyStr.length <= 64 * 1024 ? bodyStr : undefined,
        enqueuedAt: Date.now(),
      }
      const enq = await offline.enqueue(entry, method)
      if (enq.queued) {
        emitTrace({
          requestId,
          bizId: tenant?.bizId,
          phase: 'offline-enqueue',
          method,
          url: redactUrl(fullUrl, redactPolicy),
          errorCode: 'offline.enqueued',
        })
      }
    }

    // 重试（★本层的重试只处理"pipeline 重试耗尽但结果仍是 failed"的情形；
    //   unknown 一律不重试——这是支付安全的硬要求）
    if (cls.outcome === 'failed' && attemptsAllowed > 0 && attempts < attemptsAllowed + 1) {
      const decision = shouldRetryResult(result, method, effectiveIdemKey !== undefined, opts.retry ?? retryPolicy, attempts)
      if (decision.retry) {
        const retryAfter = parseRetryAfter(result.ok ? undefined : headerOf(result, 'retry-after'))
        const delay = computeBackoffMs(attempts + 1, opts.retry ?? retryPolicy ?? {}, retryAfter)
        emitTrace({
          requestId,
          bizId: tenant?.bizId,
          phase: 'retry',
          method,
          url: redactUrl(fullUrl, redactPolicy),
          attempt: attempts + 1,
          errorCode: result.error.code,
        })
        await sleep(delay)
        // ★重试复用同一个 requestId 与幂等键（同一次逻辑请求）；attemptNo+1 是**本地**计数
        return execute<T>(url, { ...opts, idempotencyKey: effectiveIdemKey }, attemptNo + 1)
      }
    }

    return finish(cls.outcome, {
      error: {
        code: cls.outcome === 'unknown' ? 'fetch.unknown' : result.error.code,
        message: cls.reason,
      },
      // ★失败分支无 status（契约如此）；不给值 = 不伪造 0
      phase: cls.phase,
      sent,
      pipelineMeta: result.meta,
      idemKey: effectiveIdemKey,
    })
  }

  // ── 对外 API ──────────────────────────────────────────────────

  function request<T = unknown>(url: string, opts: RequestOptions = {}): Promise<RequestResult<T>> {
    totals.requests++
    return execute<T>(url, opts)
  }

  function task<T = unknown>(url: string, opts: RequestOptions = {}): RequestTask<T> {
    totals.requests++
    // ★abort 语义：若请求已发出 ⇒ 结果按 unknown（由 classifyFailure 依据 sent 判定）
    const ctl = createHttpAbort()
    const merged: RequestOptions = { ...opts, signal: ctl.signal }
    const p = execute<T>(url, merged)
    return {
      id: `rt-${(taskSeq = (taskSeq + 1) % 1e9).toString(36)}`,
      result: p,
      state: 'running',
      abort(reason?: string): void {
        ctl.abort(reason ?? 'aborted by caller')
      },
    }
  }

  /**
   * ★★★#1344：离线队列重放的**唯一实现**（手动 `flushOfflineQueue()` 与自动驱动共用）。
   *
   * 【防重入】网络抖动会连发多次"已恢复"事件。若每次都起一轮重放，
   *   同一条队列会被多个并发的 `request()` 同时处理 ⇒ 重复发送
   *   （虽有幂等键兜底，但那是在**服务端**去重；客户端不该制造这种流量）。
   *   ⇒ `flushing` 闸门保证一次只跑一轮；期间来的事件记 `flushPending`，
   *     本轮结束后补跑一次（不丢事件、不并发）。
   */
  async function doFlush(): Promise<{ replayed: number; failed: number; skipped: number }> {
    if (!offline) return { replayed: 0, failed: 0, skipped: 0 }
    if (flushing) {
      flushPending = true
      return { replayed: 0, failed: 0, skipped: 0 }
    }
    flushing = true
    try {
      const entries = await offline.peekAll()
      const done: string[] = []
      let replayed = 0
      let failed = 0
      for (const e of entries) {
        // ★重放必须带原幂等键（服务端据此去重）；已重放太多次的条目视为毒丸 ⇒ 跳过并留在队列
        if ((e.attempts ?? 0) >= 3) continue
        const r = await request(e.url, {
          method: e.method as RequestOptions['method'],
          headers: e.headers,
          data: e.body,
          idempotencyKey: e.idempotencyKey,
          allowOffline: false,
        })
        if (r.ok) {
          done.push(e.idempotencyKey)
          replayed++
        } else {
          failed++
        }
      }
      if (done.length > 0) await offline.remove(done)
      return { replayed, failed, skipped: entries.length - replayed - failed }
    } finally {
      flushing = false
      if (flushPending) {
        flushPending = false
        // ★补跑一次（不 await：调用方可能已经不关心；但事件不能丢）
        void doFlush()
      }
    }
  }

  /**
   * ★★★#1344：**自动重放驱动**（`offlineQueue.autoFlush: true` 才启用）。
   *
   * 【为什么默认关】自动重放会**在后台替业务发请求**（没有用户手势）——
   *   对有副作用的业务（支付/下单）必须由平台显式决定，不能默认替它做。
   * 【为什么不在这里判断"当前是否在线"】`isConnected === true` 只说明"网卡通了"，
   *   不代表目标服务可达（可能还要等 DNS/代理）。此时重放失败也无害：
   *   条目**留在队列**（只有 `r.ok` 才 remove），下一次恢复事件会再试。
   *   ★这比"等一个完美的在线判据"实际得多 —— 完美判据不存在。
   */
  if (offline && options.offlineQueue?.autoFlush === true && options.onNetworkStatusChange) {
    try {
      unsubNet = options.onNetworkStatusChange((st) => {
        if (st.isConnected) void doFlush()
      })
    } catch {
      // 订阅失败 ⇒ 退化为"只能手动 flush"（如实：不假装自动重放已生效）
      unsubNet = undefined
    }
  }

  /**
   * ★取消网络订阅（实例是冻结的，但订阅是**副作用**：页面销毁后必须解掉，
   *   否则回调还在跑、还持有整个 client 的闭包）。
   * ★挂在 client 的 `dispose` 上由调用方调用 —— 与 CapabilityResourceRegistry 同一治理口径。
   */
  function dispose(): void {
    unsubNet?.()
    unsubNet = undefined
    /**
     * ★★★#1403：**必须释放审计定时器**（否则 client 被丢弃后定时器仍在跑 = 泄漏，
     *   且会持续对已销毁的出口写数据）。`dispose` 里会先 flush 一次再停表 ——
     *   不丢已缓冲的条目。
     */
    auditSink?.dispose()
  }

  const client: RequestClient = {
    request,
    task,
    async requestOrThrow<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
      const r = await request<T>(url, opts)
      if (r.ok) return r.data
      const err = new CapError(r.error.code, r.error.message)
      // ★把三态挂到错误上，便于 catch 里判断
      ;(err as unknown as { outcome?: RequestOutcome; meta?: RequestMeta }).outcome = r.outcome
      ;(err as unknown as { meta?: RequestMeta }).meta = r.meta
      throw err
    },
    get: <T = unknown>(url: string, opts?: Omit<RequestOptions, 'method'>) => request<T>(url, { ...opts, method: 'GET' }),
    post: <T = unknown>(url: string, data?: unknown, opts?: Omit<RequestOptions, 'method' | 'data'>) =>
      request<T>(url, { ...opts, method: 'POST', data }),
    put: <T = unknown>(url: string, data?: unknown, opts?: Omit<RequestOptions, 'method' | 'data'>) =>
      request<T>(url, { ...opts, method: 'PUT', data }),
    patch: <T = unknown>(url: string, data?: unknown, opts?: Omit<RequestOptions, 'method' | 'data'>) =>
      request<T>(url, { ...opts, method: 'PATCH', data }),
    delete: <T = unknown>(url: string, opts?: Omit<RequestOptions, 'method'>) => request<T>(url, { ...opts, method: 'DELETE' }),
    stats(): RequestClientStats {
      return {
        bizId: tenant?.bizId,
        inflight: quota.snapshot().global,
        circuit: breaker ? breaker.snapshot().map((c) => ({ host: c.key, state: c.state, failures: c.failures })) : [],
        offlineQueueSize: offline ? offline.size() : 0,
        totals: { ...totals },
        rejectedLocal,
        /**
         * ★★★#1403：平台化三件的读数（诊断用，**不含请求内容**）。
         * ★`sharedQuotaKey` 回显是刻意的：它是"这份额度是全局的还是本实例的"的**唯一线索**。
         *   不显示的话，运维无法判断"为什么全局上限没生效"。
         */
        sharedQuotaKey: sharedKey ?? null,
        rateLimit: limiter.snapshot(),
        audit: auditSink ? auditSink.snapshot() : null,
      }
    },
    async flushOfflineQueue(): Promise<{ replayed: number; failed: number; skipped: number }> {
      return doFlush()
    },
    dispose,
  }

  return Object.freeze(client)
}

/* ══════════════════════ 小工具 ══════════════════════ */

let requestSeq = 0
let taskSeq = 0

function hostOfSafe(url: string): string {
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(url)
  if (!m) return ''
  let h = m[1]
  const at = h.lastIndexOf('@')
  if (at >= 0) h = h.slice(at + 1)
  const colon = h.indexOf(':')
  if (colon >= 0 && !h.startsWith('[')) h = h.slice(0, colon)
  return h.toLowerCase()
}

function isIdempotentSafe(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'].includes(method.toUpperCase())
}

function headerOf(res: FetchResult<unknown>, name: string): string | undefined {
  if (!res.ok) return undefined
  const n = name.toLowerCase()
  for (const [k, v] of Object.entries(res.headers)) if (k.toLowerCase() === n) return v
  return undefined
}

/**
 * ★取消信号 → 一个 reject 的 Promise（用于 `Promise.race`）。
 *   · signal 已 abort ⇒ 立刻 reject
 *   · signal 未 abort ⇒ 挂 `onabort` / `addEventListener`，abort 时 reject
 *   · 没有 signal ⇒ 返回 `undefined`（不参与 race，零开销）
 *
 * ★★★类型说明：pipeline 的 `AbortSignalLike` 只声明了**只读** `aborted`，但运行时
 *   两边都可能提供可写的 `onabort`（本库自己的 `createHttpAbort` 就提供，pipeline 的
 *   合并信号也支持赋值——见 `capability-invoke.ts` 的注释）。
 *   ⇒ 这里用**局部结构化类型**读取这两个可选成员，而不是去改 pipeline 的公共契约
 *     （改公共类型会影响三端与判据，且"只读 aborted"本身是对的：业务不该改它）。
 */
function waitAbort(signal: RequestOptions['signal'] | undefined): Promise<never> | undefined {
  if (!signal) return undefined
  const writable = signal as unknown as {
    onabort?: ((r?: string) => void) | null
    addEventListener?: (t: 'abort', f: () => void) => void
  }
  return new Promise<never>((_resolve, reject) => {
    const fail = (reason?: string): void => reject(new CapError('fetch.aborted', reason ?? 'aborted'))
    if (signal.aborted === true) {
      fail()
      return
    }
    try {
      writable.onabort = (r?: string) => fail(r)
    } catch {
      /* 只读属性 */
    }
    if (typeof writable.addEventListener === 'function') {
      try {
        writable.addEventListener('abort', () => fail())
      } catch {
        /* 忽略 */
      }
    }
  })
}

/** 可注入的 sleep（无 `setTimeout` 的 App 精简引擎 ⇒ 立即返回） */
function sleep(ms: number): Promise<void> {
  const st = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout
  if (typeof st !== 'function' || ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    st(() => resolve(), ms)
  })
}

/**
 * 最小 AbortController 形状（★不假设宿主有 `AbortController`；App 精简引擎未必有）。
 * 与 pipeline 的 `AbortSignalLike` 兼容：同时提供 `onabort` 与 `addEventListener`。
 */
function createHttpAbort(): { signal: { aborted: boolean; onabort: ((r?: string) => void) | null; addEventListener: (t: 'abort', f: () => void) => void }; abort: (reason?: string) => void } {
  const listeners: Array<() => void> = []
  const signal = {
    aborted: false,
    onabort: null as ((r?: string) => void) | null,
    addEventListener(_t: 'abort', f: () => void): void {
      listeners.push(f)
    },
  }
  return {
    signal,
    abort(reason?: string): void {
      if (signal.aborted) return
      signal.aborted = true
      try {
        signal.onabort?.(reason)
      } catch {
        /* 调用方回调抛错不影响取消 */
      }
      for (const f of listeners) {
        try {
          f()
        } catch {
          /* 同上 */
        }
      }
    },
  }
}

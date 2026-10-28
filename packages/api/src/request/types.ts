// packages/api/src/request/types.ts
// ★★★#1342 请求库对外契约（`createRequestClient` 的配置与结果类型）。
//
// 【本文件只放「门面层」类型——不放线格式字段】
//   `FetchConfig`（capability-fetch-types.ts）是**四层链的唯一契约**（门面 → 桥参数 → App args → 线格式）。
//   本库的策略字段（baseURL / bizId / 幂等 / 熔断 / 脱敏 / 租户）**一律不写进 `FetchConfig`**，
//   否则会污染那条四层白名单（`docs/contract-index.md:190-202`，`tests/fetch-wire-fields.test.ts` 会红）。
//   ⇒ 这里的类型只活在**门面 → pipeline** 这一段，不下传宿主。
import type { FetchConfig, FetchMeta, FetchResult } from '../capability-fetch-types'
import type { CapabilityHooks } from '../capability'
import type { AuthManager } from '../auth'

/* ══════════════════════ 超时（三层显式） ══════════════════════ */

/**
 * ★★★痛点 #6：主流库的 `timeout` 语义模糊（是连接？空闲？整个？）。
 *   本库要求**三层分开**，因为它们的处置完全不同：
 *   · `connect` 超时 ⇒ 请求**肯定没发出去** ⇒ 可安全重试（幂等）
 *   · `idle` 超时 ⇒ 连接在但对方不回 ⇒ **可能已到达** ⇒ 非幂等请求必须按"未知"处理
 *   · `deadline` ⇒ 从入队起算的总预算（含排队/重试/重定向），到点即失败 `fetch.deadline`
 */
export interface RequestTimeoutPolicy {
  /** 建连超时（ms）。不传 ⇒ 由传输层默认值决定 */
  connect?: number
  /** 空闲超时（ms）：多久没收到任何字节算超时。映射到 `FetchConfig.timeout` */
  idle?: number
  /** 总预算（ms）：从入队起算，跨排队/重试/重定向。映射到 `FetchConfig.deadline` */
  deadline?: number
}

/* ══════════════════════ 可靠性 ══════════════════════ */

/**
 * 重试策略（门面层默认值；单请求可覆盖）。
 * ★与 pipeline 的 `RetryPolicy` 不同点：
 *   · `respectRetryAfter`：读服务端 `Retry-After`（pipeline 现在**完全不解析**）
 *   · `retryNonIdempotent`：默认 **false** —— 非幂等请求（POST/PATCH）**默认不重试**。
 *     这是对痛点 #1 的正面回答：主流库一开 retry 就把下单请求重发。
 */
export interface RequestRetryPolicy {
  /** 额外重试次数（不含首次）。默认 0 = 不重试 */
  attempts?: number
  /** 退避曲线。默认 exponential */
  backoff?: 'fixed' | 'linear' | 'exponential'
  /** 基础延迟（ms）。默认 300 */
  delayMs?: number
  /** 抖动比例 0~1。默认 0.2。★实现用真随机（见 reliability.ts 的说明） */
  jitter?: number
  /**
   * ★服务端可覆盖：响应带 `Retry-After` 时用它代替退避计算。
   * 默认 true（这是对"服务端叫你等多久就等多久"的正确尊重）。
   */
  respectRetryAfter?: boolean
  /**
   * ★是否允许重试**非幂等**请求。默认 **false**。
   * 打开后仍要求：要么有 `idempotencyKey`，要么显式承认"该请求可安全重发"。
   * ★这条默认值是本库对支付安全的核心保护之一。
   */
  retryNonIdempotent?: boolean
}

/** 幂等策略 */
export type IdempotencyMode =
  /** 默认：非幂等方法（POST/PATCH）在**有 key** 时才允许重试；无 key 则不重试 */
  | 'auto'
  /** 强制所有请求都带幂等键（服务端必须支持 `Idempotency-Key`） */
  | 'required'
  /** 完全关闭（业务自行保证） */
  | 'off'

/**
 * 断路器配置。
 * ★痛点 #4：主流库没有断路器 ⇒ 下游挂了还持续打，雪崩。
 *   状态机：closed →（连续失败 ≥ threshold）→ open →（等 cooldownMs）→ halfOpen
 *           →（探测成功）closed /（探测失败）open
 */
export interface CircuitBreakerPolicy {
  /** 连续失败多少次打开。默认 5 */
  threshold?: number
  /** 打开后多久进入半开探测（ms）。默认 30_000 */
  cooldownMs?: number
  /** 半开状态允许几个探测请求。默认 1 */
  halfOpenProbes?: number
}

/**
 * 离线队列配置。
 * ★痛点 #5：主流库断网即失败。本库把"可安全重放"的请求入持久队列，恢复后按序重放。
 *
 * ★只允许**幂等**请求入队（有 `idempotencyKey` 或方法本身幂等）——
 *   把非幂等请求入队的唯一结果就是网络恢复后重复下单。
 */
export interface OfflineQueuePolicy {
  /** 是否启用。默认 false（需显式注入 store 才可能开启） */
  enabled?: boolean
  /**
   * 重放顺序。默认 `'fifo'`（同 key 内保证顺序）。
   * ★不同 key 之间不保证全局顺序（那需要全局串行，会把吞吐打死）。
   */
  order?: 'fifo'
  /** 队列容量上限（条）。默认 100；超限**丢最旧并计数**（不静默） */
  maxEntries?: number
}

/* ══════════════════════ 安全 ══════════════════════ */

/**
 * 请求签名配置。
 * ★痛点 #14：主流库无签名/防重放。本库由 client **统一注入**——业务既写不到也绕不过。
 *
 * 【为什么放在 client 而不是拦截器】拦截器是业务的扩展点，业务可以不加；
 *   而签名/防重放是**平台合规要求**，必须由平台强制。
 */
export interface RequestSigningPolicy {
  /**
   * 计算签名。输入是被签名的规范化字符串，输出签名值。
   * ★返回值会写进 `signatureHeader`（默认 `X-Proteus-Signature`）。
   * ★实现方负责密钥管理——本库**不持有密钥**（那属于宿主/安全模块）。
   */
  sign: (canonical: string) => string | Promise<string>
  /** 签名头名。默认 `X-Proteus-Signature` */
  signatureHeader?: string
  /** 参与签名的头（按名字排序后拼接，保证服务端可复算）。默认 `['x-proteus-timestamp', 'x-proteus-nonce']` */
  signedHeaders?: string[]
}

/** 防重放配置 */
export interface AntiReplayPolicy {
  /** 是否启用（需同时配 `signing`，否则只是加了两个无签名保护的头——无意义） */
  enabled?: boolean
  /** 时间戳头名。默认 `X-Proteus-Timestamp` */
  timestampHeader?: string
  /** 随机串头名。默认 `X-Proteus-Nonce` */
  nonceHeader?: string
}

/**
 * 脱敏配置。
 * ★痛点 #12：主流库把 header 原样交给日志/trace。本库在**通道层**脱敏（不是调用方自觉）。
 */
export interface RedactPolicy {
  /** 要脱敏的 header 名（大小写不敏感）。默认见 DEFAULT_REDACT_HEADERS */
  headers?: string[]
  /** 要脱敏的 body 字段名（递归匹配，大小写不敏感）。默认见 DEFAULT_REDACT_FIELDS */
  fields?: string[]
  /** 替换成什么。默认 `***` */
  mask?: string
}

/* ══════════════════════ 多业务隔离 ══════════════════════ */

/**
 * 租户（业务）隔离配置。
 * ★痛点 #17/#18：主流库没有"业务"概念。本库让 bizId 成为一等轴：
 *   独立域名白名单 · 独立并发配额 · 独立审计。
 */
export interface TenantPolicy {
  /** 业务标识（审计与配额的维度）。必填 */
  bizId: string
  /**
   * 域名白名单。给定时，**非白名单域一律拒绝**（`request.forbidden`），不发出去。
   * ★这是合规评审第一个会问的问题："这个业务能访问哪些域？"
   * ★支持 `*.example.com` 通配一级（只允许前缀通配，不支持正则——避免白名单被写成任意匹配）。
   */
  allowedDomains?: string[]
  /** 该业务的并发上限（覆盖全局）。不传 ⇒ 用全局值 */
  concurrency?: number
  /** 审计回调（每个请求一条，载荷已脱敏） */
  onAudit?: (entry: RequestAuditEntry) => void
}

/** 一条审计记录（★已脱敏：不含 header 原值、不含 body） */
export interface RequestAuditEntry {
  /** 请求 id（与 `FetchMeta.id` 同源，用于和 trace 对齐） */
  id: string
  bizId: string
  url: string
  /** 只保留 host（路径可能带敏感 id，默认不记全路径） */
  host: string
  method: string
  /** 结果。`unknown` 见 `RequestOutcome` */
  outcome: RequestOutcome
  status?: number
  durationMs: number
  attempts: number
  /** 失败时的错误码（不含 message，避免泄漏服务端细节） */
  errorCode?: string
  /** 是否命中缓存 */
  cacheHit?: boolean
  at: number
}

/* ══════════════════════ 结果（★含未知态） ══════════════════════ */

/**
 * ★★★痛点 #7（本库最核心的差异化）：一次请求的**三种结局**，不是两种。
 *
 *   · `success`  —— 拿到响应且 HTTP 成功
 *   · `failed`   —— **确定**失败，且**确定没被服务端处理**（如建连失败、被白名单拒绝、
 *                   被断路器拒绝、4xx/5xx 明确响应）
 *   · `unknown`  —— **可能已被服务端处理，但我们不知道结果**（空闲超时、连接中途断开、
 *                   响应读到一半失败、取消时请求已发出）
 *
 * 【为什么必须区分 `failed` 与 `unknown`】
 *   支付/下单场景里，`failed` 可以安全重试或直接报错；而 `unknown` **绝不能重试**
 *   （会重复扣款），唯一正确处置是**去查单**。
 *   主流库把这两种都压成 `timeout`/`network error`，于是业务只能猜。
 */
export type RequestOutcome = 'success' | 'failed' | 'unknown'

/**
 * 一次请求的判定依据（为什么是 success/failed/unknown）。
 * 业务排查时看这个字段，不用再猜"到底是没发出去还是发出去了"。
 */
export type RequestPhase =
  /** 被本地策略拒绝（白名单/断路器/未授权），**一定没发出** */
  | 'rejected-local'
  /** 请求已构造但传输层报告建连失败，**一定没发出** */
  | 'connect-failed'
  /** 请求已发出，且收到了完整的失败响应（4xx/5xx） */
  | 'responded'
  /** 请求已发出，但读响应时中断/超时 —— **结果未知** */
  | 'response-incomplete'
  /** 在飞时被 abort，且已确认请求发出过 —— **结果未知** */
  | 'aborted-after-sent'
  /** 传输层无法判定是否发出（不猜） —— **按未知处理** */
  | 'indeterminate'

/** 请求库结果（成功/失败/未知三态；`FetchResult` 的增强，不是替代） */
export type RequestResult<T> =
  | {
      ok: true
      outcome: 'success'
      data: T
      status: number
      headers: Record<string, string>
      /** ★统一 meta（含 `requestId`、`bizId`、`outcome`、`phase`、attempts、transport 等） */
      meta: RequestMeta
    }
  | {
      ok: false
      outcome: 'failed' | 'unknown'
      /** 错误码。`unknown` 时固定 `fetch.unknown`；`failed` 时沿用 pipeline 的错误码 */
      error: { code: string; message: string }
      status?: number
      meta: RequestMeta
    }

/** 请求元数据（门面层 + pipeline 观测的合并视图） */
export interface RequestMeta {
  /** 请求 id（与审计/trace 对齐） */
  requestId: string
  bizId?: string
  outcome: RequestOutcome
  phase: RequestPhase
  /** 是否已确认"请求发出过"（★`unknown` 判定的关键依据） */
  sent: boolean
  attempts: number
  durationMs: number
  /** 排队等待（ms） */
  queuedMs?: number
  /** 命中缓存 */
  cacheHit?: boolean
  /** 幂等键（**回显给业务**，便于对账时按 key 查单） */
  idempotencyKey?: string
  /** 底层 pipeline 的完整观测（原样透出，不裁剪） */
  pipeline?: FetchMeta
}

/* ══════════════════════ 客户端配置 ══════════════════════ */

/**
 * 请求客户端配置（★平台方一次性配置；实例创建后**不可变**——见 `client.ts` 的说明）。
 *
 * 【为什么不可变】`axios.defaults.headers.common['Authorization'] = token`
 *   之所以危险，是因为它允许**任意代码**在任何时刻改全局默认值，绕过托管层。
 *   本库的实例是冻结的：要换 token 走 `auth`，要换配置新建实例。
 */
export interface RequestClientOptions {
  /**
   * ★底座：必须是既有的能力 Hook 实例（内部只调 `useFetch`/`useFetchTask`）。
   *   本库**不自己实现传输**——那是 `capability-fetch-pipeline` 的职责（G-54.1 内核唯一）。
   *   不传 ⇒ 用 `createCapabilityHooks()` 的默认共享桥实例。
   */
  hooks?: CapabilityHooks
  /** 基础地址。★只在门面层拼接，不进 `FetchConfig` */
  baseURL?: string
  /** 默认头（每请求可覆盖） */
  headers?: Record<string, string>
  /** 默认超时（三层显式） */
  timeout?: RequestTimeoutPolicy | number
  /** 默认重试策略 */
  retry?: RequestRetryPolicy
  /** 幂等策略。默认 `'auto'` */
  idempotency?: IdempotencyMode
  /** 断路器。不传 ⇒ 不启用 */
  circuitBreaker?: CircuitBreakerPolicy | false
  /** 离线队列。不传 ⇒ 不启用 */
  offlineQueue?: OfflineQueuePolicy & {
    /** 持久化后端（注入式；不传则只内存排队） */
    store?: OfflineQueueStore
  }
  /** 凭证托管。不传 ⇒ 不注入 `Authorization` */
  auth?: AuthManager
  /** 签名（平台强制） */
  signing?: RequestSigningPolicy
  /** 防重放（需与 `signing` 同时给才生效） */
  antiReplay?: AntiReplayPolicy
  /** 脱敏。不传 ⇒ 用默认黑名单（`Authorization`/`Cookie`/`Set-Cookie` 等） */
  redact?: RedactPolicy
  /** 租户隔离 */
  tenant?: TenantPolicy
  /** trace 回调（每次请求一条；载荷已脱敏） */
  trace?: (event: RequestTraceEvent) => void
}

/** 离线队列持久化后端（★注入式：不假设 `getStorage` 存在——鸿蒙就没有 `fs.*`） */
export interface OfflineQueueStore {
  /** 读出全部待重放条目 */
  load(): Promise<OfflineQueueEntry[]>
  /** 整体覆盖写（★简单但可靠；条目数有上限 `maxEntries`，不会无限增长） */
  save(entries: OfflineQueueEntry[]): Promise<void>
}

/** 离线队列里的一条（★存的是"重放所需的完整信息"，不是 fetch 配置） */
export interface OfflineQueueEntry {
  /** 幂等键（重放时原样带回去，保证服务端能去重） */
  idempotencyKey: string
  url: string
  method: string
  headers?: Record<string, string>
  /** 请求体（已序列化的字符串；★不存二进制大体——那会让队列无限大） */
  body?: string
  /** 入队时间 */
  enqueuedAt: number
  /** 已重放次数（防止毒丸条目无限重试） */
  attempts?: number
}

/** trace 事件（脱敏后） */
export interface RequestTraceEvent {
  requestId: string
  bizId?: string
  phase: 'start' | 'end' | 'error' | 'retry' | 'offline-enqueue' | 'offline-replay'
  method: string
  /** ★已脱敏的 URL（query 里的敏感字段被替换） */
  url: string
  outcome?: RequestOutcome
  status?: number
  durationMs?: number
  attempt?: number
  errorCode?: string
}

/** 单请求可在门面层覆盖的字段（**不含** `FetchConfig` 的线格式字段那部分） */
export interface RequestOptions<T = unknown> extends Omit<FetchConfig, 'retry' | 'timeout' | 'deadline'> {
  /** 门面层重试覆盖 */
  retry?: RequestRetryPolicy
  /** 门面层超时覆盖 */
  timeout?: RequestTimeoutPolicy | number
  /** 幂等键（★业务给出的值会被**原样**用于所有重试） */
  idempotencyKey?: string
  /** 跳过鉴权头注入（登录/刷新 token 自身用） */
  skipAuth?: boolean
  /** 跳过域名白名单（**仅供平台内部**，业务不该用） */
  skipTenantCheck?: boolean
  /** 允许入离线队列（默认按幂等性自动判定） */
  allowOffline?: boolean
  /** 调用方标记（进审计，便于定位是哪个业务方发的） */
  caller?: string
}

/** 客户端实例（对外唯一门面） */
export interface RequestClient {
  /** 核心请求（结果永不抛；三态见 `RequestResult`） */
  request<T = unknown>(url: string, options?: RequestOptions): Promise<RequestResult<T>>
  /** 需要一个**会抛**的便捷入口时用它（显式选择，不是默认） */
  requestOrThrow<T = unknown>(url: string, options?: RequestOptions): Promise<T>
  /** 任务句柄（可 abort；`result` 同样永不抛） */
  task<T = unknown>(url: string, options?: RequestOptions): RequestTask<T>
  get<T = unknown>(url: string, options?: Omit<RequestOptions, 'method'>): Promise<RequestResult<T>>
  post<T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>): Promise<RequestResult<T>>
  put<T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>): Promise<RequestResult<T>>
  patch<T = unknown>(url: string, data?: unknown, options?: Omit<RequestOptions, 'method' | 'data'>): Promise<RequestResult<T>>
  delete<T = unknown>(url: string, options?: Omit<RequestOptions, 'method'>): Promise<RequestResult<T>>
  /** 只读快照（诊断用；不含 token/载荷） */
  stats(): RequestClientStats
  /** 离线队列：手动触发重放（网络恢复事件也可由平台调用） */
  flushOfflineQueue(): Promise<{ replayed: number; failed: number; skipped: number }>
}

/** 任务句柄（★与 `FetchTask` 同形状，但 `result` 是三态结果） */
export interface RequestTask<T> {
  readonly id: string
  readonly result: Promise<RequestResult<T>>
  readonly state: 'queued' | 'running' | 'done'
  /** 取消：★若请求已发出，结果是 `unknown`（不是 `failed`）——见 `aborted-after-sent` */
  abort(reason?: string): void
}

/** 诊断读数（★不含请求内容，只含计数） */
export interface RequestClientStats {
  bizId?: string
  /** 在飞数（含排队） */
  inflight: number
  /** 断路器状态（按 host） */
  circuit: Array<{ host: string; state: 'closed' | 'open' | 'halfOpen'; failures: number }>
  /** 离线队列深度 */
  offlineQueueSize: number
  /** 累计请求/成功/失败/未知 */
  totals: { requests: number; success: number; failed: number; unknown: number }
  /** 因本地策略被拒绝的次数（白名单/断路器/未授权） */
  rejectedLocal: number
}

/* ══════════════════════ 内部：需要用到 pipeline 类型的地方 ══════════════════════ */

/** 重新导出，便于业务在只引本库时也能拿到这两个契约（不改语义） */
export type { FetchConfig, FetchResult }

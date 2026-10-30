// packages/api/src/request/index.ts
// ★★★#1342 请求库对外导出面。
//
// 【本库的定位（一句话）】
//   不做"又一个 axios"，做**平台方的请求治理层**：让一个 App 里几十个业务团队
//   共用一套网络，还管得住（域名白名单 · 每业务配额 · 调用审计 · 未知态 · 幂等）。
//
// 【与既有三套入口的关系（重要——这不是第四套并行栈）】
//   · 底座 = `useFetch` / `useFetchTask` / `createFetchPipeline`（**不重写传输与 HTTP 语义**）
//   · 本库只做 pipeline 做不到的事：三态归一（含 `unknown`）· 租户隔离 · 离线队列 ·
//     签名/防重放/脱敏 · 审计 · 幂等键稳定性
//   · `createApi` / `createRequestEngineering` 保留 API 但内部委托本库（见 C2 阶段）
//
// 【契约约束（违反即破坏四层链）】
//   本库的策略字段（`baseURL` / `bizId` / 幂等 / 熔断 / 脱敏 / 租户）**一律不写进 `FetchConfig`**，
//   因此不会污染「门面 → 桥参数 → App args → 线格式」那条四层白名单
//   （`docs/contract-index.md:190-202`，`tests/fetch-wire-fields.test.ts` 守着）。

export { createRequestClient, joinUrl } from './client'

export {
  // 可靠性内核
  CircuitBreaker,
  OfflineQueue,
  canRetry,
  classifyFailure,
  classifySuccess,
  computeBackoffMs,
  isIdempotentMethod,
  makeIdempotencyKey,
  parseRetryAfter,
  resolveIdempotencyKey,
  shouldRetryResult,
} from './reliability'

export type { CircuitState, CircuitView, OfflineQueueOptions } from './reliability'

export {
  // 安全通道
  DEFAULT_REDACT_FIELDS,
  DEFAULT_REDACT_HEADERS,
  bearerHeader,
  buildCanonicalString,
  hasHeader,
  makeAntiReplayHeaders,
  normalizeRedact,
  redactBody,
  redactHeaders,
  redactUrl,
  signRequest,
} from './security'

export {
  // 多业务隔离
  ConcurrencyGate,
  QuotaTree,
  createTenantContext,
  hostOf,
  isHostAllowed,
  makeAuditEntry,
  redactAuditUrl,
} from './tenant'

export type { TenantContext } from './tenant'

export { createMutation, createQuery } from './query'

export type { MutationHandle, MutationOptions, QueryHandle, QueryOptions, QueryReactivity, QueryState } from './query'

export type {
  AntiReplayPolicy,
  CircuitBreakerPolicy,
  IdempotencyMode,
  OfflineQueueEntry,
  OfflineQueuePolicy,
  OfflineQueueStore,
  RedactPolicy,
  RequestAuditEntry,
  RequestClient,
  RequestClientOptions,
  RequestClientStats,
  RequestMeta,
  RequestOptions,
  RequestOutcome,
  RequestPhase,
  RequestResult,
  RequestRetryPolicy,
  RequestSigningPolicy,
  RequestTask,
  RequestTimeoutPolicy,
  RequestInterceptorLike,
  ResponseInterceptorLike,
  RequestTraceEvent,
  TenantPolicy,
} from './types'

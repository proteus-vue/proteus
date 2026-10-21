// packages/api/src/capability-fetch-types.ts
// ★★★#1122：**useFetch 的类型面**（从 `capability-types.ts` 抽出）。
//
// 【为什么单列】`capability-types.ts` 已 3881 行（`check:file-size` 存量棘轮只减不增）。
//   `FetchConfig` / `FetchResult` / `FetchOk` 是**网络能力专属**的一组类型（它们描述的是
//   `bridge.request` 的入参与出参），与「设备/媒体/支付/存储」那些能力类型没有耦合 ⇒
//   抽出来既让主文件回落，也把"网络请求的契约"集中到一处。
//
// 【★#1122 要解决的问题】此前 `FetchConfig` 只有 6 个字段，而底层 S3 能力
//   （`responseType` / `savePath` / `onChunk` / `upload` / `signal`）**全都没暴露** ⇒
//   业务侧根本够不着。本文件把它们全部开放，并如实标注端差异。
//
// 【★#1133 新增】超级应用级请求治理的**策略字段**（`retry` / `priority`）与**观测字段**（`FetchMeta`）。
//   它们与传输层无关（三端同一份语义），落在 TS 管线（`capability-fetch-pipeline.ts`）。

import type { HttpMethod } from '@proteus-vue/types/api-types'
import type { CapError } from './capability-types'
import type { RedirectDecision, RedirectHop, RedirectTrace } from './capability-fetch-redirect'
import type { FetchCacheMeta, FetchCacheMode } from './capability-fetch-cache'

/** 重试策略（与 `capability-fetch-pipeline.ts` 的 `RetryPolicy` 同构）。 */
export interface RetryPolicy {
  /** 额外重试次数（默认 0 = 不重试） */
  attempts?: number
  /** 首次退避（ms，默认 300） */
  delayMs?: number
  /** 退避曲线（默认 `exponential`） */
  backoff?: 'fixed' | 'linear' | 'exponential'
  /** 抖动比例 0~1（默认 0.2；避免重试风暴同步打点） */
  jitter?: number
  /** 判定是否重试（默认：网络类失败 + 429/5xx；**不重试** aborted/unsupported/tooLarge/intercepted） */
  retryOn?: (res: FetchResult<unknown>, attempt: number) => boolean
}

/**
 * useFetch 配置。★#1122：S3 能力（流式/落盘/上传/取消）此前底层做完但**门面没开口**——现已全部开放。
 */
export interface FetchConfig {
  /** HTTP 方法（缺省 GET） */
  method?: HttpMethod
  /** 请求体（POST/PUT；对象自动 JSON 序列化） */
  data?: unknown
  /** URL 查询参数（拼接到 query string） */
  params?: Record<string, unknown>
  /** 自定义请求头 */
  headers?: Record<string, string>
  /** 超时（ms；超时 → Err）。★单轮语义：重试时每轮各自计时 */
  timeout?: number
  /**
   * ★★★#1135 **总时限**（ms）：从**入队**起算的墙钟预算，跨排队/重试退避/重定向多跳。
   *
   * 【与 `timeout` 的区别（这是超级应用最常踩的坑）】
   *   · `timeout` 是**单轮**语义：重试 3 次 × 15s ⇒ 最坏 ~60s；多跳重定向同理；
   *   · `deadline` 是**总预算**：排队、退避、每一跳都计入，耗尽 ⇒ `fetch.deadline`。
   * ⇒ 业务要"20s 内给我结果"时必须用 `deadline`，`timeout: 20000` 表达不了这个意思。
   *
   * ★超预算时框架会把**单轮 timeout 收敛到剩余预算**（不会让某一次尝试突破总时限）。
   * ★`fetch.deadline` 与 `fetch.timeout` 分开：前者"整体没时间了"，后者"这一轮等太久"。
   */
  deadline?: number
  /** ★#1122 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节）。端差异：wx 给 `ArrayBuffer`。 */
  responseType?: 'text' | 'json' | 'arraybuffer'
  /** ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径，内存与文件大小无关。Web/MP ⇒ unsupported。 */
  savePath?: string
  /**
   * ★#1122 流式消费：每块回调一次，内存不随响应体增长。**回调同步**（宿主回推的 JS 线程上）。
   * App 逐块回推；Web 用 ReadableStream（节奏不同）；**MP 不支持** ⇒ unsupported。
   */
  onChunk?: (chunk: Uint8Array, seq: number) => void
  /** ★#1122 流式上传（仅 App）：宿主自读文件、自拼 multipart、边读边发。Web/MP 用各自上传 API ⇒ unsupported。 */
  upload?: UploadSpec
  /**
   * ★#1122 取消：`abort()` ⇒ 立即 `fetch.aborted`，并尽力通知宿主中止传输。
   * App 用 `createAbortController()`（引擎无原生 AbortController）；Web 用原生 `AbortSignal`；**MP 不支持**。
   */
  signal?: AbortSignalLike
  /**
   * ★#1133 重试：数字 = 额外次数；对象 = 覆盖管线默认策略。
   * ★只对**可恢复**失败生效（网络错误 / 超时 / 429 / 5xx）——取消与能力缺失不重试。
   */
  retry?: number | RetryPolicy
  /** ★#1133 排队优先级（越大越先发；默认 0）。并发打满时用于"首屏关键请求优先"。 */
  priority?: number
  /**
   * ★#1134 重定向策略：
   *   · `follow`（默认）= 平台跟随（老行为，宿主自己跟）；
   *   · `manual` = **不跟随**，3xx 原样返回（`status` + `headers.location` 可直接读）；
   *   · `error` = 遇到 3xx 直接失败（`fetch.redirectForbidden`）。
   * ★给出 `onRedirect` 时会**自动**走逐跳拦截（无需显式写本字段）。
   * ★MP 端不支持 `manual`/`error`/`onRedirect` ⇒ `fetch.unsupported`（`wx.request` 无此能力）。
   */
  redirect?: 'follow' | 'manual' | 'error'
  /**
   * ★#1134 最多跟随几跳（默认 5）。超过 ⇒ `fetch.tooManyRedirects`（真实错误）。
   * ★只在 `manual` / `onRedirect`（即框架层在跟）时生效。
   */
  maxRedirects?: number
  /**
   * ★#1134 **逐跳拦截**：每遇到一次重定向调一次；返回 `{action:'stop'}` 可拒绝。
   *
   * 【为什么这是超级应用必须的】重定向是**框架看不见的跳转**：API 302 到第三方域时，
   *   宿主会把 `Authorization` 带过去（open-redirect 凭据泄露）。有了本回调，业务能看见每一跳
   *   并决定跟不跟；**跨域时框架还会自动剥离凭据头**（不经业务决策，安全底线）。
   *
   * ★回调里 `hop.from/to/status/methodChanged` 都是可记录的审计信息。
   */
  onRedirect?: (hop: RedirectHop) => RedirectDecision | Promise<RedirectDecision>
  /**
   * ★#1134 **宿主级**开关（一般不直接用）：true ⇒ 宿主不跟随（见线格式 `Redirect` tag）。
   * ★由管线在 `redirect:manual` / 有 `onRedirect` 时自动置位；业务手写无副作用（语义一致）。
   */
  redirectManual?: boolean
  /**
   * ★★★#1149 **HTTP 缓存模式**（对齐浏览器 `Request.cache` 的六个标准值）。
   *
   * 【为什么必须有】App 端的字节腿是**裸 HTTP**——Android `HttpURLConnection` 不启用 `ResponseCache`、
   *   鸿蒙 RCP 亦不做条件缓存；而浏览器/小程序会自动做。⇒ 不显式给业务这个旋钮，
   *   同一份源码在三端就会"Web 命中 304、App 每次整包回源"。
   *
   * · `default`（管线开启缓存时的默认）= 新鲜则直用，过期则带 `If-None-Match`/`If-Modified-Since` 回源；
   * · `no-store` = 不读也不写缓存；
   * · `reload` = 忽略缓存、强制回源（并刷新缓存）；
   * · `no-cache` = 跳过"新鲜直用"，但仍带校验器回源（304 则复用）；
   * · `force-cache` = 有缓存就用（即使过期），没有才回源；
   * · `only-if-cached` = 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**）。
   *
   * ★只对 GET 的 200/203 生效；流式/落盘/上传不缓存。
   * ★不写它时：管线未开缓存 ⇒ 行为与从前完全一致（零回归）；管线开了 ⇒ 用管线默认模式。
   */
  cache?: FetchCacheMode
  /**
   * ★#1149 **内部字段**（一般不写）：让 Web 腿把浏览器自带的 HTTP 缓存让开，
   * 使缓存语义在本框架层成为唯一来源（否则"浏览器命中"与"我们命中"两套计数/语义会漂移）。
   */
  bypassPlatformCache?: boolean
}

/** ★#1122：流式上传规格（宿主据此自读文件 + 自拼 multipart）。 */
export interface UploadSpec {
  /** 沙箱相对路径（与 `fs.readBytes` 同一套校验：拒绝绝对路径与 `..`） */
  path: string
  /** multipart 字段名（如 `file`） */
  fieldName: string
  /** 上传文件名（进 `Content-Disposition` 的 filename） */
  filename: string
  /** multipart 边界串——**必须与 `Content-Type` 头里的一致** */
  boundary: string
  /** 普通表单字段（按插入序编码） */
  formData?: Record<string, string>
}

/**
 * 最小取消信号契约（兼容原生 `AbortSignal` 与 `createAbortController()` 的产物）。
 * ★只要求 `aborted` 可读 ⇒ 浏览器原生 `AbortSignal` 与 App 侧 `createAbortController().signal`
 *   都能直接传入 `useFetch(url, { signal })`，无需适配层。
 */
export interface AbortSignalLike {
  /** 是否已取消。`useFetch` 在请求期间读它；取消后 Promise 以 `fetch.aborted` 结束。 */
  readonly aborted: boolean
}

/**
 * ★#1133：单次请求的**观测元数据**（超级应用排障的底座）。
 *
 * 【为什么必须有】没有它就只能得到"成功/失败"，无法回答"慢在排队、慢在网络、还是慢在重试"。
 * 这些数字**全部在框架层可得**（不依赖宿主），所以三端语义一致。
 */
export interface FetchMeta {
  /** 请求 id（与 `FetchTask.id` 一致；日志/埋点用它串起来） */
  id: string
  /** 实际发出的轮次（含首次；1 = 没重试） */
  attempts: number
  /** 在并发队列里等待的时间（ms）——**慢在排队**还是慢在网络，看这个 */
  queuedMs: number
  /** 从入队到结算的总墙钟（ms） */
  totalMs: number
  /** 每轮耗时（ms；下标 = 轮次） */
  attemptMs: number[]
  /** 是否命中去重（本次没真发请求，用的是别人在飞的结果） */
  deduped: boolean
  /** 排队优先级（观测用） */
  priority: number
  /** ★App 精简引擎无 `setTimeout` ⇒ 重试未等待（如实标记，不谎称退避过） */
  retryDelaySkipped?: boolean
  /** ★#1134：重定向轨迹（仅在发生过跳转/被拦截/超限时出现）。`hops` 是逐跳审计记录。 */
  redirects?: RedirectTrace
  /** ★#1135：本次请求的总时限预算（ms；未设置则不出现）。 */
  deadlineMs?: number
  /** ★#1135：是否因总时限耗尽而失败（`fetch.deadline`）。 */
  deadlineHit?: boolean
  /**
   * ★★★#1149：本次请求的缓存结局（未启用缓存时不出现）。
   * `hit` 直接命中新鲜缓存（**没有发网络请求**）/ `revalidated` 304 复用 /
   * `miss` 回源 / `bypass` 不适用（非 GET、流式等，或 `no-store`）。
   */
  cache?: FetchCacheMeta
}

/** ★#1122：`useFetch` 成功结果（`data` 解构保持兼容；`status`/`headers` 为新增）。 */
export interface FetchOk<T> {
  ok: true
  data: T
  /** ★此前被 `useFetch` 丢弃 ⇒ 业务无法区分 404/500 */
  status: number
  headers: Record<string, string>
  /** ★#1133 观测元数据（走管线时才有；直接调 `runFetch` 时不带） */
  meta?: FetchMeta
}

/** ★#1122：`useFetch` 的结果（成功带 status/headers，失败只有 error；#1133 两条分支都可带 meta）。 */
export type FetchResult<T> =
  | FetchOk<T>
  | { ok: false; error: CapError; meta?: FetchMeta }

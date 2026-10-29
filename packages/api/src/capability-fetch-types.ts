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
  /**
   * ★★★#1385：允许对**非幂等方法**（POST/PATCH 等）重试。默认 false。
   *
   * 【为什么默认禁止（这是本仓实证的痛点 #1）】此前 pipeline 的判定**完全不看 method**：
   *   只要不是 aborted/unsupported/tooLarge/intercepted 就一律可重试 ⇒ 一开 `retry`
   *   就把 `POST /order` **重新提交一遍**（超时后重试 = 可能下两单）。
   *   HTTP 语义上只有**幂等方法**（GET/HEAD/PUT/DELETE/OPTIONS/TRACE）可以无条件重试。
   *
   * 【什么时候可以打开】调用方**已经提供了幂等键**（服务端按它去重）时才是安全的
   *   —— 门面层 `createApi` 在有 idempotencyKey 时会自动把它置 true。
   *   业务直接调 `useFetch` 时想对 POST 重试，必须自己确认服务端幂等，再显式打开。
   *
   * ★与 `request/reliability.ts::canRetry` **同一参数名与同一语义**（单一事实源）：
   *   `isIdempotentMethod(m) || hasIdempotencyKey || retryNonIdempotent === true`。
   */
  retryNonIdempotent?: boolean
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
  /**
   * ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径。
   *
   * ★★★#1193 **已真机取证（B4 收口）**：鸿蒙端落盘的内存**确实与文件大小无关**。
   *   真机两组对照（`/proc/self/status` 的 `VmHWM` 峰值 RSS）：
   *     · 1 MiB 文件 → 进程峰值 +2.76 MiB（chunks=116）
   *     · **64 MiB 文件 → 峰值只 +3.41 MiB**（chunks=4260，`seen == saveWritten == 67108864`）
   *   ⇒ 文件大 64 倍而内存增量几乎不变（只剩固定开销）⇒ **在 64 MiB 量级未观测到整包驻留**（VmHWM 只能证明"没观测到"，不能证明机制上"不会"）。
   *   证据 `hosts/harmony/results/http-probe-save-{1m,64m}.json`，判据
   *   `tests/harmony-http-gaps.test.ts` 的「落盘内存不随文件大小增长」。
   * ★诚实边界：只测到 **64 MiB**，不外推到 1 GiB（上限未压测）。
   */
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
  /**
   * ★★★#1153 **TLS 证书 pinning**（仅 App 三端；Web 由浏览器管 TLS、MP 的 `wx.request` 不暴露）。
   *
   * 传 **base64 SHA-256 SPKI 指纹**数组（换行/逗号/空格分隔的字符串也接受）。
   *
   * 【为什么钉 SPKI 而不是钉整张证书】整张证书在**续期**（同一密钥）时指纹就变了 ⇒ 每次续期都得改代码；
   *   SPKI 跨续期稳定，且能自然覆盖"链上任意一张证书"（含中间 CA）。
   *
   * 【默认语义 = 叠加】系统信任必须通过 **且** pin 必须命中（防 MITM 的额外一道防线）。
   *   要"只看 pin"（企业自签场景）须显式 `tlsPinOnly: true`。
   *
   * 【命中即通过】`sniHostname` 仍按平台默认校验（pinning **不**替代主机名校验）。
   *
   * ★失败 ⇒ `fetch.tlsError`（独立错误码，不混进 `fetch.failed`）——业务据此区分"证书不对"与"网络不好"。
   */
  tlsPins?: string | string[]
  /**
   * ★★★#1153 `tlsPins` 的**信任语义**：
   * · 缺省/`false` = **叠加**（系统信任 + pin 都要过）——生产默认，最安全；
   * · `true` = **替代**（只看 pin，仍校验主机名）——企业内网/自签证书场景。
   * ★它**放宽**了信任锚，所以只由业务显式开启，绝不默认。
   */
  tlsPinOnly?: boolean
  /**
   * ★★★#1169 **HTTPDNS**：本次请求的**域名 → IP 映射**（键 = 域名，值 = `string[]` 或逗号分隔串）。
   *
   * 【什么时候用它】业务已通过 HTTPDNS 服务（自建/云厂商）拿到 IP，希望**绕过系统 DNS**直连——
   * 典型动机：系统 DNS 被投毒/劫持、需要就近调度、或首包延迟敏感（省一次 DNS 往返）。
   *
   * 【★语义（三端同一套）】
   * · 只影响**表里出现的域名**；表里没有的域名**照旧走系统 DNS**（不改变其他域名行为）；
   * · IP 顺序即**尝试顺序**（多 IP 时宿主按序回退，与浏览器 Happy Eyeballs 精神一致但不做竞速）；
   * · **SNI 与证书主机名校验仍用原域名**（不是 IP）——否则 TLS 会失败或退化成不安全模式。
   *   ★这条是硬约束：把 URL 换成 IP 直连会破坏 SNI/主机名校验，HTTPDNS 必须走"解析注入"而非"URL 改写"。
   *
   * 【★端差异：如实，不粉饰】
   * · **Android** ✅ OkHttp `Dns`（#1160 已有注入点）
   * · **鸿蒙** ✅ RCP 静态 DNS 规则（#1169 真机实证注入生效）
   * · **iOS** ❌ `URLSession` **没有**自定义 DNS 钩子 ⇒ 传了本字段 ⇒ **`fetch.unsupported`**
   *   （不静默忽略——否则业务以为用了 HTTPDNS，实际走了系统 DNS，属于"假数据比缺数据更糟"）
   *
   * 【★与缓存/失败的关系】
   * · 本字段只作用于**当次请求**；框架层不缓存解析结果（HTTPDNS 的 TTL 归业务/服务商管）；
   * · 表里的 IP 全部不可达 ⇒ 请求按网络错误失败（**不回退系统 DNS**——回退会掩盖 HTTPDNS 故障）。
   *
   * @example
   * ```ts
   * useFetch('https://api.example.com/data', {
   *   httpDns: { 'api.example.com': ['203.0.113.10', '203.0.113.11'] },
   * })
   * ```
   */
  httpDns?: Record<string, string | string[]>
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
  /**
   * ★★★#1385：**本可以重试但被策略拒绝**的原因（不静默）。
   *
   * 【为什么不静默跳过】把 `POST + retry` 拦下来是对的行为，但如果业务只看到
   *   `attempts: 1`，会误判成"重试没生效 / 库有 bug"——排查方向完全错。
   *   ⇒ 明确告诉它"因为你没给幂等键，所以按 HTTP 语义不重试"。
   */
  retryRefused?: { reason: string }
  /**
   * ★★★#1386：**去重被跳过**的原因（不静默）。
   *
   * 当前只有一种：配了请求拦截器。因为拦截器可以改 url / headers（鉴权头最常见），
   *   而拦截器在**去重键算好之后**才执行 ⇒ 键无法代表最终请求身份 ⇒
   *   继续去重就有"跨租户合并"的风险（A 拿到 B 的应答）。
   * ⇒ 宁可少一次去重，也不冒错合并的风险（正确性 > 效率），但要**说出来**。
   */
  dedupeSkipped?: { reason: string }
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
  /**
   * ★★★#1158：**宿主侧传输层读数**（本次请求的最后一轮）。
   *
   * 【它解决什么】"网络慢"长期只有 `totalMs` 一个数 ⇒ 分不清**排队 / DNS / 建连 / TLS / 首字节**。
   *   本字段由宿主实测提供（iOS `URLSessionTaskMetrics` · Android `OkHttp EventListener`（#1160 换栈后） · 鸿蒙 `Rcp_TimeInfo`）。
   *
   * 【★逐端可得性 —— 缺的键**不出现**，不是 0/false】
   *   | 端 | proto | reused | dnsMs | connectMs | tlsMs | ttfbMs |
   *   |---|---|---|---|---|---|---|
   *   | iOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
   *   | Android | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（#1160 换 OkHttp 后全字段；`ttfbMs` 为纯首字节） |
   *   | 鸿蒙 | — | — | ✅ | ✅ | ✅ | ✅ |
   *   | Web | ✅ | — | — | — | — | — |
   *   | MP | （整项不出现：`wx.request` 不暴露任何传输读数） |
   *
   * ★**"不可得"与"测到 0"是两件事**：宿主不提供时这里就是 `undefined`，绝不填 0——
   *   否则业务会据此判断"DNS 只花了 0ms"（假的）。
   * ★缓存的命中（`cache.hit`）**不发网络请求** ⇒ 本字段不出现（不是"0ms"，是没有）。
   */
  transport?: TransportMeta
}

/**
 * ★★★#1158：宿主侧传输层读数（**类型化、已解析**；线格式见 `invoke-wire.ts` 的 `Transport=22`）。
 * 所有字段可选——缺 = 该端测不到。毫秒字段为浮点（iOS/鸿蒙给小数）。
 */
export interface TransportMeta {
  /** 实际协商的协议版本（`"h2"` / `"http/1.1"`） */
  proto?: string
  /** 是否复用已有连接（`true` = 复用了连接池里的连接，没有新建 TCP） */
  reused?: boolean
  /** DNS 解析耗时（ms） */
  dnsMs?: number
  /** TCP 建连耗时（ms；**不含** DNS） */
  connectMs?: number
  /** TLS 握手耗时（ms；**不含** DNS/TCP） */
  tlsMs?: number
  /** 首字节耗时（ms；从发起请求到收到响应首字节） */
  ttfbMs?: number
  /**
   * ★★★#1183：**本次请求的域名解析走了哪一级**（HTTPDNS 可观测面）。
   *
   * - `'table'`：命中业务给的 `httpDns` 表（**这是"表真的生效"的唯一直接证据**）；
   * - `'system'`：表未命中 ⇒ 回落系统 DNS（**回落是显式的，不是静默**）；
   * - `'literal'`：URL 本身就是 IP ⇒ 根本没有解析；
   * - `'resolver'`：命中进程级解析器（Android 的 `setHttpDns`）。
   *
   * ★**为什么必须有这个字段**：`httpDns` 生效与否，从外部只有"请求成败"一个间接信号；
   *   而"注入不可达 IP ⇒ 失败"与"网络本来就不通"看起来一样（#1169 首跑踩到）。
   * ★缺 = 该端不上报（不写 `'system'` 冒充"确定走了系统"——那是假数据）。
   */
  dnsSource?: 'table' | 'system' | 'literal' | 'resolver'
  /** ★★★#1183：本次请求是否命中了 `httpDns` 表（与 `dnsSource === 'table'` 同义，但更直白） */
  dnsTableHit?: boolean
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

/**
 * ★★★#1158：把线格式的**字符串读数**解析成类型化 `TransportMeta`。
 *
 * 【规则（每条都有理由）】
 *   · **只保留能解析的项**：`dnsMs` 非数字 ⇒ 丢弃该键（不写 NaN——NaN 会让 JSON 变成 `null`，
 *     业务拿到 `null` 会以为"测到但为空"）；
 *   · 负数 ⇒ 丢弃（宿主算错时不能把负时间交给业务）；
 *   · `reused`：只认 `"1"` / `"0"`（线格式约定）；其它值 ⇒ 丢弃（不把任何非空串当 true）；
 *   · 空对象 / 全项被丢弃 ⇒ 返回 `undefined`（**整项不出现**，与"某端测不到"同语义）；
 *   · `proto` 空串 ⇒ 丢弃。
 *
 * ★纯函数（零 IO），由 `tests/fetch-transport-meta.test.ts` 直接断言。
 */
export function parseTransportReadout(raw: Record<string, string> | undefined): TransportMeta | undefined {
  if (!raw) return undefined
  const out: TransportMeta = {}
  const num = (k: string): number | undefined => {
    const s = raw[k]
    if (s === undefined) return undefined
    /**
     * ★★★空串/空白串必须当**不可解析**——`Number('')` 是 **0**（JS 的经典陷阱）。
     * 若漏掉这一条，宿主把"没测到"写成空串时，业务会读到 `dnsMs: 0`（"DNS 花了 0ms"）——
     * **假数据比缺数据更糟**（本仓反复记的"用缺省值冒充已知"）。
     * ★这是本轮判据 ⑤ 当场抓出的：`parseTransportReadout({dnsMs:''})` 曾返回 `{dnsMs: 0}`。
     */
    if (s.trim() === '') return undefined
    const n = Number(s)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const proto = raw['proto']
  if (typeof proto === 'string' && proto.length > 0) out.proto = proto
  const reused = raw['reused']
  if (reused === '1') out.reused = true
  else if (reused === '0') out.reused = false
  const dns = num('dnsMs')
  if (dns !== undefined) out.dnsMs = dns
  const conn = num('connectMs')
  if (conn !== undefined) out.connectMs = conn
  const tls = num('tlsMs')
  if (tls !== undefined) out.tlsMs = tls
  const ttfb = num('ttfbMs')
  if (ttfb !== undefined) out.ttfbMs = ttfb
  /**
   * ★★★#1183：DNS 来源（HTTPDNS 可观测面）。
   * ★**白名单校验**：只认四个已知值——宿主写错/写新值时**丢弃**而不是当字符串透传，
   *   否则业务会拿到拼错的枚举值（`'Tabel'`）却以为有效。
   */
  const src = raw['dnsSource']
  if (src === 'table' || src === 'system' || src === 'literal' || src === 'resolver') out.dnsSource = src
  const hit = raw['dnsTableHit']
  if (hit === '1') out.dnsTableHit = true
  else if (hit === '0') out.dnsTableHit = false
  return Object.keys(out).length > 0 ? out : undefined
}

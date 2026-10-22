---
title: useFetch (capability.fetch)
group: 网络与通信
order: 1
---

# useFetch

**What it does**: Send an HTTP request and get the response data.

**When to use it**: Calling APIs, loading lists, submitting forms.

> 技术标识：能力原语 C26 · `capability.fetch` · 返回 `Promise<T>` · **Hook implemented** (per-end support in the table below)

★ G-32 B3 (continued): communication / permission / storage — a missing bridge → Err instead of throwing (G-32.3 degradation semantics)

## Signature

```ts
useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<FetchResult<T>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `url` | `string` | Yes | Target URL (HTTPS) |
| `config` | `FetchConfig` | No | useFetch configuration (aligned with RequestConfig high-frequency fields) |

#### Properties of `config`

| Property | Type | Required | Doc |
|---|---|---|---|
| `method` | `HttpMethod` | No | HTTP method (defaults to GET) |
| `data` | `unknown` | No | Request body (POST/PUT; objects are JSON-serialized automatically) |
| `params` | `Record<string, unknown>` | No | URL query parameters (appended to the query string) |
| `headers` | `Record<string, string>` | No | Custom request headers |
| `timeout` | `number` | No | Timeout in ms (timeout → Err) |
| `deadline` | `number` | No | — |
| `responseType` | `'text' \| 'json' \| 'arraybuffer'` | No | — |
| `savePath` | `string` | No | — |
| `onChunk` | `(chunk: Uint8Array, seq: number) => void` | No | — |
| `upload` | `UploadSpec` | No | — |
| `signal` | `AbortSignalLike` | No | — |
| `retry` | `number \| RetryPolicy` | No | — |
| `priority` | `number` | No | — |
| `redirect` | `'follow' \| 'manual' \| 'error'` | No | — |
| `maxRedirects` | `number` | No | — |
| `onRedirect` | `(hop: RedirectHop) => RedirectDecision \| Promise<RedirectDecision>` | No | — |
| `redirectManual` | `boolean` | No | — |
| `cache` | `FetchCacheMode` | No | — |
| `bypassPlatformCache` | `boolean` | No | — |
| `tlsPins` | `string \| string[]` | No | — |
| `tlsPinOnly` | `boolean` | No | — |
| `httpDns` | `Record<string, string \| string[]>` | No | — |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `T` | Success payload — generic, inferred from the response body (e.g. JSON auto-deserialized) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Error codes

| code | Doc |
|---|---|
| `fetch.unsupported` | The bridge does not provide request (useFetch unavailable) |
| `fetch.aborted` | — |
| `fetch.timeout` | — |
| `fetch.failed` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.request |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | ✅ | native-harmony (ArkUI RenderNode) · Harmony host wired (invoke_bytes_bridge.h / proteus_http.h) · device-verified (transport-probe 3/3 200 · 3 req/1 conn; fetch-limit both gates → `fetch.tooLarge`); **three limits here**: ① `abort()` is a **no-op** (one-shot VM + synchronous napi ⇒ no in-flight request to cancel; use `timeout`); ② `stream: true` is **honestly rejected** (`fetch.unsupported` — chunks cannot be pushed back; use `savePath`); ③ **SPKI pinning not wired** (RCP exposes CA config only, no fingerprint verification) |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `FetchConfig`

useFetch 配置。★#1122：S3 能力（流式/落盘/上传/取消）此前底层做完但**门面没开口**——现已全部开放。

| Prop/Method | Type | Doc |
|---|---|---|
| `method` | `HttpMethod` | HTTP 方法（缺省 GET） |
| `data` | `unknown` | 请求体（POST/PUT；对象自动 JSON 序列化） |
| `params` | `Record<string, unknown>` | URL 查询参数（拼接到 query string） |
| `headers` | `Record<string, string>` | 自定义请求头 |
| `timeout` | `number` | 超时（ms；超时 → Err）。★单轮语义：重试时每轮各自计时 |
| `deadline` | `number` | ★★★#1135 **总时限**（ms）：从**入队**起算的墙钟预算，跨排队/重试退避/重定向多跳。  【与 `timeout` 的区别（这是超级应用最常踩的坑）】 · `timeout` 是**单轮**语义：重试 3 次 × 15s ⇒ 最坏 ~60s；多跳重定向同理； · `deadline` 是**总预算**：排队、退避、每一跳都计入，耗尽 ⇒ `fetch.deadline`。 ⇒ 业务要"20s 内给我结果"时必须用 `deadline`，`timeout: 20000` 表达不了这个意思。  ★超预算时框架会把**单轮 timeout 收敛到剩余预算**（不会让某一次尝试突破总时限）。 ★`fetch.deadline` 与 `fetch.timeout` 分开：前者"整体没时间了"，后者"这一轮等太久"。 |
| `responseType` | `'text' \| 'json' \| 'arraybuffer'` | ★#1122 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节）。端差异：wx 给 `ArrayBuffer`。 |
| `savePath` | `string` | ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径。  ★★★#1191 更正（独立验证 B4）：原文写「内存与文件大小无关」——**对鸿蒙不成立，且未取证**。 · Android / iOS：逐块写文件，已验证； · **鸿蒙**：我们这层确实逐块直写（`SaveSession`），但 RCP 的 `Rcp_Response.body` 仍可能把整包驻留（`HMS_Rcp_SetRequestOnBinaryDataRecvCallback` 只"替换回调"， 没有关闭整包驻留的开关）⇒ **内存上限未取证**。 ⇒ 准确说法：**"避免框架层的第二份拷贝；是否与文件大小无关取决于宿主栈，鸿蒙端未取证"**。 大文件落盘前请按目标端实测（本仓待补 `VmHWM` 对照）。 |
| `onChunk` | `(chunk: Uint8Array, seq: number) => void` | ★#1122 流式消费：每块回调一次，内存不随响应体增长。**回调同步**（宿主回推的 JS 线程上）。 App 逐块回推；Web 用 ReadableStream（节奏不同）；**MP 不支持** ⇒ unsupported。 |
| `upload` | `UploadSpec` | ★#1122 流式上传（仅 App）：宿主自读文件、自拼 multipart、边读边发。Web/MP 用各自上传 API ⇒ unsupported。 |
| `signal` | `AbortSignalLike` | ★#1122 取消：`abort()` ⇒ 立即 `fetch.aborted`，并尽力通知宿主中止传输。 App 用 `createAbortController()`（引擎无原生 AbortController）；Web 用原生 `AbortSignal`；**MP 不支持**。 |
| `retry` | `number \| RetryPolicy` | ★#1133 重试：数字 = 额外次数；对象 = 覆盖管线默认策略。 ★只对**可恢复**失败生效（网络错误 / 超时 / 429 / 5xx）——取消与能力缺失不重试。 |
| `priority` | `number` | ★#1133 排队优先级（越大越先发；默认 0）。并发打满时用于"首屏关键请求优先"。 |
| `redirect` | `'follow' \| 'manual' \| 'error'` | ★#1134 重定向策略： · `follow`（默认）= 平台跟随（老行为，宿主自己跟）； · `manual` = **不跟随**，3xx 原样返回（`status` + `headers.location` 可直接读）； · `error` = 遇到 3xx 直接失败（`fetch.redirectForbidden`）。 ★给出 `onRedirect` 时会**自动**走逐跳拦截（无需显式写本字段）。 ★MP 端不支持 `manual`/`error`/`onRedirect` ⇒ `fetch.unsupported`（`wx.request` 无此能力）。 |
| `maxRedirects` | `number` | ★#1134 最多跟随几跳（默认 5）。超过 ⇒ `fetch.tooManyRedirects`（真实错误）。 ★只在 `manual` / `onRedirect`（即框架层在跟）时生效。 |
| `onRedirect` | `(hop: RedirectHop) => RedirectDecision \| Promise<RedirectDecision>` | ★#1134 **逐跳拦截**：每遇到一次重定向调一次；返回 `{action:'stop'}` 可拒绝。  【为什么这是超级应用必须的】重定向是**框架看不见的跳转**：API 302 到第三方域时， 宿主会把 `Authorization` 带过去（open-redirect 凭据泄露）。有了本回调，业务能看见每一跳 并决定跟不跟；**跨域时框架还会自动剥离凭据头**（不经业务决策，安全底线）。  ★回调里 `hop.from/to/status/methodChanged` 都是可记录的审计信息。 |
| `redirectManual` | `boolean` | ★#1134 **宿主级**开关（一般不直接用）：true ⇒ 宿主不跟随（见线格式 `Redirect` tag）。 ★由管线在 `redirect:manual` / 有 `onRedirect` 时自动置位；业务手写无副作用（语义一致）。 |
| `cache` | `FetchCacheMode` | ★★★#1149 **HTTP 缓存模式**（对齐浏览器 `Request.cache` 的六个标准值）。  【为什么必须有】App 端的字节腿是**裸 HTTP**——Android `HttpURLConnection` 不启用 `ResponseCache`、 鸿蒙 RCP 亦不做条件缓存；而浏览器/小程序会自动做。⇒ 不显式给业务这个旋钮， 同一份源码在三端就会"Web 命中 304、App 每次整包回源"。  · `default`（管线开启缓存时的默认）= 新鲜则直用，过期则带 `If-None-Match`/`If-Modified-Since` 回源； · `no-store` = 不读也不写缓存； · `reload` = 忽略缓存、强制回源（并刷新缓存）； · `no-cache` = 跳过"新鲜直用"，但仍带校验器回源（304 则复用）； · `force-cache` = 有缓存就用（即使过期），没有才回源； · `only-if-cached` = 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**）。  ★只对 GET 的 200/203 生效；流式/落盘/上传不缓存。 ★不写它时：管线未开缓存 ⇒ 行为与从前完全一致（零回归）；管线开了 ⇒ 用管线默认模式。 |
| `bypassPlatformCache` | `boolean` | ★#1149 **内部字段**（一般不写）：让 Web 腿把浏览器自带的 HTTP 缓存让开， 使缓存语义在本框架层成为唯一来源（否则"浏览器命中"与"我们命中"两套计数/语义会漂移）。 |
| `tlsPins` | `string \| string[]` | ★★★#1153 **TLS 证书 pinning**（仅 App 三端；Web 由浏览器管 TLS、MP 的 `wx.request` 不暴露）。  传 **base64 SHA-256 SPKI 指纹**数组（换行/逗号/空格分隔的字符串也接受）。  【为什么钉 SPKI 而不是钉整张证书】整张证书在**续期**（同一密钥）时指纹就变了 ⇒ 每次续期都得改代码； SPKI 跨续期稳定，且能自然覆盖"链上任意一张证书"（含中间 CA）。  【默认语义 = 叠加】系统信任必须通过 **且** pin 必须命中（防 MITM 的额外一道防线）。 要"只看 pin"（企业自签场景）须显式 `tlsPinOnly: true`。  【命中即通过】`sniHostname` 仍按平台默认校验（pinning **不**替代主机名校验）。  ★失败 ⇒ `fetch.tlsError`（独立错误码，不混进 `fetch.failed`）——业务据此区分"证书不对"与"网络不好"。 |
| `tlsPinOnly` | `boolean` | ★★★#1153 `tlsPins` 的**信任语义**： · 缺省/`false` = **叠加**（系统信任 + pin 都要过）——生产默认，最安全； · `true` = **替代**（只看 pin，仍校验主机名）——企业内网/自签证书场景。 ★它**放宽**了信任锚，所以只由业务显式开启，绝不默认。 |
| `httpDns` | `Record<string, string \| string[]>` | ★★★#1169 **HTTPDNS**：本次请求的**域名 → IP 映射**（键 = 域名，值 = `string[]` 或逗号分隔串）。  【什么时候用它】业务已通过 HTTPDNS 服务（自建/云厂商）拿到 IP，希望**绕过系统 DNS**直连—— 典型动机：系统 DNS 被投毒/劫持、需要就近调度、或首包延迟敏感（省一次 DNS 往返）。  【★语义（三端同一套）】 · 只影响**表里出现的域名**；表里没有的域名**照旧走系统 DNS**（不改变其他域名行为）； · IP 顺序即**尝试顺序**（多 IP 时宿主按序回退，与浏览器 Happy Eyeballs 精神一致但不做竞速）； · **SNI 与证书主机名校验仍用原域名**（不是 IP）——否则 TLS 会失败或退化成不安全模式。 ★这条是硬约束：把 URL 换成 IP 直连会破坏 SNI/主机名校验，HTTPDNS 必须走"解析注入"而非"URL 改写"。  【★端差异：如实，不粉饰】 · **Android** ✅ OkHttp `Dns`（#1160 已有注入点） · **鸿蒙** ✅ RCP 静态 DNS 规则（#1169 真机实证注入生效） · **iOS** ❌ `URLSession` **没有**自定义 DNS 钩子 ⇒ 传了本字段 ⇒ **`fetch.unsupported`** （不静默忽略——否则业务以为用了 HTTPDNS，实际走了系统 DNS，属于"假数据比缺数据更糟"）  【★与缓存/失败的关系】 · 本字段只作用于**当次请求**；框架层不缓存解析结果（HTTPDNS 的 TTL 归业务/服务商管）； · 表里的 IP 全部不可达 ⇒ 请求按网络错误失败（**不回退系统 DNS**——回退会掩盖 HTTPDNS 故障）。  @example ```ts useFetch('https://api.example.com/data', { httpDns: { 'api.example.com': ['203.0.113.10', '203.0.113.11'] }, }) ``` |

### `UploadSpec`

★#1122：流式上传规格（宿主据此自读文件 + 自拼 multipart）。

| Prop/Method | Type | Doc |
|---|---|---|
| `path` | `string` | 沙箱相对路径（与 `fs.readBytes` 同一套校验：拒绝绝对路径与 `..`） |
| `fieldName` | `string` | multipart 字段名（如 `file`） |
| `filename` | `string` | 上传文件名（进 `Content-Disposition` 的 filename） |
| `boundary` | `string` | multipart 边界串——**必须与 `Content-Type` 头里的一致** |
| `formData` | `Record<string, string>` | 普通表单字段（按插入序编码） |

### `AbortSignalLike`

最小取消信号契约（兼容原生 `AbortSignal` 与 `createAbortController()` 的产物）。
★只要求 `aborted` 可读 ⇒ 浏览器原生 `AbortSignal` 与 App 侧 `createAbortController().signal`
都能直接传入 `useFetch(url, { signal })`，无需适配层。

| Prop/Method | Type | Doc |
|---|---|---|
| `aborted` | `boolean` | 是否已取消。`useFetch` 在请求期间读它；取消后 Promise 以 `fetch.aborted` 结束。 |

### `RetryPolicy`

重试策略（与 `capability-fetch-pipeline.ts` 的 `RetryPolicy` 同构）。

| Prop/Method | Type | Doc |
|---|---|---|
| `attempts` | `number` | 额外重试次数（默认 0 = 不重试） |
| `delayMs` | `number` | 首次退避（ms，默认 300） |
| `backoff` | `'fixed' \| 'linear' \| 'exponential'` | 退避曲线（默认 `exponential`） |
| `jitter` | `number` | 抖动比例 0~1（默认 0.2；避免重试风暴同步打点） |
| `retryOn` | `(res: FetchResult<unknown>, attempt: number) => boolean` | 判定是否重试（默认：网络类失败 + 429/5xx；**不重试** aborted/unsupported/tooLarge/intercepted） |

### `RedirectHop`

单跳记录（`onRedirect` 的入参、`FetchResult.redirects` 的元素）。

| Prop/Method | Type | Doc |
|---|---|---|
| `status` | `number` | 本跳的状态码（301 / 302 / 303 / 307 / 308…） |
| `from` | `string` | 本跳请求的 URL（跳转**前**） |
| `to` | `string` | 目标 URL（来自 `Location`，已按 RFC 3986 相对解析） |
| `methodChanged` | `boolean` | 方法是否被改写（303 ⇒ 通常改 GET；301/302 按浏览器惯例也改 GET） |

### `FetchCacheMode`

`Request.cache` 的六个标准值（与浏览器**同名同义**）。

为什么必须给业务这个旋钮：App 端的字节腿是**裸 HTTP**（Android/iOS/鸿蒙 都不做平台条件缓存），
而浏览器/小程序会自动做 ⇒ 不给旋钮，同一份源码在三端就会"Web 命中 304、App 每次整包回源"。

逐值语义（★这里是**单一事实源**：官网能力页的取值表由本 JSDoc 生成，改语义只改这里）：
· `default` = 新鲜则直用，过期则带 `If-None-Match` / `If-Modified-Since` 回源（管线开启缓存时的默认）
· `no-store` = 不读也不写缓存
· `reload` = 忽略缓存、强制回源（并刷新缓存）
· `no-cache` = 跳过"新鲜直用"，但仍带校验器回源（304 则复用）
· `force-cache` = 有缓存就用（即使已过期），没有才回源
· `only-if-cached` = 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**）

★只对 **GET 的 200/203** 生效；流式（`onChunk`）/落盘（`savePath`）/上传（`upload`）一律不缓存。
★不写它时：管线未开缓存 ⇒ 行为与从前完全一致（零回归）；管线开了 ⇒ 用管线默认模式。

| 取值 | 说明 |
|---|---|
| `'default'` | 新鲜则直用，过期则带 `If-None-Match` / `If-Modified-Since` 回源（管线开启缓存时的默认） |
| `'no-store'` | 不读也不写缓存 |
| `'reload'` | 忽略缓存、强制回源（并刷新缓存） |
| `'no-cache'` | 跳过"新鲜直用"，但仍带校验器回源（304 则复用） |
| `'force-cache'` | 有缓存就用（即使已过期），没有才回源 |
| `'only-if-cached'` | 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**） |

### `FetchMeta`

★#1133：单次请求的**观测元数据**（超级应用排障的底座）。

【为什么必须有】没有它就只能得到"成功/失败"，无法回答"慢在排队、慢在网络、还是慢在重试"。
这些数字**全部在框架层可得**（不依赖宿主），所以三端语义一致。

| Prop/Method | Type | Doc |
|---|---|---|
| `id` | `string` | 请求 id（与 `FetchTask.id` 一致；日志/埋点用它串起来） |
| `attempts` | `number` | 实际发出的轮次（含首次；1 = 没重试） |
| `queuedMs` | `number` | 在并发队列里等待的时间（ms）——**慢在排队**还是慢在网络，看这个 |
| `totalMs` | `number` | 从入队到结算的总墙钟（ms） |
| `attemptMs` | `number[]` | 每轮耗时（ms；下标 = 轮次） |
| `deduped` | `boolean` | 是否命中去重（本次没真发请求，用的是别人在飞的结果） |
| `priority` | `number` | 排队优先级（观测用） |
| `retryDelaySkipped` | `boolean` | ★App 精简引擎无 `setTimeout` ⇒ 重试未等待（如实标记，不谎称退避过） |
| `redirects` | `RedirectTrace` | ★#1134：重定向轨迹（仅在发生过跳转/被拦截/超限时出现）。`hops` 是逐跳审计记录。 |
| `deadlineMs` | `number` | ★#1135：本次请求的总时限预算（ms；未设置则不出现）。 |
| `deadlineHit` | `boolean` | ★#1135：是否因总时限耗尽而失败（`fetch.deadline`）。 |
| `cache` | `FetchCacheMeta` | ★★★#1149：本次请求的缓存结局（未启用缓存时不出现）。 `hit` 直接命中新鲜缓存（**没有发网络请求**）/ `revalidated` 304 复用 / `miss` 回源 / `bypass` 不适用（非 GET、流式等，或 `no-store`）。 |
| `transport` | `TransportMeta` | ★★★#1158：**宿主侧传输层读数**（本次请求的最后一轮）。  【它解决什么】"网络慢"长期只有 `totalMs` 一个数 ⇒ 分不清**排队 / DNS / 建连 / TLS / 首字节**。 本字段由宿主实测提供（iOS `URLSessionTaskMetrics` · Android `OkHttp EventListener`（#1160 换栈后） · 鸿蒙 `Rcp_TimeInfo`）。  【★逐端可得性 —— 缺的键**不出现**，不是 0/false】 | 端 | proto | reused | dnsMs | connectMs | tlsMs | ttfbMs | |---|---|---|---|---|---|---| | iOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | Android | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（#1160 换 OkHttp 后全字段；`ttfbMs` 为纯首字节） | | 鸿蒙 | — | — | ✅ | ✅ | ✅ | ✅ | | Web | ✅ | — | — | — | — | — | | MP | （整项不出现：`wx.request` 不暴露任何传输读数） |  ★**"不可得"与"测到 0"是两件事**：宿主不提供时这里就是 `undefined`，绝不填 0—— 否则业务会据此判断"DNS 只花了 0ms"（假的）。 ★缓存的命中（`cache.hit`）**不发网络请求** ⇒ 本字段不出现（不是"0ms"，是没有）。 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const res = await useFetch<{ id: number; name: string }>('/api/user/1')

if (res.ok) {
  console.log(res.data.name) // response auto-deserialized from JSON
} else if (res.error.code === 'fetch.unsupported') {
  // bridge has no request → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->
---
title: useFetch（capability.fetch）
group: 网络与通信
order: 1
---

# useFetch

**它能做什么**：发一个 HTTP 请求并拿到返回数据。

**什么时候用**：调后端接口、拉列表、提交表单。

> 技术标识：能力原语 C26 · `capability.fetch` · 返回 `Promise<T>` · **Hook 已实现**（各端支持情况见下方兼容进度表）

★#1122 门面开口 · #1133 走请求管线；`bridge.request` 显式出现（文档探测靠它判该端是否接线）

## 签名

```ts
useFetch<T = unknown>(url: string, config?: FetchConfig): Promise<FetchResult<T>>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | `string` | 是 | 目标 URL（HTTPS） |
| `config` | `FetchConfig` | 否 | useFetch 配置。★#1122：S3 能力（流式/落盘/上传/取消）此前底层做完但**门面没开口**——现已全部开放。 |

#### `config` 的属性

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `method` | `HttpMethod` | 否 | HTTP 方法（缺省 GET） |
| `data` | `unknown` | 否 | 请求体（POST/PUT；对象自动 JSON 序列化） |
| `params` | `Record<string, unknown>` | 否 | URL 查询参数（拼接到 query string） |
| `headers` | `Record<string, string>` | 否 | 自定义请求头 |
| `timeout` | `number` | 否 | 超时（ms；超时 → Err）。★单轮语义：重试时每轮各自计时 |
| `deadline` | `number` | 否 | ★★★#1135 **总时限**（ms）：从**入队**起算的墙钟预算，跨排队/重试退避/重定向多跳。  【与 `timeout` 的区别（这是超级应用最常踩的坑）】 · `timeout` 是**单轮**语义：重试 3 次 × 15s ⇒ 最坏 ~60s；多跳重定向同理； · `deadline` 是**总预算**：排队、退避、每一跳都计入，耗尽 ⇒ `fetch.deadline`。 ⇒ 业务要"20s 内给我结果"时必须用 `deadline`，`timeout: 20000` 表达不了这个意思。  ★超预算时框架会把**单轮 timeout 收敛到剩余预算**（不会让某一次尝试突破总时限）。 ★`fetch.deadline` 与 `fetch.timeout` 分开：前者"整体没时间了"，后者"这一轮等太久"。 |
| `responseType` | `'text' \| 'json' \| 'arraybuffer'` | 否 | ★#1122 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节）。端差异：wx 给 `ArrayBuffer`。 |
| `savePath` | `string` | 否 | ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径。  ★★★#1191 更正（独立验证 B4）：原文写「内存与文件大小无关」——**对鸿蒙不成立，且未取证**。 · Android / iOS：逐块写文件，已验证； · **鸿蒙**：我们这层确实逐块直写（`SaveSession`），但 RCP 的 `Rcp_Response.body` 仍可能把整包驻留（`HMS_Rcp_SetRequestOnBinaryDataRecvCallback` 只"替换回调"， 没有关闭整包驻留的开关）⇒ **内存上限未取证**。 ⇒ 准确说法：**"避免框架层的第二份拷贝；是否与文件大小无关取决于宿主栈，鸿蒙端未取证"**。 大文件落盘前请按目标端实测（本仓待补 `VmHWM` 对照）。 |
| `onChunk` | `(chunk: Uint8Array, seq: number) => void` | 否 | ★#1122 流式消费：每块回调一次，内存不随响应体增长。**回调同步**（宿主回推的 JS 线程上）。 App 逐块回推；Web 用 ReadableStream（节奏不同）；**MP 不支持** ⇒ unsupported。 |
| `upload` | `UploadSpec` | 否 | ★#1122 流式上传（仅 App）：宿主自读文件、自拼 multipart、边读边发。Web/MP 用各自上传 API ⇒ unsupported。 |
| `signal` | `AbortSignalLike` | 否 | ★#1122 取消：`abort()` ⇒ 立即 `fetch.aborted`，并尽力通知宿主中止传输。 App 用 `createAbortController()`（引擎无原生 AbortController）；Web 用原生 `AbortSignal`；**MP 不支持**。 |
| `retry` | `number \| RetryPolicy` | 否 | ★#1133 重试：数字 = 额外次数；对象 = 覆盖管线默认策略。 ★只对**可恢复**失败生效（网络错误 / 超时 / 429 / 5xx）——取消与能力缺失不重试。 |
| `priority` | `number` | 否 | ★#1133 排队优先级（越大越先发；默认 0）。并发打满时用于"首屏关键请求优先"。 |
| `redirect` | `'follow' \| 'manual' \| 'error'` | 否 | ★#1134 重定向策略： · `follow`（默认）= 平台跟随（老行为，宿主自己跟）； · `manual` = **不跟随**，3xx 原样返回（`status` + `headers.location` 可直接读）； · `error` = 遇到 3xx 直接失败（`fetch.redirectForbidden`）。 ★给出 `onRedirect` 时会**自动**走逐跳拦截（无需显式写本字段）。 ★MP 端不支持 `manual`/`error`/`onRedirect` ⇒ `fetch.unsupported`（`wx.request` 无此能力）。 |
| `maxRedirects` | `number` | 否 | ★#1134 最多跟随几跳（默认 5）。超过 ⇒ `fetch.tooManyRedirects`（真实错误）。 ★只在 `manual` / `onRedirect`（即框架层在跟）时生效。 |
| `onRedirect` | `(hop: RedirectHop) => RedirectDecision \| Promise<RedirectDecision>` | 否 | ★#1134 **逐跳拦截**：每遇到一次重定向调一次；返回 `{action:'stop'}` 可拒绝。  【为什么这是超级应用必须的】重定向是**框架看不见的跳转**：API 302 到第三方域时， 宿主会把 `Authorization` 带过去（open-redirect 凭据泄露）。有了本回调，业务能看见每一跳 并决定跟不跟；**跨域时框架还会自动剥离凭据头**（不经业务决策，安全底线）。  ★回调里 `hop.from/to/status/methodChanged` 都是可记录的审计信息。 |
| `redirectManual` | `boolean` | 否 | ★#1134 **宿主级**开关（一般不直接用）：true ⇒ 宿主不跟随（见线格式 `Redirect` tag）。 ★由管线在 `redirect:manual` / 有 `onRedirect` 时自动置位；业务手写无副作用（语义一致）。 |
| `cache` | `FetchCacheMode` | 否 | ★★★#1149 **HTTP 缓存模式**（对齐浏览器 `Request.cache` 的六个标准值）。  【为什么必须有】App 端的字节腿是**裸 HTTP**——Android `HttpURLConnection` 不启用 `ResponseCache`、 鸿蒙 RCP 亦不做条件缓存；而浏览器/小程序会自动做。⇒ 不显式给业务这个旋钮， 同一份源码在三端就会"Web 命中 304、App 每次整包回源"。  · `default`（管线开启缓存时的默认）= 新鲜则直用，过期则带 `If-None-Match`/`If-Modified-Since` 回源； · `no-store` = 不读也不写缓存； · `reload` = 忽略缓存、强制回源（并刷新缓存）； · `no-cache` = 跳过"新鲜直用"，但仍带校验器回源（304 则复用）； · `force-cache` = 有缓存就用（即使过期），没有才回源； · `only-if-cached` = 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**）。  ★只对 GET 的 200/203 生效；流式/落盘/上传不缓存。 ★不写它时：管线未开缓存 ⇒ 行为与从前完全一致（零回归）；管线开了 ⇒ 用管线默认模式。 |
| `bypassPlatformCache` | `boolean` | 否 | ★#1149 **内部字段**（一般不写）：让 Web 腿把浏览器自带的 HTTP 缓存让开， 使缓存语义在本框架层成为唯一来源（否则"浏览器命中"与"我们命中"两套计数/语义会漂移）。 |
| `tlsPins` | `string \| string[]` | 否 | ★★★#1153 **TLS 证书 pinning**（仅 App 三端；Web 由浏览器管 TLS、MP 的 `wx.request` 不暴露）。  传 **base64 SHA-256 SPKI 指纹**数组（换行/逗号/空格分隔的字符串也接受）。  【为什么钉 SPKI 而不是钉整张证书】整张证书在**续期**（同一密钥）时指纹就变了 ⇒ 每次续期都得改代码； SPKI 跨续期稳定，且能自然覆盖"链上任意一张证书"（含中间 CA）。  【默认语义 = 叠加】系统信任必须通过 **且** pin 必须命中（防 MITM 的额外一道防线）。 要"只看 pin"（企业自签场景）须显式 `tlsPinOnly: true`。  【命中即通过】`sniHostname` 仍按平台默认校验（pinning **不**替代主机名校验）。  ★失败 ⇒ `fetch.tlsError`（独立错误码，不混进 `fetch.failed`）——业务据此区分"证书不对"与"网络不好"。 |
| `tlsPinOnly` | `boolean` | 否 | ★★★#1153 `tlsPins` 的**信任语义**： · 缺省/`false` = **叠加**（系统信任 + pin 都要过）——生产默认，最安全； · `true` = **替代**（只看 pin，仍校验主机名）——企业内网/自签证书场景。 ★它**放宽**了信任锚，所以只由业务显式开启，绝不默认。 |
| `httpDns` | `Record<string, string \| string[]>` | 否 | ★★★#1169 **HTTPDNS**：本次请求的**域名 → IP 映射**（键 = 域名，值 = `string[]` 或逗号分隔串）。  【什么时候用它】业务已通过 HTTPDNS 服务（自建/云厂商）拿到 IP，希望**绕过系统 DNS**直连—— 典型动机：系统 DNS 被投毒/劫持、需要就近调度、或首包延迟敏感（省一次 DNS 往返）。  【★语义（三端同一套）】 · 只影响**表里出现的域名**；表里没有的域名**照旧走系统 DNS**（不改变其他域名行为）； · IP 顺序即**尝试顺序**（多 IP 时宿主按序回退，与浏览器 Happy Eyeballs 精神一致但不做竞速）； · **SNI 与证书主机名校验仍用原域名**（不是 IP）——否则 TLS 会失败或退化成不安全模式。 ★这条是硬约束：把 URL 换成 IP 直连会破坏 SNI/主机名校验，HTTPDNS 必须走"解析注入"而非"URL 改写"。  【★端差异：如实，不粉饰】 · **Android** ✅ OkHttp `Dns`（#1160 已有注入点） · **鸿蒙** ✅ RCP 静态 DNS 规则（#1169 真机实证注入生效） · **iOS** ❌ `URLSession` **没有**自定义 DNS 钩子 ⇒ 传了本字段 ⇒ **`fetch.unsupported`** （不静默忽略——否则业务以为用了 HTTPDNS，实际走了系统 DNS，属于"假数据比缺数据更糟"）  【★与缓存/失败的关系】 · 本字段只作用于**当次请求**；框架层不缓存解析结果（HTTPDNS 的 TTL 归业务/服务商管）； · 表里的 IP 全部不可达 ⇒ 请求按网络错误失败（**不回退系统 DNS**——回退会掩盖 HTTPDNS 故障）。  @example ```ts useFetch('https://api.example.com/data', { httpDns: { 'api.example.com': ['203.0.113.10', '203.0.113.11'] }, }) ``` |

## 返回值

`Promise<FetchResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `T` | 成功载荷——泛型，由响应内容推导（如 JSON 自动反序列化） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |
| `status` | `number` | ★此前被 `useFetch` 丢弃 ⇒ 业务无法区分 404/500 |
| `headers` | `Record<string, string>` | — |
| `meta` | `FetchMeta` | ★#1133 观测元数据（走管线时才有；直接调 `runFetch` 时不带） |

## 类型引用

### `FetchConfig`

useFetch 配置。★#1122：S3 能力（流式/落盘/上传/取消）此前底层做完但**门面没开口**——现已全部开放。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `method` | `HttpMethod` | `GET` | HTTP 方法（缺省 GET） |
| `data` | `unknown` | — | 请求体（POST/PUT；对象自动 JSON 序列化） |
| `params` | `Record<string, unknown>` | — | URL 查询参数（拼接到 query string） |
| `headers` | `Record<string, string>` | — | 自定义请求头 |
| `timeout` | `number` | — | 超时（ms；超时 → Err）。★单轮语义：重试时每轮各自计时 |
| `deadline` | `number` | — | ★★★#1135 **总时限**（ms）：从**入队**起算的墙钟预算，跨排队/重试退避/重定向多跳。  【与 `timeout` 的区别（这是超级应用最常踩的坑）】 · `timeout` 是**单轮**语义：重试 3 次 × 15s ⇒ 最坏 ~60s；多跳重定向同理； · `deadline` 是**总预算**：排队、退避、每一跳都计入，耗尽 ⇒ `fetch.deadline`。 ⇒ 业务要"20s 内给我结果"时必须用 `deadline`，`timeout: 20000` 表达不了这个意思。  ★超预算时框架会把**单轮 timeout 收敛到剩余预算**（不会让某一次尝试突破总时限）。 ★`fetch.deadline` 与 `fetch.timeout` 分开：前者"整体没时间了"，后者"这一轮等太久"。 |
| `responseType` | `'text' \| 'json' \| 'arraybuffer'` | — | ★#1122 响应体解释方式（`arraybuffer` ⇒ `data` 是裸字节）。端差异：wx 给 `ArrayBuffer`。 |
| `savePath` | `string` | — | ★#1122 落盘路径（仅 App）：宿主**直接写沙箱文件**，`data` 回路径。  ★★★#1191 更正（独立验证 B4）：原文写「内存与文件大小无关」——**对鸿蒙不成立，且未取证**。 · Android / iOS：逐块写文件，已验证； · **鸿蒙**：我们这层确实逐块直写（`SaveSession`），但 RCP 的 `Rcp_Response.body` 仍可能把整包驻留（`HMS_Rcp_SetRequestOnBinaryDataRecvCallback` 只"替换回调"， 没有关闭整包驻留的开关）⇒ **内存上限未取证**。 ⇒ 准确说法：**"避免框架层的第二份拷贝；是否与文件大小无关取决于宿主栈，鸿蒙端未取证"**。 大文件落盘前请按目标端实测（本仓待补 `VmHWM` 对照）。 |
| `onChunk` | `(chunk: Uint8Array, seq: number) => void` | — | ★#1122 流式消费：每块回调一次，内存不随响应体增长。**回调同步**（宿主回推的 JS 线程上）。 App 逐块回推；Web 用 ReadableStream（节奏不同）；**MP 不支持** ⇒ unsupported。 |
| `upload` | `UploadSpec` | — | ★#1122 流式上传（仅 App）：宿主自读文件、自拼 multipart、边读边发。Web/MP 用各自上传 API ⇒ unsupported。 |
| `signal` | `AbortSignalLike` | — | ★#1122 取消：`abort()` ⇒ 立即 `fetch.aborted`，并尽力通知宿主中止传输。 App 用 `createAbortController()`（引擎无原生 AbortController）；Web 用原生 `AbortSignal`；**MP 不支持**。 |
| `retry` | `number \| RetryPolicy` | — | ★#1133 重试：数字 = 额外次数；对象 = 覆盖管线默认策略。 ★只对**可恢复**失败生效（网络错误 / 超时 / 429 / 5xx）——取消与能力缺失不重试。 |
| `priority` | `number` | `0` | ★#1133 排队优先级（越大越先发；默认 0）。并发打满时用于"首屏关键请求优先"。 |
| `redirect` | `'follow' \| 'manual' \| 'error'` | — | ★#1134 重定向策略： · `follow`（默认）= 平台跟随（老行为，宿主自己跟）； · `manual` = **不跟随**，3xx 原样返回（`status` + `headers.location` 可直接读）； · `error` = 遇到 3xx 直接失败（`fetch.redirectForbidden`）。 ★给出 `onRedirect` 时会**自动**走逐跳拦截（无需显式写本字段）。 ★MP 端不支持 `manual`/`error`/`onRedirect` ⇒ `fetch.unsupported`（`wx.request` 无此能力）。 |
| `maxRedirects` | `number` | `5` | ★#1134 最多跟随几跳（默认 5）。超过 ⇒ `fetch.tooManyRedirects`（真实错误）。 ★只在 `manual` / `onRedirect`（即框架层在跟）时生效。 |
| `onRedirect` | `(hop: RedirectHop) => RedirectDecision \| Promise<RedirectDecision>` | — | ★#1134 **逐跳拦截**：每遇到一次重定向调一次；返回 `{action:'stop'}` 可拒绝。  【为什么这是超级应用必须的】重定向是**框架看不见的跳转**：API 302 到第三方域时， 宿主会把 `Authorization` 带过去（open-redirect 凭据泄露）。有了本回调，业务能看见每一跳 并决定跟不跟；**跨域时框架还会自动剥离凭据头**（不经业务决策，安全底线）。  ★回调里 `hop.from/to/status/methodChanged` 都是可记录的审计信息。 |
| `redirectManual` | `boolean` | — | ★#1134 **宿主级**开关（一般不直接用）：true ⇒ 宿主不跟随（见线格式 `Redirect` tag）。 ★由管线在 `redirect:manual` / 有 `onRedirect` 时自动置位；业务手写无副作用（语义一致）。 |
| `cache` | `FetchCacheMode` | — | ★★★#1149 **HTTP 缓存模式**（对齐浏览器 `Request.cache` 的六个标准值）。  【为什么必须有】App 端的字节腿是**裸 HTTP**——Android `HttpURLConnection` 不启用 `ResponseCache`、 鸿蒙 RCP 亦不做条件缓存；而浏览器/小程序会自动做。⇒ 不显式给业务这个旋钮， 同一份源码在三端就会"Web 命中 304、App 每次整包回源"。  · `default`（管线开启缓存时的默认）= 新鲜则直用，过期则带 `If-None-Match`/`If-Modified-Since` 回源； · `no-store` = 不读也不写缓存； · `reload` = 忽略缓存、强制回源（并刷新缓存）； · `no-cache` = 跳过"新鲜直用"，但仍带校验器回源（304 则复用）； · `force-cache` = 有缓存就用（即使过期），没有才回源； · `only-if-cached` = 只用缓存；无条目 ⇒ `fetch.cacheMiss`（**不联网**）。  ★只对 GET 的 200/203 生效；流式/落盘/上传不缓存。 ★不写它时：管线未开缓存 ⇒ 行为与从前完全一致（零回归）；管线开了 ⇒ 用管线默认模式。 |
| `bypassPlatformCache` | `boolean` | — | ★#1149 **内部字段**（一般不写）：让 Web 腿把浏览器自带的 HTTP 缓存让开， 使缓存语义在本框架层成为唯一来源（否则"浏览器命中"与"我们命中"两套计数/语义会漂移）。 |
| `tlsPins` | `string \| string[]` | — | ★★★#1153 **TLS 证书 pinning**（仅 App 三端；Web 由浏览器管 TLS、MP 的 `wx.request` 不暴露）。  传 **base64 SHA-256 SPKI 指纹**数组（换行/逗号/空格分隔的字符串也接受）。  【为什么钉 SPKI 而不是钉整张证书】整张证书在**续期**（同一密钥）时指纹就变了 ⇒ 每次续期都得改代码； SPKI 跨续期稳定，且能自然覆盖"链上任意一张证书"（含中间 CA）。  【默认语义 = 叠加】系统信任必须通过 **且** pin 必须命中（防 MITM 的额外一道防线）。 要"只看 pin"（企业自签场景）须显式 `tlsPinOnly: true`。  【命中即通过】`sniHostname` 仍按平台默认校验（pinning **不**替代主机名校验）。  ★失败 ⇒ `fetch.tlsError`（独立错误码，不混进 `fetch.failed`）——业务据此区分"证书不对"与"网络不好"。 |
| `tlsPinOnly` | `boolean` | — | ★★★#1153 `tlsPins` 的**信任语义**： · 缺省/`false` = **叠加**（系统信任 + pin 都要过）——生产默认，最安全； · `true` = **替代**（只看 pin，仍校验主机名）——企业内网/自签证书场景。 ★它**放宽**了信任锚，所以只由业务显式开启，绝不默认。 |
| `httpDns` | `Record<string, string \| string[]>` | — | ★★★#1169 **HTTPDNS**：本次请求的**域名 → IP 映射**（键 = 域名，值 = `string[]` 或逗号分隔串）。  【什么时候用它】业务已通过 HTTPDNS 服务（自建/云厂商）拿到 IP，希望**绕过系统 DNS**直连—— 典型动机：系统 DNS 被投毒/劫持、需要就近调度、或首包延迟敏感（省一次 DNS 往返）。  【★语义（三端同一套）】 · 只影响**表里出现的域名**；表里没有的域名**照旧走系统 DNS**（不改变其他域名行为）； · IP 顺序即**尝试顺序**（多 IP 时宿主按序回退，与浏览器 Happy Eyeballs 精神一致但不做竞速）； · **SNI 与证书主机名校验仍用原域名**（不是 IP）——否则 TLS 会失败或退化成不安全模式。 ★这条是硬约束：把 URL 换成 IP 直连会破坏 SNI/主机名校验，HTTPDNS 必须走"解析注入"而非"URL 改写"。  【★端差异：如实，不粉饰】 · **Android** ✅ OkHttp `Dns`（#1160 已有注入点） · **鸿蒙** ✅ RCP 静态 DNS 规则（#1169 真机实证注入生效） · **iOS** ❌ `URLSession` **没有**自定义 DNS 钩子 ⇒ 传了本字段 ⇒ **`fetch.unsupported`** （不静默忽略——否则业务以为用了 HTTPDNS，实际走了系统 DNS，属于"假数据比缺数据更糟"）  【★与缓存/失败的关系】 · 本字段只作用于**当次请求**；框架层不缓存解析结果（HTTPDNS 的 TTL 归业务/服务商管）； · 表里的 IP 全部不可达 ⇒ 请求按网络错误失败（**不回退系统 DNS**——回退会掩盖 HTTPDNS 故障）。  @example ```ts useFetch('https://api.example.com/data', { httpDns: { 'api.example.com': ['203.0.113.10', '203.0.113.11'] }, }) ``` |

### `UploadSpec`

★#1122：流式上传规格（宿主据此自读文件 + 自拼 multipart）。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `path` | `string` | — | 沙箱相对路径（与 `fs.readBytes` 同一套校验：拒绝绝对路径与 `..`） |
| `fieldName` | `string` | — | multipart 字段名（如 `file`） |
| `filename` | `string` | — | 上传文件名（进 `Content-Disposition` 的 filename） |
| `boundary` | `string` | — | multipart 边界串——**必须与 `Content-Type` 头里的一致** |
| `formData` | `Record<string, string>` | — | 普通表单字段（按插入序编码） |

### `AbortSignalLike`

最小取消信号契约（兼容原生 `AbortSignal` 与 `createAbortController()` 的产物）。
★只要求 `aborted` 可读 ⇒ 浏览器原生 `AbortSignal` 与 App 侧 `createAbortController().signal`
都能直接传入 `useFetch(url, { signal })`，无需适配层。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `aborted` | `boolean` | — | 是否已取消。`useFetch` 在请求期间读它；取消后 Promise 以 `fetch.aborted` 结束。 |

### `RetryPolicy`

重试策略（与 `capability-fetch-pipeline.ts` 的 `RetryPolicy` 同构）。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `attempts` | `number` | `0` | 额外重试次数（默认 0 = 不重试） |
| `delayMs` | `number` | `300` | 首次退避（ms，默认 300） |
| `backoff` | `'fixed' \| 'linear' \| 'exponential'` | ``exponential`` | 退避曲线（默认 `exponential`） |
| `jitter` | `number` | `0.2` | 抖动比例 0~1（默认 0.2；避免重试风暴同步打点） |
| `retryOn` | `(res: FetchResult<unknown>, attempt: number) => boolean` | `网络类失败` | 判定是否重试（默认：网络类失败 + 429/5xx；**不重试** aborted/unsupported/tooLarge/intercepted） |

### `RedirectHop`

单跳记录（`onRedirect` 的入参、`FetchResult.redirects` 的元素）。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `status` | `number` | — | 本跳的状态码（301 / 302 / 303 / 307 / 308…） |
| `from` | `string` | — | 本跳请求的 URL（跳转**前**） |
| `to` | `string` | — | 目标 URL（来自 `Location`，已按 RFC 3986 相对解析） |
| `methodChanged` | `boolean` | — | 方法是否被改写（303 ⇒ 通常改 GET；301/302 按浏览器惯例也改 GET） |

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

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | `string` | — | 请求 id（与 `FetchTask.id` 一致；日志/埋点用它串起来） |
| `attempts` | `number` | — | 实际发出的轮次（含首次；1 = 没重试） |
| `queuedMs` | `number` | — | 在并发队列里等待的时间（ms）——**慢在排队**还是慢在网络，看这个 |
| `totalMs` | `number` | — | 从入队到结算的总墙钟（ms） |
| `attemptMs` | `number[]` | — | 每轮耗时（ms；下标 = 轮次） |
| `deduped` | `boolean` | — | 是否命中去重（本次没真发请求，用的是别人在飞的结果） |
| `priority` | `number` | — | 排队优先级（观测用） |
| `retryDelaySkipped` | `boolean` | — | ★App 精简引擎无 `setTimeout` ⇒ 重试未等待（如实标记，不谎称退避过） |
| `redirects` | `RedirectTrace` | — | ★#1134：重定向轨迹（仅在发生过跳转/被拦截/超限时出现）。`hops` 是逐跳审计记录。 |
| `deadlineMs` | `number` | — | ★#1135：本次请求的总时限预算（ms；未设置则不出现）。 |
| `deadlineHit` | `boolean` | — | ★#1135：是否因总时限耗尽而失败（`fetch.deadline`）。 |
| `cache` | `FetchCacheMeta` | — | ★★★#1149：本次请求的缓存结局（未启用缓存时不出现）。 `hit` 直接命中新鲜缓存（**没有发网络请求**）/ `revalidated` 304 复用 / `miss` 回源 / `bypass` 不适用（非 GET、流式等，或 `no-store`）。 |
| `transport` | `TransportMeta` | — | ★★★#1158：**宿主侧传输层读数**（本次请求的最后一轮）。  【它解决什么】"网络慢"长期只有 `totalMs` 一个数 ⇒ 分不清**排队 / DNS / 建连 / TLS / 首字节**。 本字段由宿主实测提供（iOS `URLSessionTaskMetrics` · Android `OkHttp EventListener`（#1160 换栈后） · 鸿蒙 `Rcp_TimeInfo`）。  【★逐端可得性 —— 缺的键**不出现**，不是 0/false】 | 端 | proto | reused | dnsMs | connectMs | tlsMs | ttfbMs | |---|---|---|---|---|---|---| | iOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | Android | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（#1160 换 OkHttp 后全字段；`ttfbMs` 为纯首字节） | | 鸿蒙 | — | — | ✅ | ✅ | ✅ | ✅ | | Web | ✅ | — | — | — | — | — | | MP | （整项不出现：`wx.request` 不暴露任何传输读数） |  ★**"不可得"与"测到 0"是两件事**：宿主不提供时这里就是 `undefined`，绝不填 0—— 否则业务会据此判断"DNS 只花了 0ms"（假的）。 ★缓存的命中（`cache.hit`）**不发网络请求** ⇒ 本字段不出现（不是"0ms"，是没有）。 |

### `CapError`

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `code` | `string` | — | — |
| `message` | `string` | — | — |
| `cause` | `unknown` | — | — |

### `RedirectTrace`

跟随循环的记账（放进 `FetchMeta`，让业务/排障能看到跳了几跳）。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hops` | `RedirectHop[]` | — | — |
| `exceeded` | `boolean` | — | 是否因为超过 `maxRedirects` 而停（真实错误，不是成功） |
| `stopped` | `boolean` | — | 是否被 `onRedirect` 主动停止 |
| `stopReason` | `string` | — | — |

### `FetchCacheMeta`

`FetchMeta.cache`：没有它就无法回答"这次到底走了网络没有"。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `status` | `FetchCacheStatus` | — | hit = 直接命中新鲜缓存；revalidated = 304 复用；miss = 回源；bypass = 未启用/不适用；stale = 返回过期值 |
| `ageMs` | `number` | — | 命中条目的年龄（ms，仅 hit / revalidated / stale / force-cache 时有意义） |
| `stored` | `boolean` | — | 本次响应是否写进了缓存（miss 时才有意义；304 更新也算 true） |
| `mode` | `FetchCacheMode` | — | 实际使用的缓存模式（排障用：确认业务传的 cache 生效了） |
| `staleReason` | `'swr' \| 'stale-if-error' \| 'force-cache'` | — | ★#1150：stale 的来源——`swr` 窗口内主动复用 / `stale-if-error` 回源失败兜底 / `force-cache` 业务要求 |
| `revalidating` | `boolean` | — | ★#1150：本次是否触发了**后台校验**（SWR 专用；`true` 表示旧值已返回、新值稍后进缓存） |

### `TransportMeta`

★★★#1158：宿主侧传输层读数（**类型化、已解析**；线格式见 `invoke-wire.ts` 的 `Transport=22`）。
所有字段可选——缺 = 该端测不到。毫秒字段为浮点（iOS/鸿蒙给小数）。

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `proto` | `string` | — | 实际协商的协议版本（`"h2"` / `"http/1.1"`） |
| `reused` | `boolean` | — | 是否复用已有连接（`true` = 复用了连接池里的连接，没有新建 TCP） |
| `dnsMs` | `number` | — | DNS 解析耗时（ms） |
| `connectMs` | `number` | — | TCP 建连耗时（ms；**不含** DNS） |
| `tlsMs` | `number` | — | TLS 握手耗时（ms；**不含** DNS/TCP） |
| `ttfbMs` | `number` | — | 首字节耗时（ms；从发起请求到收到响应首字节） |
| `dnsSource` | `'table' \| 'system' \| 'literal' \| 'resolver'` | — | ★★★#1183：**本次请求的域名解析走了哪一级**（HTTPDNS 可观测面）。  - `'table'`：命中业务给的 `httpDns` 表（**这是"表真的生效"的唯一直接证据**）； - `'system'`：表未命中 ⇒ 回落系统 DNS（**回落是显式的，不是静默**）； - `'literal'`：URL 本身就是 IP ⇒ 根本没有解析； - `'resolver'`：命中进程级解析器（Android 的 `setHttpDns`）。  ★**为什么必须有这个字段**：`httpDns` 生效与否，从外部只有"请求成败"一个间接信号； 而"注入不可达 IP ⇒ 失败"与"网络本来就不通"看起来一样（#1169 首跑踩到）。 ★缺 = 该端不上报（不写 `'system'` 冒充"确定走了系统"——那是假数据）。 |
| `dnsTableHit` | `boolean` | — | ★★★#1183：本次请求是否命中了 `httpDns` 表（与 `dnsSource === 'table'` 同义，但更直白） |

### `FetchCacheStatus`

一次请求的缓存结局（`FetchMeta.cache.status`）。

| 取值 | 说明 |
|---|---|
| `'hit'` | — |
| `'revalidated'` | — |
| `'miss'` | — |
| `'bypass'` | — |

## 错误码

| code | 说明 |
|---|---|
| `fetch.unsupported` | fetch 不支持（Node<18/SSR） |
| `fetch.aborted` | 请求已取消（signal.abort()） |
| `fetch.timeout` | 请求超时（未在 timeout 内完成） |
| `fetch.failed` | 请求失败（网络/解析/其他） |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge 实现（平台 API 直连） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.request |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | ✅ | native-ios（UIKit + CoreAnimation） · App 宿主桥（capability-app.ts）· 桥方法已接入 |
| Android 原生 | ✅ | native-android（自绘 Canvas） · App 宿主桥（capability-app.ts）· 桥方法已接入 |
| 鸿蒙 | ✅ | native-harmony（ArkUI RenderNode） · 鸿蒙宿主已接线（invoke_bytes_bridge.h / proteus_http.h） · 真机已验证（transport-probe 3/3 200 · 3 请求/1 连接 · fetch-limit 两道闸均 `fetch.tooLarge`）· ★**三处受限**：① **`abort()` 是 no-op**（一次性 VM + 同步 napi ⇒ 请求期间 JS 被占、没有"在飞请求"可取消；连本地 reject 都不会发生）⇒ 要限时请用 `timeout`；② **`stream: true` 如实拒绝**（`fetch.unsupported`——逐块回推没有接收方）⇒ 要边收边处理请用 `savePath`（宿主逐块落盘）；③ **SPKI pinning 未接**（RCP 只提供 CA 配置，不做 fingerprint 校验）⇒ 本端 pin 不生效，请勿据此判断安全策略已成立 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供**或桥是纯空壳**→Err 显式降级（方法存在但每一条路径都返回 unsupported 不算可用）；🟡 能力桥未接线；⬜ 端未开始。★**各端判据严格度不同**：微信/Web 要求桥方法存在**且方法体真有平台对接**；iOS/Android 要求 App 桥工厂里有该方法；鸿蒙要求 JS 桥 + 宿主分派**双证据**。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const res = await useFetch<{ id: number; name: string }>('/api/user/1')

if (res.ok) {
  console.log(res.data.name) // 响应自动 JSON 反序列化
} else if (res.error.code === 'fetch.unsupported') {
  // 桥未提供 request → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->
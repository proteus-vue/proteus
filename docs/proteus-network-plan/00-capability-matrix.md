# 00 · 网络层能力矩阵：`useFetch` 距离"超级应用可承载"还差什么

> ★★★决策 #1133 · 2026-10-20 · 触发：用户点名
> 「我们现在的 useFetch 能力完善了吗？可以承载大厂超级应用使用场景了吗？我看 HttpDns、高性能模式、
> http2、请求拦截、重定向拦截、请求缓存、RequestTask、网络调优等等好像都没做。能力可以对齐小程序的
> wx.request，但是实现上面可以不用照搬，从我们框架最佳方式来就行……总之就是我们框架提供给开发者的
> 就是能承载超级应用的成熟能力，非 demo 基本能力的高标准落地。」

本文是**诚实的缺口账**（不是愿景）：每一行注明「现状 / 这是哪一层的事 / 是否本轮做了」。
★判定口径：**"能达到 S3" 只说明"传输层做对了"，不等于"业务能安全地在超级应用里用"**。
真正让业务方在超级应用里敢用的，是**请求治理**（拦截/重试/并发/可取消/可观测），不是传输协议。

---

## 1. 一张表：用户点名的九项，逐项对账

| # | 能力 | 现状（取证） | 属哪一层 | 本轮 |
|---|---|---|---|---|
| 1 | **HTTPDNS** | **零实现**（全仓 `grep enableHttpDNS/httpDNSServiceId` = 0 处）。三端都走系统 DNS。★**#1160**：Android 已落 **`Dns` 注入 seam**（`HttpTransport.setHttpDns`，`HttpURLConnection` 根本给不了这个接入点）——但**业务 API + 线格式 tag 未做**，seam 目前无调用方 ⇒ 仍算「未实现」，只是**前置已具备** | 宿主传输 / 业务 SDK | 🟡 Android 接入点✅（#1160 seam）；业务面 ❌ |
| 2 | **高性能模式** | **无此概念**。Android ~~`HttpURLConnection` 默认连接池~~ ⇒ ★**#1160 换 OkHttp**（进程级 `ConnectionPool(8, 5min)`）；iOS `URLSessionConfiguration.default` 复用会话。★**#1155 取证：连接复用两端都已在工作**（真机各 3 请求 / 1 连接）；★**#1160 换栈后 Android 仍 3/1**（未退化） | 宿主传输 | 🟡 连接复用✅（#1155 取证 · #1160 未退化）；余项见 §3 |
| 3 | **HTTP/2** | ★★★**三端全具备**：**Android #1160** 换 OkHttp 3.14.9（`protocols(HTTP_2, HTTP_1_1)`，真机 `{"h2":3}`）· **iOS** 平台默认已协商（#1155）· ★★★**鸿蒙 #1166 已取证：本来就具备**（RCP 底层是 libcurl，公网真机 `http=http/2` + `tls=TLSv1.3`）——原记的"鸿蒙需先接 CA/pinning"**是误判**（把"探针连不上自签服务端"当成了"平台不支持"，见 §3 专项） | 宿主传输 | ✅ Android + iOS + 鸿蒙 |
| 4 | **请求拦截** | ★**本轮做了**：`requestInterceptors` / `responseInterceptors`（洋葱模型，可改 url/headers、可短路） | **框架策略（TS）** | ✅ |
| 5 | **重定向拦截** | ★**本轮做了**：`redirect: follow\|manual\|error` · `maxRedirects` · `onRedirect` 逐跳回调 · ★**跨域自动剥离 Authorization/Cookie**。宿主侧：Android `followRedirects(!manual)`（OkHttp，per-call 经 `newBuilder()` 派生，四条路径统一 `HttpTransport.CallConfig.redirectManual`）· iOS `willPerformHTTPRedirection`（manual ⇒ `completionHandler(nil)`）· 线格式新增 `Redirect=11` tag（五端逐字节对拍） | **框架策略（TS）+ 宿主最小能力** | ✅ |
| 6 | **请求缓存** | ★**#1149 已做（框架层）**：`config.cache`（对齐浏览器 `Request.cache` 六值）+ `Cache-Control`（max-age / no-store / no-cache / must-revalidate）+ `ETag`/`Last-Modified` 条件请求 + **304 ⇒ 缓存体合成 200** + `Vary` 分桶 + 内存 LRU 预算；★**#1150 已做**：RFC 5861 `stale-while-revalidate` / `stale-if-error` + `Age` 头；★**#1151 已做（L2 持久层）**：`cache: { persist: true }` ⇒ Web/MP 走 KV、App 走文件（`fs.*`），**跨进程重启仍命中**（真机双端各 13/13） | **框架策略（TS）** | ✅（含持久层） |
| 7 | **RequestTask** | ★**本轮做了**：`useFetchTask()` → `FetchTask`（`result` / `state` / `abort(reason)`）。★形状是 Promise + abort，**不复刻** wx 的回调对象 | **框架策略（TS）** | ✅ |
| 8 | **网络调优** | **无**：无并发上限（本轮前）、无优先级、无超时分级、无弱网退避 | **框架策略（TS）** | ✅ 并发/优先级/退避已做；**连接参数调优仍属宿主（未做）** |
| 9 | **观测/排障** | ★**本轮做了**：`FetchMeta`（`queuedMs` / `attemptMs[]` / `attempts` / `deduped` / `priority`） | **框架策略（TS）** | ✅ |

**结论（一句话）**：**9 项里 6 项已落地**（4 请求拦截 · 5 重定向拦截 · 6 请求缓存（框架层）·
7 RequestTask · 8 网络调优的策略部分 · 9 观测）；**1 项已具备**（2 高性能模式的**连接复用**三端都在工作：
Android/iOS `3 请求/1 连接`、鸿蒙 #1156 修后 3/1）· **3 HTTP/2 三端全具备**（iOS 平台默认 · Android #1160 换栈 ·
鸿蒙 #1166 取证本来就有）；
**真缺口剩 1 项**（1 **HTTPDNS 业务化**——三端都还没有业务 API/线格式；
接入点已具备：Android `Dns` seam #1160 / 鸿蒙 RCP 内置 DoH #1166 / iOS 仍待定）。

---

## 2. 为什么这些缺口"不该在本轮硬塞"

### 2.1 传输层能力必须在宿主实现（不在 TS）

HTTPDNS / HTTP/2 / 连接池 / 证书锁定（pinning）/ 弱网调优 的落点**只有一个**：宿主传输栈。
- Android：`HttpURLConnection` 无法自定义 DNS（要换 OkHttp 的 `Dns` 接口）；
- iOS：`URLSession` 的 DNS 由系统决定（要自定义需 `Network.framework` 或自建 socket）；
- 鸿蒙：`RemoteCommunicationKit` 也走系统。

⇒ 换传输栈（Android → OkHttp）是**一个独立的大单**，涉及：
  · Android 新增 OkHttp 依赖（APK 体积 + ~500KB，需评估）；
  · iOS 需评估 `Network.framework` 自建，或接受"DNS 交给系统"；
  · 三端要**同一套可观测字段**（否则判据无法跨端比对，违反本仓"三端同判据"纪律）。
  ⇒ 本轮先做**框架层**（平台无关、三端同一份、立刻可用），传输层按 §3 分期。

### 2.2 "对齐 wx.request"的正确理解

用户明确「能力可以对齐小程序的 wx.request，但是实现上面可以不用照搬」。本轮的取舍：

| wx.request 的形态 | 我们的形态 | 为什么 |
|---|---|---|
| `wx.request` 返回 `RequestTask`（**回调对象**） | `useFetchTask()` 返回 `FetchTask`（**Promise + abort**） | Promise 形状可直接 `await`，取消是显式动作；不需要记 `task.abort` 的回调签名 |
| 并发上限**隐式 10**（不可配） | `concurrency` **显式可配**（默认 10） | 超级应用需要按页面/业务分层（首屏 3、预取 2） |
| 失败只有 `errMsg` 字符串 | `FetchResult.error.code` + `FetchMeta` | 业务要能区分"重试有用/没用"，并知道慢在哪 |
| `enableHttp2` / `enableHttpDNS` 等**客户端开关** | ❌ 未做（见 §3） | 需要宿主换栈，不能只在 JS 加字段 |
| 无内置重试 | `retry` 策略（指数退避 + 可重试判定） | 弱网下 5xx/超时是常态，业务不该每个页面各写一遍 |

★**刻意不做**的两件事（避免"照搬"带来的包袱）：
1. **不提供 `wx.request` 那种"全字段大对象"**——字段按语义分组（传输 / 策略 / 观测），新增能力不挤进同一层；
2. **不伪造 `RequestTask` 的 `onHeadersReceived`/`onChunkReceived` 回调**——我们的流式走 `onChunk(chunk, seq)`（#1118，真背压），
   只在 App/Web 支持；MP 如实 `unsupported`（不假装有）。

---

### 2.3 重定向已落地（#1134 · 本轮）

**做了什么**：

| 能力 | 入口 | 语义 |
|---|---|---|
| `redirect: 'manual'` | `useFetch(url, { redirect: 'manual' })` | **不跟随**，拿回 `status` + `headers.location` |
| `redirect: 'error'` | 同上 | 遇 3xx 直接失败（`fetch.redirectForbidden`） |
| `maxRedirects` | 同上（默认 5） | 超过 ⇒ `fetch.tooManyRedirects`（真实错误，不静默成功） |
| `onRedirect` | `useFetch(url, { onRedirect(h) })` | **逐跳回调**：`{status, from, to, methodChanged}`；返回 `{action:'stop'}` 可拒绝 |
| ★**跨域剥离凭据** | 自动（无需业务决策） | 跳转到**不同 origin** ⇒ 剥离 `Authorization` / `Cookie` / `Proxy-Authorization` |

**架构取舍（为什么宿主只做一小块）**：宿主只执行"**不跟随**"（线格式 `Redirect=11` tag）；
跟随循环 / 限额 / 拦截 / 凭据剥离 / RFC 方法改写全在 `capability-fetch-redirect.ts`（跨端同一份）。
理由：这些都是**策略**，放宿主就要"网络线程回调 JS"（违反线程纪律）或两端各写一套（必然分叉）。

**端差异（如实）**：

| 端 | 实现 | 状态 |
|---|---|---|
| Android | `followRedirects(!manual)`（OkHttp，per-call 经 `newBuilder()` 派生；四条请求路径统一 `HttpTransport.CallConfig.redirectManual`） | ✅ |
| iOS | `URLSessionTaskDelegate.willPerformHTTPRedirection` ⇒ manual 时 `completionHandler(nil)` | ✅ |
| Web | 原生 `fetch(url, { redirect: 'manual' })`（比 JS 逐跳重发省一次往返） | ✅ |
| **MP** | `wx.request` **隐式跟随且不可关** | **❌ `fetch.unsupported`**（如实） |

**RFC 语义（基准 = 标准真值，不是各端看着办）**：
303 ⇒ 一律改 `GET` 并丢 body；301/302 ⇒ **仅 POST** 改 `GET`；307/308 ⇒ 保持方法与 body。
## 3. 缺口分期（按"能交付什么"切，不按"想做多少"）

### P0 · 本轮已交付（框架策略层，三端同一份）

| 能力 | 入口 | 判据 |
|---|---|---|
| 请求/响应拦截器（洋葱模型） | `createCapabilityHooks(bridge, { fetch: { requestInterceptors, responseInterceptors } })` | `tests/fetch-pipeline.test.ts`（20 条） |
| 重试（指数退避 + 可重试判定 + 单请求覆盖） | `fetch: { retry }` / `useFetch(url, { retry })` | 同上 |
| 并发上限 + 优先级 | `fetch: { concurrency }` / `useFetch(url, { priority })` | 同上 |
| 去重（同飞共享；含 body 键） | `fetch: { dedupe: true }` | 同上 |
| 任务句柄（可取消，排队中不占额度） | `useFetchTask(url, config)` | 同上 |
| 观测（排队/每轮/总耗时/去重标记） | `res.meta` | 同上 |

### P1 · 传输层（需换栈，**独立立项**）

> ★**重定向可拦截已从本表移出**（它**不需要换栈**——两端都有原生钩子）⇒
> 见上方"§2.3 重定向已落地"；执行证据见 §4。
> ★★**证书 pinning 也已移出（#1154）**——同一判断：它同样**不需要换栈**
> （Android `setSSLSocketFactory` + `X509TrustManager`；iOS `URLSession` challenge 回调），
> 见下方"P1 · 已落地"。
> ★★★**连接池也已移出（#1155 取证）**——它**两端一直都在工作**，不是缺口：
> 真机实测 Android `3 请求 / 1 TCP 连接`、iOS `3 请求 / 1 TCP 连接`（证据
> `hosts/{android,ios}/results/transport-probe.json`，门禁 `check:cache-evidence`）。
> 本轮反而抓出**我们自己**破坏它的真回归（见下方"P1 · 已落地"的 pinning 行）。
> ★★★**鸿蒙也已补齐（#1156）**——`#1155` 曾记成"鸿蒙端未跑"，**真实原因是 `hdc` 不在 PATH
> 被误判成无设备**（设备一直连着）。补齐过程中抓出**鸿蒙端零连接复用的真缺陷**：
> 生产路径每请求建/关 RCP session + 用同步 `HMS_Rcp_FetchSync` ⇒ 真机 `3 请求 / 3 TCP`；
> 修为「进程级 session + **异步** `HMS_Rcp_Fetch`」后 `3 请求 / 1 TCP`。
> ⇒ **P1 只剩两项**：HTTPDNS（两端都需要自定义解析）与 **HTTP/2（Android 与鸿蒙都缺）**。
>
> ★★★**#1160 收口了 HTTP/2 的 Android 侧**：宿主传输栈换成 **OkHttp 3.14.9**
> （纯 Java 线；APK **+180 KB**，对比 4.x + Kotlin stdlib 的 **+929 KB**）。真机
> `server_protocols={"h2":3}` + `3 请求 / 1 TCP`（复用未退化）。同一笔换栈还买到了：
> **全字段传输读数**（`EventListener` 的 dns/connect/tls/ttfb + reused）与
> **HTTPDNS 的 `Dns` 注入 seam**（业务 API 仍属下一单）。
> ⇒ **P1 真正剩余**：① HTTPDNS 业务化（seam 已就绪）② 鸿蒙 h2（需先接 CA/pinning）。

| 能力 | 落点 | 前置 | 判据设计（可执行） |
|---|---|---|---|
| HTTPDNS | Android ~~OkHttp `Dns` 接口~~ ⇒ ✅**seam 已落（#1160）**，待业务 API / 线格式 tag；iOS `NWConnection` 自定义解析 | ~~Android 需引入 OkHttp~~ ✅ 已引入（+180 KB）；iOS 需自建解析或 `Network.framework` | 断言：域名解析走注入的解析器（假解析器返回假 IP，请求仍到达测试服务） |
| **HTTP/2（Android）** | ✅ **#1160 已交付**：OkHttp `Protocol.HTTP_2` 显式协商 | — | 真机 `server_protocols` 含 `h2`（`bash hosts/android/run-transport-probe.sh` 现读数 **`http2_ok=true`**） |
| **HTTP/2（鸿蒙）** | ★★★**#1166 已取证：本来就具备**——RCP 底层是 **libcurl**（真机响应头 `uag=libcurl-agent/1.0` 可证），走系统 TLS 栈自动 ALPN。见下方专项 | **无需任何前置**（原写"需先接自定义 CA/pinning"**是错的**） | 真机 `https://www.cloudflare.com/cdn-cgi/trace` 的 `http=http/2`（`hosts/harmony/results/http-probe-h2.json`）；静态判据 `tests/harmony-http2-evidence.test.ts` |

★★★**#1166 专项：鸿蒙 HTTP/2 ——「需先接 CA/pinning」这个前提被实测推翻**

矩阵与决策 #1163/#1165 一路记着「鸿蒙 RCP 需先接自定义 CA/pinning 才可能协商 h2」——**这句是错的**。
**这是错的**，两层误判叠在一起：

1. **把"探针连不上自签服务端"当成了"平台不支持 h2"**：`run-transport-probe.sh` 用**自签证书**的
   本地 h2 服务端（为了能核对 SPKI pin），而鸿蒙宿主未接自定义 CA ⇒ 那个服务端连不上
   ⇒ `http2_ok=null`（未测）。**这是装置限制，不是能力缺失**。
2. **没验证 RCP 的底层**：`librcp_c.so` 的能力面取决于它链接的 HTTP 栈。#1166 实测：
   请求 `https://www.cloudflare.com/cdn-cgi/trace`，响应体回显 `uag=libcurl-agent/1.0`
   ⇒ **RCP 底层就是 libcurl**；libcurl 原生支持 ALPN + h2，而**公网证书是系统信任的**，
   根本不需要自定义 CA。
   ★RCP 头文件也印证：`Rcp_TransferConfiguration` **没有 HTTP 版本选项**
   （只有 `autoRedirect` / `timeout` / `assumesHTTP3Capable` / `pathPreference`）
   ⇒ 协议版本完全交给 libcurl 的 ALPN 协商，我们**无需也无法**显式指定。

**真机读数（2026-10-22 · HUAWEI KLE-AL00U · 公网）**：
`http=http/2` · `tls=TLSv1.3` · `kex=X25519` · `sni=plaintext` · `visit_scheme=https`
⇒ **鸿蒙端已在用 HTTP/2 + TLS 1.3**，且不是我们配置的结果，是平台默认行为。

★**这意味着两件事**：
· P1 的「HTTP/2（鸿蒙）」**可以销项**——原以为要先做一笔"接 CA/pinning"的前置工程，实际不需要；
· `run-transport-probe.sh` 的 `http2_ok=null` 会**继续**是 null（它连自签服务端，测不了这本就正常），
  ⇒ 鸿蒙 h2 的判据**不能用那份证据**，必须用公网端点（本单已加 `http-probe-h2.json` + 判据）。

★★**顺带发现的更大一件事：RCP 内置 DoH**。`rcp.h` 里有
`Rcp_DnsOverHttps { url, skipCertificatesValidation }` 与注释
「DNS configuration on HTTPS. If set, the address resolved by the DOH dns server is preferred.」
⇒ **鸿蒙的 HTTPDNS 落点是现成的**（配置 `doh.url` 即可，不需要自建解析器）。
这直接改写矩阵第 1 项（HTTPDNS）的鸿蒙侧工程量：从"需自建解析"降为"接一个配置项 + 对齐线格式语义"。
★诚实边界：本单只做了**头文件取证**，未实测 DoH 生效（需可达的 DoH 服务端 + 真机对照）⇒ 已登记后续单。

★**为什么"HTTP/2 只剩 Android"这条很重要（它改变了工程量判断）**：
矩阵原先写"HTTP/2 + 连接池：需 Android 引入 OkHttp"，读起来像"三端都要补"。
实测是**端差异**：iOS 的 `URLSession` **默认协商 h2**（真机 `client_protos=["h2","h2","h2"]`、
服务端 `{"h2":3}`），Android 的 `HttpURLConnection`（AOSP 底层虽为 okhttp）**默认不开 h2**
（真机 `["http/1.1","http/1.1","http/1.1"]`）。
⇒ 换栈只该为**一个端的一项能力**付费；若未来只为"Android 上 h2"引 OkHttp，
必须显式说明"iOS 已具备、另两端不受影响"，而不是笼统说"补齐传输层"。

**P1 · 已落地**：

| 能力 | 做法 | 判据 |
|---|---|---|
| **TLS 证书 pinning** | ✅ **#1154**：`tlsPins`（**SPKI** 指纹，换行/逗号/数组都接受）+ `tlsPinOnly`（`true`=替代系统信任；缺省=**叠加**）。宿主：Android `TlsPinning`（`X509TrustManager` 代理默认信任 + 逐证书 `SHA-256(getPublicKey().getEncoded())`）· iOS `TlsPinningIos`（challenge 回调 + `SecKeyCopyExternalRepresentation` **补 SPKI 头**再哈希）。线格式 `Pins=12` / `PinOnly=13`（五端 40 向量逐字节等价） | 真机双端各 **11/10 条**：pin 命中⇒成功 / 未命中⇒**`fetch.tlsError`** / **叠加模式真的叠加**（pin 对但不开 pinOnly ⇒ 自签被系统信任拒） / 无 pin⇒自签被拒 / 宿主记账确有 challenge。`bash hosts/{android,ios}/run-tls-probe.sh` |
| **连接复用（连接池）** | ✅ **本来就具备**（#1155 取证，无需换栈）：Android `HttpURLConnection` 的 keep-alive 池 · iOS `URLSessionConfiguration.default` 的进程级单例会话。★但 **#1154 的 pinning 首版把它弄坏了**（每次请求新建 `SSLContext` ⇒ 连接池按 `SSLSocketFactory` 分桶 ⇒ 复用归零），#1155 修为**进程内缓存 factory** | 真机双端各 **3 请求 / 1 TCP 连接**（服务端按**对端 socket**记账）；静态判据 `tests/tls-pinning-reuse.test.ts`（缓存入口唯一 + 命中即返回）+ 计量判据 `tests/transport-probe-accounting.test.ts`（h2 的多个流算 1 条连接、控制端点不计样本） |
| **连接复用（鸿蒙）** | ✅ **#1156 修出来的**（原本零复用）：根因两层——① `handle()` 每请求建/关 `Rcp_Session`；② **同步 `HMS_Rcp_FetchSync` 不池化**（同一 session、同一连接池配置下，只改取数 API 即从 3/3 变 3/1）。修法：**进程级 session**（`SessionSlot` + mutex）+ 生产路径改用**异步** `HMS_Rcp_Fetch` + **有界等待**（回调为完成信号，超时则 cancel 并回 `http.timeout`）。原生 napi 仍是同步返回（一次性 VM 约束未变） | 真机 **3 请求 / 1 TCP**（`hosts/harmony/results/transport-probe.json`，`check:cache-evidence` 第三端）；静态判据 `tests/harmony-session-reuse.test.ts`（session 缓存 get/put 配对 + 无 per-request close + 锁不覆盖整段请求）；四方注册判据 `tests/harmony-napi-registry.test.ts` |

★**pinning 的两条诚实边界**：① `pinOnly` 只替代**信任锚**，**不**替代主机名校验
（放宽主机名会打开 MITM 的门，属另一个策略开关）；② 钉 SPKI 而非整张证书——后者在证书**续期**（同一密钥）时指纹就变。

★**#1155 的另一半产出：把"看不见的传输层"变成可观测读数**。
`bash hosts/{android,ios,harmony}/run-transport-probe.sh` 现在产出
`{client_protos, client_peers, server_protocols, server_requests, server_connections, http2_ok, conn_reused_ok}`
★**三端读数（2026-10-21 真机）**：Android `http/1.1 · 3/1 复用` · iOS `h2 · 3/1 复用` ·
鸿蒙 `http/1.1 · 3/1 复用（修后）· h2=未测`。

### ★★★#1158 · 传输读数已**产品化**（业务可见，不只是探针）

矩阵原先只写"P1 共同前提：三端要有同一套可观测字段 `transport:{protocol,dnsMs,connectMs,tlsMs,reused}`"
——那句话此前是**愿景**。现在它是**已交付的 API**：`res.meta.transport`。

| 端 | `proto` | `reused` | `dnsMs` | `connectMs` | `tlsMs` | `ttfbMs` | 采集来源 |
|---|---|---|---|---|---|---|---|
| iOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `URLSessionTaskMetrics` |
| Android | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **`OkHttp EventListener`**（#1160 换栈后全字段；`ttfbMs` = `requestHeadersEnd→responseHeadersStart`，**纯首字节**；`reused` = 本次是否新建连接） |
| 鸿蒙 | — | — | ✅ | ✅ | ✅ | ✅ | `Rcp_TimeInfo`（★实际单位是**微秒**，与墙钟对账后修正） |
| Web | ✅ | — | — | — | — | — | `PerformanceResourceTiming.nextHopProtocol`（只此一项：其余受 TAO 限制会全 0，填了就是假数据） |
| MP | （整项不出现：`wx.request` 不暴露任何传输读数） | | | | | | — |

★**"缺键 = 不可得"是硬约定**：宿主测不到的项**不出现**，绝不填 `0`/`false`——
否则业务会把"没测到"读成"DNS 花了 0ms"（假数据比缺数据更糟）。
★线格式 = 回程 TLV `Transport=22`（name-values；五端 43 向量逐字节等价）。
★判据：`tests/fetch-transport-meta.test.ts`（12 条）+ `tests/fetch-pipeline.test.ts` 的
「五段链路」断言 + `check:cache-evidence` 的"业务侧真的拿到读数"（三端证据）。

★**P1 的共同前提**：三端要有**同一套可观测字段**（`transport`：`{ protocol, dnsMs, connectMs, tlsMs, reused }`），
否则判据只能各端各写、无法比对——这与本仓"三端同判据"纪律冲突。

### P2 · 缓存（HTTP 语义，框架层可做一部分）

| 能力 | 做法 | 依赖 |
|---|---|---|
| `If-None-Match` / `If-Modified-Since` 条件请求 | ✅ **已做（#1149）**：框架层存 `(method+url+params+responseType → etag/lastModified)`，命中则加条件头；304 ⇒ 用缓存体合成 200（RFC 9111 §4.3.4） | 内存 LRU（默认 5 MiB）+ ★**L2 持久层（#1151）** |
| **L2 持久层**（跨进程复用） | ✅ **已做（#1151）**：`cache: { persist: true }` ⇒ **Web/MP 走 KV**（`localStorage` / `wx.setStorage`）、**App 走文件**（`fs.readBytes/writeBytes`——App **没有** `getStorage`）。★内存仍是权威热层（内存命中零 IO，未命中才读盘并回填）；写盘 fire-and-forget（失败不影响本次请求，只记 `writeErrors`）；损坏条目当未命中 + 记 `corruptEntries` | `04-cache-layers.md` 的 L2 |
| **持久层容量治理**（字节预算 + LRU + 配额收缩） | ✅ **已做（#1152）**：按**字节**做 LRU 淘汰（缺省 KV 2 MiB / 文件 8 MiB；★按条数不够——一条 2MB 响应顶掉 200 条小条目），字节与年龄记在 **manifest**（KV 拿不到单键大小）；**内存命中也会刷新持久层 LRU**（否则淘汰退化成"谁最后写"）；配额写失败 ⇒ **主动淘汰 25% 再重试一次**（有界）；单条超预算**不自杀**（受保护集） | 同上 |
| `Cache-Control` 尊重（max-age / no-store / no-cache / must-revalidate） | ✅ **已做（#1149）**：`parseCacheControl` + `freshnessLifetimeMs`（含 `Expires`/`Age`），不新鲜则条件回源 | 同上 |
| `Vary` 分桶 | ✅ **已做（#1149）**：按 Vary 头名 + 取值分变体；`Vary: *` 拒绝缓存 | 同上 |
| `stale-while-revalidate` / `stale-if-error`（RFC 5861） | ✅ **已做（#1150）**：SWR = 变 stale 后 N 秒内**立即回旧值** + 后台条件校验（按条目去重，防 amplification）；SIE = 回源遇网络失败 / 500·502·503·504 时用旧值兜底。★`must-revalidate` **优先**（RFC 5861 未规定此交互，取 RFC 9111 的更严格者）；★缓存生成的响应必带 `Age`（RFC 9111 §5.1 MUST） | 同上 |
| 请求去重（同飞） | ✅ **已做（#1133）** | — |

★诚实边界：**浏览器/小程序会自动做 HTTP 缓存，但 App 三个宿主不会**（我们的字节腿是裸 HTTP）。
⇒ App 端的缓存语义**必须框架层实现**，这是"同一份源码三端一致"的必要条件，不能靠平台。
★因此开启缓存时 Web 腿会显式传 `cache:'no-store'` 让浏览器自带缓存让开（`bypassPlatformCache`）——
否则"浏览器命中"与"框架命中"两套语义会漂移，`meta.cache` 也会与实际不符。

### P3 · 取消/超时的更强语义

| 能力 | 现状 |
|---|---|
| 单轮超时 | ✅ 已有（App `setConnectTimeout`/`setReadTimeout`；Web `AbortController`；MP `wx.request.timeout`） |
| **总时限**（跨重试的 deadline） | ✅ **已做（#1135）**：`deadline` 从**入队**起算，跨排队/退避/多跳；耗尽 ⇒ `fetch.deadline`（与 `fetch.timeout` 分开）；单轮 timeout 自动**收敛到剩余预算** |
| 超时分级（连接 / 首字节 / 空闲） | ❌ 未做（App 只有 connect/read 两档，Web 只有一档）——**属宿主传输层** |

★`FetchMeta` 已经能暴露"总耗时"，所以**P3 的判据可以先写**（断言 `totalMs ≤ deadline`），实现随后。

---

## 4. 本轮落地清单（可复核）

- `packages/api/src/capability-fetch-pipeline.ts`（新，~450 行）：管线本体
- `packages/api/src/capability-fetch-types.ts`：+`RetryPolicy` / `FetchMeta` / `retry` / `priority`
- `packages/api/src/capability.ts`：`useFetch` 改走管线 + 新增 `useFetchTask`
- `packages/api/src/capability-hooks-options.ts`：+`fetch` 管线配置
- `packages/api/src/index.ts`：导出管线类型与工厂
- `tests/fetch-pipeline.test.ts`（新，20 条）：拦截器/重试/并发/去重/任务句柄/观测
- ★破坏性验证 5 条（逐条单独命中，其余保持绿）：
  ① 并发上限失效 ⇒ 3 红；② aborted 被重试 ⇒ 1 红；③ 去重键漏 body ⇒ 1 红；
  ④ 响应拦截器正序 ⇒ 1 红；⑤ `queuedMs` 恒 0 ⇒ 1 红。

---

## 5. 诚实边界（不粉饰）

1. ~~**本轮没有做任何传输层优化**~~ ⇒ ★**已按端分项收口（#1154 / #1155 / #1160 / #1166）**：
   证书 pinning ✅（Android+iOS 真机）· 连接复用 ✅（三端都在工作：两端 `3/1` 本来就具备、
   鸿蒙 #1156 修后 3/1）· HTTP/2 ✅（**三端全具备**：iOS 平台默认 · Android #1160 换 OkHttp ·
   鸿蒙 #1166 取证 RCP 底层 libcurl 本就协商 h2）· HTTPDNS 🟡（**接入点三端已有两**：
   Android `Dns` seam #1160 · 鸿蒙 RCP 内置 DoH #1166 · iOS 待定；**业务面全未做**）。
   ⇒ 准确说法（更新后）：**"请求治理层达到超级应用可用；传输层里复用于 h2 三端都已具备，
   唯一剩下的是 HTTPDNS 的业务化（三端同一份门面 + 线格式）"**。
2. ~~没有做 HTTP 缓存~~ ⇒ ★**已收口（#1149，框架层内存缓存）**：`config.cache` 六模式 +
   `Cache-Control` / `ETag` / `Last-Modified` / 304 合成 / `Vary` 分桶 / LRU 预算。
   **剩余真差异**：~~L2 **磁盘层**未做（重启即失效）~~ ⇒ ✅ **已收口（#1151）**：
   `cache:{persist:true}` 跨进程命中（Web/MP=KV、App=文件，真机双端各 13/13）。
   ~~持久层无淘汰~~ ⇒ ✅ **已收口（#1152）**：字节预算 + LRU + 配额收缩（真机双端各 15/15）。
   ~~RFC 5861 未做~~ ⇒ ✅ **#1150**。
   **仍存的边界**：持久层是**单进程**模型（不做多进程并发写协调）；文件后端写一条要重写整份（见 #1151 的 O(N) 说明）。
3. ~~重定向仍不可拦~~ ⇒ ★**已收口（本轮 #1134）**：manual / onRedirect / 限额 / 跨域剥离凭据全落地，Android+iOS 真机验过。**剩一个端差异**：MP 端 `wx.request` 隐式跟随且不可关 ⇒ 如实 `fetch.unsupported`。
4. 管线的**并发额度是按 `CapabilityHooks` 实例**计的，不跨页面/不全局。多页面场景要全局额度需另建实例共享
   （本仓尚无"全局请求管理器"，属 P2/P3）。
5. `retry` 的等待依赖 `setTimeout`；App 精简引擎无定时器 ⇒ **立即重试**（`meta.retryDelaySkipped` 标记，不谎称退避过）。

---

## 6. 下一步（按优先级）

1. ~~P1 重定向可拦~~ ⇒ ✅ **已完成（#1134）**；
2. ~~P3 总时限 deadline~~ ⇒ ✅ **已完成（#1135）**；
3. ~~P2 条件请求缓存~~ ⇒ ✅ **已完成（#1149 · 框架层内存层）**；~~RFC 5861 扩展~~ ⇒ ✅ **已完成（#1150）**；
   ~~L2 磁盘层~~ ⇒ ✅ **已完成（#1151 · `persist:true`，Web/MP=KV、App=文件）**；
4. ~~P1 证书 pinning~~ ⇒ ✅ **已完成（#1154，不需要换栈）**；
   ~~P1 连接池~~ ⇒ ✅ **#1155 取证：两端本来就在工作**（各 3 请求 / 1 连接；并修掉 #1154 引入的复用回归）；
   ~~P1 连接池（鸿蒙）~~ ⇒ ✅ **#1156：原本零复用（3/3），修为 3/1**（进程级 session + 异步 `Rcp_Fetch`）；
   ~~P1 HTTP/2（iOS 侧）~~ ⇒ ✅ **平台默认已具备**（真机 h2 已协商）；
   ~~P1 HTTP/2（Android 侧）~~ ⇒ ✅ **#1160 换 OkHttp 3.14.9**（真机 `{"h2":3}` + 3 请求/1 TCP 未退化）；
   ~~P1 HTTP/2（鸿蒙）~~ ⇒ ✅ **#1166 已取证：本来就具备**（RCP 底层 libcurl，公网真机 `http=http/2` +
   `tls=TLSv1.3`）——原以为要先做"接自定义 CA/pinning"，**实测不需要**（见 §3 的 #1166 专项）；
   **P1 剩余一项**：**HTTPDNS 业务化**——★#1166 另发现**鸿蒙有现成落点**（`Rcp_DnsOverHttps`），
   Android 的 `Dns` seam 已落 #1160（iOS 需自建解析或 `Network.framework`）；
   待业务 API + 线格式 tag（三端同一份门面）。
5. **鸿蒙传输层的两处状态变化要单独记（#1156）**：
   ① **session 现在跨请求复用** ⇒ RCP 的 cookie / 认证状态**可能随之跨请求保留**——该行为**尚未取证**，
   在取证前**不宣称**"鸿蒙端已具备会话共享"（与 Android `CookieManager` / iOS `HTTPCookieStorage` 对齐是目标，不是现状）；
   ② **原生 napi 仍是同步返回**（一次性 VM 约束未变），但内部改为"异步 Fetch + 有界等待" ⇒
   请求期间**调用线程仍被阻塞**（与 Android/iOS 的"受理即返、完成回推"语义不同，如实登记）。
6. MP 端的重定向能力取决于微信是否开放（当前**无**）；若未来开放，框架层循环无需改动（已跨端同一份）。

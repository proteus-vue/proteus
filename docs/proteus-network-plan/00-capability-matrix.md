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
| 1 | **HTTPDNS** | **零实现**（全仓 `grep enableHttpDNS/httpDNSServiceId` = 0 处）。三端都走系统 DNS | 宿主传输 / 业务 SDK | ❌ 见 §3 分期 |
| 2 | **高性能模式** | **无此概念**。Android `HttpURLConnection` 默认连接池；iOS `URLSessionConfiguration.default` 复用会话 | 宿主传输 | ❌ 见 §3 |
| 3 | **HTTP/2** | **走平台默认**（Android `HttpCapability.java:30` / iOS `http-capability.swift:30` 均注明"HTTP/2、压缩、连接池全走平台默认，不自造"） | 宿主传输 | ❌ 见 §3 |
| 4 | **请求拦截** | ★**本轮做了**：`requestInterceptors` / `responseInterceptors`（洋葱模型，可改 url/headers、可短路） | **框架策略（TS）** | ✅ |
| 5 | **重定向拦截** | **跟随但不可拦**：Android `setInstanceFollowRedirects(true)`（4 处）/ iOS `URLSession` 默认跟随；**没有 `redirect:'manual'`，也没有 `onRedirect` 回调** | 宿主传输 + 策略 | ❌ 见 §3 |
| 6 | **请求缓存** | **HTTP 语义零实现**（无 `If-None-Match`/`If-Modified-Since`/`Cache-Control` 处理） | 框架策略 + 宿主 | ❌ 见 §3（L2 已有 `04-cache-layers.md` 设计） |
| 7 | **RequestTask** | ★**本轮做了**：`useFetchTask()` → `FetchTask`（`result` / `state` / `abort(reason)`）。★形状是 Promise + abort，**不复刻** wx 的回调对象 | **框架策略（TS）** | ✅ |
| 8 | **网络调优** | **无**：无并发上限（本轮前）、无优先级、无超时分级、无弱网退避 | **框架策略（TS）** | ✅ 并发/优先级/退避已做；**连接参数调优仍属宿主（未做）** |
| 9 | **观测/排障** | ★**本轮做了**：`FetchMeta`（`queuedMs` / `attemptMs[]` / `attempts` / `deduped` / `priority`） | **框架策略（TS）** | ✅ |

**结论（一句话）**：**9 项里 4 项本轮落地（4/5/7/8 的策略部分 + 9）**；
**5 项属宿主传输层（1/2/3/5 的"拦"），本轮未做**——它们是**真缺口**，不是"不需要"。

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

| 能力 | 落点 | 前置 | 判据设计（可执行） |
|---|---|---|---|
| 重定向**可拦截**（`redirect: 'manual'` + `onRedirect`） | Android OkHttp `followRedirects(false)` / iOS `URLSessionTaskDelegate.willPerformHTTPRedirection` | 无（**不需换整栈**——两端都有原生钩子） | 真机：3xx 响应回 `status=302` + `location` 头，不自动跟随；回调收到 (from, to) 链 |
| HTTPDNS | Android OkHttp `Dns` 接口 / iOS `NWConnection` 自定义解析 | **Android 需引入 OkHttp**（APK +Δ） | 断言：域名解析走注入的解析器（假解析器返回假 IP，请求仍到达测试服务） |
| HTTP/2 + 连接池参数 | 同上 | 同 HTTPDNS | 断言：服务端记录 `HTTP/2` 协商结果 + 复用连接数（单连接多请求） |
| 证书 pinning | 同栈 | 同 HTTPDNS | 断言：错误证书 ⇒ 明确 `fetch.tlsError`（不是笼统 failed） |

★**P1 的共同前提**：三端要有**同一套可观测字段**（`transport`：`{ protocol, dnsMs, connectMs, tlsMs, reused }`），
否则判据只能各端各写、无法比对——这与本仓"三端同判据"纪律冲突。

### P2 · 缓存（HTTP 语义，框架层可做一部分）

| 能力 | 做法 | 依赖 |
|---|---|---|
| `If-None-Match` / `If-Modified-Since` 条件请求 | 框架层存 (url → etag/lastModified)，命中则加条件头；304 ⇒ 回缓存体 | L2 磁盘层（`04-cache-layers.md` 已设计，未实现） |
| `Cache-Control` 尊重（max-age / no-store） | 框架层解析响应头，决定能否复用 | 同上 |
| 请求去重（同飞） | ✅ **本轮已做** | — |

★诚实边界：**浏览器/小程序会自动做 HTTP 缓存，但 App 三个宿主不会**（我们的字节腿是裸 HTTP）。
⇒ App 端的缓存语义**必须框架层实现**，这是"同一份源码三端一致"的必要条件，不能靠平台。

### P3 · 取消/超时的更强语义

| 能力 | 现状 |
|---|---|
| 单轮超时 | ✅ 已有（App `setConnectTimeout`/`setReadTimeout`；Web `AbortController`；MP `wx.request.timeout`） |
| **总时限**（跨重试的 deadline） | ❌ 未做。`timeout` 是**单轮**，重试 3 次可能总耗时 = 4×timeout |
| 超时分级（连接 / 首字节 / 空闲） | ❌ 未做（App 只有 connect/read 两档，Web 只有一档） |

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

1. **本轮没有做任何传输层优化**：HTTPDNS / HTTP/2 / 连接池调优 / 证书 pinning **全部未做**（§3 P1）。
   ⇒ 准确说法：**"请求治理层达到超级应用可用"；"传输层仍是平台默认"**。
2. **没有做 HTTP 缓存**（§3 P2）。App 端因此**没有** 304 复用——这与浏览器/小程序不同，是**真差异**。
3. **重定向仍不可拦**（只能跟随）。这在超级应用里是真实痛点（埋点重定向、登录跳转要观测），列入 P1。
4. 管线的**并发额度是按 `CapabilityHooks` 实例**计的，不跨页面/不全局。多页面场景要全局额度需另建实例共享
   （本仓尚无"全局请求管理器"，属 P2/P3）。
5. `retry` 的等待依赖 `setTimeout`；App 精简引擎无定时器 ⇒ **立即重试**（`meta.retryDelaySkipped` 标记，不谎称退避过）。

---

## 6. 下一步（按优先级）

1. **P1 重定向可拦**（不需换栈，两端都有原生钩子）——性价比最高；
2. **P3 总时限 deadline**（判据已可写，纯框架层）；
3. **P2 条件请求缓存**（框架层 + L2 落地）；
4. **P1 HTTPDNS/HTTP/2**（需 Android 引入 OkHttp，独立大单，先做 APK 体积与包体影响评估）。

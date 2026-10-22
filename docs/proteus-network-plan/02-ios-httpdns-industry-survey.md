# 02 · iOS 上 HTTPDNS 到底怎么做：业内四条路线与微信实测参数

> 决策 #1176 · 2026-10-22 · 触发：用户追问「一半业内怎么做的呢？比如微信小程序我看是支持的，他们走的 B 还是 C？」
> 前置：#1171 已把 `httpDns` 业务化（Android + 鸿蒙真机生效），iOS 当时写的是
> 「平台边界、不支持」——**本文更正这个过强结论**。

## 0. 一句话结论

**微信小程序走的是 C（容器自建网络栈），不是 B。** 但微信**没有**把这张能力开放给开发者：
小程序 API 只允许开发者选一个**服务商 ID**，不能传自己的域名→IP 表。
iOS 上轻量接入的业内主流是 **A（IP 直连 + 改写证书校验主机名）**。

## 1. 微信小程序：能力形状是"选服务商"，不是"给表"

证据：本仓 `node_modules/miniprogram-api-typings/types/wx/lib.wx.api.d.ts`（官方类型定义）
里 `wx.request` 的 `RequestOption` 字段：

| 字段 | 起始基础库 | 含义 |
|---|---|---|
| `enableHttpDNS?: boolean` | 2.19.1 | 是否开启 HttpDNS |
| `httpDNSServiceId?: string` | 2.19.1 | **必填**，微信服务市场里购买的 HTTPDNS 资源 ID |
| `httpDNSTimeout?: number` | 3.8.9 | 解析超时 |
| `enableHttpDNSFallback?: boolean` | 3.16.2 | 解析失败是否回落 LocalDNS（默认 true） |

响应侧另有 `useHttpDNS: boolean` 与 `exception`（说明"开了但最终没用上"的原因）。

官方文档（`developers.weixin.qq.com/miniprogram/dev/framework/ability/HTTPDNS.html`）明确：
- 需先在**微信服务市场选购 HttpDNS 资源**，从服务详情页拿 Service ID；
- **解析请求由微信代开发者调用服务商接口**，按服务商返回的 TTL 缓存；
- 未通过微信安全认证的服务商 ID 返回 `602108`；
- v2.22.1 起若检测到系统代理，基础库会**主动强制关闭** `enableHttpDNS`。

⇒ **关键差异**：微信把 HTTPDNS 做成"平台代调用服务商"的**托管能力**；
我们的 `httpDns: Record<host, string[]>` 是"开发者自己给表"的**开放能力**。
两者语义不同，不能照抄微信的 API 形状（本仓 §2.2 已有"对齐能力、不照搬实现"的纪律）。

`TCPSocket.connect` 也带 `enableHttpDNS` / `useHttpDNS`
（见同文件 8787/8799 行）⇒ 说明这是**容器网络栈层面的统一能力**，不是 `wx.request` 特例。

## 2. 微信客户端为什么在 iOS 上做得到：它不走 `URLSession`

证据：`Tencent/mars`（微信移动团队开源的跨平台终端基础组件）README 自述
"a cross-platform infrastructure component developed by WeChat Mobile Team"，定位
"A network solution fit for mobile application"；其 `mars/comm/` 目录下同时存在
`socket/`、`dns/`、`network/`、`http.cc` / `http.h`。

⇒ 微信的 HTTP 请求跑在**自研 socket/HTTP 栈**上，DNS 解析是这条栈里的一个可替换环节。
**在 iOS 上能 per-request 指定解析结果，前提是"不用 URLSession"**——这正是 C 路线的本质。

注意：Mars README 本身**没有**出现 "HTTPDNS"/"NewDNS" 字样，`comm/dns/dns.cc`
也只是个 12 KB 的模块。所以本文只断言"微信自建了网络栈并在此之上提供 HTTPDNS"，
**不断言** Mars 里具体哪个文件实现了 HTTPDNS。

## 3. 业内轻量方案：A 路线（IP 直连 + 证书校验改回原域名）

证据：腾讯云 HTTPDNS 接入实践文档（`cloud.tencent.com/document/product/379/3523`）
在"其他注意事项"里明确要求客户端：
- **hook 证书校验过程：将 IP 直接替换成原来的域名，再执行证书验证**；
- 或"忽略证书认证，类似于 `curl -k`"（**这是降级，不可取**）；
- 缓存建议 120–600 秒（不低于 60 秒）、按 TTL 75% 提前刷新、网络切换时重解析；
- 解析失败回落 LocalDNS（建议 5 秒超时）。

⇒ 这是**云厂商 iOS SDK 的通行做法**：URL 换成 IP，Host/证书校验用原域名补回来。
它**没有**解决 SNI（TLS 握手里的 server_name 仍是从 URL host 推导的 IP），
所以 CDN 场景（同 IP 多域名、按 SNI 选证书）容易失败。

## 4. iOS 平台 API 事实（本机 SDK 头文件取证）

Xcode 安装位：`/Volumes/data1/Applications/Xcode.app`（`/Applications` 下没有）。
SDK：`iPhoneOS16.2.sdk`。

| 事实 | 证据 |
|---|---|
| `URLSession` **没有** per-request DNS resolver 钩子 | `NSURLSession.h` 里与 DNS 相关的只有 `requiresDNSSECValidation`（一个开关，735 行）和 `NSURLSessionTaskMetricsDomainResolutionProtocol`（**事后统计**用了 UDP/TCP/TLS/HTTPS，1185–1192 行） |
| iOS **能**独立设置 TLS SNI（与连接目标解耦） | `Security.framework/Headers/SecProtocolOptions.h:338` `sec_protocol_options_set_tls_server_name(options, name)`，官方注释：「**This will override the server name obtained from the endpoint**」，iOS 12+ |
| `Network.framework` 能把"连 IP + 用域名做 TLS"接起来 | `Network/Headers/tls_options.h:73` `nw_tls_copy_sec_protocol_options()` 返回 `sec_protocol_options_t`；`endpoint.h:104/183` 有 `nw_endpoint_create_host` / `nw_endpoint_create_address` |
| `Network.framework` **没有** HTTP 协议层 | 头文件只有 `tcp/tls/udp/quic/ws`；全 SDK 搜不到 `nw_protocol_http` |
| iOS **不能** per-session 配 HTTPS 代理 | `CFNetwork/CFProxySupport.h:489` `kCFNetworkProxiesHTTPSEnable` = `CF_AVAILABLE(10_6, NA)`；而 `kCFNetworkProxiesHTTPEnable` = `CF_AVAILABLE(10_6, 2_0)`（iOS 可用） |
| 证书可按任意主机名重新校验 | `Security/SecPolicy.h:180` `SecPolicyCreateSSL(Boolean server, CFStringRef hostname)` |
| 系统级自定义 DNS 存在，但要 entitlement | `NetworkExtension/NEDNSProxyProvider.h`（iOS 11+）、`NEDNSSettingsManager.h`、`NEDNSOverHTTPSSettings`（DoH） |

## 5. 四条路线对比（含诚实边界）

| 路线 | 做法 | 保 SNI | 保 h2 | 成本 | 谁在用 |
|---|---|---|---|---|---|
| **A. IP 直连 + 证书策略改写** | URL 用 IP、设 `Host` 头、`SecPolicyCreateSSL(true, 原域名)` 重校验 | ❌（SNI=IP） | 🟡 需确认 `:authority` | **低** | 云厂商 iOS SDK（主流） |
| **B. 本地 CONNECT 代理** | 进程内 loopback 监听；`connectionProxyDictionary` 把会话指过去，代理查表后连 IP | ✅ | ✅ | 中 | 少见（需自研） |
| **C. 自建网络栈** | `Network.framework`/BSD socket 自己实现 HTTP | ✅ | ✅ | **极高** | 微信 / 超大 App |
| **D. 系统 DNS Proxy / DoH** | `NEDNSProxyProvider` / `NEDNSSettingsManager` | ✅ | ✅ | 中（但要 entitlement） | 企业/MDM、DoH 类产品 |

**D 为什么不等价于 `httpDns` 表**：它是**进程/系统级**的解析策略，不是 per-request 的
"这次请求用这张表"，且需要 Network Extension entitlement（普通 App Store 应用申请困难）。
它更接近"把系统 DNS 换成 DoH"，与我们的 `Record<host, ip[]>` 语义不同。

**B 的可行性缺口**：iOS 头文件层面只支持 HTTP 代理键（HTTPS 代理键标 `NA`）。
`https://` 请求经 per-session HTTP 代理时**是否**发起 `CONNECT` 隧道，**本仓尚未实测**——
这是 B 路线唯一的验证缺口，不能凭头文件推断。若成立，B 是唯一同时保住 SNI 与 h2 的低成本路径。

**A 的真实代价（更正上一轮的错误）**：
- 上一轮我写"改 IP 直连会破坏 SNI **与证书主机名校验**"——**证书校验那一半是错的**：
  `SecPolicyCreateSSL(true, "原域名")` 可以按原域名重新校验，安全性不必降级。
- 真正丢的只有 **SNI**，后果是 CDN/虚拟主机可能返回错证书或拒绝连接。
- 另有 `Host` 头与 h2 `:authority` 需要手工维护。

## 6. 对本仓的建议

1. **短期**：iOS 保持 `fetch.unsupported`（**如实报错，不静默忽略**——这一点不变）。
2. **中期**：先做 **A**。它能覆盖"防 DNS 劫持 / 指定调度 IP"的主诉求，实现量最小，
   且证书校验不降级；把"SNI 敏感域名"登记为已知边界。
3. **增强**：为 **B** 做一个 30 分钟的真机可行性探针（本地 loopback 代理 + 一个 https 请求，
   看 CFNetwork 是否发 `CONNECT`）。**先验证再决定**，不要按头文件推断。
4. **不做 C**：为了一个字段重造 HTTP 栈不划算；除非将来要接 QUIC/自研协议。
5. **不把 D 混进 `httpDns` 语义**；若要支持 DoH，单列一个能力项。

## 7. 判据（可回归）

- `tests/httpdns-wire.test.ts` 断言 iOS **必须**明确 `fetch.unsupported`，
  且**不得**再声称"平台不支持"（只允许说"当前栈无注入点"）。
- 本文的 API 事实均可由 SDK 头文件复核；路线选择变更时必须同步本文与能力矩阵。

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
| **B. 本地 CONNECT 代理** | 进程内 loopback 监听；`connectionProxyDictionary` 把会话指过去，代理查表后连 IP | ✅**已实测** | ✅**已实测 h2** | 中 | 本仓选定路线（#1178） |
| **C. 自建网络栈** | `Network.framework`/BSD socket 自己实现 HTTP | ✅ | ✅ | **极高** | 微信 / 超大 App |
| **D. 系统 DNS Proxy / DoH** | `NEDNSProxyProvider` / `NEDNSSettingsManager` | ✅ | ✅ | 中（但要 entitlement） | 企业/MDM、DoH 类产品 |

**D 为什么不等价于 `httpDns` 表**：它是**进程/系统级**的解析策略，不是 per-request 的
"这次请求用这张表"，且需要 Network Extension entitlement（普通 App Store 应用申请困难）。
它更接近"把系统 DNS 换成 DoH"，与我们的 `Record<host, ip[]>` 语义不同。

**B 的可行性缺口**：iOS 头文件层面只支持 HTTP 代理键（HTTPS 代理键标 `NA`）。
★★★ **#1178 已实测推翻"B 不可行"的推断**：配 `connectionProxyDictionary` 的 **HTTP** 代理键后，
`https://` 请求**确实**由 CFNetwork 以 `CONNECT host:443` 隧道交给代理，且隧道内
**SNI / Host / HTTP/2 / 连接复用全部保留**。⇒ **B 是本仓在 iOS 上唯一同时保住 SNI 与 h2 的低成本路径**。
证据：`bash hosts/ios/run-httpdns-route-b-probe.sh`（11 项判据，见 §8）。

**A 的真实代价（更正上一轮的错误）**：
- 上一轮我写"改 IP 直连会破坏 SNI **与证书主机名校验**"——**证书校验那一半是错的**：
  `SecPolicyCreateSSL(true, "原域名")` 可以按原域名重新校验，安全性不必降级。
- 真正丢的只有 **SNI**，后果是 CDN/虚拟主机可能返回错证书或拒绝连接。
- 另有 `Host` 头与 h2 `:authority` 需要手工维护。

## 6. 对本仓的建议

1. **短期**：iOS 保持 `fetch.unsupported`（**如实报错，不静默忽略**——这一点不变）。
2. **中期**：**做 B**（#1178 已实测可行：CONNECT 隧道 + SNI/Host/h2/复用全保）。
   原计划的"先做 A"被本次取证下调：B 的成本集中在"实现一个 CONNECT 代理"，
   但**不牺牲任何安全语义**（A 必丢 SNI）；而 A 的实现量虽小，却要在每次请求上
   改写信任评估，长期维护面更脏。
3. **A 仍作为 B 的降级兜底**：若 B 代理在某种网络形态下不可用（例如企业 MDM 已强制全局代理），
   A 是唯一的退路。两条路线**不互斥**。
4. **不做 C**：为了一个字段重造 HTTP 栈不划算；除非将来要接 QUIC/自研协议。
5. **不把 D 混进 `httpDns` 语义**；若要支持 DoH，单列一个能力项。

## 7. B 路线实测证据（#1178）

**入口**：`bash hosts/ios/run-httpdns-route-b-probe.sh [repeats]`
→ `hosts/ios/results/httpdns-route-b.json`（汇总）+ 4 份原始读数。

**装置**：本地 HTTP 代理（记录 `CONNECT`）+ 本地自签 TLS 服务端（`SNICallback` 直接读 SNI）
+ 两个 iOS 侧探针（`URLSessionConfiguration.connectionProxyDictionary`）。
★关键设计：用**无 DNS 记录的假域名** `sni-probe.local` 做假域名实验——
系统解析必然失败，**只有代理**（按固定映射转发到本地 TLS 服务端）能让它返回 200
⇒ "200" 本身就是"代理真的接管了解析"的证据，而不是"碰巧直连成功"。

| 判据 | 读数 | 说明 |
|---|---|---|
| 代理收到 `CONNECT` | `www.cloudflare.com:443` + `sni-probe.local:18443` | https 走隧道，**不是**明文绝对 URI |
| 无明文绝对 URI 请求 | 0 | 排除"降级成明文代理" |
| TLS 服务端读到 SNI | `sni-probe.local` | **原域名，不是 IP** |
| 假域名经代理成功 | `status=200` | 系统 DNS 解析不出，只有代理能通 |
| `Host` 头 | `sni-probe.local:18443` | 原域名保留 |
| 3 次请求的隧道数 | **1** | 隧道内连接复用未退化 |
| 对照组（不配代理） | `200` | 测试环境本身可用 |
| 公网经代理 | `200` + `http/http/2` + `visit_scheme=https` | **h2 与 TLS 端到端都保住** |

**破坏性验证**：把 `cfg.connectionProxyDictionary` 整段移除 ⇒ 5 条判据红、
`verdict=ROUTE_B_BLOCKED`、**脚本 `exit 1`**；恢复 ⇒ 11 项全绿、`exit 0`。

**装置层踩的两个坑（都修了，记下来防复发）**：
1. **端口占用冒充就绪**：残留进程占着 18898，新代理 bind 失败被静默吞掉，而
   `wait_for --port` 因旧进程在监听照样通过 ⇒ 判据读的是**别人的记账**
   （表现为"假域名 200 但 connectCount=0"这种自相矛盾）。修法：起服务前 `lsof` 预检端口，
   就绪判据改用**文件**（文件出现 = 我们自己的进程真的活到 listen 之后）。
2. **空数组假绿**：`sniValues.every(...)` 在空数组时恒为 `true` ⇒ 读不到 SNI 也判绿。
   修法：先要求 `length > 0` 再判内容。

**诚实边界**：
- **★真机已补（#1179）**：`bash hosts/ios/run-httpdns-b-device-probe.sh` 在 **iPhone 12 真机**上
  13/13 全绿 ⇒ B 路线不再只是模拟器结论，见 §7.2。
- TLS 服务端用**自签证书**（仅为本探针读 SNI，绝不进生产）；★真机生产 session 不信任自签证书
  ⇒ 假域名必然 `fetch.failed: The certificate for this…`，**这是预期的装置变量，不是路线缺陷**。
- 隧道内是 HTTP/1.1（本地服务端未开 h2）；公网那轮实测是 `http/2`，两条互补。
- **B 的生产实现尚未开始**：本单只定性"可行"，代理进程、表查询、降级链、
  与 `fetch.unsupported` 的切换点都还没写。

## 7.2 真机复验（#1179）—— 同一组判据，模拟器结论在真机上成立

**入口**：`bash hosts/ios/run-httpdns-b-device-probe.sh [repeats]` → `hosts/ios/results/httpdns-b-device.json`
（`verdict=ROUTE_B_DEVICE_OK`）。

**装置**：本机起「HTTP 代理 + 自签 TLS 服务端」绑 `0.0.0.0`（真机经 LAN IP 访问）；
App 侧由 `PROTEUS_B_PROXY=<LAN_IP>:<port>` 注入 `connectionProxyDictionary`
（`HttpCapability.session`，不设该变量时**一个代理键都不加**，生产零影响）。

| 判据 | 真机读数 |
|---|---|
| 代理收到 `CONNECT sni-probe.local` | **3 个** |
| 代理收到 `CONNECT www.cloudflare.com:443` | **1 个** |
| 无明文绝对 URI | 0 |
| 服务端读到的 SNI | 3 次全是 `sni-probe.local`（**原域名**） |
| 公网经代理（真实证书） | **`[200,200,200]`** |
| 公网 3 次请求的隧道数 | **1**（隧道内复用成立） |
| 假域名请求到达 | ✅（证书校验处失败，如预期） |

**★真机与模拟器的两处实质差异（这才是真机复验的价值）**：
1. **复用必须用真实证书判**：模拟器探针用 `TrustAll` 无条件信任 ⇒ 假域名也能握手成功 ⇒ 1 隧道；
   真机走生产 session、不信任自签 ⇒ 假域名 3 次各建一条隧道（3 个 CONNECT）。
   **这不是 B 路线缺陷，而是"证书不受信"这个装置变量** —— 与 #1165「把探针连不上自签服务端
   当成平台不支持」同族。修法：加一组**公网域名**（真实证书）轮次专测复用，真机读数 **1 隧道 / 3 请求**。
2. **"请求到达"的判据不能取 HTTP 层**：自签证书 ⇒ 握手在证书校验处中断 ⇒ HTTP 请求永不发出
   ⇒ 用 `request` 事件判"到达"会**永远红（假红）**。正确判据是 `SNICallback` 被调用（= 握手已开始）。

**★又一个"参数丢失伪装成功能失败"**：`superapp-scene.swift` 的探针参数分派漏了新 case
⇒ 走 `default: extra = ""` ⇒ `publicUrl`/`rounds` **静默丢弃** ⇒ 现象是"公网经代理全失败"
（`public_statuses: []`），而真因只是参数没传进去。⇒ **新增探针必须同时加 Swift 分派分支**。

**破坏性验证（真机）**：① 探针不发请求 ⇒ `exit 1`（CONNECT/SNI 全 0）；
② 宿主忽略 `PROTEUS_B_PROXY` ⇒ `exit 1`（同样全 0）。恢复 ⇒ `exit 0`、`ROUTE_B_DEVICE_OK`。

## 8. 判据（可回归）

- `tests/httpdns-wire.test.ts` 断言 iOS **必须**明确 `fetch.unsupported`，
  且**不得**再声称"平台不支持"（只允许说"当前栈无注入点"）。
- `bash hosts/ios/run-httpdns-route-b-probe.sh` —— **模拟器** B 路线 11 项判据（`exit 1` = 不可行）；
  证据 `hosts/ios/results/httpdns-route-b.json` 入库，`tests/httpdns-wire.test.ts` 校验其
  `verdict === 'ROUTE_B_FEASIBLE'` 且 `sniValues` 全是原域名。
- `bash hosts/ios/run-httpdns-b-device-probe.sh` —— **真机** B 路线 13 项判据（`exit 1` = 失败）；
  证据 `hosts/ios/results/httpdns-b-device.json` 的 `verdict === 'ROUTE_B_DEVICE_OK'` 由判据校验。
- 本文的 API 事实均可由 SDK 头文件复核；路线选择变更时必须同步本文与能力矩阵。

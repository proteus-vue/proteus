# 01 · Android 传输栈换装 OkHttp（HTTP/2 + 全字段传输读数 + HTTPDNS 前置）

> 立项：2026-10-22 · 决策 **#1160** · 承接 `00-capability-matrix.md` §6「P1 剩余两项」（HTTP/2 Android + HTTPDNS 全端）
> 任务板：`T-android-okhttp-transport`

## 1. 为什么单独立项（而不是继续用 `HttpURLConnection`）

矩阵 P1 只剩两项，而**它们落在同一处**：宿主传输栈。

| 能力 | `HttpURLConnection` 能做到吗 | 实测/机制依据 |
|---|---|---|
| HTTP/2（Android） | ❌ | 真机 `server_protocols={"http/1.1":3}`（#1155）。AOSP 的 `HttpURLConnection` 虽然底层是 `com.android.okhttp`，但**不暴露协议协商**，也不开 h2 |
| HTTPDNS | ❌ | `HttpURLConnection` 没有 `Dns` 注入点；只能改 URL 为 IP，但那会**破坏 SNI 与证书主机名校验** |
| 连接复用 | ✅（已具备） | 真机 `3 请求 / 1 TCP`（#1155）——**本次换栈不得让它退化** |
| TLS pinning | ✅（已具备） | `setSSLSocketFactory`（#1153/#1155） |
| 传输读数 | 🟡（只有 `proto` + `ttfbMs`） | 状态行 + 自量 TTFB（#1158）；`dnsMs/connectMs/tlsMs/reused` **平台不暴露** |

⇒ 一次换栈同时买到三样：**h2、HTTPDNS 的落点、全字段读数**。这正是矩阵 §6 说的
「两者都属'换/扩传输栈'，应合并为一个独立立项（同一笔栈改动的两个收益）」。

## 2. 选型：OkHttp 3.14.9（实测体积决定）

用本仓**同一套 d8 参数**（`--release --min-api 24 --lib android.jar`）实测：

| 组合 | dex 未压缩 | APK 内（压缩后） | 相对基线 |
|---|---|---|---|
| 现状（无 OkHttp） | 627,800 B | 292,290 B | — |
| **OkHttp 3.14.9 + Okio 1.17.2** | 388,392 B | **184,549 B** | **+180 KB** |
| OkHttp 4.12.0 + Okio 3.6.0 + kotlin-stdlib 1.8.21 | 2,879,144 B | 951,024 B | +929 KB |

⇒ 取 **3.14.9**（最后一个纯 Java 稳定线）。4.x 用 Kotlin 重写，单 `kotlin-stdlib` 就 1.6 MB 未压缩，
为一项能力付 ~930 KB 不划算。依赖入库在 `hosts/android/thirdparty/`（含 sha256 与升级口径）。

★**这是本立项唯一的"新增依赖"决定，必须显式记录**：iOS 的 `URLSession` 不需要第三方栈
（h2 平台默认已具备），鸿蒙的 RCP 是系统栈 ⇒ 本次换栈**只影响 Android 一端**，
不能表述为"三端补齐传输层"。

## 3. 设计（三条硬约束）

1. **唯一建连入口不能破**：现状四条请求路径（普通 / 流式上传 / 落盘 / 流式下载）都经
   `TlsPinning.open`，`#1153` 的教训是「新增传输策略不会漏路径」。换栈后统一收口到
   `HttpTransport.execute`，四条路径**只改取数与写体，不改错误映射与上限闸**。
2. **连接复用不能退化**（#1155 的真回归教训）：
   `OkHttpClient` 持有 `ConnectionPool`，**每请求 new 一个 client = 池归零**。
   ⇒ 按传输配置（`pinsRaw|pinOnly`）缓存 client，per-call 的 timeout / redirect 一律走
   `client.newBuilder()`（**共享同一 pool 与 dispatcher**）。
3. **缺键 = 不可得**（#1158 的硬约定）：OkHttp 的 `EventListener` 能测到就写键，
   测不到就不写；**绝不填 0/false**。

### 3.1 传输读数（EventListener）

| 字段 | 来源 | 说明 |
|---|---|---|
| `proto` | `Response.protocol()` | 换栈后 Android **应出现 `h2`**（本次的核心判据） |
| `reused` | `connectionAcquired` 的 `Connection` 复用判定 | OkHttp 3.x 无公开 `isReused`；用 `connectionAcquired` 次数 vs `connectStart` 次数**按调用计**：本次 call 若发生过 `connectStart` ⇒ `reused=false`，否则 `true` |
| `dnsMs` | `dnsStart → dnsEnd` | 自定义 `Dns` 注入点也在这里 |
| `connectMs` | `connectStart → connectEnd` | 含 TLS 之前的部分 |
| `tlsMs` | `secureConnectStart → secureConnectEnd` | 明文/复用连接**不写**该键 |
| `ttfbMs` | `requestHeadersEnd → responseHeadersStart` | 纯首字节（比现状"连接+首字节+响应头"更细） |

★现状 Android 的 `ttfbMs` 语义会**变化**（变细）。这是**改进**，但必须写进矩阵，
不能让下游误以为"变快了"。

### 3.2 取消通道

`HttpURLConnection.disconnect()` → `Call.cancel()`。取消后 OkHttp 抛 `IOException("Canceled")`，
JS 侧本就按 `fetch.aborted` 收口 —— 语义不变。

### 3.3 保持不动的语义（回归面）

| 语义 | 现状实现 | 换栈后 |
|---|---|---|
| 响应体 32 MiB 上限 | `readAll` 累计闸 | **不动** |
| 落盘 1 GiB 上限 + 残包清理 | `performSaveToFile` | **不动** |
| 流式背压（8 块队列 + ack 等待） | `performStreaming` | **不动** |
| 上传流式（文件不进 JS） | `setFixedLengthStreamingMode` | `RequestBody.writeTo`（内存仍只有 16 KiB 缓冲） |
| cookie 会话共享 | `CookieManager` 注入 + 回灌 | **不动**（不换 OkHttp `CookieJar`：要与 WebView 共用同一存储） |
| 框架内部头剔除 | `applyRequestHeaders` | **不动** |
| 重定向 manual | `setInstanceFollowRedirects` | `followRedirects(false)` |

## 4. 判据（可执行）

| # | 判据 | 入口 |
|---|---|---|
| ① | 静态：client 按配置缓存 + 构造收口唯一 + 缓存键含 pinOnly | `tests/android-okhttp-transport.test.ts`（新） |
| ② | 静态：四条路径全部经 `HttpTransport`（不得残留 `openConnection`） | 同上 |
| ③ | 静态：pinning 的 factory/trustManager **同源同缓存** | `tests/tls-pinning-reuse.test.ts`（改断言口径） |
| ④ | 线格式：`Transport=22` 五端 43 向量不变 | `node scripts/check-invoke-wire-parity.mjs` |
| ⑤ | 读数解析：新键（`reused` 只认 `"1"/"0"`、缺键不填） | `npx vitest run tests/fetch-transport-meta.test.ts` |
| ⑥ | **真机：h2 协商**（核心） | `bash hosts/android/run-transport-probe.sh` ⇒ `http2_ok=true` |
| ⑦ | **真机：连接复用不退化** | 同上 ⇒ `conn_reused_ok=true`（3 请求 / 1 连接） |
| ⑧ | **真机：四条路径回归** | `bash hosts/android/run-tls-probe.sh`（pinning）· `run-transfer-probe.sh`（上传）· `run-save-probe.sh`（落盘）· `run-stream-probe.sh`（流式） |
| ⑨ | 宿主编译（零设备） | `bash hosts/android/check-host-compile.sh` |
| ⑩ | AAR 新鲜度 + CLI 打包 | `pnpm check:android-runtime-aar-fresh` · `npx vitest run tests/app-host-cli.test.ts` |

**破坏性验证**（每条断言必须能被打红）：
① 去掉 client 缓存 ⇒ 判据红；② 某条路径改回 `openConnection` ⇒ 判据红；
⑥ 把 `protocols()` 限成 `HTTP_1_1` ⇒ 真机 `http2_ok=false`（反向证明判据有效）。

## 5. 诚实边界

1. **只为 Android 一端付费**：iOS 的 h2 是平台默认（#1155），鸿蒙 RCP 本次不动。
2. **OkHttp 3.x 已停止维护**：安全修复不再回移；升级 4.x 的代价是 +929 KB + Kotlin 运行时（见 README）。
3. **HTTPDNS 本次只做"接入点"**：`Dns` 注入 seam 落地并可测，但**业务 API + 线格式 tag 属下一单**
   （跨五端，需 `Dns` TLV + TS 门面 + 三端宿主，不与换栈混在一个单元里）。
4. **`reused` 是"本次调用是否新建连接"**，与 `HttpURLConnection` 时代"服务端视角的连接计数"口径不同；
   两者不可直接对比，矩阵里各自标注来源。
5. **h2 能否协商还取决于服务端**：自签 + `tlsPinOnly` 的探针服务端已开 `allowHTTP1` 与 ALPN；
   生产环境若对端只支持 h1，读数会如实是 `HTTP/1.1`（不是缺陷）。

## 6. 下一步（本单之外）

1. **HTTPDNS 能力化**（跨五端）：`Dns` 线格式 tag + `fetch: { httpDns }` 门面 + 三端宿主实现；
2. 鸿蒙 RCP 接自定义 CA ⇒ 才可能协商 h2（其 `http2_ok` 现为 `null`＝未测）；
3. 传输读数接进性能预算门禁（首字节 P95 告警，需先积累基线）。

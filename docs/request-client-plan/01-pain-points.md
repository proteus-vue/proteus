# 请求库方案（#1342）· 痛点 → 答案

> **定位**：不做"又一个 axios"，做**平台方的请求治理层**。
> 主流库优化"业务少写代码"；我们优化"**一个 App 里几十个团队共用一套网络，还管得住**"。
> 这两个视角的答案完全不同——前者优化便利，后者优化可控/可审计/可对账。

## 0. 架构位置（三条铁律）

```
L4 业务代码
     ↓  import { createRequestClient } from '@proteus-vue/api'
L3 请求库（本方案）= 实例配置 · 幂等/熔断/离线/未知态 · 签名脱敏 · bizId 隔离 · 审计
     ↓  只调 useFetch / useFetchTask / pipeline 的配置面
L2 fetch 策略管线（已有 987 行）拦截器·重试·并发·优先级·去重·HTTP 缓存·deadline·取消
     ↓
L1 能力桥 useFetch → bridge.request
     ↓
L0 三端宿主（OkHttp / URLSession / RCP）
```

**铁律（违反即第四套并行栈）**

1. `FetchConfig` / `FetchResult` 是唯一契约；策略字段（`baseURL`/`bizId`/幂等等）**不进** `FetchConfig`
   —— 否则污染「门面 → 桥参数 → App args → 线格式」四层白名单（`docs/contract-index.md:190-202`）
2. 所有新增策略字段登记为 `PIPELINE_ONLY_FIELDS`，**不下传宿主**
3. 结果永不抛（G-32.3）；`requestOrThrow` 只是显式选择
4. 内部只调 `useFetch`/`useFetchTask`/pipeline，**绝不复刻 `IRequestAdapter`**

---

## 1. 痛点 → 答案（20 条）

### 一、可靠性（业界最普遍的坑）

| # | 主流库痛点 | 来源 | 我们的答案 | 落地 |
|---|---|---|---|---|
| 1 | **重试不看方法与幂等性**，POST 下单也被重发 | 本仓实证 `capability-fetch-pipeline.ts:185-195` | 重试前查**幂等性声明**：非幂等默认不重试，除非给 `idempotencyKey` | `reliability.ts::canRetry` |
| 2 | **抖动是确定性的**（`attempt % 2` 符号），多客户端同 attempt 得同一系数 | 本仓实证 `:208-212` | 真随机抖动 + 服务端可覆盖（读 `Retry-After`） | `computeBackoffMs` / `parseRetryAfter` |
| 3 | **无幂等键**，弱网重发 = 重复扣款 | 本仓实证：零实现 | 幂等键**跨重试稳定**（同一逻辑请求一个 key，重试复用） | `resolveIdempotencyKey` + `client.ts` 任务级绑定 |
| 4 | **无断路器**，下游挂了还持续打 | 本仓实证：零实现 | open → halfOpen → closed，按 host 计数 | `CircuitBreaker` |
| 5 | **无离线队列**，断网即失败 | 本仓实证：零实现 | 持久队列 + 恢复重放 + **只收幂等** + 容量上限丢最旧 | `OfflineQueue` |
| 6 | **超时语义模糊**（连接？空闲？整个？） | 本仓实证：`timeout` vs `deadline` 已分但宿主只收单轮 | 三层显式：`connect` / `idle` / `deadline` | `RequestTimeoutPolicy` |
| 7 | **没有"未知态"** —— 支付级最致命 | 本仓实证：超时只回 `fetch.timeout` | 新增 `fetch.unknown` + `meta.sent`：**未发出 / 确定失败 / 结果未知** | `classifyFailure` |

**第 7 条是本库的核心差异化。** 主流库把超时当失败；而对支付来说，超时是**必须去查的状态**，
不是错误。判不出时本库**保守按 `unknown`**——宁可让业务多查一次单，也不能让它以为失败而重试。

### 二、数据获取（两套缓存语义打架）

| # | 痛点 | 来源 | 我们的答案 |
|---|---|---|---|
| 8 | **HTTP 缓存与查询缓存是两套**，同一请求两种"命中"解释 | 本仓实证：pipeline 的 RFC 9111 vs `request-engineering` 的 TTL | 只有一层：HTTP 缓存为准，`useQuery` 不自己缓存（`query.ts`） |
| 9 | **去重键不含 body/headers**，POST 被错误合并 | 本仓实证 `request-engineering.ts:98-109` | 完整请求身份（method+url+params+body+headers+responseType+流式） |
| 10 | **"SWR"名不副实**，命中即用不后台刷新 | 本仓实证 `request-engineering.ts:55` 自认 | 接 pipeline 真 SWR（RFC 5861 已实现），删假标签 |
| 11 | **乐观更新要手写回滚** | 业界共识 | `useMutation({ optimistic, rollback })` 内建；**`unknown` 时不回滚**（可能已成功） |

### 三、安全与合规（请求库的盲区）

| # | 痛点 | 来源 | 我们的答案 |
|---|---|---|---|
| 12 | **凭据泄漏到日志/trace** | 本仓实证：`capability-app-log.ts` 无脱敏 | 脱敏在**通道层**（不是调用方自觉）：header/query/body 三层，默认开 |
| 13 | **全局可变配置**（`axios.defaults.headers.common['Authorization']`） | 本仓实证 `02-m2-credential.md:75` 明确禁止 | 实例 `Object.freeze`；凭证只从 `auth` 取，业务拿不到 token |
| 14 | **无请求签名/防重放** | 本仓实证：零实现 | 签名钩子 + nonce/timestamp，由 client 统一注入 |
| 15 | **WebSocket 绕过全部加固** | 本仓实证：Android WS 连主机名校验都缺（`WebSocketCapability.java:196-199`） | WS 与 HTTP 走同一套策略链（**P4 阶段**） |
| 16 | **无调用审计** | 本仓实证：零实现 | 按 bizId 记域名/方法/状态/耗时（**已脱敏**，不含 path 细节与 body） |

### 四、平台化（业务库根本不做的事）

| # | 痛点 | 我们的答案 |
|---|---|---|
| 17 | 请求库没有"业务"概念 | `bizId` 贯穿：独立配额 · 独立白名单 · 独立审计 |
| 18 | 多业务共享额度，一个业务能把全 App 打满 | 额度树 `全局 → 业务 → host`，任一超限只影响自己（`QuotaTree`） |
| 19 | 跨端要各自找库 | **同一份 TS 五端生效**；端差异收进能力探测 |
| 20 | 拿不到宿主能力（HTTPDNS / pinning / 连接池） | 直通宿主；不可用端**如实 `unsupported`**，不静默降级 |

---

## 2. 对外 API

```ts
// 平台方配置一次（实例不可变）
const client = createRequestClient({
  hooks: createCapabilityHooks(bridge, { fetch }),   // 底座就是 useFetch
  baseURL: getConfig().api.baseUrl,
  bizId: 'order-center',                              // 多业务隔离轴
  network: { allowedDomains: ['api.example.com'] },   // 合规
  auth: createAuth(),                                 // 凭证托管
  retry: { attempts: 3, backoff: 'exponential', respectRetryAfter: true },
  timeout: { connect: 5000, idle: 15000, deadline: 30000 },
  idempotency: 'auto',
  circuitBreaker: { threshold: 5, cooldownMs: 30_000 },
  redact: ['authorization', 'cookie', 'idcard'],
  trace: (e) => traceBus.emit(e),
})

// 业务用法
const r = await client.get<User>('/api/user/1')       // RequestResult<User>，永不抛
if (!r.ok && r.outcome === 'unknown') {
  // ★支付/下单必须走这里：结果未知 ⇒ 去查单，不要重试
}

const t = client.task<Order>('/api/order', { method: 'POST', data, idempotencyKey })
t.abort()                                              // 真取消
```

---

## 3. 三阶段交付

| 阶段 | 内容 | 状态 |
|---|---|---|
| **C1 骨架** | `packages/api/src/request/`（types·reliability·security·tenant·query·client·index） | ✅ 完成（63 条判据全绿） |
| **C2 收口** | `createApi` / `createRequestEngineering` 内部委托本库；删自带 TTL 缓存与 FIFO 队列 | ✅ 完成（`47f20f6a` · 决策 #1342） |
| **C3 生产路径接线** | ★★★#1385：**pipeline 接 `request/reliability.ts` 的单一事实源** | ✅ 完成（见下） |
| **A（P0）** | 真机验 #540：持久 VM 是否仍崩（决定"多端一致"能否成立） | ✅ 通过（真机实证推翻 #540 · 决策 #1343） |
| **B（P1）** | 鸿蒙会话式 VM：真实 cancel/stream/WS | ◐ cancel/stream 已成立；WS 仍 🟡（前置=会话 open 后进程存活，未成立） |

### ★★★C3（#1385）：新库写对了、生产路径却没用上

C1 把正确答案写进了 `request/reliability.ts`，但**生产路径**（`capability-fetch-pipeline.ts`）
仍跑着旧逻辑 —— 与 #1344「离线队列 `flushOfflineQueue()` 没有任何调用方」**完全同构**的缺陷形态。
本轮把两处接上：

| 缺陷 | 旧行为（生产路径） | 修法 |
|---|---|---|
| **重试不看 method** | `POST /order` 超时被重试 ⇒ **可能下 N 单** | 委托 `canRetry`（幂等方法 / 有幂等键 / 显式 `retryNonIdempotent`）；被拒时 `meta.retryRefused` **如实说明原因**（不静默当"没重试过"） |
| **抖动是确定性符号** | `sign = attempt % 2` ⇒ 所有客户端退避**同样长度** ⇒ 重试风暴照旧（jitter 名存实亡） | 委托 `computeBackoffMs`（真随机 `[1-j, 1+j]`） |

★**幂等键的口径**：pipeline 看不到 `idempotencyKey`（架构约束：门面层字段不进 `FetchConfig`），
⇒ 门面层 `createApi` 在**有幂等键**时把 `retryNonIdempotent: true` 传下去（`request/client.ts`），
这条路径仍能对 POST 安全重试；业务直接调 `useFetch` 想重试非幂等请求，必须自己显式打开。

★**判据**：`tests/fetch-pipeline.test.ts` 新增 5 条（POST 不重试 / 显式放行后重试 / 幂等方法照常重试 /
抖动真随机 / `jitter=0` 可精确断言）；全套 110/110。破坏性验证 2 层（M1 摘方法门禁 ⇒ "防重复下单"红；
M2 换回确定性符号 ⇒ "真随机"红，实得恒为单值 1500）。

★★**我第一版判据是假绿，被 M2 抓出**：初版把所有 attempt 的退避值混进一个 Set 断言 `size>1`——
确定性抖动下**不同 attempt** 本来就给不同值（1000/2000/4000 × 各自符号）⇒ 旧实现也能过。
正解 = **只盯同一个 attempt 跨多次运行**是否变化。同族纪律：**新写判据必须先做破坏性验证**。

---

## 4. 判据（C1 已完成部分）

| 文件 | 条数 | 守什么 |
|---|---|---|
| `tests/request-reliability.test.ts` | 21 | 幂等键跨重试稳定 · 未知态三态 · 非幂等不重试 · 真随机抖动 · 断路器状态机 · 离线队列只收幂等 · Retry-After |
| `tests/request-security.test.ts` | 14 | 默认黑名单 · header/query/body 三级脱敏 · 规范化串可复算 · 篡改检测 · nonce 真随机 · 签名失败不发送 · 头注入防护 |
| `tests/request-tenant.test.ts` | 16 | `*.example.com` 只匹配一级 · 未配不拦 · 闸门排队/幂等释放/取消退出 · **一业务打满不阻塞另一业务** · 审计脱敏 · audit 回调抛错不阻断 |
| `tests/request-client.test.ts` | 12 | 白名单先于网络 · 断路器后续不发 · 三态贯通 · **门面字段不污染 FetchConfig** · 凭证托管 · 签名失败不发送 · trace 已脱敏 · 实例冻结 · abort ⇒ unknown |

**破坏性验证（已做）**

| 变异 | 结果 |
|---|---|
| M1 幂等键每次 attempt 重生成 | 红 1（报错直接列出 3 个不同 key） |
| M2b 超时改判 `failed` | 红 4 |
| M4 脱敏失效 | 红 2 |

---

## 5. 诚实边界

- **支付渠道 SDK 不接**（微信/支付宝/Apple IAP 原生集成）——本库只提供可靠性语义
- **无 schema/OpenAPI 代码生成**——仓库零基础设施，需单独立项
- 断路器 / 配额是**进程内**状态（单实例）；跨进程共享需宿主支持
- 脱敏是**字段名匹配**（不是内容识别）：业务把 token 塞进自定义头且没加黑名单就漏了
- **不证明 `unknown` 时代码一定能正确处置**——那是业务的（也是本库文档必须教会的）责任

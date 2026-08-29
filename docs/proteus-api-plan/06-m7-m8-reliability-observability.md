# API 层超级应用加固（M7 可靠性 + M8 可观测性）

> 对应：Pinia M7/M8、Router B8-B12 的加固逻辑在 API 层的落地。
> 追加式，不重构 P0/P1/P2。

---

## M7 — 可靠性

### M7.1 API 调用审计（白名单 / 禁写清单）

**问题**：超级应用团队大、AI 参与度高，业务里随手 `wx.request` / `fetch` 会绕过拦截器、重试、trace。

**方案**：CI 硬卡口（对齐 Pinia M8.4、Router M8.6）

```bash
# .gitlab-ci.yml 或 husky pre-commit
proteus audit api
```

规则：
- `src/{views,stores,composables,components}` 下文件禁止出现：
  - `wx\.` `tt\.` `my\.` `swan\.`（平台全局）
  - `\bfetch\s*\(` `\bXMLHttpRequest\b` `navigator\.clipboard` `localStorage\.`
  - `process\.env` 直接读取（须走 `api.config`）
- 白名单例外：`platforms/**` `packages/api/**` 可用平台 API（L1/L2）
- 违规 → CI 红，阻断合并

**配套**：`eslint-plugin-proteus` 提供同名规则，开发期即时报错。

### M7.2 弱网 / 离线韧性（A1 增强）

- **请求队列持久化**：断网时 PUT/POST 入队列（storage），恢复后按序重放
- **幂等键**：`Idempotency-Key` 头，防重放导致重复下单
- **乐观更新 + 回滚**：`api.request({ optimistic: true, rollback: () => {} })`
- **断路器**：连续失败 N 次 → 熔断 X 秒，快速失败（防雪崩）
- **超时分级**：普通请求 15s，文件上传 60s，支付 30s

### M7.3 并发控制 / 请求池

- 全局并发上限（默认 6，对齐浏览器 HTTP/1.1 限制）
- 超出排队，防小程序请求数限制（微信 `wx.request` 并发上限较低）
- 同 URL  GET 去重（A1 已有），POST 可选去重（`dedupe: true`）

### M7.4 安全：敏感字段脱敏 + 防泄漏

- **请求/响应拦截器自动脱敏**：`phone` `idCard` `token` `password` 字段 → `***`
- `--trace-api` 输出默认脱敏（防 trace 泄露到日志/埋点）
- **Authorization 头不在 trace 里输出**
- 敏感接口（支付/实名）强制 HTTPS + 证书校验（App 端）

### M7.5 版本兼容 / 降级

- **API 版本协商**：请求头 `X-Api-Version`，后端返回 `X-Api-Deprecated` 时前端告警
- **能力探测**：`api.device.supports('biometric')` → 不支持时降级方案
- **适配器热切换**：开发期一键切 mock / 真实 / 录制回放

### M7.6 内存 / 资源清理

- 页面卸载时自动 `abort` 该页面发起的未完请求（防内存泄漏 + 竞态更新已卸载组件）
- 方案：`api.request` 关联当前页面 scope，`navigator.back` 时取消
- EventListener（`onNetworkChange` / `onMessage`）返回取消函数，组合式 API `onUnmounted` 自动调用

---

## M8 — 可观测性

### M8.1 调用链 Trace（对齐 Pinia/Router trace 体系）

```ts
api.configure({ trace: true })  // 或 --trace-api 编译开关
```

输出（开发期 console + 生产期可上报）：

```
[api:request] wx GET /api/user/123  (page: Home)
  ├─ request 拦截器: +Authorization
  ├─ cache: MISS
  ├─ wx.request success 200 (142ms)
  ├─ response 拦截器: 脱敏 phone:***, idCard:***
  └─ done (total 145ms)
```

字段：`timestamp / platform / adapter / method / url / status / duration / page / traceId`

### M8.2 与 Pinia / Router trace 关联

统一 `traceId`（UUID），一次用户操作串联：
- Router：`navigateTo /pages/home` → traceId=A
- API：`request /api/user` → traceId=A
- Pinia：`store.user.setUser` → traceId=A

→ 上报后可在 DevTools 还原完整链路（对齐 Router M8.4 DevTools）。

### M8.3 生产监控指标

- 成功率（按接口 / 平台 / 网络类型分维度）
- P50/P95/P99 耗时
- 失败 TopN + 自动归因（超时 / 401 / 域名未配置 / 权限拒绝）
- 上报走 `api.messaging`（或独立通道），**脱敏后上报**

### M8.4 DevTools 面板（开发期）

- 请求列表 + 时间线 + 重试/缓存标记
- 一键重放（修改参数）
- 导出 HAR-like 文件供后端排查

### M8.5 灰度 / Mock / 录制回放

- `api.configure({ mode: 'mock' | 'record' | 'replay' | 'real' })`
- **录制回放**：真机跑一遍 → 录请求/响应 → CI 回放做回归（超强测试能力）
- 灰度：按 userId 百分比走新接口版本

### M8.6 CI 审计（M7.1 增强）

`proteus audit api --strict` 额外检查：
- 是否存在硬编码域名（应走 `api.configure({ baseURL })`）
- 是否有 `wx.request` 绕过 adapter
- 是否缺失错误处理的 `await api.xxx`（fire-and-forget 审计）
- Storage key 是否无 namespace 前缀

---

## 加固执行顺序

```
M7.1 审计（先立门禁）→ M7.4 脱敏（安全底线）
  → M7.2 韧性 + M7.3 并发（可靠性）
  → M7.5 降级 + M7.6 清理
  → M8.1 trace → M8.2 链路关联 → M8.3 监控 → M8.4 DevTools → M8.5 灰度 → M8.6 审计
```

依赖关系：M8 全部依赖 M7.1（审计框架）+ A1（拦截器）。

与 Pinia M8、Router M8 共用一套 `traceId` 生成器和上报通道 → 三者合并为**统一的 Proteus Observability Layer**。

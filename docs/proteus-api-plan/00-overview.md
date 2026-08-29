# Proteus API 层抽象 — 落地执行文档（总览）

> 配套：`proteus-pinia-plan/`（状态层）、`proteus-router-plan/`（路由层）。
> 本文档覆盖 **API 层**：小程序原生 API（`wx.*` / `tt.*` / `my.*`）+ Web API + App 原生 API 的统一抽象。
> 设计哲学与前两份一致：**透明编译 + AI-native + 产物可审计 + 分批可执行**。

---

## 0. 为什么需要 API 层抽象

现状（v2.47 推测）：业务代码里直接调用 `wx.request`、`wx.getSystemInfo`、`wx.login`、`wx.setStorageSync`……

问题：
1. **平台分支污染业务**：`if (isMp) wx.xxx else fetch` 散落在 `.vue` / `stores/` / `utils/` 各处
2. **违反 stores/ 铁律**：Pinia 文档规定 `stores/` 不得出现 `wx.` / `window.` / `process.env`，但 API 调用比状态更早破戒
3. **不可测试**：业务函数直接调 `wx.login`，单测必须 mock 全局对象
4. **不可替换**：换端（支付宝小程序 / App / 鸿蒙）或换实现（自研网关、离线缓存）要全文检索替换
5. **AI 不安全**：AI 在业务里随手写 `wx.request`，破坏 Skyline 满血 + 透明编译原则

**目标**：业务代码只写标准接口（`proteus.api.xxx`），平台差异收敛在 `platforms/*/api/`。

---

## 1. 分层模型（4 层）

```
┌──────────────────────────────────────────────┐
│  L4  业务层  (.vue / stores/ / composables/)   │
│       import { useApi } from 'proteus'         │
│       const { data } = await api.user.get(id)  │
├──────────────────────────────────────────────┤
│  L3  标准 API 层  (@proteus/api)               │
│       - 统一签名 / 类型 / 错误码               │
│       - 拦截器 / 重试 / 缓存 / 取消            │
│       - 不感知平台                              │
├──────────────────────────────────────────────┤
│  L2  适配器层  (platforms/*/api/*.adapter.ts)   │
│       - wx.request  →  IRequestAdapter         │
│       - wx.login    →  IAuthAdapter            │
│       - wx.setStorage → IStorageAdapter (Pinia M1)│
├──────────────────────────────────────────────┤
│  L1  平台原生层  (wx.* / fetch / Native Bridge) │
│       - 唯一允许出现 wx. 的位置                 │
└──────────────────────────────────────────────┘
```

**铁律**：
- `L4 / L3` 代码 **禁止出现** `wx.` `tt.` `my.` `window.` `fetch` `XMLHttpRequest` `process.env`
- 平台分支 **只允许** 出现在 `L2` 适配器工厂（`createXxxAdapter`）
- `L1` 只有平台原生 API，不做任何业务转换

---

## 2. 三端 API 适配矩阵

| 能力分类 | Web | 微信小程序 | App（Custom Renderer） |
|---------|-----|-----------|----------------------|
| 网络请求 | `fetch` / `XMLHttpRequest` | `wx.request` | Native HTTP（OkHttp/URLSession）|
| 文件上传 | `FormData` + fetch | `wx.uploadFile` | Native 上传 |
| 本地存储 | `localStorage` | `wx.setStorage(Sync)` | SQLite / SharedPreferences |
| 用户信息 | OAuth 弹窗 | `wx.login` + `code2Session` | 原生登录 SDK |
| 支付 | Web 支付 | `wx.requestPayment` | 微信/支付宝 SDK |
| 扫码 | `getUserMedia` | `wx.scanCode` | 原生相机 |
| 导航/路由 | History API | `wx.navigateTo` | Native Navigator |
| 系统信息 | `navigator` | `wx.getSystemInfo` | `Build.VERSION` 等 |
| 剪贴板 | `navigator.clipboard` | `wx.setClipboardData` | 原生剪贴板 |
| 网络状态 | `navigator.onLine` | `wx.getNetworkType` | 原生 Connectivity |
| 推送 | Web Push | `wx.requestSubscribeMessage` | FCM / APNs |
| 分享 | Web Share API | `wx.shareAppMessage` | 原生分享面板 |
| 生物认证 | WebAuthn | `wx.checkIsSoterEnrolled` | BiometricPrompt |

**原则**：以 **微信小程序 API 语义为基准**（覆盖最广、约束最细），Web / App 向它靠拢。

理由：你的框架双端核心是 Web + Skyline，Skyline API 是"最小公分母 + 最严约束"，用它做标准能天然避开"Web 能力超集导致小程序不支持"的陷阱。

---

## 3. 模块拆分（11 个能力域）

| 编号 | 能力域 | 标准接口前缀 | 优先级 |
|-----|-------|------------|-------|
| A1 | 网络请求（Request） | `api.request` | P0 |
| A2 | 文件（File） | `api.file` | P1 |
| A3 | 存储（Storage） | `api.storage` | P0（复用 Pinia M1）|
| A4 | 认证（Auth） | `api.auth` | P0 |
| A5 | 支付（Payment） | `api.payment` | P1 |
| A6 | 设备/系统（Device） | `api.device` | P1 |
| A7 | 媒体（Media：图片/音频/视频）| `api.media` | P2 |
| A8 | 导航（Navigator） | `api.navigator` | P0（对接 Router M5）|
| A9 | 界面（UI：Toast/Modal/Loading）| `api.ui` | P1 |
| A10 | 消息/推送（Messaging）| `api.messaging` | P2 |
| A11 | 分享（Share） | `api.share` | P2 |

---

## 4. 里程碑

```
P0 ── 基础设施（A1, A3, A4, A8）
  A1  Request 适配器 + 拦截器 + 重试
  A3  Storage（复用 Pinia StorageAdapter）
  A4  Auth（login / token / 刷新）
  A8  Navigator（对接 Router）

P1 ── 业务能力（A2, A5, A6, A9）
  A2  File 上传下载
  A5  Payment
  A6  Device（系统信息 / 网络 / 剪贴板）
  A9  UI（Toast / Modal / Loading）

P2 ── 增强能力（A7, A10, A11）
  A7  Media
  A10 Messaging
  A11 Share
```

### 超级应用加固（M7 + M8）

详见 `06-m7-m8-reliability-observability.md`、`08-code-splitting-ci.md`：

- **M7 可靠性**：CI 审计门禁（M7.1）/ 弱网韧性+请求队列（M7.2）/ 并发池（M7.3）/
  敏感字段脱敏（M7.4）/ 版本降级（M7.5）/ 请求自动取消+资源清理（M7.6）
- **M8 可观测**：调用链 Trace（M8.1，关联 Pinia/Router traceId）/ 生产监控（M8.3）/
  DevTools（M8.4）/ 灰度+录制回放（M8.5）/ CI 审计（M8.6）

依赖关系：
- A3 依赖 Pinia M1（StorageAdapter）
- A4 依赖 A1（token 刷新走 request 拦截器）
- A8 依赖 Router M5（App 导航）
- A9 依赖 Skyline Worklet（`wx.showToast` 无动画，自绘 Toast 走 Worklet）
- M7.1 是 M8 全部的前置（审计框架）
- M7/M8 共用 Pinia M8、Router M8 的 traceId 生成器 + 上报通道 → 统一 **Proteus Observability Layer**

---

## 5. 执行批次（防上下文撑爆）

```
B1(A1 Request) → B2(A3 Storage 复用) → B3(A4 Auth)
  → B4(A8 Navigator) → B5(P1 并行: A2/A6/A9) → B6(P2: A7/A10/A11)
  → B7(测试/迁移/codemod) → B8(M7 可靠性) → B9(M8 可观测)
```

每批 = 1 个 PR = LLM 单次 ≤ 3 文件，规则与前两份一致。
B5/B6 内部各能力域互相独立，可拆子 PR 进一步降上下文（详见 `07-testing-migration-batches.md`）。

---

## 6. 验收标准（超级应用档）

- [ ] 业务 `.vue` / `stores/` 全量 grep 无 `wx.` `tt.` `my.` `fetch(`
- [ ] 任一能力可一键切换实现（mock / 真实 / 离线缓存）
- [ ] 单测可在 Node 环境跑（不依赖 `wx` 全局）
- [ ] `--trace-api` 输出每次调用的 适配器 / 参数 / 耗时 / 结果（对齐 Pinia trace、Router trace）
- [ ] A1 在弱网下：超时、重试、取消、并发去重全部通过混沌测试
- [ ] A4 token 刷新无竞态（并发 401 只刷新一次）
- [ ] M7.1 `proteus audit api --strict` 全绿，CI 阻断平台 API 泄漏
- [ ] M8.1 `--trace-api` 与 Pinia/Router trace 共享同一 traceId，可还原完整链路
- [ ] 按需加载生效：A7/A10/A11 走独立 chunk，不进小程序主包（≤2MB）

详见各模块文件。

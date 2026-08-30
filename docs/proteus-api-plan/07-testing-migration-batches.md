# 测试 / 迁移 / 分批执行

> 对齐 Pinia、Router 文档的执行规范。

---

## 1. 测试矩阵

| 层 | 测试方式 | 覆盖目标 |
|----|---------|---------|
| L1 平台原生 | mock `wx` 全局对象 | adapter 调用正确 |
| L2 适配器 | 契约测试（AdapterContract）| 三端实现符合 `IRequestAdapter` 等接口 |
| L3 标准 API | 单测（Node，不依赖 wx）| 拦截器 / 重试 / 去重 / 取消逻辑 |
| L4 业务 | mock `api` 对象 | 业务无平台分支 |

**跨端矩阵**（必跑，对齐 Router 09-testing）：

| 能力 | Web | MP(WebView) | MP(Skyline) | App |
|------|:---:|:---:|:---:|:---:|
| A1 Request | ✅ | ✅ | ✅ | ✅ |
| A3 Storage | ✅ | ✅ | ✅ | ✅ |
| A4 Auth | ✅ | ✅ | ✅ | ✅ |
| A8 Navigator | ✅ | ✅ | ✅ | ✅ |
| A2 File | ✅ | ✅ | ✅ | ✅ |
| A5 Payment | ⚠️(需后端) | ✅ | ✅ | ✅ |
| A6 Device | ✅ | ✅ | ✅ | ✅ |
| A9 UI | ✅ | ✅ | ⚠️(需自绘) | ✅ |
| A7 Media | ✅ | ✅ | ⚠️(cover 限制) | ✅ |
| A10 Messaging | ⚠️(需 HTTPS+SW) | ✅ | ✅ | ✅ |
| A11 Share | ⚠️(兼容有限) | ✅ | ✅ | ✅ |

`⚠️` = 需真机/特定环境，CI 用 mock + 契约测试替代。

### 混沌测试（超级应用档）

- 弱网模拟（延迟 + 丢包 + 断网恢复）
- 并发 401 竞态
- 页面快速切换导致请求未完成 + 组件卸载
- 小程序页面栈满（>10）时 push
- Storage 配额满时 setItem

---

## 2. 迁移指南（存量项目 → Proteus API 层）

### 原则
- **零 / 极小改动**：业务文件不改逻辑，只改 import 来源
- 提供 codemod 自动迁移

### 迁移步骤

**Step 1：安装 + 配置**
```ts
// main.mp.ts
import { createApi } from '@proteus-vue/api'
import { createMpRequestAdapter } from '@proteus-vue/api/platforms/mp'

const api = createApi({
  baseURL: 'https://api.example.com',
  adapter: createMpRequestAdapter(),
  trace: __DEV__,
})

export { api }
```

**Step 2：替换 import**
```ts
// Before
import { request } from '@/utils/request'
// After
import { api } from '@/main'

// Before
const res = await request.get('/user')
// After
const res = await api.get('/user')
```

**Step 3：codemod 自动转换**（提供 `proteus-codemod`）
- `wx.request` → `api.request`
- `wx.getStorage(Sync)` → `api.storage.get/set`
- `wx.navigateTo` → `api.navigator.push`
- `wx.showToast` → `api.ui.toast`
- `wx.login` → `api.auth.login`
- `wx.setClipboardData` → `api.device.setClipboard`

**Step 4：验证**
```bash
proteus audit api   # 应 0 违规
proteus test --e2e  # 跨端矩阵全绿
```

### 兼容层（可选）
提供 `legacy-wx-shim.ts`：把 `wx.request` 代理到 `api.request`，允许渐进迁移（不建议长期保留）。

---

## 3. 分批执行（防上下文撑爆）

### 批次划分

```
B1 ── A1 Request（P0 地基）
B2 ── A3 Storage 复用（P0）
B3 ── A4 Auth（P0）
B4 ── A8 Navigator（P0）
B5 ── P1 并行：A2 File / A5 Payment / A6 Device / A9 UI
B6 ── P2：A7 Media / A10 Messaging / A11 Share
B7 ── 测试 + 迁移 + codemod
B8 ── M7 可靠性（加固）
B9 ── M8 可观测（加固）
```

每批 = 1 PR = LLM 单次 ≤ 3 文件。

### Prompt 模板（喂 LLM 用）

```
【角色】你是 Proteus 框架核心开发者，负责 API 层抽象。

【必读上下文】
1. proteus-api-plan/00-overview.md（架构总览、铁律、分层模型）
2. 当前批次对应的模块文件（如 B1 → 01-a1-request.md）
3. 直接依赖：若实现 adapter，需读对应平台目录已有代码

【铁律（不可违反）】
- L3/L4 代码禁止出现 `wx.` `tt.` `my.` `fetch(` `process.env`
- 平台分支只允许在 L2 适配器工厂
- 所有公共 API 必须三端可用（Web / MP / App），缺失的用 mock + 契约测试

【当前任务】B1 — 实现 A1 Request
【交付文件】
- packages/api/src/request/types.ts
- packages/api/src/request/core.ts
- platforms/{web,mp,app}/request.adapter.ts
- packages/api/test/request.test.ts

【要求】
- 严格按 01-a1-request.md 的接口签名实现
- 拦截器/重试/取消/去重全部实现 + 单测覆盖
- 完成后自跑 `request.test.ts`，全绿才结束
- 不实现本批次外的内容（如 Auth 刷新逻辑只留接口，不实现细节）
```

### 批次依赖图

```
B1 ──→ B2 ──→ B3 ──→ B4 ──→ B7 ──→ B8 ──→ B9
              ↑         ↑
              A4依赖A1   A8依赖Router M5
         B5 ──┘
         B6 ──┘（P2 可与 B4 并行）
```

B5/B6 内部（A2/A5/A6/A7/A9/A10/A11）互相独立，可拆分到子 PR 进一步降上下文。

---

## 4. 进度追踪

| 批 | 模块 | 档 | 状态 |
|----|------|---|------|
| B1 | A1 Request | P0 | ✅（@proteus-vue/api：createApi + wx/fetch adapter + 拦截器/重试/错误模型，2026-08） |
| B2 | A3 Storage | P0 | ✅ 已由 pinia-plan M1 覆盖（packages/shared/src/storage） |
| B3 | A4 Auth | P0 | ✅ 部分（@proteus-vue/api createAuth 凭证托管 + createApi 自动 Authorization，2026-08；完整登录态/权限守卫依赖 security-plan） |
| B4 | A8 Navigator | P0 | ✅ 部分：设备信息（getDeviceInfo）；导航已由 @proteus-vue/shared PlatformAdapter 覆盖 |
| B5 | A2/A5/A6/A9 | P1 | ⬜ |
| B6 | A7/A10/A11 | P2 | ⬜ |
| B7 | 测试/迁移/codemod | — | ⬜ |
| B8 | M7 可靠性 | 超级应用 | ⬜ |
| B9 | M8 可观测 | 超级应用 | ⬜ |

> 建议：**先只走 B1-B4（P0 骨架）**，跑通后再启动 P1/P2 与加固。
> 顺序对齐 Pinia（先 M1-M6）、Router（先 B1-B7）——三份计划共用一套分批哲学。

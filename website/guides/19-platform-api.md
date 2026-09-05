---
title: 平台 API
order: 19
group: 渲染与能力
---

# 平台 API

存存储、跳页面、弹 Toast、发请求——每个应用都要用的几件事，恰恰是平台分支最先污染业务的地方：`wx.setStorageSync` 还是 `localStorage`？`wx.navigateTo` 还是 `history.pushState`？Proteus 的答案是一个契约 `PlatformAPI` + 一个工厂 `createPlatformAPI`（`@proteus-vue/api`）：业务层只依赖类型契约与工厂，**不出现 `wx.` / `window.` 裸调用**。

> **四域统一：request / storage / router / ui。**
> 平台探测收敛在工厂内部；端差异是 adapter 的实现细节，业务零感知。

## PlatformAPI 契约

契约定义在 `@proteus-vue/types`（`platform-api.ts`），实现归 `@proteus-vue/api`——类型与运行时单一来源：

```ts
interface PlatformAPI {
  request: <T = unknown>(config: RequestConfig) => Promise<RequestResponse<T>>
  storage: StorageAPI // get / set / remove / clear（同步形态，最小公分母）
  router: RouterAPI   // push / replace / switchTab / reLaunch / back
  ui: UIAPI           // showToast / showLoading / hideLoading / showModal / showActionSheet
}
```

`RouterAPI` 对齐微信语义（`push` 对应 `navigateTo`、`replace` 对应 `redirectTo`），`showModal` / `showActionSheet` 对齐微信高频字段，结果统一 Promise 化（`ModalResult { confirm, cancel }` / `ActionSheetResult { tapIndex }`，取消 `tapIndex = -1`）。

## 每端适配器

`createPlatformAPI()` 内部按「wx 优先」自动探测（`globalThis.wx` 且存储/导航/UI 方法存在），三域各自的适配路径：

| 域 | wx 端（小程序 / Skyline） | Web 端 | Node / SSR 兜底 |
|---|---|---|---|
| storage | `wx.setStorageSync` 系列 | `localStorage`（JSON 序列化往返） | 内存 Map |
| router | `navigateTo` / `redirectTo` / `switchTab` / `reLaunch` / `navigateBack` | `history.pushState` + `popstate`（`switchTab`/`reLaunch` 映射为 replace，tab 语义由路由层处理） | —— |
| ui | `wx.showToast` / `showLoading` / `showModal` / `showActionSheet` | DOM toast / DOM 模态框 / 操作菜单（内联样式，零 CSS 依赖） | 无 `document` 时 `console` 降级（测试/SSR 安全） |
| request | `wx.request` | `fetch`（AbortController 超时，默认 15s） | 同 Web 路径 |

诚实边界：**运行时当前覆盖 wx + web 两端**。api-plan 三端矩阵中的 App 端（Native HTTP / 原生导航 / 原生登录 SDK）是 L2 适配器层的规划位，接入后业务代码同样零改动——这正是契约先行的好处。

## 业务代码零平台分支

同一行业务代码，两端各走各的原生实现（与 `tests/platform-api.test.ts` 同源的真实用法）：

```ts
import { createPlatformAPI } from '@proteus-vue/api'

const api = createPlatformAPI()

// storage：wx 端 wx.setStorageSync，Web 端 localStorage
api.storage.set('cart', { items: [1, 2] })
const cart = api.storage.get<{ items: number[] }>('cart')

// router：wx 端 wx.navigateTo({ url: '/pages/user?id=7' })；Web 端 pushState
api.router.push('/pages/user', { id: '7' })

// ui：wx 端原生弹窗，Web 端 DOM 对话框——同一签名、同一返回值
const { confirm } = await api.ui.showModal({ title: '确认', content: '删除？' })

// request：转发到平台请求适配器（缺省 wx.request / fetch 自动探测）
const res = await api.request<{ ok: boolean }>({ url: '/api/submit', method: 'POST', data: cart })
if (confirm && res.data.ok) api.ui.showToast('已提交')
```

## request 转发与注入

`request` 域不做任何业务加工，把 `RequestConfig` 原样转发给 `IRequestAdapter`。缺省自动探测（`createRequestAdapter`：有 `wx` → `wx.request`，否则 `fetch`）；也可以注入自定义适配器，mock / 网关 / 录制回放一键切换：

```ts
import { createPlatformAPI } from '@proteus-vue/api'
import type { IRequestAdapter, RequestConfig, RequestResponse } from '@proteus-vue/types'

const replay: IRequestAdapter = {
  name: 'web',
  request: async <T>(config: RequestConfig): Promise<RequestResponse<T>> => ({
    data: { echoed: config.url } as T,
    status: 200,
    headers: {},
    config,
  }),
}

const api = createPlatformAPI(replay) // 注入即替换，业务零感知
const res = await api.request<{ echoed: string }>({ url: '/ping', method: 'GET' })
```

单测因此可以完全脱离 `wx` 全局在 Node 跑——`api-plan` 的验收标准之一就是「业务层 grep 无 `wx.` `fetch(` `localStorage.`」。

## 与语义原语（G-31/32）的关系

平台 API 与语义原语是同一目标的两张面孔：

| 面 | 形态 | 覆盖 |
|---|---|---|
| 命令式（本篇） | `createPlatformAPI()` 四域方法调用 | request / storage / router / ui 高频域 |
| 声明式（G-31/32） | `p-*` 语义组件 + 128 原语 SSOT + 50 Capability Hook | 布局 / UI / 设备 / 系统 / 通信 / 扩展 |

分界规则：**有明确 UI 语义的走 `p-*` 组件**（编译进 `ComponentIR`，由渲染后端映射）；**命令式动作走 PlatformAPI / useXxx Hook**。能力 Hook 层（G-32：`useLocation` / `useNetwork` / `useBattery`…）全部返回 `Promise<Result<T>>`——平台不支持时返回 `Err('<cap>.unsupported')` 而非抛异常，与[能力系统](/docs/18-capability-system)的降级语义对齐。平台独占能力（蓝牙、生物认证等）**不塞进 PlatformAPI**，走能力系统声明。

## 下一步

- [能力系统](/docs/18-capability-system)：平台独占能力的声明、探测与降级
- [状态管理](/docs/15-state-management)：Pinia 与 Storage 适配的协作
- [一致性验证](/docs/29-conformance)：平台契约的机器验证

# 10 · M9 跨端 API 统一层（`@proteus-vue/types/api`）

> 基于 B1（`Platform` 判别）+ B8（官方 `WechatMiniprogram` 类型），把 Web / Skyline / App **三端常用 API 收敛为统一 `PlatformAPI` 接口**。业务层只依赖统一类型，不出现 `wx.` / `window.` / `plus.` 裸调用。

---

## 1. 设计目标

**问题**：小程序 `wx.*`、Web `window.*` / `fetch`、App 原生 `plus.*` / `uni.*` 三套 API 形态各异，业务代码若直接调用会形成平台泄漏。

**方案**：在 `@proteus-vue/types` 内定义**统一的平台无关接口 `PlatformAPI`**，各端通过 `assertPlatform` 分派到对应实现，**实现签名对齐最小公约数**。

```ts
// 业务层（统一，零平台判断）
import { platformAPI } from '@proteus-vue/types'

const res = await platformAPI.request({ url: '/api/foo' })
//          ^? 类型 = PlatformAPI['request']（统一签名）
```

---

## 2. `PlatformAPI` 接口定义

```ts
// api/platform-api.ts
export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, unknown>
  header?: Record<string, string>
  timeout?: number
}

export interface RequestResponse<T = unknown> {
  data: T
  statusCode: number
  header: Record<string, string>
}

export interface StorageAPI {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  clear(): void
}

export interface RouterAPI {
  push(url: string, query?: Record<string, string>): void
  replace(url: string, query?: Record<string, string>): void
  back(delta?: number): void
}

export interface UIAPI {
  showToast(msg: string, duration?: number): void
  showLoading(title?: string): void
  hideLoading(): void
}

/**
 * 跨端统一 API 接口（业务层唯一依赖点）
 * —— 每端实现此接口，通过 Platform 判别分派
 */
export interface PlatformAPI {
  request: <T = unknown>(opt: RequestOptions) => Promise<RequestResponse<T>>
  storage: StorageAPI
  router: RouterAPI
  ui: UIAPI
  // 平台独占能力走 CapabilityIR，不塞进这里
}
```

---

## 3. 三端实现分派（对齐铁律 #4：禁止 `#ifdef`）

```ts
// api/index.ts
import type { Platform, PlatformAPI } from '../platform'
import type { RequestOptions, RequestResponse } from './platform-api'

declare const __PLATFORM__: Platform

// ---- 各端实现（签名统一，内部适配差异）----
const webImpl: PlatformAPI = {
  request: <T>(opt: RequestOptions) => fetch(opt.url, { /* ... */ }).then(r => ({ ... })),
  storage: { /* localStorage */ } as StorageAPI,
  router:  { /* history.pushState */ } as RouterAPI,
  ui:      { /* document toast */ } as UIAPI,
}

const skylineImpl: PlatformAPI = {
  request: <T>(opt: RequestOptions) =>
    new Promise(resolve => wx.request({ ...opt, success: r => resolve(r as RequestResponse<T>) })),
  storage: { /* wx.setStorageSync */ } as StorageAPI,
  router:  { /* wx.navigateTo */ } as RouterAPI,
  ui:      { /* wx.showToast */ } as UIAPI,
}

const appImpl: PlatformAPI = { /* uni-app / 原生桥 */ } as PlatformAPI

/** 编译期注入为 literal，运行时零开销 */
export const platformAPI: PlatformAPI = (() => {
  switch (__PLATFORM__) {
    case 'web':     return webImpl
    case 'skyline': return skylineImpl
    case 'app':     return appImpl
  }
})()

// `wx.request` 等官方类型直接来自 miniprogram-api-typings（B8），此处复用
// 不需要自己定义 request 参数类型
```

> `wx.request` 的 `RequestOptions` 源自官方 `WechatMiniprogram.RequestOption`；为统一跨端，Proteus 收敛为更严格的 `RequestOptions`（最小公约数），适配层负责映射。

---

## 4. 平台独占能力：走 `CapabilityIR`，不强塞统一接口

```ts
// api/extended-capability.ts
/**
 * 只有小程序才有的能力（如蓝牙、生物认证）
 * —— 不进 PlatformAPI，走 CapabilityIR + 显式守卫
 */
export function useBluetooth() {
  assertPlatform('skyline')           // 编译期 + 运行期双重守卫
  // 此处可安全调用 wx.openBluetoothAdapter（官方类型生效）
  wx.openBluetoothAdapter({})
}
```

**原则**：
- 90% 通用能力 → `PlatformAPI`（统一、可跨端）
- 10% 平台独占 → `CapabilityIR` + `assertPlatform`（显式、可追溯）

---

## 5. 与 B8（官方类型）的协作边界

| 层 | 类型来源 | 职责 |
|----|---------|------|
| `PlatformAPI` | Proteus 自建（本文件） | 跨端统一接口，业务层依赖 |
| `wx.*` 实现内部 | **官方 `miniprogram-api-typings`** | 适配层直接用，不自造 |
| `MpComponentSchema` | Proteus 自建（B8 §9） | WXML 属性校验 |
| 平台独占 capability | `CapabilityIR` + 官方类型 | 显式守卫后使用 |

---

## 6. 验收

- [ ] 业务代码调用 `platformAPI.request` 三端均能正确分派，`tsc` 零错误
- [ ] `wx.` / `window.` / `plus.` 裸调用在业务层被 ESLint 规则禁止（`no-restricted-globals`）
- [ ] 新增平台只需新增一个 `PlatformAPI` 实现 + `switch` 分支（穷尽检查报错提醒补全）
- [ ] `wx.request` 等官方 API 参数类型源自 `miniprogram-api-typings`，Proteus 不重复定义
- [ ] 平台独占能力必须 `assertPlatform` 后才可调官方 API

---

## 7. 风险提示

- **只收敛常用 API**：请求/存储/路由/UI 四类；不要把蓝牙、支付、文件系统全塞进 `PlatformAPI`，否则接口膨胀失控
- **签名最小公约数**：统一接口取三端交集，缺省能力用 `CapabilityIR` 探测，避免"伪统一"（某端根本不支持却占位）
- **与 API plan 的关系**：本文件只定义**类型契约**，`@proteus-vue/api` 运行时包负责真实实现（含拦截器/重试/缓存）

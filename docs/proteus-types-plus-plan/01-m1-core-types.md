# 01 · M1 核心类型系统（`@proteus-vue/types`）

> 定义 Proteus 全局共享类型：平台判别、生命周期阶段、各层 IR、全局 Registry 推断、**小程序端第三方类型来源与边界**。
> **零运行时依赖，纯 `.d.ts` + 少量类型工具函数。**

---

## 1. 包结构

```
packages/types/src/
├── index.ts                     ← 统一导出
├── platform.ts                  ← Platform 判别联合
├── lifecycle.ts                 ← AppPhase / LaunchType
├── ir/
│   ├── sfc.ts                   ← SFCIR（复用 Compiler IR）
│   ├── route.ts                 ← RouteIR
│   ├── store.ts                 ← StoreIR
│   ├── module.ts                ← ModuleIR
│   └── capability.ts            ← CapabilityIR
├── registry.ts                  ← StoresRegistry / ModulesRegistry / RoutesRegistry
├── mp/
│   ├── official-typings.ts      ← 小程序官方类型引用（§8）
│   └── component-schema.ts      ← WXML 组件属性 schema（Compiler 自建，§9）
└── utils.ts                     ← 条件类型工具
```

> 相比初版新增 `mp/` 子目录：明确**哪些类型用官方 d.ts、哪些由 Proteus 自建**（这是本节最重要的边界划分，见 §8-§9）。

---

## 2. `Platform` 判别联合（替代 `#ifdef`）

```ts
// platform.ts
export type Platform = 'web' | 'skyline' | 'app'

/** 平台判别守卫 —— 业务代码唯一允许的运行时判断点 */
export function assertPlatform<T extends Platform>(
  expected: T,
): asserts typeof __PLATFORM__ is T {
  if (__PLATFORM__ !== expected) {
    throw new Error(`[Proteus] expected platform "${expected}", got "${__PLATFORM__}"`)
  }
}

/** 编译期常量（由 Compiler 注入为 literal） */
declare const __PLATFORM__: Platform

/** 条件类型：按平台抽取成员 */
export type IfPlatform<P extends Platform, T> = P extends Platform ? T : never
```

**使用范式**（业务代码）：
```ts
// ✅ 正确：用类型收窄
import type { Platform } from '@proteus-vue/types'
declare const __PLATFORM__: Platform

function getStorage() {
  switch (__PLATFORM__) {
    case 'skyline': return wxStorage
    case 'web':     return webStorage
    case 'app':     return nativeStorage
  }
}

// ❌ 禁止：#ifdef 或 process.env
// if (process.env.PLATFORM === 'mp') { ... }
```

**穷尽检查**：新增平台（如鸿蒙 `'harmony'`）后，所有 `switch (__PLATFORM__)` 必须编译报错提醒补全——这是 `#ifdef` 永远做不到的。

---

## 3. 生命周期阶段类型（供 Lifecycle plan 引用）

```ts
// lifecycle.ts
export type AppPhase =
  | 'bootstrap'
  | 'coreReady'
  | 'navigationReady'
  | 'beforeFirstPaint'
  | 'interactive'

export type LaunchType = 'cold' | 'warm' | 'recover'

export interface LifecycleContext {
  phase: AppPhase
  launchType: LaunchType
  traceId: string
}

export type PhaseHook = (ctx: LifecycleContext) => void | Promise<void>
```

---

## 4. 各层 IR（对齐 Compiler `02-ir.md`）

```ts
// ir/route.ts
export interface RouteIR {
  path: string
  name?: string
  component: string          // 组件路径
  parent?: string            // 嵌套父路由
  meta: RouteMeta
  children?: RouteIR[]
}

export interface RouteMeta {
  transition?: 'slideUp' | 'halfScreen' | 'scaleDown' | 'none'
  permissions?: string[]
  chunk?: string             // 分包归属（对齐 Router M7.1）
  errorBoundary?: boolean
  __parent?: string          // Skyline 降级用
}

// ir/store.ts
export interface StoreIR {
  id: string                 // 'user' | 'player'
  version: number
  persisted?: PersistedConfig
  lazy?: boolean             // 对齐 Pinia M7.1
  scope?: 'app' | 'page'     // 对齐 Pinia M7.5
}

// ir/module.ts
export interface ModuleIR {
  domain: string
  dependencies: string[]
  exports: string[]
  chunk?: string
  preload?: boolean
}

// ir/capability.ts
export interface CapabilityIR {
  name: string
  platforms: Partial<Record<Platform, AdapterRef>>
  runsInWorklet?: boolean
  permissions?: string[]
}

// ir/sfc.ts（复用 Compiler，此处仅 re-export + 扩展）
export interface SFCIR {
  template?: TemplateIRNode
  script?: ScriptIR
  styles: StyleIR[]
  customBlocks: Record<string, unknown>  // <route>/<config> 等
}
```

---

## 5. 全局 Registry 推断（对齐 Pinia M8.4、Module M1、Router M8）

```ts
// registry.ts
import type { StoreIR } from './ir/store'
import type { ModuleIR } from './ir/module'
import type { RouteIR } from './ir/route'

/** 由 defineStore 自动注册，全局推断 */
export interface StoresRegistry {
  // 用户扩展（声明合并）
  [id: string]: StoreIR
}

/** 由 defineModule 自动注册 */
export interface ModulesRegistry {
  [domain: string]: ModuleIR
}

/** 由 <route> 自动注册 */
export interface RoutesRegistry {
  [name: string]: RouteIR
}

/** 辅助：从 registry 取 store 类型（Pinia M8.4） */
export type StoreById<K extends keyof StoresRegistry> = StoresRegistry[K]
```

**效果**：`useStore('user')` 自动补全 + 拼写错误编译报错（替代字符串 id 静默失败）。

---

## 6. 条件类型工具

```ts
// utils.ts
export type ExtractByPlatform<T, P extends Platform> = Extract<
  T extends { platform: infer Plat } ? (Plat extends P ? T : never) : never,
  any
>

export type RequiredBy<T, K extends keyof T> = T & { [P in K]-?: T[P] }
export type Brand<T, B extends string> = T & { readonly __brand: B }  // 防混淆（M6）
```

---

## 7. 验收

- [ ] `tsc --strict` 全包通过，零 `any` 泄漏
- [ ] `IfPlatform` / `ExtractByPlatform` 在调用点正确收窄
- [ ] `useStore('typo')` 编译报错，`useStore('user')` 补全
- [ ] 所有 IR 与 Compiler `02-ir.md` 字段一致（B3 codegen 校验）
- [ ] 新增 `Platform` 成员后，所有 `switch (__PLATFORM__)` 编译报错提醒补全（穷尽检查）

---

## 8. 小程序端类型来源：官方统一类型库 ✅（重要边界）

> **结论：有官方统一类型库，不用自己从文档提炼。**

微信官方团队在 GitHub 维护 [`wechat-miniprogram/api-typings`](https://github.com/wechat-miniprogram/api-typings)，发到 npm 是两个等价包：

- **`miniprogram-api-typings`**（官方独立发版，**推荐用这个**）
- `@types/wechat-miniprogram`（走 DefinitelyTyped 镜像，社区习惯但更新略慢）

### 8.1 它覆盖什么 / 不覆盖什么

**✅ 自动生成、跟官方文档严格同步**
- `wx.*` 全部 API（`request` / `setStorage` / `showToast` / `createOffscreenCanvas` 等）→ `lib.wx.api.d.ts`
- 这部分跟着开发者文档**自动生成**，API 定义不接受社区 PR，发现错误只提 issue

**✅ 手写维护、覆盖框架构造器**
- `App()` / `Page()` / `Component()` / `Behavior()` 的参数与 `this` 类型 → `lib.wx.app.d.ts` / `lib.wx.page.d.ts` / `lib.wx.component.d.ts` / `lib.wx.behavior.d.ts`
- 云开发 `wx.cloud.*` → `lib.wx.cloud.d.ts`
- 事件、Canvas 上下文等
- 全部挂在全局命名空间 **`WechatMiniprogram`** 下（如 `WechatMiniprogram.App.Option`、`WechatMiniprogram.RequestOption`）

**⚠️ 不覆盖 / 要自己补**
- **WXML 内置组件（`<view>` / `<scroll-view>` / `<swiper>` 等）的属性类型**：`.wxml` 不是 TS 编译单元，官方 d.ts 不给标签做类型检查 → **归 Proteus Compiler 自建组件 schema（见 §9）**
- **Skyline 专属 API / 刚发布的新 API**：有滞后，可锁版本或临时 `declare module` 补
- **Promise 化封装**：官方是回调风格，要 `promisify` 得自己包一层

### 8.2 接入方式（Proteus 不自造 `wx` 类型）

```ts
// mp/official-typings.ts
/// <reference types="miniprogram-api-typings" />

import type { RequestOption } from 'miniprogram-api-typings'

/** 将官方 wx 类型收敛到 Proteus 适配层，业务不直接 import 官方包 */
export type WxRequestOption = RequestOption

/**
 * 版本对齐策略：由 proteus.config 指定目标基础库版本 → 锁对应 typings 版本
 * 避免"新 API 在旧基础库"的误用
 */
export interface MpSdkVersion {
  libVersion: string          // 如 '3.0.0'
  typingsVersion: string      // 如 '5.2.0'
}
```

`packages/types/package.json`：
```json
{
  "devDependencies": {
    "miniprogram-api-typings": "^5.2.0"
  }
}
```

### 8.3 与 `Platform` 判别联合的结合

```ts
// capability 后端分发时，wx.* 调用自动拿到官方类型
declare const __PLATFORM__: Platform

function request<T>(opt: WechatMiniprogram.RequestOption): Promise<T> {
  switch (__PLATFORM__) {
    case 'skyline': return wx.request(opt) as any   // 官方类型直接生效
    case 'web':     return webFetch(opt) as any
    case 'app':     return nativeFetch(opt) as any
  }
}
```

---

## 9. WXML 模板层类型：Proteus 自建组件属性 Schema（官方不管的部分）

> **这是 Proteus 的附加值**：官方 d.ts 不覆盖 `.wxml` 标签属性，必须由 Compiler 自建 schema，并对齐 `p-*` 映射表。

```ts
// mp/component-schema.ts

/**
 * 单个 WXML 内置组件的属性定义（源自官方文档组件元数据）
 * —— Proteus 在 Compiler 层维护，供 SFC 模板类型校验使用
 */
export interface MpComponentProp {
  name: string
  type: 'string' | 'number' | 'boolean' | 'event' | 'enum'
  required?: boolean
  enumValues?: readonly string[]
  /** 映射到 Proteus 通用名（对齐 Component plan 的 p-*） */
  alias?: string
}

export interface MpComponentSchema {
  /** 小程序原生标签名，如 'scroll-view' */
  tag: string
  props: Record<string, MpComponentProp>
  /** 对应的 Proteus 通用组件，如 'p-scroll-list' */
  proteusAlias?: string
}

/**
 * 全局组件属性注册表（Compiler 校验 SFC 模板时查这张表）
 * —— 单一来源，与官方文档元数据同步；新增组件走 B3 codegen 派发
 */
export interface MpComponentRegistry {
  [tag: string]: MpComponentSchema
}

// 示例：scroll-view 的属性 schema
export const scrollViewSchema: MpComponentSchema = {
  tag: 'scroll-view',
  proteusAlias: 'p-scroll-list',
  props: {
    scrollX: { name: 'scroll-x', type: 'boolean' },
    scrollY: { name: 'scroll-y', type: 'boolean' },
    onScrollToLower: { name: 'bindscrolltolower', type: 'event' },
    refresherEnabled: { name: 'refresher-enabled', type: 'boolean' },
  },
}
```

**职责划分（一句话）**：
> **`wx.*` 和 `App/Page/Component` 构造器参数 → 直接用官方 `miniprogram-api-typings`；WXML 标签属性类型 → 官方不管，归 Proteus Compiler 自建 schema。**

---

## 10. 版本锁定与迁移策略

| 关注点 | 策略 |
|--------|------|
| 基础库版本 | `proteus.config` 的 `mp.libVersion` 锁定目标版本 |
| typings 版本 | 由 `MpSdkVersion` 映射到对应 `miniprogram-api-typings` 版本 |
| 新 API 超前使用 | 版本低于 typings 时不报错（运行时兜底）；`audit` 给出警告 |
| 官方 typings 滞后 | 在 `mp/shims.d.ts` 用 `declare module 'miniprogram-api-typings'` 临时补 |
| 组件 schema 滞后 | `MpComponentRegistry` 支持用户扩展（声明合并），PR 回流官方元数据 |

---

## 11. 与其他计划的接口（更新）

| 类型 | 消费方 | 说明 |
|------|--------|------|
| `WechatMiniprogram.*`（官方） | Platform / API plan | capability 后端直接复用，不自造 |
| `MpComponentSchema` / `MpComponentRegistry` | Compiler（模板校验）、Component plan（`p-*` 映射） | 自建，对齐官方组件元数据 |
| `MpSdkVersion` | CLI（config 校验）、Build（目标版本） | 版本对齐 |
| `Platform` / IR / Registry | 全部运行时层 | 见 §2-§6 |

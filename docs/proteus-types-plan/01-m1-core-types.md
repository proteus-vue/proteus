# 01 · M1 核心类型系统（`@proteus-vue/types`）

> 定义 Proteus 全局共享类型：平台判别、生命周期阶段、各层 IR、全局 Registry 推断。**零运行时依赖，纯 `.d.ts`。**

---

## 1. 包结构

```
packages/types/src/
├── index.ts                  ← 统一导出
├── platform.ts               ← Platform 判别联合
├── lifecycle.ts              ← AppPhase / LaunchType
├── ir/
│   ├── sfc.ts                ← SFCIR（复用 Compiler IR）
│   ├── route.ts              ← RouteIR
│   ├── store.ts              ← StoreIR
│   ├── module.ts             ← ModuleIR
│   └── capability.ts         ← CapabilityIR
├── registry.ts               ← StoresRegistry / ModulesRegistry / RoutesRegistry
└── utils.ts                  ← 条件类型工具
```

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

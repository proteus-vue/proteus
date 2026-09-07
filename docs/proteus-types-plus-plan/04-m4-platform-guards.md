# 04 · M4 平台判别与守卫

> 提供运行时平台判别 + 编译期类型收窄，**彻底替代 `#ifdef`**。对齐铁律 #4。

---

## 1. 编译期常量注入

Compiler 在编译入口注入（对齐 Compiler `03-codegen-backends.md`）：
```ts
// 注入到每个入口（web/main.ts、mp/main.ts、app/main.ts）
declare const __PLATFORM__: 'web' | 'skyline' | 'app'
```

> 业务代码只读 `__PLATFORM__`，不直接读 `process.env` / `wx.*` / `window.*`。

---

## 2. 守卫函数

```ts
// src/platform.ts
import type { Platform } from './types'

declare const __PLATFORM__: Platform

export function getPlatform(): Platform { return __PLATFORM__ }

export function assertPlatform<P extends Platform>(
  expected: P,
): asserts __PLATFORM__ is P {
  if (__PLATFORM__ !== expected) {
    throw new Error(`[Proteus] platform assertion failed: expected ${expected}, got ${__PLATFORM__}`)
  }
}

/** 穷尽检查辅助（新增 Platform 成员时编译报错） */
export function exhaustiveCheck(x: never, msg: string): never {
  throw new Error(`[Proteus] exhaustive check failed: ${msg}, got ${x}`)
}

/** 平台分支（类型收窄） */
export function matchPlatform<T>(cases: {
  web: () => T
  skyline: () => T
  app: () => T
}): T {
  switch (__PLATFORM__) {
    case 'web':     return cases.web()
    case 'skyline': return cases.skyline()
    case 'app':     return cases.app()
    default: return exhaustiveCheck(__PLATFORM__, 'matchPlatform')
  }
}
```

---

## 3. 使用范式

```ts
// ✅ 正确：穷尽 switch（新增平台时编译报错）
function getStorage() {
  switch (__PLATFORM__) {
    case 'web':     return webStorage
    case 'skyline': return wxStorage
    case 'app':     return nativeStorage
  }
}

// ✅ 正确：守卫后收窄
function init() {
  assertPlatform('skyline')
  // 此处 __PLATFORM__ 收窄为 'skyline'，可访问 Skyline-only API
  wx.worklet.shared(0)  // OK
}

// ❌ 禁止：#ifdef
// #ifdef MP
//   wx.xxx
// #endif
```

---

## 4. 条件类型工具

```ts
// src/utils.ts
export type IfPlatform<P extends Platform, T> =
  P extends 'web' ? T :
  P extends 'skyline' ? T :
  P extends 'app' ? T : never

/** 按平台抽取能力字段 */
export type PlatformCapabilities = {
  web: { dom: true; worklet: false }
  skyline: { dom: false; worklet: true }
  app: { dom: false; worklet: false }
}

export type CapabilityOf<P extends Platform> = PlatformCapabilities[P]
```

---

## 5. Audit 规则（对齐 CLI）

CLI audit 检测：
- 业务目录出现 `process.env.PLATFORM` / `#ifdef` → 报错
- `wx.`/`document.`/`window.` 裸调用 → 报错（必须用 capability 或守卫）
- `switch (__PLATFORM__)` 缺少 `default` + `exhaustiveCheck` → 警告

---

## 6. 验收

- [ ] 新增 `Platform` 成员后，所有 `switch` 编译报错提醒补全
- [ ] `assertPlatform('skyline')` 后访问 `wx.*` 无 TS 报错
- [ ] `#ifdef` / `process.env.PLATFORM` 被 audit 拦截
- [ ] `matchPlatform` 返回类型在各分支一致
- [ ] 穷尽检查覆盖 Router/API/Component 所有平台分支

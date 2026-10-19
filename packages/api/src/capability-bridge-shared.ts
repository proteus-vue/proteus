// packages/api/src/capability-bridge-shared.ts
// ★★★**共享能力桥**（决策 #1072）—— 2026-10-19
//
// 【为什么必须共享（实测）】`createCapabilityBridge()` 每次调用都新建一个含 ~73 个闭包的对象
//   （实测 **23.8 KB/个**），且会重跑平台探测（`webBridge` 里的 IIFE / App 三组能力装配）。
//   `createCapabilityHooks()` 原先的默认参数**每次调用都建一个新桥** ⇒ 每访问一页多 23.8 KB。
//   500 页实例实测：桥 11.6 MB + Hooks 15.0 MB = 26.5 MB（54.3 KB/页）。
//
// 【为什么共享是安全的】桥是**无状态**的（所有方法只读平台全局 + 转发到宿主/总线）：
//   · 生命周期订阅由 **Hooks 实例的 scope** 管理（每页独立，见 `capability-hooks-scope.ts`）；
//   · 事件源安装已**幂等**（决策 #1071：按事件源身份去重），重复建桥不再多挂监听器；
//   · 桥内部无"页面/实例"概念 ⇒ 多页共用一份不串台。
//
// 【★依赖方向（为什么用"构造器登记"而不是直接 import）】
//   `capability.ts` → 本模块（要取共享桥）；若本模块再 import 前者的 `createCapabilityBridge`
//   就成了**环**（ESM 下会拿到未初始化的绑定）。⇒ 本模块只存一个**构造器槽位**，由
//   `capability.ts` 在模块顶层（import 之后、任何调用之前）调 `registerBridgeFactory(...)` 登记。
//   ESM 保证 import 先于模块体执行 ⇒ 首次取桥一定拿得到构造器（否则**抛错**，不静默返回半成品）。
//
// 【★诚实边界】共享的是**桥**，不是 Hooks 实例。Hooks 对象本身仍每页一份（实测 30.7 KB/个），
//   因为它持有该页的订阅回收袋，语义上必须独立。本决策省掉的是"每页 23.8 KB 的桥"。

/** 惰性持有的共享桥 */
let shared: unknown = null
/** 桥构造器槽位（由 `capability.ts` 在模块顶层登记） */
let bridgeFactory: (() => unknown) | null = null

/** ★由 `capability.ts` 在模块顶层调用：登记桥构造器（幂等）。 */
export function registerBridgeFactory(factory: () => unknown): void {
  bridgeFactory = factory
}

/**
 * 取（或惰性建）共享桥。
 * ★未登记构造器 ⇒ **抛错**（不静默返回 undefined——那会让所有能力 Hook 变成"桥缺失"的假降级）。
 */
export function getSharedCapabilityBridge<T = unknown>(): T {
  if (shared === null) {
    if (bridgeFactory === null) {
      throw new Error('共享能力桥构造器未登记：请从 @proteus-vue/api 主入口加载（capability.ts 在模块顶层登记）')
    }
    shared = bridgeFactory()
  }
  return shared as T
}

/** 当前是否已有共享桥（诊断/测试用，不触发构造）。 */
export function hasSharedCapabilityBridge(): boolean {
  return shared !== null
}

/** 丢弃共享桥（下次取会重建）——**供测试隔离**；生产不要调。 */
export function resetSharedCapabilityBridge(): void {
  shared = null
}

/* ══════════════════ 诊断：桥构造次数（判据用） ══════════════════ */

let bridgeConstructions = 0

/** 记一次桥构造（由 `createCapabilityBridge` 调用——判据据此证明"每页不再各建一份"）。 */
export function recordBridgeConstruction(): void {
  bridgeConstructions++
}

/** 桥构造累计次数（测试/诊断读数）。 */
export function bridgeConstructionCount(): number {
  return bridgeConstructions
}

/** 复位构造计数（**仅测试**）。 */
export function resetBridgeConstructionCount(): void {
  bridgeConstructions = 0
}

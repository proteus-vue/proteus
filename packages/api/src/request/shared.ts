// packages/api/src/request/shared.ts
// ★★★#1403：**跨实例共享的状态注册表**（配额树 / 断路器）。
//
// 【它修的是什么（本轮取证的第三个缺口）】
//   `tenant.ts` 的 `QuotaTree` 注释写着「必须在**所有实例之上**再有一层」，
//   但 `client.ts` 里 `new QuotaTree(...)` / `new CircuitBreaker(...)` 都在
//   `createRequestClient` **内部** ⇒ **每个实例一份**。
//   后果：超级应用里"每页一个 client"（或每业务一个）⇒ N 个实例 = N 份额度，
//   平台的"全局并发不超过 6"变成"每个实例 6" ⇒ **全局上限形同虚设**。
//   断路器同理：A 实例发现 api.x 挂了并熔断，B 实例照样继续打。
//
// 【★为什么做成**显式选择**而不是改默认】
//   改默认会改变既有语义（多实例互不干扰在某些场景是**期望行为**，例如两个独立业务
//   故意各跑各的额度）。本仓纪律：**零回归优先** ⇒ 默认仍是每实例一份，
//   需要全局治理时显式传 `sharedQuotaKey`。
//   ★但"默认不共享"这件事必须**能被发现** —— 所以 `stats()` 里会回显 `sharedQuotaKey`，
//     并在创建时若配了 `tenant.bizId` 却没配 key，console 里给一条**一次性的**提示。
//
// 【为什么按 key 分表而不是只有一个全局单例】
//   超级应用里可能同时存在"生产 client"与"测试/沙箱 client"，
//   它们不该共用同一份额度（否则测流量会吃掉生产额度）。
//   ⇒ 用 key 隔离命名空间；同 key 即同池。
import { CircuitBreaker } from './reliability'
import { QuotaTree } from './tenant'

/** 一个共享池里放了什么（配额树 + 断路器，两者一起共享才有意义） */
interface SharedPool {
  quota: QuotaTree
  breaker: CircuitBreaker | undefined
}

/** key → 池。★模块级（跨实例）—— 这是本文件存在的全部理由 */
const POOLS = new Map<string, SharedPool>()

/**
 * 取（或建）一个共享池。
 *
 * @param key 命名空间（同一 key 的多个 client 实例共享额度与熔断状态）
 * @param globalLimit 全局并发上限（★**只在首次创建时生效**——后到的实例传入的值会被忽略，
 *   因为改上限会让已在飞请求的计数失去意义。要改上限请换 key 或先 reset。）
 * @param breaker 断路器配置（同上，首次创建时生效）
 */
export function acquireSharedPool(
  key: string,
  globalLimit: number,
  breaker: { enabled: boolean; options?: Record<string, unknown> },
): SharedPool {
  const hit = POOLS.get(key)
  if (hit) return hit
  const pool: SharedPool = {
    quota: new QuotaTree(globalLimit),
    breaker: breaker.enabled ? new CircuitBreaker((breaker.options ?? {}) as never) : undefined,
  }
  POOLS.set(key, pool)
  return pool
}

/** 当前共享池数量（诊断用） */
export function sharedPoolCount(): number {
  return POOLS.size
}

/**
 * 清空共享池。
 * ★仅用于测试与"平台方要重置治理状态"的场景 —— 运行时清空会让**在飞请求的额度泄漏**
 *   （旧池的计数被丢弃，新池从 0 开始 ⇒ 实际并发可以超过上限一次）。
 *   所以它不在 client 的公开面上，只在这里导出。
 */
export function resetSharedPools(): void {
  POOLS.clear()
}

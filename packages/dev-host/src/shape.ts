/**
 * G-45 B2 —— 语义等价 shape 工具
 * CMP074 思想延伸：同能力的实现（mock/native）必须产出相同 shape 的结果。
 */

import type { ConformanceCase, NativeBackendLike } from './types'

/** 提取 JSON shape：键集合递归一致（忽略值），数组取首元素 shape；null 为独立形态（typeof null 怪癖修正） */
export function shapeOf(value: unknown): unknown {
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : []
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) out[key] = shapeOf(obj[key])
  return out
}

export function shapeEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(shapeOf(a)) === JSON.stringify(shapeOf(b))
}

/**
 * conformance 快检用例工厂：断言 backend[method](...args) 的结果符合 shape 契约。
 * 用于 loadModule 装载门禁（CMP085）与 CI 全量门禁双用途（NAT-C-04）。
 */
export function checkResultShape(
  capability: string,
  method: string,
  sampleArgs: unknown[],
  shapeContract: unknown
): ConformanceCase {
  return {
    name: `${capability}.${method} 结果 shape 契约`,
    async check(backend: NativeBackendLike) {
      const fn = backend[method]
      if (typeof fn !== 'function') return false
      const result = await fn.apply(backend, sampleArgs)
      return shapeEquals(result, shapeContract)
    },
  }
}

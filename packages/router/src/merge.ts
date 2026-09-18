// packages/router/src/merge.ts
// meta 合并（docs/proteus-router-plan M2）—— 全局默认 < 页面，嵌套对象深合并（限深 3）
// 透明度：--trace-router 可逐字段打印最终来源（global / page），见 tree.ts
import type { RouteMeta } from './types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 合并全局默认 meta 与页面 <route>.meta
 * - 标量/冲突：页面胜（{ ...global, ...page }）
 * - 嵌套对象：递归深合并，限深 3（防环 + 防意外深克隆性能损耗）
 */
export function mergeMeta(global: RouteMeta | undefined, page: RouteMeta | undefined): RouteMeta {
  const base = global ?? {}
  const over = page ?? {}
  const out: RouteMeta = { ...base }

  for (const [k, v] of Object.entries(over)) {
    const existing = out[k]
    if (isPlainObject(v) && isPlainObject(existing)) {
      out[k] = mergeDeep(existing, v, 1)
    } else {
      out[k] = v
    }
  }
  return out
}

/** 嵌套对象深合并（限深 3，超过后页面直接覆盖） */
function mergeDeep(global: Record<string, unknown>, page: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...global }
  for (const [k, v] of Object.entries(page)) {
    const existing = out[k]
    if (depth < 3 && isPlainObject(v) && isPlainObject(existing)) {
      out[k] = mergeDeep(existing, v, depth + 1)
    } else {
      out[k] = v
    }
  }
  return out
}

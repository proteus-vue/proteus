// packages/types/src/ir-guards.ts
// ★types-plus-plan B5（05 §2）：IR 类型守卫（RouteIR/StoreIR/SFCIR 形状检查）
// 错误码对齐 05 §3：IR_INVALID_ROUTE 等（codegen 消费 IR 前调用，失败即抛错 + 定位）
// 零依赖纯函数（MP 产物安全：无 ?./??/展开/解构）

/** 守卫错误码（对齐 05 §3 错误码体系） */
export const IR_GUARD_ERROR_CODES = {
  IR_INVALID_ROUTE: 'IR_INVALID_ROUTE',
  IR_INVALID_STORE: 'IR_INVALID_STORE',
  IR_INVALID_SFC: 'IR_INVALID_SFC',
} as const
export type IRGuardErrorCode = (typeof IR_GUARD_ERROR_CODES)[keyof typeof IR_GUARD_ERROR_CODES]

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/** RouteIR 形状守卫（path 必填 string；component 存在时须为 string） */
export function isRouteIR(x: unknown): x is { path: string; component?: string; name?: string; parent?: string } {
  if (!isRecord(x)) return false
  if (typeof x.path !== 'string') return false
  if (x.component !== undefined && typeof x.component !== 'string') return false
  return true
}

/** StoreIR 形状守卫（id 必填 string；version 缺省 1） */
export function isStoreIR(x: unknown): x is { id: string; version?: number } {
  if (!isRecord(x)) return false
  if (typeof x.id !== 'string') return false
  if (x.version !== undefined && typeof x.version !== 'number') return false
  return true
}

/** SFCIR 形状守卫（styles 须为数组；template/script 可选对象） */
export function isSFCIR(
  x: unknown,
): x is { template?: unknown; script?: unknown; styles: unknown[]; customBlocks?: Record<string, unknown> } {
  if (!isRecord(x)) return false
  if (!Array.isArray(x.styles)) return false
  return true
}

/** 断言版（失败抛错，含错误码 + 定位信息） */
export function assertRouteIR(x: unknown, source?: string): asserts x is { path: string; component?: string } {
  if (!isRouteIR(x)) {
    throw new Error(`[proteus-types] ${IR_GUARD_ERROR_CODES.IR_INVALID_ROUTE}${source ? ` @ ${source}` : ''}: 缺 path（string）`)
  }
}

export function assertStoreIR(x: unknown, source?: string): asserts x is { id: string } {
  if (!isStoreIR(x)) {
    throw new Error(`[proteus-types] ${IR_GUARD_ERROR_CODES.IR_INVALID_STORE}${source ? ` @ ${source}` : ''}: 缺 id（string）`)
  }
}

export function assertSFCIR(x: unknown, source?: string): asserts x is { styles: unknown[] } {
  if (!isSFCIR(x)) {
    throw new Error(`[proteus-types] ${IR_GUARD_ERROR_CODES.IR_INVALID_SFC}${source ? ` @ ${source}` : ''}: styles 须为数组`)
  }
}

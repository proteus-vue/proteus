// scripts/lib/app-composite-verdict.d.mts
// 类型声明（配套 app-composite-verdict.mjs）——供 tests/app-screen-content-gate.test.ts
// 以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。纯判据函数，签名与实现同源。

export type CompositeDatum = Record<string, unknown>
export type CompositeCheck = (d: CompositeDatum) => boolean

/** 各端"真上屏"判据（Android / iOS / 鸿蒙） */
export const COMPOSITE_OK: Record<string, CompositeCheck>

/** 各端"真实触摸"判据（非装置内直调） */
export const REAL_TOUCH_OK: Record<string, CompositeCheck>

/** 该端缺失/为 0 的真实触摸字段名（报错信息用） */
export function realTouchMissingField(platform: string): string

// website/scripts/lib/demo-page-type-ssot.d.mts
// 类型声明（配套 demo-page-type-ssot.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// ★#1130：本文件由 #1129 引入但当时没补声明 ⇒ 根 tsconfig 的 `npx vue-tsc --noEmit` 一直红。

/**
 * `slug → 该页 `data` 结构的接口名`。
 * `null` = 该页没有单一返回接口（void / 句柄型 / 联合型），**显式标注不假装覆盖**。
 */
export const PAGE_TYPE_SSOT: Record<string, string | null>

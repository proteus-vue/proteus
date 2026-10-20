// website/scripts/lib/type-refs.d.mts
// 类型声明（配套 type-refs.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// ★#1130：本文件由 #1124 引入但当时没补声明 ⇒ 根 tsconfig 的 `npx vue-tsc --noEmit` 一直红。

import type { IfaceMap } from './ts-ifaces.mjs'

/** TS 内置/全局类型（不需要在本项目文档里解释）。 */
export const TS_BUILTINS: Set<string>

/** 从任意签名/类型片段里抽出**本项目已知的自定义接口名**。 */
export function namesIn(sig: string, ifaces: IfaceMap): string[]

/**
 * 收一页的全部类型引用（四个来源：参数类型 / 参数对象属性类型 / 返回值类型 / 页级属性与方法）。
 * @returns 类型名（去重，顺序稳定）
 */
export function collectPageTypeRefs(p?: {
  sigLine?: string
  ifaces?: IfaceMap
  allMethods?: Array<{ sig?: string }>
  allProps?: Array<{ type?: string }>
}): string[]

/** 悬空引用检查：页面引用了自定义类型但无说明段 ⇒ 返回缺失清单。 */
export function findUnexplainedTypes(markdown: string, ifaces: IfaceMap): string[]

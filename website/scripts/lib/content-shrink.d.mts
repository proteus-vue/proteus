// website/scripts/lib/content-shrink.d.mts
// 类型声明（配套 content-shrink.mjs）——供以 TS 导入时拿到类型（否则 TS7016「找不到声明文件」）。
// ★#1130：本文件由 #1125 引入但当时没补声明 ⇒ 根 tsconfig 的 `npx vue-tsc --noEmit` 一直红。

/** 文档结构性规模（只统计结构，不看文案——文案改写不该触发缩水判定）。 */
export interface DocMeasure {
  tableRows: number
  headings: number
  codeBlocks: number
  bodyLines: number
}

/** 统计一个 markdown 文档的结构性规模。 */
export function measureDoc(content: string): DocMeasure

/** 两个度量的差值（正数 = 缩水）。 */
export function shrinkOf(prev: Partial<DocMeasure>, now: Partial<DocMeasure>): DocMeasure

/** 是否构成"实质性缩水"（默认：绝对差 >2 且相对 >10%）。 */
export function judgeShrink(
  prev: Partial<DocMeasure>,
  now: Partial<DocMeasure>,
  opts?: { minAbs?: number; ratio?: number },
): { shrunk: boolean; fields: string[]; detail: string }

/** 合并基线：**只允许增长**（任一指标变小则保留旧值）。 */
export function mergeBaseline(prev: DocMeasure | undefined | null, now: DocMeasure): DocMeasure

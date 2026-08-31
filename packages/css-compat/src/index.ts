// packages/css-compat/src/index.ts
// G-21 css-compat B1：CSS 跨端兼容——--strict-css 校验（CSS001-012）+ 编译期重写 + css-compat-report
// 纯逻辑零运行时依赖（postcss 仅构建期工具）；CLI（css:check）与 Compiler 管线共用
export type {
  CssViolation,
  StrictCssOptions,
  RewriteCounts,
  CssCompatReport,
  CssFileResult,
  CssSeverity,
} from './types'
export { buildCssCompatReport, lintStyleCss } from './report'
export { rewriteStyleCss } from './rewrite'
export { extractStyleBlocks } from './extract'
export type { ExtractedStyle } from './extract'
export { CSS_BUDGETS, checkCssBudget, formatBudgetCheck } from './budget'
export type { CssBudgetMetric, CssGlobalReport, BudgetCheckResult } from './budget'
export { CSS_RULES, CSS_RULE_MAP, defaultStrictOptions } from './rules'
export type { CssRule } from './rules'

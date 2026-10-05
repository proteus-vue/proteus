// packages/compiler/src/cse/index.ts
// ★★★G-61 B1：**CSE（编译期 CSS 引擎）· 公开出口**（L-A 唯一实现——plan README §1）
//
// 链路：`<style>` 文本 → parseStyleSheet（收集/长手展开/层/特异性/源序）
//        → buildIndex（按 key selector 分桶）→ chainMatches（右→左）
//        → cascade（五级层叠：importance → @layer → specificity → order）
//        → computeTree（继承 + 计算值 + StyleIR 字段映射 + trace）
//
// ★过渡期（plan §2.2「新通路并行」）：本模块与 `vapor/template.ts` 的旧折叠通路**并存**；
//   B3 按端/字段切换后旧通路下线。`proteus explain` 的 trace 由 `CseComputedNode.trace` 承载。
export { parseStyleSheet, parseChain, parseSegment, specificityOf, stripScopeSuffix } from './parse'
export { expandShorthandDecl, splitTopLevel, UNSUPPORTED_SHORTHANDS } from './shorthand'
export { extractFromSfc, parseInlineStyleToLonghand } from './extract'
// ★★★G-61 B2（2026-10-05）：**动态 :class 预计算**（Profile §5——属性维度分解 + 互斥分组 + 爆炸保护）
export { enumerateDynamicClassCandidates, buildDynamicClassPlans } from './dynamic'
// ★★★G-61 B4（2026-10-05）：CSS 引擎 lint（E-CSS-001~006 / W-CSS-101~105）+ degradeTo 配方执行器
export { lintCse, hasCseLintErrors, formatCseLint, CSE_LINT_RULES } from './lint'
export type { CseLintDiagnostic, CseLintOptions } from './lint'
export { applyDegradeRecipe, DEGRADE_RECIPES } from './degrade'
export type { DegradeRecipe, DegradeResult, DegradeContext } from './degrade'
export type { EnumerateResult, BuildDynamicPlansOptions, BuildDynamicPlansResult, DynamicPlanDiagnostic } from './dynamic'
export type { CseExtractResult, ExtractOptions } from './extract'
export { buildIndex, candidatesFor, chainMatches, segmentMatches, contextOf } from './match'
export type { MatchContext, AncestorChain, RuleIndex } from './match'
export { cascade, layerContextOf, explainLayerPrecedence } from './cascade'
export type { CascadeCandidate, CascadeInput, LayerContext } from './cascade'
export { computeTree, computeColor, computeLength, substituteVars, foldCalc, CSE_INHERITED_PROPS } from './compute'
export type { ComputeTreeOptions, CssComputedValue, LengthResolveCtx, LengthResult } from './compute'
export type {
  CseComputedNode,
  CseComputeResult,
  CseDeclaration,
  CseNode,
  CsePseudo,
  CseRule,
  CseSegment,
  CseSelectorChain,
  CseStyleSheet,
  CseTraceStep,
  CseWinner,
} from './types'

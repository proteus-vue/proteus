// packages/css-compat/src/report.ts
// G-21 css-compat B1：css-compat-report 聚合（03 §三 结构 + 09 集成）
import postcss from 'postcss'
import type { Root } from 'postcss'
import type { CssCompatReport, CssViolation, StrictCssOptions } from './types'
import { applyRules, defaultStrictOptions, UNIVERSAL_SELECTOR_RE } from './rules'
import { rewriteStyleCss } from './rewrite'

/** 语义组件建议检测（04-semantic-style-components.md：裸能力 → p-* 语义组件），AST 精确遍历 */
function detectSemanticComponents(root: Root): Record<string, number> {
  const hits: Record<string, number> = {}
  root.walkDecls((decl) => {
    let name: string | null = null
    if (decl.prop === 'backdrop-filter') name = 'p-glass'
    else if (decl.prop === 'position' && /sticky\b/i.test(decl.value)) name = 'p-sticky'
    else if (decl.prop === 'overflow' && /(scroll|auto)\b/i.test(decl.value)) name = 'p-scroll'
    else if (decl.prop === 'box-shadow') name = 'p-shadow'
    else if (/(linear|radial)-gradient/i.test(decl.prop)) name = 'p-bg-gradient'
    if (name) hits[name] = (hits[name] ?? 0) + 1
  })
  return hits
}

/** 禁止项计数（03 §三 forbidden：float / 通用选择器），AST 遍历避免正则量词坑 */
function countForbidden(root: Root): { float: number; universalSelector: number } {
  let float = 0
  let universalSelector = 0
  root.walkDecls((decl) => {
    if (decl.prop === 'float') float++
  })
  root.walkRules((rule) => {
    if (UNIVERSAL_SELECTOR_RE.test(rule.selector)) universalSelector++
  })
  return { float, universalSelector }
}

/** 校验 + 重写 + 报告聚合（B1 主入口；--strict-css 校验 + 重写统计 + 报告 JSON） */
export function buildCssCompatReport(css: string, options: StrictCssOptions = {}): CssCompatReport {
  const opts = defaultStrictOptions(options)
  const violations: CssViolation[] = []
  let root: Root
  try {
    root = postcss.parse(css, { from: undefined })
  } catch (e) {
    return {
      rewritten: { calc: 0, vh: 0, 'rgba-to-argb': 0 },
      semanticComponents: {},
      forbidden: { float: 0, universalSelector: 0 },
      forbiddenCount: 0,
      selectors: 0,
      classSelectors: 0,
      bundleCssBytes: Buffer.byteLength(css, 'utf8'),
      violations: [{ code: 'CSS-PARSE', message: 'CSS 解析失败：' + (e as Error).message, severity: 'error', fixable: false }],
    }
  }
  root.walkRules((rule) => applyRules(rule, opts, violations))
  root.walkAtRules((at) => {
    if (at.name === 'media') applyRules(at, opts, violations)
  })

  const { rewritten } = rewriteStyleCss(css)
  const forbidden = countForbidden(root)
  let selectorCount = 0
  let classSelectorCount = 0
  root.walkRules((rule) => {
    selectorCount++
    // 类选择器（.class 范式 = 语义化，06 选择器级联哲学）；标签/属性/通用选择器不计
    if (/\./.test(rule.selector)) classSelectorCount++
  })
  return {
    rewritten,
    semanticComponents: detectSemanticComponents(root),
    forbidden,
    forbiddenCount: forbidden.float + forbidden.universalSelector,
    selectors: selectorCount,
    classSelectors: classSelectorCount,
    bundleCssBytes: Buffer.byteLength(css, 'utf8'),
    violations,
  }
}

/** 便捷：仅 lint（CLI / 测试高频用） */
export function lintStyleCss(css: string, options: StrictCssOptions = {}): CssViolation[] {
  return buildCssCompatReport(css, options).violations
}

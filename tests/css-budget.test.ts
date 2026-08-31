// tests/css-budget.test.ts
// ★G-21 css-compat B3：预算门禁（10-benchmark-budgets.md §一/§四 check-css-report）
import { describe, expect, it } from 'vitest'
import { CSS_BUDGETS, checkCssBudget, buildCssCompatReport } from '../packages/css-compat/src/index'
import type { CssGlobalReport } from '../packages/css-compat/src/index'

describe('CSS_BUDGETS 预算表（10 §一）', () => {
  it('六项指标完整（含方向）', () => {
    expect(CSS_BUDGETS.map((b) => b.key)).toEqual(['bundleCssBytes', 'criticalCssBytes', 'styleIRObjects', 'selectors', 'semanticRatio', 'forbiddenCount'])
    expect(CSS_BUDGETS.find((b) => b.key === 'bundleCssBytes')?.limit).toBe(60_000)
    expect(CSS_BUDGETS.find((b) => b.key === 'semanticRatio')?.direction).toBe('min')
    expect(CSS_BUDGETS.find((b) => b.key === 'semanticRatio')?.limit).toBe(0.7)
  })
})

describe('checkCssBudget（10 §四 assert 语义）', () => {
  it('全绿报告 → 全 pass', () => {
    const report: CssGlobalReport = {
      bundleCssBytes: 4_200,
      criticalCssBytes: 1_800,
      styleIRObjects: 120,
      selectors: 60,
      semanticRatio: 0.75,
      forbiddenCount: 0,
      classSelectors: 45,
      fileCount: 10,
    }
    const checks = checkCssBudget(report)
    expect(checks.every((c) => c.pass)).toBe(true)
  })

  it('超限逐项标记（forbidden > 0 / 字节超预算 / semanticRatio 不足）', () => {
    const report: CssGlobalReport = {
      bundleCssBytes: 61_000,
      criticalCssBytes: 9_000,
      styleIRObjects: 200,
      selectors: 100,
      semanticRatio: 0.5,
      forbiddenCount: 3,
      classSelectors: 40,
      fileCount: 1,
    }
    const checks = checkCssBudget(report)
    const failed = checks.filter((c) => !c.pass).map((c) => c.metric.key)
    expect(failed).toEqual(['bundleCssBytes', 'semanticRatio', 'forbiddenCount'])
  })
})

describe('报告扩展字段（forbiddenCount/selectors，CLI 聚合数据源）', () => {
  it('buildCssCompatReport 输出禁止项总数 + 选择器数', () => {
    const r = buildCssCompatReport('.a { float: left; } * { margin: 0; } .b { color: red; }')
    expect(r.forbiddenCount).toBe(2) // float + 通用选择器
    expect(r.selectors).toBe(3)
  })

  it('合法 CSS → forbiddenCount 0 + selectors 计数', () => {
    const r = buildCssCompatReport('.a { display: flex; } .b { gap: 8px; }')
    expect(r.forbiddenCount).toBe(0)
    expect(r.selectors).toBe(2)
  })
})

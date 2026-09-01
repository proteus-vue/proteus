// tests/adaptive.test.ts
// ★p-adaptive（adaptive-container-plan B1）：容器形态自适应纯逻辑——解析/校验/求解
//   用例对齐 06-benchmark-batches.md §3（compute 边界 + validate FLD007）
// @vitest-environment happy-dom（仅依赖 vue 无关，纯逻辑）
import { describe, it, expect } from 'vitest'
import { parseAdaptiveExpression, validateAdaptiveRanges, computeAdaptiveForm } from '@proteus-vue/fluid'
import type { AdaptiveVariant } from '@proteus-vue/fluid'

const VARIANTS: AdaptiveVariant[] = [
  { form: 'sheet', lo: 0, hi: 600 },
  { form: 'dialog', lo: 600, hi: 840 },
  { form: 'popover', lo: 840, hi: Infinity },
]

describe('p-adaptive parseAdaptiveExpression（B1 解析）', () => {
  it('标准表达式 `sheet(0, 600) | dialog(600, 840) | popover(840, ∞)` → 有序形态区间', () => {
    const modes = parseAdaptiveExpression('sheet(0, 600) | dialog(600, 840) | popover(840, ∞)')
    expect(modes).toEqual([
      { form: 'sheet', lo: 0, hi: 600 },
      { form: 'dialog', lo: 600, hi: 840 },
      { form: 'popover', lo: 840, hi: Infinity },
    ])
  })

  it('上界省略/∞/inf/空白 → Infinity；下界省略 → 0；空/格式非法 → 空数组', () => {
    expect(parseAdaptiveExpression('sidebar(840,)')).toEqual([{ form: 'sidebar', lo: 840, hi: Infinity }])
    expect(parseAdaptiveExpression('topnav(1280, inf)')).toEqual([{ form: 'topnav', lo: 1280, hi: Infinity }])
    expect(parseAdaptiveExpression('fullscreen(, 768)')).toEqual([{ form: 'fullscreen', lo: 0, hi: 768 }])
    expect(parseAdaptiveExpression('')).toEqual([])
    expect(parseAdaptiveExpression('not-a-range')).toEqual([])
    expect(parseAdaptiveExpression('sheet(0,600) | 垃圾 | dialog(600,840)')).toHaveLength(2)
  })
})

describe('p-adaptive validateAdaptiveRanges（B1 校验 FLD007）', () => {
  it('连续区间 → 零诊断', () => {
    expect(validateAdaptiveRanges(VARIANTS)).toEqual([])
    expect(validateAdaptiveRanges([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 600, hi: Infinity }])).toEqual([])
  })

  it('重叠区间 → FLD007（06 §3 用例）', () => {
    const diags = validateAdaptiveRanges([
      { form: 'a', lo: 0, hi: 600 },
      { form: 'b', lo: 500, hi: 900 },
    ])
    expect(diags).toContainEqual(expect.objectContaining({ code: 'FLD007' }))
  })

  it('不连续（gap）→ FLD007；非法区间（hi ≤ lo）→ FLD007；空 → FLD007', () => {
    expect(validateAdaptiveRanges([{ form: 'a', lo: 0, hi: 600 }, { form: 'b', lo: 700, hi: 900 }])).toHaveLength(1)
    expect(validateAdaptiveRanges([{ form: 'a', lo: 100, hi: 100 }])).toHaveLength(1)
    expect(validateAdaptiveRanges([])).toHaveLength(1)
    const diags = validateAdaptiveRanges([])
    expect(diags[0]?.code).toBe('FLD007')
  })
})

describe('p-adaptive computeAdaptiveForm（B1 求解）', () => {
  it('宽度 < 600 → sheet（06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 320)).toBe('sheet')
    expect(computeAdaptiveForm(VARIANTS, 599)).toBe('sheet')
  })

  it('边界 600/700 → dialog（[lo, hi) 左闭右开——06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 600)).toBe('dialog')
    expect(computeAdaptiveForm(VARIANTS, 700)).toBe('dialog')
  })

  it('840 以上 → popover（06 §3 用例）', () => {
    expect(computeAdaptiveForm(VARIANTS, 840)).toBe('popover')
    expect(computeAdaptiveForm(VARIANTS, 1920)).toBe('popover')
  })

  it('越界兜底：宽度 < 首区间 lo → 首形态；空区间 → null', () => {
    expect(computeAdaptiveForm(VARIANTS, -100)).toBe('sheet')
    expect(computeAdaptiveForm([], 500)).toBeNull()
  })
})

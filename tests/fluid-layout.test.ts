// tests/fluid-layout.test.ts
// ★G-22 柔性布局 B1（fluid-layout-plan 05 §4 可单测用例，期望值来自 01/05 文档「已验证」输出）
import { describe, it, expect } from 'vitest'
import { generateClamp, deriveBreakpoints, calcColumns, gridTemplate } from '@proteus-vue/compiler'

describe('fluid-layout B1（纯算法）', () => {
  it('generateClamp：设计稿 375 → clamp(20px, calc(15.77px + 1.1268vw), 32px)（01 §4.1 已验证输出）', () => {
    expect(generateClamp(20, 32, 375, { min: 320, max: 1440 })).toBe('clamp(20px, calc(15.77px + 1.1268vw), 32px)')
  })

  it('generateClamp：默认视口区间 [320,1440]；min==max → 平值 clamp', () => {
    expect(generateClamp(20, 32, 375)).toBe('clamp(20px, calc(15.77px + 1.1268vw), 32px)')
    // 区间退化（maxVw == designWidth）→ slope 0，preferred = min
    expect(generateClamp(20, 20, 375)).toBe('clamp(20px, calc(20.00px + 0.0000vw), 20px)')
  })

  it('deriveBreakpoints：设计稿 375 → sm 188 / md 328 / lg 469 / xl 609（01 §4.2 已验证）', () => {
    expect(deriveBreakpoints(375)).toEqual([
      { name: 'sm', min: 188 },
      { name: 'md', min: 328 },
      { name: 'lg', min: 469 },
      { name: 'xl', min: 609 },
    ])
  })

  it('deriveBreakpoints：自定义比例 / 自定义断点可覆盖', () => {
    expect(deriveBreakpoints(375, [{ name: 'sm', ratio: 0.5 }])).toEqual([{ name: 'sm', min: 188 }])
    expect(deriveBreakpoints(375, [{ name: 'sm', ratio: 320 / 375 }])).toEqual([{ name: 'sm', min: 320 }])
  })

  it('calcColumns：320→1 / 375→2 / 768→4 / 1024→6 / 1440→8（01 验证输出）', () => {
    expect(calcColumns(320, 160, 12)).toBe(1)
    expect(calcColumns(375, 160, 12)).toBe(2)
    expect(calcColumns(768, 160, 12)).toBe(4)
    expect(calcColumns(1024, 160, 12)).toBe(6)
    expect(calcColumns(1440, 160, 12)).toBe(8)
  })

  it('calcColumns：窄容器保底 1 列；gridTemplate 生成 minmax 模板', () => {
    expect(calcColumns(100, 160, 12)).toBe(1)
    expect(gridTemplate(160)).toBe('repeat(auto-fill, minmax(160px, 1fr))')
  })
})

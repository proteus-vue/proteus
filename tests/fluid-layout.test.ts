// tests/fluid-layout.test.ts
// ★G-22 柔性布局 B1（fluid-layout-plan 05 §4 可单测用例，期望值来自 01/05 文档「已验证」输出）
// @vitest-environment happy-dom（applyFluidStyle 用 document）
import { describe, it, expect } from 'vitest'
import { generateClamp, deriveBreakpoints, calcColumns, gridTemplate, transformTemplateToWxml } from '@proteus-vue/compiler'
import { createFluidStyle, parseFluidExpr, applyFluidStyle } from '@proteus-vue/components'
import { defaultScopedPlugin } from '@proteus-vue/plugin-vite'

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

describe('★G-22 p-fluid 编译期生成（MP 模板转换）', () => {
  it('transformTemplateToWxml：p-fluid 属性 → style 追加 clamp 声明；属性本身剥离', () => {
    const result = transformTemplateToWxml('<h1 p-fluid="font-size(20, 32)">标题</h1>', {})
    expect(result.wxml).toContain('style="font-size: clamp(20px, calc(15.77px + 1.1268vw), 32px)"')
    expect(result.wxml).not.toContain('p-fluid')
    expect(result.warnings.length).toBe(0)
  })

  it('多组 + 与静态 style 合并；自定义 designWidth/viewport 生效', () => {
    const result = transformTemplateToWxml('<div style="color:red" p-fluid="gap(12,20) margin(16,32)">x</div>', {
      fluidLayout: { designWidth: 400, viewport: { min: 320, max: 1280 } },
    })
    // slope(gap)=(20-12)/(1280-400)=0.00909；intercept=12-0.00909*400=8.36；margin slope=0.01818，intercept=16-0.01818*400=8.73
    expect(result.wxml).toContain('style="color:red; gap: clamp(12px, calc(8.36px + 0.9091vw), 20px); margin: clamp(16px, calc(8.73px + 1.8182vw), 32px)"')
  })

  it('FLD003：无法解析的表达式 → 剥离 + 警告，不生成样式', () => {
    const result = transformTemplateToWxml('<p p-fluid="font-size(20)">x</p>', {})
    expect(result.wxml).not.toContain('p-fluid')
    expect(result.warnings.some((w) => w.includes('FLD003'))).toBe(true)
  })
})

describe('★G-22 p-fluid Web 运行时（指令 + 属性改写）', () => {
  it('parseFluidExpr / createFluidStyle：与编译期同源输出', () => {
    expect(parseFluidExpr('font-size(20, 32) gap(12,20)').length).toBe(2)
    expect(createFluidStyle('font-size(20, 32)', 375, 1440)).toBe('font-size: clamp(20px, calc(15.77px + 1.1268vw), 32px)')
    expect(createFluidStyle('font-size(20)')).toBe('')
  })

  it('applyFluidStyle：与既有 style 合并（保留优先级）', () => {
    const el = document.createElement('div')
    el.setAttribute('style', 'color:red')
    applyFluidStyle(el, 'font-size(20, 32)', 375, 1440)
    expect(el.getAttribute('style')).toBe('color:red; font-size: clamp(20px, calc(15.77px + 1.1268vw), 32px)')
  })

  it('defaultScopedPlugin：p-fluid 属性 → v-p-fluid 指令（一套源码语法两端求解）', () => {
    const plugin = defaultScopedPlugin()
    const out = (plugin.transform as (code: string, id: string) => { code: string } | null)('<template><h1 p-fluid="font-size(20, 32)">x</h1></template>', '/x.vue')
    expect(out?.code).toContain('v-p-fluid="\'font-size(20, 32)\'"')
    expect(out?.code).not.toContain(' p-fluid=')
  })
})

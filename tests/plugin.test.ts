// tests/plugin.test.ts
// mp 插件内置预设内联逻辑单测（P4 适配层）
import { describe, it, expect } from 'vitest'
import { extractBuilderFnName, assembleAppJs, filterOverriddenPresets } from '../vite-plugin-mp-transform'

describe('内置预设内联（extractBuilderFnName / assembleAppJs）', () => {
  it('extractBuilderFnName 提取函数名', () => {
    expect(extractBuilderFnName('function halfScreenBuilder(ctx) { return {} }')).toBe('halfScreenBuilder')
    expect(extractBuilderFnName('const a = 1')).toBeNull()
  })

  it('assembleAppJs 内联函数定义 + 生成注册块（同文件静态可分析）', () => {
    const appJs = assembleAppJs('App({ onLaunch() {} })', [
      { name: 'halfScreen', fnName: 'halfScreenBuilder', source: 'function halfScreenBuilder() {}' },
      { name: 'slideUp', fnName: 'slideUpBuilder', source: 'function slideUpBuilder() {}' },
    ])
    expect(appJs).toContain('function halfScreenBuilder() {}')
    expect(appJs).toContain("wx.router.addRouteBuilder('halfScreen', halfScreenBuilder)")
    expect(appJs).toContain("wx.router.addRouteBuilder('slideUp', slideUpBuilder)")
    expect(appJs).toContain("if (typeof wx !== 'undefined' && wx.router) {")
    // builder 定义与注册在同一文件内（静态可分析要求）
    expect(appJs.indexOf('function halfScreenBuilder')).toBeLessThan(
      appJs.indexOf("addRouteBuilder('halfScreen'"),
    )
  })

  it('无预设时不生成注册块', () => {
    const appJs = assembleAppJs('App({})', [])
    expect(appJs).not.toContain('addRouteBuilder')
  })

  it('filterOverriddenPresets：main 中同名手写注册的预设被跳过（开发者优先）', () => {
    const presets = [
      { name: 'halfScreen', fnName: 'halfScreenBuilder', source: 'function halfScreenBuilder() {}' },
      { name: 'slideUp', fnName: 'slideUpBuilder', source: 'function slideUpBuilder() {}' },
    ]
    const main = "wx.router.addRouteBuilder('halfScreen', myOwnHalfScreen)"
    const kept = filterOverriddenPresets(main, presets)
    expect(kept.map((p) => p.name)).toEqual(['slideUp'])
  })
})

// tests/plugin.test.ts
// mp 插件内置预设内联逻辑单测（P4 适配层 + 拆包步骤 5：插件归 @proteus/plugin-vite）
import { describe, it, expect } from 'vitest'
import { extractBuilderFnName, assembleAppJs, filterOverriddenPresets } from '../packages/plugin-vite/src/plugin'

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

  // ★ 多入口优化：极简模式（入口不写 App() → 框架自动补全 app 骨架）
  it('极简模式：入口不含 App() 时自动生成 app 骨架（App/调试/错误捕获/预设注册）', () => {
    const appJs = assembleAppJs(
      "wx.router.addRouteBuilder('halfScreen', myHalfScreenVariant)",
      [{ name: 'slideUp', fnName: 'slideUpBuilder', source: 'function slideUpBuilder() {}' }],
    )
    // 骨架生成
    expect(appJs).toContain('App({')
    expect(appJs).toContain('[proteus][app]')
    expect(appJs).toContain('wx.onError')
    // 开发者自定义保留
    expect(appJs).toContain("wx.router.addRouteBuilder('halfScreen', myHalfScreenVariant)")
    // 预设定义 + 骨架内注册
    expect(appJs).toContain('function slideUpBuilder() {}')
    expect(appJs).toContain("addRouteBuilder('slideUp', slideUpBuilder)")
    // 定义在注册之前（静态可分析）
    expect(appJs.indexOf('function slideUpBuilder')).toBeLessThan(appJs.indexOf("addRouteBuilder('slideUp'"))
  })

  it('极简模式：无预设无自定义时生成纯骨架 app.js', () => {
    const appJs = assembleAppJs('', [])
    expect(appJs).toContain('App({')
    expect(appJs).toContain('__PRESET_REGISTRATION__'.replace('__PRESET_REGISTRATION__', '无内置预设'))
    expect(appJs).not.toContain('addRouteBuilder')
  })

  it('极简模式：无自定义但配置了预设时，预设定义 + 骨架注册齐全', () => {
    const appJs = assembleAppJs('', [{ name: 'halfScreen', fnName: 'halfScreenBuilder', source: 'function halfScreenBuilder() {}' }])
    expect(appJs).toContain('function halfScreenBuilder() {}')
    expect(appJs).toContain("addRouteBuilder('halfScreen', halfScreenBuilder)")
    expect(appJs).toContain('App({')
  })
})

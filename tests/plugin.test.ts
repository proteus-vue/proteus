// tests/plugin.test.ts
// mp 插件内置预设内联逻辑单测（P4 适配层 + 拆包步骤 5：插件归 @proteus-vue/plugin-vite）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { extractBuilderFnName, assembleAppJs, filterOverriddenPresets, resolvePkgPath, resolveSharedModule, scanSourceImports, rewriteFrameworkRequires } from '../packages/plugin-vite/src/plugin'

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

  // ★ 拆包步骤 7：npm 包内预设源码路径解析（模板 config.builders 指向 node_modules/@proteus-vue/router/...）
  describe('resolvePkgPath：node_modules 包内路径解析', () => {
    it('scoped 包路径 → 解析包根 + 子路径', () => {
      // projectRoot 为仓库根（★2026-08：基准改 projectRoot，createRequire(projectRoot) 解析真实 node_modules）
      const abs = resolvePkgPath(path.resolve(__dirname, '..'), 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts')
      // 从测试所在仓库解析 @proteus-vue/router → packages/router，接 src/presets/...
      expect(abs.endsWith('src/presets/halfScreen.ts')).toBe(true)
      expect(fs.existsSync(abs)).toBe(true)
    })

    it('非 scoped 包路径 → 解析包根 + 子路径', () => {
      const abs = resolvePkgPath('/tmp/project', 'node_modules/foo/src/x.ts')
      // foo 未安装 → 回退 projectRoot 相对路径
      expect(abs).toBe('/tmp/project/node_modules/foo/src/x.ts')
    })

    it('非 node_modules 路径（主仓相对路径）→ 原样 projectRoot 拼接', () => {
      expect(resolvePkgPath('/tmp/project', 'packages/router/src/presets/halfScreen.ts')).toBe(
        '/tmp/project/packages/router/src/presets/halfScreen.ts',
      )
    })
  })

  describe('★共享模块解析（resolveSharedModule：@proteus-vue/* 放行 + 第三方跳过）', () => {
    it('@proteus-vue/* 框架包 → 产物 _proteus/<name>（白名单放行，platform-plan B5 尾）', () => {
      const r = resolveSharedModule('/proj', '/proj/pages/a.vue', '@proteus-vue/capabilities')
      expect(r?.relNoExt).toBe('_proteus/capabilities')
      expect(r?.file).toContain('packages/capabilities/dist/index.js')
    })

    it('相对路径本地共享模块 → 产物相对 appDir 路径', () => {
      const repoRoot = path.resolve(__dirname, '..')
      const r = resolveSharedModule(repoRoot, path.join(repoRoot, 'examples/pages/forms.vue'), '../utils/format')
      expect(r?.relNoExt).toBe('examples/utils/format')
      expect(fs.existsSync(r?.file ?? '')).toBe(true)
    })

    it('第三方裸模块（pinia/vue/lodash）→ null（不参与，B0 边界）', () => {
      expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'pinia')).toBeNull()
      expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'vue')).toBeNull()
      expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'lodash')).toBeNull()
    })

    it('@proteus-vue/* 未构建（无 dist）→ null', () => {
      expect(resolveSharedModule('/proj', '/proj/pages/a.vue', '@proteus-vue/ghost')).toBeNull()
    })

    it('★resolveFrom（projectRoot）解析应用声明的框架包（真机 bug 2026-09-12：插件位置解析不到 → 产物缺 _proteus/*.js）', () => {
      const repoRoot = path.resolve(__dirname, '..')
      const examplesRoot = path.join(repoRoot, 'examples')
      // @proteus-vue/api 由 examples 工程声明（pnpm 严格链接仅在其 node_modules）——按 projectRoot 解析应命中
      const r = resolveSharedModule(examplesRoot, path.join(examplesRoot, 'pages/a.vue'), '@proteus-vue/api', undefined, examplesRoot)
      expect(r?.relNoExt).toBe('_proteus/api')
      expect(r?.file).toContain('packages/api/dist/index.js')
    })
  })

  describe('★共享模块 import 扫描（scanSourceImports：多行 named 不漏扫——semantic 页 desktop 白屏根因）', () => {
    it('多行 named import（import {\n  a,\n} from \'m\'）→ 源模块命中（★2026-09-07 修复：旧正则 .*? 无 s 标志不跨行 → 漏扫）', () => {
      const src = "import {\n  sendNotification,\n  buildPermissionManifest,\n} from '@proteus-vue/desktop'"
      expect(scanSourceImports(src)).toEqual([{ source: '@proteus-vue/desktop', typeOnly: false }])
    })

    it('单行 named / default / 副作用 / type import → 不回归', () => {
      expect(scanSourceImports("import { ref } from 'vue'")).toEqual([{ source: 'vue', typeOnly: false }])
      expect(scanSourceImports("import def from 'm'")).toEqual([{ source: 'm', typeOnly: false }])
      expect(scanSourceImports("import 'side'")).toEqual([{ source: 'side', typeOnly: false }])
      expect(scanSourceImports("import type { T } from 'z'")).toEqual([{ source: 'z', typeOnly: true }])
    })

    it('default + named 组合跨行（import def, {\n  a\n} from \'m\'）→ 命中一次', () => {
      const src = "import def, {\n  a,\n  b\n} from '@proteus-vue/x'"
      expect(scanSourceImports(src)).toEqual([{ source: '@proteus-vue/x', typeOnly: false }])
    })

    it('多 import 混合（单行 + 跨行 + 副作用）→ 全部命中且顺序保留', () => {
      const src = [
        "import { ref } from 'vue'",
        'import {',
        '  PHeading,',
        '  PText,',
        "} from '@proteus-vue/components'",
        "import 'proteus/style-guard'",
      ].join('\n')
      expect(scanSourceImports(src)).toEqual([
        { source: 'vue', typeOnly: false },
        { source: '@proteus-vue/components', typeOnly: false },
        { source: 'proteus/style-guard', typeOnly: false },
      ])
    })
  })

  it('极简模式：无预设无自定义时生成纯骨架 app.js', () => {
    const appJs = assembleAppJs('', [])
    expect(appJs).toContain('App({')
    expect(appJs).toContain('__PRESET_REGISTRATION__'.replace('__PRESET_REGISTRATION__', '无内置预设'))
    expect(appJs).not.toContain('addRouteBuilder')
  })

  it('★lifecycle B4：骨架含 App 级 onShow/onHide 钩子（调试日志）', () => {
    const appJs = assembleAppJs('', [])
    expect(appJs).toContain('onShow() {')
    expect(appJs).toContain("[proteus][app] onShow")
    expect(appJs).toContain('onHide() {')
  })

  it('极简模式：无自定义但配置了预设时，预设定义 + 骨架注册齐全', () => {
    const appJs = assembleAppJs('', [{ name: 'halfScreen', fnName: 'halfScreenBuilder', source: 'function halfScreenBuilder() {}' }])
    expect(appJs).toContain('function halfScreenBuilder() {}')
    expect(appJs).toContain("addRouteBuilder('halfScreen', halfScreenBuilder)")
    expect(appJs).toContain('App({')
  })
})

describe('rewriteFrameworkRequires（★reactivity-runtime spke：裸 @proteus-vue/* require → 相对 _proteus/*.js）', () => {
  it('页面层级（pages/index/index → ../../_proteus/runtime.js）', () => {
    const js = "const { reactive, effect } = require('@proteus-vue/runtime')"
    expect(rewriteFrameworkRequires(js, 'pages/index/index')).toBe("const { reactive, effect } = require('../../_proteus/runtime.js')")
  })

  it('组件层级（components/foo/index → ../../_proteus/*.js）', () => {
    const js = "const { reactive } = require('@proteus-vue/runtime')\nconst { foo } = require('@proteus-vue/api')"
    const out = rewriteFrameworkRequires(js, 'components/foo/index')
    expect(out).toContain("require('../../_proteus/runtime.js')")
    expect(out).toContain("require('../../_proteus/api.js')")
  })

  it('无 @proteus-vue/* require 时原样返回', () => {
    const js = "const { reactive } = require('@vue/reactivity')"
    expect(rewriteFrameworkRequires(js, 'pages/foo')).toBe(js)
  })
})

// tests/module-import.test.ts
// ★module-plan B0：跨模块引用最小闭环——import → require 转换 + 函数调用初始化运行时化
//   compiler 侧：moduleImports（插件预计算路径）命中 → require 语句；未命中 → 剥离 + 警告
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'
import { getTransformRule } from '../packages/compiler/src/transforms/registry'

const compile = (src: string, name = 'mi.vue', moduleImports?: Array<{ source: string; requirePath: string }>) => {
  const r = compileVueSfc(src, { filename: name, moduleImports })
  return { warnings: r.warnings, wxml: r.wxml, js: r.js }
}

describe('module-plan B0：跨模块引用（import → require）', () => {
  it('named import → require 语句（产物顶部）+ 不再警告', () => {
    const r = compile(
      '<script setup>\nimport { formatTime, pad2 } from "../utils/format"\nconst now = ref("x")\n</script>',
      'pages/a.vue',
      [{ source: '../utils/format', requirePath: '../utils/format.js' }],
    )
    expect(r.js).toContain("const { formatTime, pad2 } = require('../utils/format.js')")
    expect(r.warnings.some((w) => w.includes('import'))).toBe(false)
  })

  it('default import → require + .default 兼容（ESM default / CJS 直出）', () => {
    const r = compile(
      '<script setup>\nimport helper from "../utils/helper"\n</script>',
      'pages/a.vue',
      [{ source: '../utils/helper', requirePath: '../utils/helper.js' }],
    )
    expect(r.js).toContain("const helper = require('../utils/helper.js').default !== undefined ? require('../utils/helper.js').default : require('../utils/helper.js')")
  })

  it('namespace import → const ns = require(...)', () => {
    const r = compile(
      '<script setup>\nimport * as utils from "../utils/format"\n</script>',
      'pages/a.vue',
      [{ source: '../utils/format', requirePath: '../utils/format.js' }],
    )
    expect(r.js).toContain("const utils = require('../utils/format.js')")
  })

  it('未收录路径 → 剥离 + 警告（反黑盒）；vue/@proteus-vue/type/.vue 跳过', () => {
    const r = compile(
      '<script setup>\nimport { useStore } from "../stores/missing"\nimport type { Foo } from "../types"\n</script>',
    )
    expect(r.warnings.some((w) => w.includes('无法解析的 import'))).toBe(true)
    expect(r.js).not.toContain('require(')
  })

  it('函数调用初始化 → onLoad 运行时初始化实例属性（不再丢调用）', () => {
    const r = compile(
      '<script setup>\nimport { usePlayerStore } from "../stores/player"\nconst store = usePlayerStore()\n</script>',
      'pages/pinia.vue',
      [{ source: '../stores/player', requirePath: '../stores/player.js' }],
    )
    expect(r.js).toContain("const { usePlayerStore } = require('../stores/player.js')")
    expect(r.js).toContain('this.store = usePlayerStore()') // onLoad 运行时初始化
    expect(r.js).not.toContain('store: undefined') // 不再降级 data
  })

  it('规则 script/module-import 说明书含跨模块转换语义', () => {
    const rule = getTransformRule('script/module-import')
    expect(rule).toBeDefined()
    expect(rule!.description).toContain('require')
  })
})

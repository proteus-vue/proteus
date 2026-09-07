// tests/compiler-validate-platform.test.ts
// ★#505 产物校验收紧：校验器按平台标准（微信 = ES5）而非宿主 Node 标准——
//   new Function / node --check 认识 ES2020，?? / ?. 语法通过但微信开发者工具 babel 不解析
//   （#504 用户点名盲区：产物校验通过 ≠ 平台可用）。
import { describe, it, expect } from 'vitest'
import {
  compileVueSfc,
  validateMpJsPlatform,
  scanMpUnsafeEs5,
  assertValidResult,
  CompilerError,
} from '@proteus-vue/compiler'

describe('scanMpUnsafeEs5：平台 JS 标准扫描', () => {
  it('代码区的 ?? / ?. / ??= / ||= / &&= 均命中并报行号', () => {
    const code = 'const a = {}\nconst b = a?.x ?? "d"\nconst c = obj ??= {}\nobj ||= {}\nobj &&= {}'
    expect(scanMpUnsafeEs5(code)).toEqual(expect.objectContaining({ kind: '?.', line: 2 }))
    // 逐形态
    expect(scanMpUnsafeEs5('const a = x ?? y')?.kind).toBe('??')
    expect(scanMpUnsafeEs5('x ??= y')?.kind).toBe('??=') // ??= 优先于 ??
    expect(scanMpUnsafeEs5('x ||= y')?.kind).toBe('||=')
    expect(scanMpUnsafeEs5('x &&= y')?.kind).toBe('&&=')
  })

  it('字符串/模板/单行注释/块注释内的 ?? ?. 不误报（注释里的 ?? 是文本非代码）', () => {
    const code = [
      "const s = 'a ?? b'", // 字符串
      'const t = `x ?. y`', // 模板
      '// comment ?? here', // 单行注释
      '/* block ?. here */', // 块注释
      'const ok = a?.b || 0', // 真实代码：命中 ?. 但这是 babel 转译失败残留，应命中
    ].join('\n')
    expect(scanMpUnsafeEs5(code)).toEqual(expect.objectContaining({ kind: '?.', line: 5 }))
    const noCode = ["const s = 'a ?? b'", 'const t = `x ?. y`', '// comment ?? here', '/* block ?. */'].join('\n')
    expect(scanMpUnsafeEs5(noCode)).toBeNull()
  })

  it('clean code 通过', () => {
    expect(scanMpUnsafeEs5('const a = 1\nfunction f(){ return a + 1 }\nPage({ data: { a } })')).toBeNull()
  })
})

describe('validateMpJsPlatform', () => {
  it('残留 ES2020 → 校验失败并指明形态与位置', () => {
    const r = validateMpJsPlatform('const x = {}\nconst y = x?.k ?? 1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('ES2020 语法「?.」残留于第 2 行')
  })
  it('纯 ES5 通过', () => {
    expect(validateMpJsPlatform('var x = 1; function f() { return x > 0 ? 1 : 0 }').ok).toBe(true)
  })
})

describe('assertValidResult：平台校验进产物自校验链', () => {
  it('js 含 ?? 残留（babel 失败路径）→ 抛 CompilerError 指明文件', () => {
    const bad = { wxml: '<view/>', js: 'const v = p?.source ?? "?"', wxss: '', warnings: [] }
    expect(() => assertValidResult(bad, 'pages/bad.vue')).toThrowError(CompilerError)
    try {
      assertValidResult(bad, 'pages/bad.vue')
    } catch (e) {
      expect(String(e)).toContain('[proteus-compiler] pages/bad.vue')
      expect(String(e)).toContain('ES2020 语法「?.」残留')
    }
  })
})

describe('compileVueSfc 端到端：正常产物过平台校验（babel 后零残留）', () => {
  it('源码含 ?? / ?. → 产物经 babel 转译后校验通过（不留 ES2020）', () => {
    // 直调 transformScriptToPage 不经校验（该函数只转译）；compileVueSfc 全链才会校验
    const src = '<script setup lang="ts">const count = ref(0)\nfunction onEvent(e: any) {\n  const v = e?.detail?.value ?? 0\n  count.value = v\n}</script>\n<template><view>{{ count }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/es5.vue', px2rpx: true, rpxRatio: 2 })
    expect(r.js).not.toMatch(/\?\?/)
    expect(r.js).not.toMatch(/\?\./)
    // 产物校验已内置在 compileVueSfc（assertValidResult）——不抛即通过
  })

  it('普通页面产物过平台校验', () => {
    const r = compileVueSfc('<template><view class="a">hi</view></template>', { filename: 'pages/plain2.vue', px2rpx: true, rpxRatio: 2 })
    expect(r.wxml).toContain('class="a"')
  })
})

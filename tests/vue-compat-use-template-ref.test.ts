// tests/vue-compat-use-template-ref.test.ts
// ★2026-09-08 useTemplateRef 对齐：const b = useTemplateRef('x') → this.b = this.selectComponent('#x')（组件实例引用）；
//   模板 ref="x" → 注入 id="x" + 收集；方法体 b.value → this.b（剥 .value——实例属性非 data）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

function compile(script: string, template: string, isComponent = true) {
  return compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`, { filename: 'pages/x.vue', isComponent }) as any
}

describe('useTemplateRef 对齐（selectComponent 承接）', () => {
  it('useTemplateRef → this.selectComponent(#name) + 方法体 b.value 剥 .value', () => {
    const r = compile("const b = useTemplateRef('btn')\nfunction go() { b.value?.tap() }", '<button ref="btn">x</button>')
    expect(r.js).toMatch(/this\.b = this\.selectComponent\('#btn'\)/)
    // .value 剥除：b.value?.tap() → this.b?.tap()（babel ES5 转 _b = this.b）
    expect(r.js).not.toMatch(/this\.b\.value/)
    expect(r.js).toMatch(/this\.b\) === null|this\.b \|\|/)
  })
  it('模板 ref → 注入 id + 不报剥离警告', () => {
    const r = compile("const b = useTemplateRef('btn')", '<button ref="btn">x</button>')
    expect(r.wxml).toMatch(/id="btn"/)
    expect(r.warnings.some((w: string) => /模板 ref/.test(w))).toBe(false)
  })
  it('无 useTemplateRef 时模板 ref 仅注入 id + 收集（不警告）', () => {
    const r = compile('', '<button ref="btn">x</button>')
    expect(r.wxml).toMatch(/id="btn"/)
  })
})

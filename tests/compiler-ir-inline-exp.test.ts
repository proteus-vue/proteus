// tests/compiler-ir-inline-exp.test.ts
// ★#505 「非规范写法自动校准」体系化第一批：event/inline-expression 从描述层迁执行层
//   （tryInlineHandler 逻辑自 template.ts 迁入规则 apply，逻辑单点化——第四条真实 apply 规则）。
//   校准语义：开发者写标准 Vue 内联表达式 → 编译器包装为小程序可运行的方法调用（bindtap=方法名）。
//   验证：① 6 形态校准可执行；② 产物与既有实现等价（golden 锁定）；③ 删/禁用规则即红（不校准 → 缺陷形态）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, transformTemplateToWxml, getTransformRule, executeRule, listTransformRules } from '@proteus-vue/compiler'
import type { RuleContext } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 校准族①：event/inline-expression 已迁执行层（第四条 apply 规则）', () => {
  it('规则带 apply，可执行规则数 ≥ 4', () => {
    const rule = getTransformRule('event/inline-expression')
    expect(typeof rule?.apply).toBe('function')
    const executable = listTransformRules().filter((r) => typeof r.apply === 'function').map((r) => r.id)
    expect(executable).toContain('event/inline-expression')
    expect(executable.length).toBeGreaterThanOrEqual(4)
  })

  it('apply 六形态校准：自增/自减/方法调用/赋值型/取反/store 方法', () => {
    const cases: Array<[string, string, string]> = [
      ['count++', 'proteusInlineIncCount', 'this.data.count + 1'],
      ['count--', 'proteusInlineDecCount', 'this.data.count - 1'],
      ['fn(1)', 'proteusInlineFn1', 'this.fn(1)'],
      ['showModal = false', 'proteusInlineSetShowModalFalse', 'this.data.showModal = false; this.setData({ showModal: this.data.showModal })'],
      ['showModal = !showModal', 'proteusInlineSetShowModalShowModal', 'this.data.showModal = !this.data.showModal'],
      ['store.toggle()', 'proteusStoreToggleNoArgs', 'this.store.toggle()'],
    ]
    for (const [exp, name, codePart] of cases) {
      const ctx: RuleContext = { input: { exp } }
      executeRule('event/inline-expression', ctx)
      const out = ctx.output as { name: string; code: string } | null
      expect(out?.name).toBe(name)
      expect(out?.code).toContain(codePart)
    }
  })

  it('不可校准形态 → null（调用方走 cleanHandler 警告原样）', () => {
    for (const exp of ['onCloseTab(t.id)', 'item = otherItem', 'a + b']) {
      const ctx: RuleContext = { input: { exp } }
      executeRule('event/inline-expression', ctx)
      expect(ctx.output).toBeNull()
    }
  })
})

describe('★#505 校准族②：产物等价（demo 页 @click="showModal = false" → proteusInlineSet 方法）', () => {
  it('赋值型内联事件产物形态（fluid-system-demo 取消/确定按钮同款）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst showModal = ref(false)</script>\n<template><button @click="showModal = false">取消</button></template>',
      { filename: 'pages/inline.vue', ...opts },
    )
    expect(r.wxml).toContain('bindtap="proteusInlineSetShowModalFalse"')
    expect(r.wxml).not.toContain('showModal = false')
    expect(r.js).toContain('proteusInlineSetShowModalFalse(e) {')
    expect(r.js).toContain('this.data.showModal = false; this.setData({ showModal: this.data.showModal })')
  })

  it('自增/方法调用/取反形态产物', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">const count = ref(0)\nfunction log(n: number) {}</script>\n<template><view><button @click="count++">+</button><button @click="log(count)">l</button><button @click="show = !show">s</button></view></template>',
      { filename: 'pages/inline2.vue', ...opts },
    )
    expect(r.wxml).toContain('bindtap="proteusInlineIncCount"')
    expect(r.wxml).toContain('bindtap="proteusInlineLogcount"')
    expect(r.js).toContain('proteusInlineIncCount(e) {')
  })

  it('golden 快照级等价锚点：既有 mp-transform 断言形态不变（迁移无行为漂移）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<button @click="showModal = false">x</button>', opts)
    expect(wxml).toContain('bindtap="proteusInlineSetShowModalFalse"')
    expect(warnings).toEqual([])
  })
})

describe('★#505 校准族③：删/禁用规则即红（自动校准依赖规则存在——缺了会死）', () => {
  it('禁用 event/inline-expression → 不包装 → bindtap 原样表达式（#500 缺陷形态）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst showModal = ref(false)</script>\n<template><button @click="showModal = false">取消</button></template>'
    const enabled = compileVueSfc(src, { filename: 'pages/inline3.vue', ...opts })
    const disabled = compileVueSfc(src, { filename: 'pages/inline3.vue', ...opts, rules: { disabled: ['event/inline-expression'] } })
    expect(enabled.wxml).toContain('bindtap="proteusInlineSetShowModalFalse"')
    expect(disabled.wxml).toContain('bindtap="showModal = false"')
    expect(disabled.wxml).not.toContain('proteusInlineSetShowModalFalse')
    expect(disabled.js).not.toContain('proteusInlineSetShowModalFalse')
  })
})

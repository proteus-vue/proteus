// tests/compiler-ir-self-once.test.ts
// ★#505 校准族第三批：event/modifier-self-once 迁执行层（第六条真实 apply 规则）。
//   .self/.once 修饰符是 Vue 语义（目标限制 / 单次触发），小程序无对等——编译器包装为方法。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, getTransformRule, executeRule, listTransformRules } from '@proteus-vue/compiler'
import type { RuleContext } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 self/once 校准族①：规则已迁执行层（第六条 apply）', () => {
  it('规则带 apply，可执行规则数 ≥ 6', () => {
    const rule = getTransformRule('event/modifier-self-once')
    expect(typeof rule?.apply).toBe('function')
    const executable = listTransformRules().filter((r) => typeof r.apply === 'function').map((r) => r.id)
    expect(executable).toContain('event/modifier-self-once')
    expect(executable.length).toBeGreaterThanOrEqual(6)
  })

  it('apply：简单方法名 + self → proteusSelf 包装；once → proteusOnce 包装', () => {
    const s: RuleContext = { input: { handler: 'handleTap', isSelf: true, isOnce: false } }
    executeRule('event/modifier-self-once', s)
    expect(s.output).toEqual({ kind: 'self', target: 'handleTap', wrap: 'proteusSelfHandleTap' })

    const o: RuleContext = { input: { handler: 'handleTap', isSelf: false, isOnce: true } }
    executeRule('event/modifier-self-once', o)
    expect(o.output).toEqual({ kind: 'once', target: 'handleTap', wrap: 'proteusOnceHandleTap' })
  })

  it('apply：复杂表达式/无修饰符 → null（原样输出）', () => {
    for (const input of [
      { handler: 'onCloseTab(t.id)', isSelf: true, isOnce: false },
      { handler: 'count > 0 ? go() : back()', isSelf: true, isOnce: false },
      { handler: 'handleTap', isSelf: false, isOnce: false },
    ]) {
      const ctx: RuleContext = { input }
      executeRule('event/modifier-self-once', ctx)
      expect(ctx.output).toBeNull()
    }
  })
})

describe('★#505 self/once 校准族②：产物等价 + 端到端', () => {
  it('@click.self / @click.once 简单方法名 → proteusSelf/Once 包装方法（产物形态不变）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">function onSelf() {}\nfunction onOnce() {}</script>\n<template><view><button @click.self="onSelf">s</button><button @click.once="onOnce">o</button></view></template>',
      { filename: 'pages/so.vue', ...opts },
    )
    expect(r.wxml).toContain('bindtap="proteusSelfOnSelf"')
    expect(r.wxml).toContain('bindtap="proteusOnceOnOnce"')
    // script 侧生成包装方法（self 事件源判断 / once data 标记）
    expect(r.js).toContain('proteusSelfOnSelf(e) {')
    expect(r.js).toContain('if (e.target === e.currentTarget)')
    expect(r.js).toContain('this.onSelf(e)')
    expect(r.js).toContain('proteusOnceOnOnce(e) {')
  })

  it('.self + 内联赋值不互斥：self 优先（不包装 inline，按 self 路径）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n<template><button @click.self="show = false">x</button></template>',
      { filename: 'pages/so2.vue', ...opts },
    )
    // .self 下赋值表达式不是简单方法名 → cleanHandler 警告原样（self 包装不适用）
    expect(r.wxml).not.toContain('proteusInlineSet')
    expect(r.wxml).toContain('bindtap="show = false"')
  })
})

describe('★#505 self/once 校准族③：删/禁用规则即红', () => {
  it('禁用 event/modifier-self-once → 不包装 → 直接绑定原方法名 + 语义丢失警告', () => {
    const src = '<script setup lang="ts">function onSelf() {}</script>\n<template><button @click.self="onSelf">s</button></template>'
    const enabled = compileVueSfc(src, { filename: 'pages/so3.vue', ...opts })
    const disabled = compileVueSfc(src, { filename: 'pages/so3.vue', ...opts, rules: { disabled: ['event/modifier-self-once'] } })
    expect(enabled.wxml).toContain('bindtap="proteusSelfOnSelf"')
    expect(disabled.wxml).not.toContain('proteusSelfOnSelf')
    expect(disabled.wxml).toContain('bindtap="onSelf"')
    expect(disabled.warnings.join('\n')).toContain('event/modifier-self-once 已被禁用')
    expect(disabled.js).not.toContain('proteusSelfOnSelf')
  })
})

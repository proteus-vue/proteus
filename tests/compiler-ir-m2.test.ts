// tests/compiler-ir-m2.test.ts
// ★#505 M2 试点：directive/v-bind-style 从描述层迁执行层 + :style 派生对象序列化挂 IR
// 草案 docs/compiler-ir-contract-draft.md §5/§6 M2
// 验收：① 产物与既有实现逐字节等价（行为零变化）；② CompileIR 快照含 style 绑定声明
//       （valueKind: string-only）；③ 删规则/禁用规则 → 派生序列化消失（删规则即红反向验证）；
//       ④ 规则 apply 从描述层真正进入执行路径（registry 第三条 apply）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, listTransformRules, getTransformRule, executeRule } from '@proteus-vue/compiler'
import type { RuleContext } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 M2 试点①：规则已从描述层迁执行层', () => {
  it('directive/v-bind-style 已登记 apply（registry 可执行规则数 > 2）', () => {
    const rule = getTransformRule('directive/v-bind-style')
    expect(rule).toBeDefined()
    expect(typeof rule?.apply).toBe('function')
    const executable = listTransformRules().filter((r) => typeof r.apply === 'function')
    expect(executable.length).toBeGreaterThanOrEqual(3) // px-to-rpx + scope-attr + v-bind-style
    expect(executable.map((r) => r.id)).toContain('directive/v-bind-style')
  })

  it('apply 语义：裸标识符 → derived + target；字面量对象 → 非 derived', () => {
    const ctx1: RuleContext = { input: { exp: 'boxStyle' } }
    executeRule('directive/v-bind-style', ctx1)
    expect(ctx1.output).toEqual({ target: 'boxStyle', derived: true })

    const ctx2: RuleContext = { input: { exp: '{ color: c }' } }
    executeRule('directive/v-bind-style', ctx2)
    expect((ctx2.output as { derived?: boolean }).derived).toBe(false)
  })
})

describe('★#505 M2 试点②：compileVueSfc 端到端产物等价 + IR 快照含 valueKind', () => {
  it(':style="boxStyle"（computed 派生对象）→ wxml/js 产物形态不变 + IR.styleBindings 带 valueKind', () => {
    const src = '<script setup lang="ts">import { ref, computed } from "vue"\nconst color = ref("#fff")\nconst boxStyle = computed(() => ({ color: color.value }))</script>\n'
      + '<template><view :style="boxStyle">x</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m2style.vue', ...opts })
    // 产物等价锚点（#500 既有形态——自动序列化 helper + 包裹 + 模板绑定）
    expect(r.js).toContain('function __proteusStyleString(o) {')
    expect(r.js).toContain('boxStyle: __proteusStyleString(')
    expect(r.wxml).toContain('style="{{boxStyle}}"')
    // IR 快照：styleBindings 升级为声明对象（valueKind = string-only 平台约束）
    expect(r.ir?.template.styleBindings).toEqual([{ target: 'boxStyle', valueKind: 'string-only' }])
  })

  it('字面量对象 :style（编译期拼接）不进 styleBindings 声明（无需序列化）', () => {
    const src = '<script setup lang="ts">const bg = ref("#000")</script>\n<template><view :style="{ backgroundColor: bg }">x</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m2lit.vue', ...opts })
    expect(r.wxml).toContain('style="background-color:{{bg}}"')
    expect(r.ir?.template.styleBindings).toEqual([])
    expect(r.js).not.toContain('__proteusStyleString')
  })
})

describe('★#505 M2 试点③：删规则即红（反向验证——规则在 IR 上、缺了会死）', () => {
  it('禁用 directive/v-bind-style → 派生绑定不再收集 → script 不注入序列化（与启用产物不同）', () => {
    const src = '<script setup lang="ts">import { ref, computed } from "vue"\nconst color = ref("#fff")\nconst boxStyle = computed(() => ({ color: color.value }))</script>\n'
      + '<template><view :style="boxStyle">x</view></template>'
    const enabled = compileVueSfc(src, { filename: 'pages/m2off.vue', ...opts })
    const disabled = compileVueSfc(src, { filename: 'pages/m2off.vue', ...opts, rules: { disabled: ['directive/v-bind-style'] } })
    // 启用：序列化注入存在；禁用：不存在（删规则即红——产物语义退化为旧缺陷形态）
    expect(enabled.js).toContain('__proteusStyleString')
    expect(disabled.js).not.toContain('__proteusStyleString')
    expect(disabled.ir?.template.styleBindings).toEqual([])
    // 反向验证门禁锚点：该用例锁定「序列化必须有」——若未来有人误删 apply 导致不收集，此处红
    expect(enabled.js).toContain('boxStyle: __proteusStyleString(')
    expect(enabled.ir?.template.styleBindings).toEqual([{ target: 'boxStyle', valueKind: 'string-only' }])
  })

  it('对未登记 apply 的规则 executeRule 抛错（规则从描述层迁执行层的护栏）', () => {
    expect(() => executeRule('tag/div-to-view', { input: {} })).toThrowError(/未登记 apply/)
  })
})

describe('★#505 M2 试点④：产物逐字节等价（golden 与既有形态不受 apply 化影响）', () => {
  it(':style 对象语法 + 语义标签基础类共存页：产物关键锚点不变', () => {
    const src = '<script setup lang="ts">const w = ref(100)</script>\n<template><p class="card" :style="{ width: w + \'px\' }">hi</p></template>'
    const r = compileVueSfc(src, { filename: 'pages/m2mix.vue', ...opts })
    expect(r.wxml).toContain('class="proteus-p card"')
    expect(r.wxml).toContain('style="width:{{w + \'px\'}}"')
    expect(r.ir).toBeDefined()
  })
})

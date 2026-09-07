// tests/compiler-ir-vmodel.test.ts
// ★#505 校准族第二批：directive/v-model 形态判定与契约命名迁执行层（第五条真实 apply 规则）。
//   Vue 组件 v-model 双向绑定是核心语义（prop + update:arg 事件契约），形态判定（组件 vs input）
//   与命名约定收口到规则 apply——删/禁用规则即回到 #500 旧缺陷（无脑 bindinput）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, transformTemplateToWxml, getTransformRule, executeRule, listTransformRules } from '@proteus-vue/compiler'
import type { RuleContext } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 v-model 校准族①：规则已迁执行层（第五条 apply）', () => {
  it('directive/v-model 带 apply，可执行规则数 ≥ 5', () => {
    const rule = getTransformRule('directive/v-model')
    expect(typeof rule?.apply).toBe('function')
    const executable = listTransformRules().filter((r) => typeof r.apply === 'function').map((r) => r.id)
    expect(executable).toContain('directive/v-model')
    expect(executable.length).toBeGreaterThanOrEqual(5)
  })

  it('apply 契约：组件形态（非 input-like 非原生标签）→ prop + update:arg handler（★名含 model——多组件 v-model 防撞名）', () => {
    const ctx: RuleContext = { input: { model: 'show', arg: 'visible', isInputLike: false, isNativeTag: false } }
    executeRule('directive/v-model', ctx)
    expect(ctx.output).toEqual({ kind: 'component', model: 'show', propName: 'visible', updateHandler: 'proteusUpdateShowModel' })
  })

  it('apply 契约：组件无 arg → 默认 modelValue（handler 名含 model——同页多组件 modelValue 不撞名）', () => {
    const ctx: RuleContext = { input: { model: 'val', arg: '', isInputLike: false, isNativeTag: false } }
    executeRule('directive/v-model', ctx)
    expect(ctx.output).toEqual({ kind: 'component', model: 'val', propName: 'modelValue', updateHandler: 'proteusUpdateValModel' })
  })

  it('apply 契约：input-like / 原生标签 → value + bindinput 形态', () => {
    for (const isNativeTag of [true, false]) {
      const ctx: RuleContext = { input: { model: 'name', arg: '', isInputLike: true, isNativeTag } }
      executeRule('directive/v-model', ctx)
      expect(ctx.output).toEqual({ kind: 'input', model: 'name', inputHandler: 'proteusOnNameInput' })
    }
    const nativeCtx: RuleContext = { input: { model: 'n', arg: '', isInputLike: false, isNativeTag: true } }
    executeRule('directive/v-model', nativeCtx)
    expect((nativeCtx.output as { kind: string }).kind).toBe('input')
  })
})

describe('★#505 v-model 校准族②：产物等价 + 端到端契约', () => {
  it('自定义组件 v-model:visible → prop + bind:update-visible（p-modal 场景）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n<template><p-modal v-model:visible="show">x</p-modal></template>',
      { filename: 'pages/vm1.vue', ...opts },
    )
    expect(r.wxml).toContain('visible="{{show}}"')
    expect(r.wxml).toContain('bind:update-visible="proteusUpdateShowModel"')
    expect(r.wxml).not.toContain('bindinput')
    expect(r.js).toContain('proteusUpdateShowModel(e) { this.setData({ show: e.detail }) }')
  })

  it('input v-model → value + bindinput（旧路径保留）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst name = ref("")</script>\n<template><input v-model="name" /></template>',
      { filename: 'pages/vm2.vue', ...opts },
    )
    expect(r.wxml).toContain('value="{{name}}"')
    expect(r.wxml).toContain('bindinput="proteusOnNameInput"')
    expect(r.js).toContain('proteusOnNameInput(e) { this.setData({ name: e.detail.value }) }')
  })

  it('组件形态同样收集 vModelBindings（vModelTargets 声明含目标字段）', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n<template><p-modal v-model:visible="show" /></template>',
      { filename: 'pages/vm3.vue', ...opts },
    )
    expect(r.ir?.template.vModelTargets).toEqual(['show'])
    expect(r.ir?.template.vModelComponentHandlers).toEqual([{ name: 'proteusUpdateShowModel', model: 'show', arg: 'visible', propName: 'visible' }])
  })
  it('组件侧 emit update 归一：emit(\'update:visible\') → triggerEvent(\'update-visible\')（组件自身产物单段，与父 bind:update-visible 同口径）；非 update 事件名不动', () => {
    const src = '<script setup lang="ts">\n'
      + 'const props = defineProps({ visible: { type: Boolean, default: false } })\n'
      + 'const emit = defineEmits([\'update:visible\', \'formChange\'])\n'
      + 'function onMaskTap(): void { emit(\'update:visible\', false) }\n'
      + 'function onFormChange(): void { emit(\'formChange\', \'a\') }\n'
      + '</script>\n<template><view class="x" @tap="onMaskTap">m</view><view @tap="onFormChange">f</view></template>'
    const r = compileVueSfc(src, { filename: 'components/p-vmtest/index.vue', isComponent: true, ...opts })
    expect(r.js).toContain("this.triggerEvent('update-visible', false)")
    expect(r.js).not.toContain("triggerEvent('update:visible'")
    // 非 v-model 契约事件名原样（formChange 无冒号不动）
    expect(r.js).toContain("this.triggerEvent('formChange', 'a')")
  })
})

describe('★#505 v-model 校准族③：删/禁用规则即红', () => {
  it('禁用 directive/v-model → 组件 v-model 不输出 prop/事件（回到无绑定形态）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n<template><p-modal v-model:visible="show">x</p-modal></template>'
    const enabled = compileVueSfc(src, { filename: 'pages/vm4.vue', ...opts })
    const disabled = compileVueSfc(src, { filename: 'pages/vm4.vue', ...opts, rules: { disabled: ['directive/v-model'] } })
    expect(enabled.wxml).toContain('bind:update-visible')
    expect(disabled.wxml).not.toContain('bind:update-visible')
    expect(disabled.wxml).not.toContain('visible="{{show}}"')
    expect(disabled.warnings.join('\n')).toContain('directive/v-model 已被禁用')
  })
})

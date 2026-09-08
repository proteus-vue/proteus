// tests/sfc-macros.test.ts
// ★★2026-09-08 关键架构定调：宏语义不由框架自造——用 @vue/compiler-sfc 的 compileScript 提取权威语义元数据
//   （bindings 分类 + defineModel→useModel 引用），落地 IR 再适配。锁定「吃官方展开、非手写正则抠宏」。
import { describe, it, expect } from 'vitest'
import { extractSfcMacros, renameModelVarsInWxml } from '../packages/compiler/src/sfc-macros'

const src = `<script setup lang="ts">
import { ref, defineModel } from 'vue'
const count = ref(0)
const m = defineModel<string>()
const title = defineModel<string>('title')
function bump() { count.value++ }
</script>
<template><view>{{ m }}{{ title }}</view></template>`

describe('宏语义权威源：extractSfcMacros（compileScript 展开，非手写）', () => {
  it('compileScript 成功提取 bindings（Vue 官方语义分类）', () => {
    const r = extractSfcMacros(src, 'x.vue')
    expect(r.ok).toBe(true)
    // 权威分类：modelValue 是 prop（defineModel 默认名），count/m/title 是 setup-ref，bump 是 setup-const
    expect(r.bindings.modelValue).toBe('props')
    expect(r.bindings.count).toBe('setup-ref')
    expect(r.bindings.m).toBe('setup-ref')
    expect(r.bindings.bump).toBe('setup-const')
  })

  it('defineModel → modelRefs（varName→propName；缺省 modelValue / 显式 arg title）', () => {
    const r = extractSfcMacros(src, 'x.vue')
    expect(r.modelRefs).toContainEqual({ varName: 'm', propName: 'modelValue' })
    expect(r.modelRefs).toContainEqual({ varName: 'title', propName: 'title' })
    expect(r.propNames.has('modelValue')).toBe(true)
  })

  it('无 <script setup> / 编译失败 → 回退空（ok=false，不抛）', () => {
    const r = extractSfcMacros('<template><view>x</view></template>', 'y.vue')
    expect(r.ok).toBe(false)
    expect(r.modelRefs).toEqual([])
  })

  it('renameModelVarsInWxml：仅 {{ }} 内模型 var→prop（类名/属性不动）', () => {
    const wxml = `<view>hi {{ m }} {{ count }}</view><view class="m-tip">{{ m }}x</view>`
    const out = renameModelVarsInWxml(wxml, [{ varName: 'm', propName: 'modelValue' }])
    expect(out).toContain('{{ modelValue }}')
    expect(out).not.toContain('{{ m }}')
    expect(out).toContain('class="m-tip"') // 类名不动
    expect(out).toContain('{{ count }}') // 非 model var 不动
  })
})

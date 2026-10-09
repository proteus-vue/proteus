// @vitest-environment happy-dom
// tests/playground-live-mount.test.ts —— ★决策 #699：Playground 实时预览的编译管线
//
// 【锁什么】`website/src/playground/live-mount.ts` 的 `compileSfc`——把标准 Vue SFC 编成可挂载组件。
//   曾经的真 bug（本会话修复）："残留 import" 检查跑在 vue 导入重写**之前** ⇒ 连 `vue` 自身的
//   import 都被误判为"不支持"。本组锁：① vue 导入被正确重写（不误报）② 非 vue 导入必须**明确报错**
//   （诚实边界，不静默）③ 缺 template 报错。
import { describe, it, expect } from 'vitest'
import { compileSfc } from '../website/src/playground/live-mount'

describe('★#699 Playground 实时预览：SFC → 组件', () => {
  it('标准 SFC（ref from vue + template + scoped style）⇒ 编出组件 + CSS', () => {
    const src = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>
<template><p-view><p-text>hi {{ count }}</p-text></p-view></template>
<style scoped>.demo { color: red; }</style>`
    const r = compileSfc(src)
    expect(r.component, '产出组件').toBeTruthy()
    expect(typeof r.css).toBe('string')
    expect(r.css).toContain('.demo')  // scoped 样式被编译
  })

  it('vue 导入不被误判（回归：曾把 vue 自身 import 当"不支持"）', () => {
    const src = `<script setup>
import { ref, computed } from 'vue'
const a = ref(1)
const b = computed(() => a.value + 1)
</script>
<template><p-text>{{ b }}</p-text></template>`
    expect(() => compileSfc(src)).not.toThrow()
  })

  it('非 vue 导入 ⇒ 明确报错（诚实边界，不静默）', () => {
    const src = `<script setup>
import { debounce } from 'lodash'
</script><template><p-text>x</p-text></template>`
    expect(() => compileSfc(src)).toThrow(/仅支持从 `vue` 导入/)
  })

  it('缺 <template> ⇒ 报错', () => {
    expect(() => compileSfc('<script setup>const a = 1</script>')).toThrow(/template/)
  })
})

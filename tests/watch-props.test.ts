// tests/watch-props.test.ts
// ★组件库 B3 编译器增强：watch props 源（watch(props.x) / watch(() => props.x)）→ WeChat observers
// 组件监听自身属性变化（列表 items 分页、弹层 visible v-model 等）；Web 端即标准 Vue watch（全响应式）
import { describe, it, expect } from 'vitest'
import { transformScriptToPage, compileVueSfc } from '../packages/compiler/src'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('watch props 源 → WeChat observers（script/watch-props）', () => {
  it('watch(() => props.x, () => { body }) → observers: { x(n, o) { body } }（非 immediate 不生成方法）', () => {
    const src = `const props = defineProps({ items: { type: Array as any } })\nfunction calc() {\n  log(props.items.length)\n}\nwatch(() => props.items, () => { calc() })`
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('observers: {')
    expect(js).toContain('items(n, o) {')
    expect(js).toContain('calc()')
    // 非 immediate：不生成 proteusWatchPropItems 方法 / attached 初始化调用
    expect(js).not.toContain('proteusWatchPropItems')
  })

  it('watch(props.x, cb, { immediate: true }) → observers + proteusWatchPropX 方法 + attached 初始化调用', () => {
    const src = `const props = defineProps({ items: { type: Array as any } })\nwatch(props.items, (n) => { log(n) }, { immediate: true })`
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('observers: {')
    expect(js).toContain('items(n, o) {')
    expect(js).toContain('proteusWatchPropItems(n) {')
    expect(js).toContain('this.proteusWatchPropItems(this.data.items, undefined)')
  })

  it('回调体 props 访问改写为 this.data（与普通方法一致）', () => {
    const src = `const props = defineProps({ items: { type: Array as any } })\nwatch(() => props.items, () => { log(props.items.length) })`
    const { js } = transformScriptToPage(src, opts, { isComponent: true })
    expect(js).toContain('log(this.data.items.length)')
  })

  it('组件整包编译：defineProps + props 源 watch → Component 含 observers（compileVueSfc）', () => {
    const result = compileVueSfc(
      '<script setup lang="ts">const props = defineProps({ items: { type: Array as any } })\nconst c = ref(0)\nfunction calc() {\n  c.value = props.items.length\n}\nwatch(() => props.items, () => { calc() })\n</script>\n<template><view>{{ c }}</view></template>',
      { isComponent: true, filename: 'components/x/index.vue' },
    )
    expect(result.js).toContain('Component({')
    expect(result.js).toContain('observers: {')
    expect(result.js).toContain('items(n, o) {')
  })

  it('页面模式不生成 observers（仅组件）', () => {
    const src = `const props = defineProps({ items: { type: Array as any } })\nwatch(() => props.items, () => { log(1) })`
    const { js } = transformScriptToPage(src, opts, { isComponent: false })
    expect(js).not.toContain('observers: {')
  })
})

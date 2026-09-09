// tests/plain-const-bare-ref.test.ts
// ★2026-09-09 const 裸引用缺口修复（p-popover TRIGGER_SELECTOR is not defined 真机根因，#506 会话登记待办）：
//   顶层 `const X = 字面量` 内联进 data 后，方法体/表达式内裸引用 X 无改写通道 → 产物词法查找 ReferenceError，
//   且常被事件 catch 吞掉无感知（此前三轮 selector 修复「无效」全被它掩盖）。
//   修复：plain data 裸引用 → this.data.X（rewritePlainDataSafe 字符级安全扫描 + 遮蔽守卫）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

function compile(script: string, template: string, isComponent = true) {
  return compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`, { filename: 'pages/x.vue', isComponent }) as any
}

describe('plain const 裸引用 → this.data.X（真机 ReferenceError 根因修复）', () => {
  it('方法体裸引用字面量 const → this.data.X（p-popover TRIGGER_SELECTOR 形态）', () => {
    const r = compile("const TRIGGER_SELECTOR = '.p-popover-trigger'\nfunction bind() { const el = this.querySelector(TRIGGER_SELECTOR) }", '<view />')
    expect(r.js).toMatch(/querySelector\(this\.data\.TRIGGER_SELECTOR\)/)
    expect(r.js).not.toMatch(/querySelector\(TRIGGER_SELECTOR\)/)
  })
  it('模板串插值内裸引用 → this.data.X（整体跳过会漏）', () => {
    const r = compile("const BASE = 'nav'\nfunction go() { this.setData({ path: `/${BASE}/home` }) }", '<view />')
    expect(r.js).toMatch(/`\/\$\{this\.data\.BASE\}\/home`/)
  })
  it('对象字面量 key 位不改写；简写 key 转完整形式', () => {
    const r = compile("const SIZE = 10\nfunction conf() { return { SIZE: 1, label: 'x', SIZE2: SIZE } }", '<view />')
    // 完整 key `{ SIZE: 1 }` 保持（不产出非法 { this.data.SIZE: 1 }）；引用位 SIZE2: SIZE 改 this.data.SIZE
    expect(r.js).toMatch(/\{\s*SIZE: 1/)
    expect(r.js).toMatch(/SIZE2: this\.data\.SIZE/)
  })
  it('属性访问与字符串内容不改写', () => {
    const r = compile("const MODE = 'side'\nfunction f() { obj.MODE = 'x'; this.log('MODE=' + obj.MODE) }", '<view />')
    expect(r.js).toMatch(/obj\.MODE = 'x'/)
    expect(r.js).toMatch(/'MODE='/)
    expect(r.js).not.toMatch(/this\.data\.MODE/)
  })
  it('局部同名声明遮蔽 → 该方法体保守不改写', () => {
    const r = compile("const LIMIT = 10\nfunction f() { const LIMIT = 5; return LIMIT + 1 }", '<view />')
    expect(r.js).toMatch(/const LIMIT = 5; return LIMIT \+ 1/)
  })
  it('单参箭头参数遮蔽 → 保守不改写', () => {
    const r = compile("const SIZE = 10\nfunction f() { return [1, 2].map(SIZE => SIZE + 1) }", '<view />')
    expect(r.js).toMatch(/SIZE => SIZE \+ 1/)
  })
  it('computed 表达式内裸引用 → this.data.X（含 ref 写入派生补丁通道）', () => {
    const r = compile("const RATE = 2\nconst total = computed(() => count.value * RATE)\nfunction add() { count.value++ }", '<view>{{ total }}</view>', false)
    expect(r.js).toMatch(/this\.data\.count \* this\.data\.RATE/)
    // 自增 setData 内派生补丁同样改写
    expect(r.js).toMatch(/total: this\.data\.count \* this\.data\.RATE/)
  })
  it('watch 函数源 getter 内裸引用 → this.data.X', () => {
    // immediate watch：getter 经 immediateWatchLine 物化进 onLoad（非 immediate 的 getter 走 writeSetData tail）
    const r = compile("const TH = 5\nconst count = ref(0)\nwatch(() => count.value > TH, (v) => {}, { immediate: true })", '<view />', false)
    expect(r.js).toMatch(/this\.data\.count > this\.data\.TH/)
  })
  it('顶层副作用调用内裸引用 → this.data.X（onLoad 注入段）', () => {
    const r = compile("const THEME = 'dark'\ninitTheme(THEME)\nfunction initTheme(t: string) { void t }", '<view />', false)
    expect(r.js).toMatch(/initTheme\(this\.data\.THEME\)/)
  })
  it('函数调用参数位逗号后标识符 → 值引用改写（旧 depth 计数误判 key 位语法错，render-backend-demo 实证）', () => {
    const r = compile("const ir = 'x'\nfunction render() { const snap = renderComponentSnapshot(vue, ir, createControlReader('vue-dom')) }", '<view />')
    expect(r.js).toMatch(/renderComponentSnapshot\(vue, this\.data\.ir, createControlReader\('vue-dom'\)\)/)
  })
  it('块内调用参数位 / 数组元素位 → 值引用改写（非对象字面量不判 key）', () => {
    const r = compile("const MODE = 'a'\nfunction f() { if (1) { use(MODE) } ; const arr = [MODE, 2] }", '<view />')
    expect(r.js).toMatch(/use\(this\.data\.MODE\)/)
    expect(r.js).toMatch(/\[this\.data\.MODE, 2\]/)
  })
  it('ref .value 改写不回归（refNames 通道独立）', () => {
    const r = compile("const BASE = 'x'\nconst count = ref(0)\nfunction inc() { count.value += 1 }", '<view />')
    expect(r.js).toMatch(/this\.data\.count/)
  })
})

// tests/svg-hit.test.ts
// ★2026-09-09 G-62 SVG 事件命中（真机实证落地）：SVG 图形 @click → 编译期收集几何 →
//   运行时 touchstart 坐标 → viewBox 换算 → 几何判定 → 调 handler。
// ★真机约束（实测，必须遵守）：Skyline tap 事件 detail/touches/changedTouches 全 undefined（无坐标）；
//   touchstart 的 touches[0] 带 pageX/pageY/clientX/clientY → 命中必须基于 touchstart。
// 真机验证：svg-hit-test 页红圆(30,30)/蓝圆(70,70)/绿方(60-90,10-40) 精确命中，空白区不命中。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

const compile = (script: string, template: string) =>
  compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n${template}`, { filename: 't.vue' }) as any

const SCRIPT = `import { ref } from 'vue'
const log = ref('')
function onRed() { log.value = 'red' }
function onBlue() { log.value = 'blue' }
function onGreen() { log.value = 'green' }`

describe('G-62 SVG 事件命中（touchstart + 几何判定）', () => {
  it('circle/rect 带 @click → image 加 id + bindtouchstart + 命中方法', () => {
    const r = compile(
      SCRIPT,
      '<template><view><svg viewBox="0 0 100 100" width="120" height="120">' +
        '<circle cx="30" cy="30" r="20" fill="#e74c3c" @click="onRed" />' +
        '<rect x="60" y="10" width="30" height="30" fill="#2ecc71" @click="onGreen" />' +
        '</svg></view></template>',
    )
    // 模板：id + touchstart 绑定（★不用 tap——真机无坐标）
    expect(r.wxml).toMatch(/<image[^>]*id="proteus-svg-hit-1"/)
    expect(r.wxml).toMatch(/bindtouchstart="proteusSvgHit1"/)
    expect(r.wxml).not.toMatch(/bind:tap="proteusSvgHit/)
    // 脚本：命中方法存在 + 取 touches[0]
    expect(r.js).toMatch(/proteusSvgHit1\(e\)/)
    expect(r.js).toMatch(/e\.touches && e\.touches\[0\]/)
    // 几何判定：circle 距离公式 + rect 包围盒
    expect(r.js).toMatch(/\(px - 30\) \* \(px - 30\) \+ \(py - 30\) \* \(py - 30\) <= 400/)
    expect(r.js).toMatch(/px >= 60 && px <= 90 && py >= 10 && py <= 40/)
    // handler 经 self 调用（boundingClientRect 回调内 this 不是组件实例——实测修正）
    expect(r.js).toMatch(/self\.onRed\(\)/)
    expect(r.js).toMatch(/self\.onGreen\(\)/)
  })

  it('坐标换算：boundingClientRect + viewBox 缩放（scale = viewBox / rect 尺寸）', () => {
    const r = compile(SCRIPT, '<template><svg viewBox="0 0 100 100" width="120" height="120"><circle cx="30" cy="30" r="20" @click="onRed" /></svg></template>')
    expect(r.js).toMatch(/var sx = 100 \/ rect\.width/)
    expect(r.js).toMatch(/var sy = 100 \/ rect\.height/)
    expect(r.js).toMatch(/var px = \(t\.pageX - rect\.left\) \* sx/)
    expect(r.js).toMatch(/var py = \(t\.pageY - rect\.top\) \* sy/)
  })

  it('ellipse / path 几何判定（path 用采样点包围盒——诚实近似）', () => {
    const r = compile(
      SCRIPT,
      '<template><svg viewBox="0 0 100 100">' +
        '<ellipse cx="50" cy="50" rx="30" ry="20" @click="onRed" />' +
        '<path d="M10 10 L90 10 L90 90 Z" @click="onBlue" />' +
        '</svg></template>',
    )
    // ellipse：归一化椭圆方程
    expect(r.js).toMatch(/\(\(px - 50\) \/ 30\) \* \(\(px - 50\) \/ 30\)/)
    // path：包围盒（10..90）
    expect(r.js).toMatch(/px >= 10 && px <= 90 && py >= 10 && py <= 90/)
  })

  it('多个图形按声明序判定（先命中先返回）', () => {
    const r = compile(
      SCRIPT,
      '<template><svg viewBox="0 0 100 100"><circle cx="30" cy="30" r="20" @click="onRed" /><circle cx="70" cy="70" r="20" @click="onBlue" /></svg></template>',
    )
    const body = r.js.match(/proteusSvgHit1\(e\) \{[\s\S]*?\n  \},/)?.[0] ?? ''
    const redIdx = body.indexOf('self.onRed()')
    const blueIdx = body.indexOf('self.onBlue()')
    expect(redIdx).toBeGreaterThan(-1)
    expect(blueIdx).toBeGreaterThan(redIdx) // 声明序：红在前
  })

  it('无事件的 SVG 不生成命中逻辑（零开销）', () => {
    const r = compile('', '<template><svg viewBox="0 0 100 100"><circle cx="30" cy="30" r="20" fill="#000" /></svg></template>')
    expect(r.wxml).not.toMatch(/proteus-svg-hit/)
    expect(r.wxml).not.toMatch(/bindtouchstart/)
    expect(r.js).not.toMatch(/proteusSvgHit/)
  })

  it('带 transform 的图形不参与命中（诚实降级——坐标换算复杂度高）', () => {
    const r = compile(SCRIPT, '<template><svg viewBox="0 0 100 100"><g transform="rotate(45)"><circle cx="30" cy="30" r="20" @click="onRed" /></g></svg></template>')
    // 仍 lowering 渲染，但不生成命中（transform 未换算）
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    expect(r.wxml).not.toMatch(/bindtouchstart/)
  })

  it('规则 template/svg-hit 可禁用（模板侧绑定与 script 侧方法同规则）', () => {
    const r = compileVueSfc(
      `<script setup lang="ts">\n${SCRIPT}\n</script>\n<template><svg viewBox="0 0 100 100"><circle cx="30" cy="30" r="20" @click="onRed" /></svg></template>`,
      { filename: 't.vue', rules: { disabled: ['template/svg-hit'] } },
    ) as any
    expect(r.wxml).not.toMatch(/bindtouchstart/)
    expect(r.js).not.toMatch(/proteusSvgHit/)
  })
})

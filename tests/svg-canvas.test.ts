// tests/svg-canvas.test.ts
// ★2026-09-09 G-62 Canvas 通道：含**形状变化动画**的 SVG → p-svg-canvas 组件（离屏 canvas 逐帧绘制）。
//   为什么：<image> 静态光栅化（内部动画不播放，§11.1 MD5 证明）+ CSS 只能做整体变换（§11.1c）。
//   实测（§12.2 探针）：离屏 canvas 可用（createPath2D 直接接受 SVG d / rAF 62fps / toDataURL 2ms），
//   可见 canvas 的 SelectorQuery.node() 拿不到（正常运行时同样 TIMEOUT）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'
import { sampleValues, evalAnim, primitiveToPathD } from '../src/components/p-svg-canvas/engine'

const compile = (template: string) => compileVueSfc(`<template>${template}</template>`, { filename: 't.vue' }) as any

describe('G-62 Canvas 通道：形状变化动画 → p-svg-canvas', () => {
  it('位置移动（cx）→ 组件 + 场景数据注入', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" width="150" height="150"><circle cx="20" cy="50" r="14" fill="#3498db">' +
        '<animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*scene="\{\{proteusSvgScene1\}\}"/)
    expect(r.wxml).toMatch(/width="150"/)
    expect(r.js).toMatch(/proteusSvgScene1:/)
    // 场景结构：viewBox + nodes + duration
    expect(r.js).toMatch(/"viewBox":\[0,0,100,100\]/)
    expect(r.js).toMatch(/"duration":2000/)
    expect(r.js).toMatch(/"attr":"cx"/)
  })

  it('描边进度（stroke-dashoffset）→ 组件', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#9b59b6" stroke-width="8" stroke-dasharray="220">' +
        '<animate attributeName="stroke-dashoffset" from="220" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).toMatch(/<p-svg-canvas/)
    expect(r.js).toMatch(/"attr":"stroke-dashoffset"/)
  })

  it('整体变换（rotate）不走 canvas（CSS 方案更优——零运行时）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><rect x="30" y="30" width="40" height="40" fill="#e74c3c">' +
        '<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s"/></rect></svg>',
    )
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
    expect(r.wxss).toMatch(/@keyframes proteus-svg-anim/)
  })

  it('无动画 SVG 不走 canvas（image 方案更优）', () => {
    const r = compile('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
  })

  it('规则 template/svg-canvas 可禁用', () => {
    const r = compileVueSfc(
      '<template><svg viewBox="0 0 100 100"><circle cx="20" cy="50" r="14"><animate attributeName="cx" values="20;80" dur="1s"/></circle></svg></template>',
      { filename: 't.vue', rules: { disabled: ['template/svg-canvas'] } },
    ) as any
    expect(r.wxml).not.toMatch(/<p-svg-canvas/)
  })
})

describe('Canvas 引擎核心（插值 / 几何）', () => {
  it('sampleValues 分段线性插值', () => {
    expect(sampleValues(['1', '0.5', '1'], 0)).toBe('1')
    expect(sampleValues(['1', '0.5', '1'], 0.5)).toBe('0.5')
    expect(sampleValues(['1', '0.5', '1'], 1)).toBe('1')
    expect(sampleValues(['20', '80'], 0.5)).toBe('50')
  })

  it('evalAnim 时间轴求值（循环 / 延迟）', () => {
    const anim = { attr: 'cx', values: ['20', '80'], dur: 1000, delay: 0, repeat: true }
    expect(evalAnim(anim, 0)).toBe('20')
    expect(evalAnim(anim, 500)).toBe('50')
    expect(evalAnim(anim, 1000)).toBe('20') // 循环回起点
  })

  it('primitiveToPathD 基础图形转 path', () => {
    expect(primitiveToPathD({ tag: 'circle', attrs: { cx: 50, cy: 50, r: 20 } } as never, 0)).toContain('A20 20')
    expect(primitiveToPathD({ tag: 'rect', attrs: { x: 10, y: 10, width: 30, height: 20 } } as never, 0)).toBe('M10 10 H40 V30 H10 Z')
    expect(primitiveToPathD({ tag: 'line', attrs: { x1: 0, y1: 0, x2: 10, y2: 10 } } as never, 0)).toBe('M0 0 L10 10')
  })
})

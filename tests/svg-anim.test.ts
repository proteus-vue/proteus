// tests/svg-anim.test.ts
// ★2026-09-09 G-62 SVG 动画转译（真机实证落地）：SVG 内部动画不播放（image 静态光栅化，§11.1 实证），
//   但**整体变换类动画可映射为 CSS 动画作用于 <image>**（真机三帧 MD5 各异——完全有效）。
//   编译器自动转译：<animateTransform rotate/scale/translate> + <animate opacity> → CSS @keyframes + 类名。
// 边界：形状属性动画（cx/d/stroke-dashoffset 等）无法用 CSS 表达 → 不转译（保留在 SVG 内，不播放）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'
import { drawScene } from '../src/components/p-svg-canvas/engine'

const compile = (template: string) => compileVueSfc(`<template>${template}</template>`, { filename: 't.vue' }) as any

describe('G-62 SVG 动画转译（整体变换 → CSS @keyframes）', () => {
  it('animateTransform rotate → CSS rotate 动画 + 类名绑定 image', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" width="80" height="80"><g><rect x="30" y="30" width="40" height="40" fill="#e74c3c"/>' +
        '<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s" repeatCount="indefinite"/></g></svg>',
    )
    expect(r.wxml).toMatch(/<image[^>]*class="[^"]*proteus-svg-anim-1/)
    expect(r.wxss).toMatch(/\.proteus-svg-anim-1\s*\{[^}]*animation:[^}]*2s linear infinite/)
    expect(r.wxss).toMatch(/@keyframes proteus-svg-anim-1-kf\s*\{\s*from \{ transform: rotate\(0deg\); \} to \{ transform: rotate\(360deg\); \}/)
    // animateTransform 元素不参与静态渲染（不留在 data-URI 里）
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    expect(Buffer.from(b64, 'base64').toString('utf8')).not.toContain('animateTransform')
  })

  it('animate opacity → CSS opacity 动画', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><g><circle cx="50" cy="50" r="30" fill="#000"/>' +
        '<animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/></g></svg>',
    )
    expect(r.wxss).toMatch(/@keyframes proteus-svg-anim-1-kf\s*\{\s*from \{ opacity: 1; \} to \{ opacity: 1; \}/)
  })

  it('animateTransform scale → CSS scale 动画（取 values 首末）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><g><circle cx="50" cy="50" r="30" fill="#000"/>' +
        '<animateTransform attributeName="transform" type="scale" values="1;0.75;1" dur="1.2s" repeatCount="indefinite"/></g></svg>',
    )
    expect(r.wxss).toMatch(/from \{ transform: scale\(1\); \} to \{ transform: scale\(1\); \}/)
  })

  it('多个 SVG 的动画类名递增不撞名', () => {
    const r = compile(
      '<view><svg viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/>' +
        '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite"/></svg>' +
        '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/>' +
        '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite"/></svg></view>',
    )
    expect(r.wxml).toMatch(/proteus-svg-anim-1/)
    expect(r.wxml).toMatch(/proteus-svg-anim-2/)
    expect(r.wxss).toMatch(/\.proteus-svg-anim-1\s*\{/)
    expect(r.wxss).toMatch(/\.proteus-svg-anim-2\s*\{/)
  })

  // ★2026-09-09 更新：形状属性动画（cx）现由 Canvas 通道接管（template/svg-canvas → p-svg-canvas）
  it('形状属性动画（cx）→ 走 Canvas 通道（非 CSS）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><circle cx="20" cy="50" r="14" fill="#3498db">' +
        '<animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    // 不生成 CSS 动画类（CSS 无法表达形状变化）
    expect(r.wxml).not.toMatch(/proteus-svg-anim/)
    expect(r.wxss).not.toMatch(/@keyframes proteus-svg-anim/)
    // → p-svg-canvas 组件（离屏 canvas 逐帧绘制）
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*scene="\{\{proteusSvgScene1\}\}"/)
    expect(r.js).toMatch(/proteusSvgScene1:/)
  })

  it('无动画的 SVG 不生成 CSS（零开销）', () => {
    const r = compile('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')
    expect(r.wxss).not.toMatch(/@keyframes proteus-svg-anim/)
    expect(r.wxml).not.toMatch(/proteus-svg-anim/)
  })
})

describe('★2026-09-10 嵌套变换动画 → Canvas 通道（骨骼运动学）', () => {
  it('深层子级 animateTransform（骨骼关节）→ 走 Canvas 而非 CSS（CSS 只能整图转）', () => {
    // 两层嵌套 <g>：外层静态 translate，内层关节 rotate —— 关节运动必须逐节点绘制
    const r = compile(
      '<svg viewBox="0 0 100 100"><g transform="translate(50,10)"><g>' +
        '<rect x="-4" y="0" width="8" height="30"/>' +
        '<animateTransform attributeName="transform" type="rotate" values="0;30;0" dur="2s" repeatCount="indefinite"/>' +
        '</g></g></svg>',
    )
    expect(r.wxml).toMatch(/<p-svg-canvas[^>]*scene="\{\{proteusSvgScene1\}\}"/)
    expect(r.wxss).not.toMatch(/@keyframes proteus-svg-anim/) // 不误走 CSS 整图通道
    expect(r.js).toMatch(/"transformType":"rotate"/)
    expect(r.js).toMatch(/"transform":\{"translate":\[50,10\]\}/) // 静态父级变换保留
  })

  it('根级 animateTransform 仍走 CSS 快路径（无运行时开销）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><g><rect x="30" y="30" width="40" height="40"/>' +
        '<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s" repeatCount="indefinite"/></g></svg>',
    )
    expect(r.wxss).toMatch(/@keyframes proteus-svg-anim-1-kf/)
    expect(r.wxml).not.toMatch(/p-svg-canvas/)
  })

  it('嵌套旋转沿链复合：子级绝对角度 = 父级 + 自身（骨骼运动学核心）', () => {
    // 仿真引擎：绘制命令里两个 rotate 依次应用（ctx.save/restore 嵌套 → 复合）
    const seq: string[] = []
    const ctx: any = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', lineDashOffset: 0,
      setLineDash() {}, save() {}, restore() {}, translate() {},
      rotate: (rad: number) => seq.push('R' + Math.round((rad * 180) / Math.PI)),
      scale() {}, setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      bezierCurveTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {}, closePath() {},
      fill() {}, stroke() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    }
    const canvas: any = { width: 100, height: 100, getContext: () => ctx }
    const scene: any = {
      viewBox: [0, 0, 100, 100], duration: 1000,
      nodes: [{
        tag: 'g', attrs: {}, anims: [{ attr: 'transform', transformType: 'rotate', values: ['0', '40', '0'], dur: 1000, delay: 0, repeat: true }],
        children: [{
          tag: 'g', attrs: {}, anims: [{ attr: 'transform', transformType: 'rotate', values: ['0', '-20', '0'], dur: 1000, delay: 0, repeat: true }],
          children: [{ tag: 'rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }],
        }],
      }],
    }
    drawScene(canvas, scene, 500) // 两个关节都在中途 → 父 +40、子 -20（子相对父）
    expect(seq).toContain('R40')
    expect(seq).toContain('R-20')
  })

  it('★交互控制：<svg> 上的 :playing/:speed/:fps 透传为 p-svg-canvas 属性绑定', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" :playing="playing && mode === \'walk\'" :speed="spd" :fps="rate">' +
        '<circle cx="50" cy="50" r="20"><animate attributeName="r" values="20;30;20" dur="1s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).toMatch(/playing="\{\{playing && mode === 'walk'\}\}"/)
    expect(r.wxml).toMatch(/speed="\{\{spd\}\}"/)
    expect(r.wxml).toMatch(/fps="\{\{rate\}\}"/)
  })

  it('交互控制白名单：非控制类绑定（:class/:style）不透传到组件', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100" :class="cls" :style="st">' +
        '<circle cx="50" cy="50" r="20"><animate attributeName="r" values="20;30;20" dur="1s" repeatCount="indefinite"/></circle></svg>',
    )
    expect(r.wxml).not.toMatch(/class="\{\{cls\}\}"/)
    expect(r.wxml).not.toMatch(/style="\{\{st\}\}"/)
  })
})

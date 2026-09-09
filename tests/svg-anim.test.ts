// tests/svg-anim.test.ts
// ★2026-09-09 G-62 SVG 动画转译（真机实证落地）：SVG 内部动画不播放（image 静态光栅化，§11.1 实证），
//   但**整体变换类动画可映射为 CSS 动画作用于 <image>**（真机三帧 MD5 各异——完全有效）。
//   编译器自动转译：<animateTransform rotate/scale/translate> + <animate opacity> → CSS @keyframes + 类名。
// 边界：形状属性动画（cx/d/stroke-dashoffset 等）无法用 CSS 表达 → 不转译（保留在 SVG 内，不播放）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

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

  it('形状属性动画（cx）不转译（CSS 无法表达——诚实边界）', () => {
    const r = compile(
      '<svg viewBox="0 0 100 100"><circle cx="20" cy="50" r="14" fill="#3498db">' +
        '<animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite"/></circle></svg>',
    )
    // 无 CSS 动画类
    expect(r.wxml).not.toMatch(/proteus-svg-anim/)
    expect(r.wxss).not.toMatch(/@keyframes proteus-svg-anim/)
    // 仍正常 lowering 为 image（静态首帧）
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
  })

  it('无动画的 SVG 不生成 CSS（零开销）', () => {
    const r = compile('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')
    expect(r.wxss).not.toMatch(/@keyframes proteus-svg-anim/)
    expect(r.wxml).not.toMatch(/proteus-svg-anim/)
  })
})

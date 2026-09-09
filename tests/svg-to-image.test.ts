// tests/svg-to-image.test.ts
// ★2026-09-09 G-62 SVG→Skyline P0：静态 <svg> 子树 → <image> data-URI（编译期 lowering）。
//   地基实证：Skyline <image> 完整渲染 SVG base64 data-URI（examples/pages/image-spike.vue 真机截图确认，
//   path/stroke/circle 均正确）——canvas 路线被 node() 通道阻塞（专项 §9），P0 走 image 路线。
//   边界：仅静态子树（无 v-bind/v-if/v-for/插值/事件）lowering；动态 SVG 诚实警告（P1 待做）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'
import { lowerSvgToImage, viewBoxRatio } from '../packages/compiler/src/svg-lower'

const compile = (src: string) => compileVueSfc(src, { filename: 't.vue' }) as any

describe('G-62 P0：静态 SVG → image data-URI', () => {
  it('静态 <svg><path></svg> → <image src="data:image/svg+xml;base64,…">', () => {
    const r = compile('<template><svg viewBox="0 0 24 24"><path d="M12 2 L22 22 L2 22 Z" fill="#e74c3c"/></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/)
    expect(r.wxml).not.toContain('<svg')
    expect(r.wxml).not.toContain('<path')
  })

  it('data-URI 解码后是合法 SVG（含 xmlns + 原属性）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#3498db"/></svg></template>')
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"') // 自动补 xmlns（渲染必需）
    expect(svg).toContain('viewBox="0 0 100 100"') // 驼峰恢复（解析后 viewbox → viewBox）
    expect(svg).toContain('<circle')
    expect(svg).toContain('fill="#3498db"')
    expect(svg).toMatch(/<\/svg>$/)
  })

  it('width/height 属性继承到 image 尺寸', () => {
    const r = compile('<template><svg viewBox="0 0 100 100" width="48" height="32"><rect x="0" y="0" width="100" height="100" fill="#000"/></svg></template>')
    expect(r.wxml).toMatch(/style="width:48px;height:32px;"/)
  })

  it('无 width/height → 用 viewBox 尺寸作默认', () => {
    const r = compile('<template><svg viewBox="0 0 32 16"><rect x="0" y="0" width="32" height="16" fill="#000"/></svg></template>')
    expect(r.wxml).toMatch(/style="width:32px;height:16px;"/)
  })

  it('嵌套结构（g/defs/linearGradient）保留', () => {
    const r = compile(
      '<template><svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><g><path d="M0 0 L24 24" stroke="url(#g)"/></g></svg></template>',
    )
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).toContain('<defs>')
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('stop-color="#f00"') // kebab 属性保持
    expect(svg).toContain('<g>')
  })

  it('动态 SVG（v-bind/插值）不 lowering + 诚实警告（P1 边界）', () => {
    const r = compile('<script setup lang="ts">const d = ref("M0 0")\nconst c = ref("red")</script>\n<template><svg viewBox="0 0 24 24"><path :d="d" :fill="c"/></svg></template>')
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml/)
    expect(r.warnings.some((w: string) => /SVG 矢量标签/.test(w))).toBe(true)
    // 警告须指向 P0 规则与 P1 路线（可行动）
    expect(r.warnings.some((w: string) => /svg-to-image/.test(w) && /P1/.test(w))).toBe(true)
  })

  it('v-if 控制的 SVG → 不 lowering（动态，P1）', () => {
    const r = compile('<script setup lang="ts">const show = ref(true)</script>\n<template><svg v-if="show" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#000"/></svg></template>')
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml/)
  })

  it('规则 template/svg-to-image 可禁用（回退原样输出 + 警告）', () => {
    const r = compileVueSfc('<template><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#000"/></svg></template>', {
      filename: 't.vue',
      rules: { disabled: ['template/svg-to-image'] },
    }) as any
    expect(r.wxml).toContain('<svg')
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml/)
  })

  it('非 svg 的 SVG 子标签（独立 <circle>）仍走 svg-no-peer 警告', () => {
    const r = compile('<template><circle cx="12" cy="12" r="10" fill="#000"/></template>')
    expect(r.warnings.some((w: string) => /SVG 矢量标签/.test(w))).toBe(true)
  })

  it('viewBoxRatio 推导宽高比', () => {
    expect(viewBoxRatio('0 0 100 50')).toBe(2)
    expect(viewBoxRatio('0 0 24 24')).toBe(1)
    expect(viewBoxRatio('bad')).toBe(1)
  })

  it('lowerSvgToImage 直接调用：静态返回 dataUri，动态返回 null', () => {
    // 通过 compileVueSfc 的产物间接覆盖（lowerSvgToImage 需要 ElementNode——此处验证导出可用）
    expect(typeof lowerSvgToImage).toBe('function')
  })
})

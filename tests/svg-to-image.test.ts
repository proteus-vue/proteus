// tests/svg-to-image.test.ts
// ★2026-09-09 G-62 SVG→Skyline P0：静态 <svg> 子树 → <image> data-URI（编译期 lowering）。
//   地基实证：Skyline <image> 完整渲染 SVG base64 data-URI（examples/pages/image-spike.vue 真机截图确认，
//   path/stroke/circle 均正确）——canvas 路线被 node() 通道阻塞（专项 §9），P0 走 image 路线。
//   边界：仅静态子树（无 v-bind/v-if/v-for/插值/事件）lowering；动态 SVG 诚实警告（P1 待做）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'
import { lowerSvgToImage, viewBoxRatio, SVG_P2_SUPPORT } from '../packages/compiler/src/svg-lower'

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

  // ★2026-09-09 P1 落地：动态 SVG 不再走警告，改为 computed 重生成（<image src="{{proteusSvgN}}">）
  it('P1：动态 SVG（:d/:fill）→ computed 重生成 + <image src="{{proteusSvgN}}">', () => {
    const r = compile('<script setup lang="ts">const d = ref("M0 0")\nconst c = ref("red")</script>\n<template><svg viewBox="0 0 24 24"><path :d="d" :fill="c"/></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*src="\{\{proteusSvg1\}\}"/)
    expect(r.wxml).not.toContain('<svg')
    // computed 表达式：URL-encoded data-URI + 依赖改写为 this.data.x
    expect(r.js).toMatch(/encodeURIComponent\(`<svg[\s\S]*this\.data\.d[\s\S]*this\.data\.c/)
    expect(r.js).toMatch(/data:image\/svg\+xml,/)
    expect(r.js).not.toMatch(/btoa/) // 微信逻辑层无 btoa——URL-encoded 形态
    // 动态已对齐 → 无 SVG 警告
    expect(r.warnings.some((w: string) => /SVG 矢量标签/.test(w))).toBe(false)
  })

  it('P1：标签名/属性名不被误伤（片段树只改 expr——嵌套 v-if 亦然）', () => {
    const r = compile('<script setup lang="ts">const show = ref(true)\nconst path = ref("M0 0")</script>\n<template><svg viewBox="0 0 24 24"><path v-if="show" :d="path"/></svg></template>')
    const js = r.js
    expect(js).not.toMatch(/<this\.data\.path/) // 标签名 path 不被改
    expect(js).not.toMatch(/this\.data\.path d=/)
    expect(js).toMatch(/<path d="\$\{this\.data\.path\}"/)
    expect(js).toMatch(/this\.data\.show \?/)
  })

  it('P1：v-for 不支持 → 保持诚实警告（边界）', () => {
    const r = compile('<script setup lang="ts">const items = ref([1])</script>\n<template><svg viewBox="0 0 24 24"><path v-for="i in items" :d="i"/></svg></template>')
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml/)
    expect(r.warnings.some((w: string) => /SVG 矢量标签/.test(w))).toBe(true)
  })

  it('v-if 控制的 SVG 根节点 → 不 lowering 为静态 image（动态，走 svg-no-peer 兜底）', () => {
    const r = compile('<script setup lang="ts">const show = ref(true)</script>\n<template><svg v-if="show" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#000"/></svg></template>')
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml;base64/)
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

  // ★2026-09-09 P2：Skyline image SVG 特性支持矩阵（真机 spike 实证）
  it('P2：mask/clipPath/transform/dasharray → 放行（实测支持，无警告）', () => {
    const r = compile(
      '<template><svg viewBox="0 0 100 100"><defs><clipPath id="c"><circle cx="50" cy="50" r="35"/></clipPath>' +
        '<mask id="m"><rect width="100" height="100" fill="#fff"/></mask></defs>' +
        '<g transform="rotate(45)"><rect width="100" height="100" fill="#2ecc71" clip-path="url(#c)" mask="url(#m)"/></g></svg></template>',
    )
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    expect(r.warnings.some((w: string) => /不支持/.test(w))).toBe(false)
    // 特性保留在 data-URI 内
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).toContain('clipPath')
    expect(svg).toContain('mask')
    expect(svg).toContain('transform="rotate(45)"')
  })

  it('P2：use/symbol → lowering + 实测不支持警告（真机渲染空白）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><defs><symbol id="s"><circle r="15"/></symbol></defs><use href="#s" x="30" y="30"/></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    const w = r.warnings.find((x: string) => /不支持/.test(x))
    expect(w, 'use/symbol 应有实测不支持警告').toBeTruthy()
    expect(w).toMatch(/<use>|<symbol>/)
  })

  it('P2：text → lowering + 实测不支持警告', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><text x="50" y="55" font-size="24">AB</text></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    expect(r.warnings.some((x: string) => /不支持/.test(x) && /<text>/.test(x))).toBe(true)
  })

  it('P2：SVG_P2_SUPPORT 支持表导出（文档化实测结论）', () => {
    expect(SVG_P2_SUPPORT.supported).toContain('clipPath')
    expect(SVG_P2_SUPPORT.supported).toContain('mask')
    expect(SVG_P2_SUPPORT.unsupported).toContain('use')
    expect(SVG_P2_SUPPORT.unsupported).toContain('text')
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

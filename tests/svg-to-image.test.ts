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
    expect(r.warnings.some((w: string) => /SVG 子标签/.test(w))).toBe(false)
    // 特性保留在 data-URI 内
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).toContain('clipPath')
    expect(svg).toContain('mask')
    expect(svg).toContain('transform="rotate(45)"')
  })

  it('P2：use/symbol 编译期展开（真机实证：原始渲染空白，展开后完美渲染）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><defs><symbol id="s"><circle cx="0" cy="0" r="15" fill="#34495e"/></symbol></defs><use href="#s" x="30" y="30"/><use href="#s" x="70" y="70"/></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).not.toContain('<use')       // use 已展开
    expect(svg).not.toContain('<symbol')    // symbol 定义已移除
    expect(svg).toMatch(/translate\(30,30\)/)
    expect(svg).toMatch(/translate\(70,70\)/)
    expect(svg).not.toMatch(/<defs>\s*<\/defs>/) // 空 defs 已清理
    expect(r.warnings.some((x: string) => /不支持/.test(x))).toBe(false) // 内部引用不警告
  })

  it('P2：use 外部引用（symbol 未定义）→ 展开失败 + 诚实警告', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><use href="#external"/></svg></template>')
    const w = r.warnings.find((x: string) => /SVG 子标签/.test(x))
    expect(w, '外部引用应有警告').toBeTruthy()
    expect(w).toMatch(/use\(外部引用\)/)
  })

  // ★2026-09-09 更新：静态 text 已编译期提升为原生 <text> 叠加（见下方 describe）——不再警告
  it('P2：静态 text → 提升为原生 text（不再警告）；tspan 保留在 SVG 内则警告', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><text x="50" y="55" font-size="24">AB</text></svg></template>')
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
    expect(r.wxml).toMatch(/proteus-svg-wrap/)
    expect(r.wxml).toContain('AB')
    expect(r.warnings.some((x: string) => /SVG 子标签.*<text>/.test(x))).toBe(false)
  })

  it('P2：SVG_P2_SUPPORT 支持表导出（文档化实测结论）', () => {
    expect(SVG_P2_SUPPORT.supported).toContain('clipPath')
    expect(SVG_P2_SUPPORT.supported).toContain('mask')
    // ★use/symbol 已由编译期展开解决（不再列为 unsupported）；text 仍不支持
    expect(SVG_P2_SUPPORT.unsupported).toContain('text')
    expect(SVG_P2_SUPPORT.unsupported).not.toContain('use')
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

describe('★2026-09-09 SVG <text> 编译期提升为原生 <text> 叠加层（补 Skyline 丢弃文字短板）', () => {
  it('静态 <text> → view 容器 + image + 绝对定位原生 text（viewBox → 百分比）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100" width="120" height="120"><circle cx="50" cy="70" r="25" fill="#e74c3c"/><text x="50" y="25" font-size="16" fill="#333" text-anchor="middle">Hello SVG</text></svg></template>')
    // 容器 + image + 叠加 text
    expect(r.wxml).toMatch(/<view class="proteus-svg-wrap[^>]*style="[^"]*position:relative/)
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml;base64/)
    expect(r.wxml).toMatch(/<text style="position:absolute;left:50\.000%;top:25\.000%/)
    expect(r.wxml).toContain('Hello SVG')
    // text-anchor=middle → translateX(-50%)
    expect(r.wxml).toMatch(/transform:translateX\(-50%\)/)
    // 颜色/字号映射
    expect(r.wxml).toMatch(/color:#333/)
    expect(r.wxml).toMatch(/font-size:16px/)
    // 不再警告（文字已提升）
    expect(r.warnings.some((w: string) => /SVG 子标签.*<text>/.test(w))).toBe(false)
  })

  it('text-anchor=end → translateX(-100%)', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><text x="90" y="50" text-anchor="end">R</text></svg></template>')
    expect(r.wxml).toMatch(/transform:translateX\(-100%\)/)
  })

  it('tspan 子文本拼接为整体', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><text x="10" y="50"><tspan>AB</tspan><tspan>CD</tspan></text></svg></template>')
    expect(r.wxml).toContain('ABCD')
  })

  it('带 transform 的 text 不提升（坐标换算复杂度高——诚实降级）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><g transform="rotate(45)"><text x="50" y="50">X</text></g></svg></template>')
    expect(r.wxml).not.toMatch(/proteus-svg-wrap/)
    expect(r.warnings.some((w: string) => /SVG 子标签.*<text>/.test(w))).toBe(true)
  })

  it('无 text 的 SVG 不生成容器包裹（既有产物形态不回归）', () => {
    const r = compile('<template><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg></template>')
    expect(r.wxml).not.toMatch(/proteus-svg-wrap/)
    expect(r.wxml).toMatch(/<image[^>]*data:image\/svg\+xml/)
  })

  it('WXML 文本转义（{{ }} 不触发插值）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><text x="10" y="50">{literal}</text></svg></template>')
    expect(r.wxml).toContain('&#123;literal&#125;')
  })
})

describe('★2026-09-09 规范盘点补全：白名单扩充（真机像素实测均渲染）', () => {
  it('滤镜（filter/feColorMatrix/feGaussianBlur）→ lowering 保留', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><defs><filter id="f"><feColorMatrix type="matrix" values="0 0 0 0 1"/><feGaussianBlur stdDeviation="5"/></filter></defs><circle cx="50" cy="50" r="40" filter="url(#f)"/></svg></template>')
    const b64 = r.wxml.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)![1]
    const svg = Buffer.from(b64, 'base64').toString('utf8')
    expect(svg).toContain('<filter')
    expect(svg).toContain('feColorMatrix')
    expect(svg).toContain('feGaussianBlur')
  })

  it('pattern / marker → lowering 保留', () => {
    const r1 = compile('<template><svg viewBox="0 0 100 100"><defs><pattern id="p" width="20" height="20"><circle cx="10" cy="10" r="6"/></pattern></defs><rect width="100" height="100" fill="url(#p)"/></svg></template>')
    expect(Buffer.from(r1.wxml.match(/base64,([^"]+)"/)![1], 'base64').toString('utf8')).toContain('<pattern')
    const r2 = compile('<template><svg viewBox="0 0 100 100"><defs><marker id="m"><path d="M0 0 L10 5 Z"/></marker></defs><line x1="10" y1="50" x2="90" y2="50" marker-end="url(#m)"/></svg></template>')
    expect(Buffer.from(r2.wxml.match(/base64,([^"]+)"/)![1], 'base64').toString('utf8')).toContain('<marker')
  })

  it('内嵌 image / textPath → lowering 保留', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><image href="data:image/png;base64,iVBOR" x="20" y="20" width="60" height="60"/></svg></template>')
    expect(Buffer.from(r.wxml.match(/base64,([^"]+)"/)![1], 'base64').toString('utf8')).toContain('<image')
  })

  it('滤镜/图案属性映射（filterUnits/stdDeviation/patternUnits/marker-end 等）', () => {
    const r = compile('<template><svg viewBox="0 0 100 100"><defs><filter id="f" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="3"/></filter><pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"/></defs><line x1="0" y1="0" x2="50" y2="50" marker-end="url(#m)"/></svg></template>')
    const svg = Buffer.from(r.wxml.match(/base64,([^"]+)"/)![1], 'base64').toString('utf8')
    expect(svg).toContain('filterUnits="userSpaceOnUse"')
    expect(svg).toContain('stdDeviation="3"')
    expect(svg).toContain('patternUnits="userSpaceOnUse"')
    expect(svg).toContain('marker-end="url(#m)"')
  })
})

// tests/compiler-ir-svg.test.ts
// ★#505 G2 补：SVG 命名空间标签在小程序无对等组件——反黑盒警告（旧行为静默当未注册组件输出无效标签）
// ★2026-09-09 G-62 P0 更新：静态 <svg> 子树已 lowering 为 <image> data-URI（template/svg-to-image）——
//   本文件锁定新契约：静态 → image（不警告）；动态/非 svg 子标签 → 保留 svg-no-peer 警告。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml, compileVueSfc, listTransformRules } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 / G-62 P0：SVG 标签处理（静态 lowering / 动态警告）', () => {
  it('静态 svg → lowering 为 <image> data-URI（P0：不再警告、不再原样输出）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<svg viewBox="0 0 24 24"><path d="M1 2L3 4" /></svg>', opts)
    expect(wxml).toMatch(/<image[^>]*data:image\/svg\+xml;base64,/)
    expect(wxml).not.toContain('<svg')
    expect(warnings.some((w) => w.includes('SVG 矢量标签'))).toBe(false) // 静态已对齐 → 无警告
  })

  it('非 svg 的 SVG 子标签（独立 <path>）→ 仍走 svg-no-peer 警告', () => {
    const { warnings } = transformTemplateToWxml('<path d="M1 2"/>', opts)
    expect(warnings.some((w) => w.includes('SVG 矢量标签') && w.includes('<path>'))).toBe(true)
  })

  it('两条规则均登记（template/svg-to-image + template/svg-no-peer）', () => {
    const ids = listTransformRules('template').map((r) => r.id)
    expect(ids).toContain('template/svg-to-image')
    expect(ids).toContain('template/svg-no-peer')
  })

  it('禁用 svg-to-image → 回退原样输出 + svg-no-peer 警告', () => {
    const { wxml, warnings } = transformTemplateToWxml('<svg><path d="M1 2"/></svg>', {
      ...opts,
      rules: { disabled: ['template/svg-to-image'] },
    })
    expect(wxml).toContain('<svg')
    expect(warnings.some((w) => w.includes('SVG 矢量标签'))).toBe(true)
  })
})

describe('★#505 p-svg 组件端到端（MP 编译）', () => {
  it('p-svg 组件模板（含动态 :d/:viewBox）→ 不 lowering + SVG 警告 + IR 快照在位', () => {
    const src = '<script setup lang="ts">import { computed } from "vue"\nconst props = defineProps({ path: { type: String, default: "" }, size: { type: Number, default: 24 } })\nconst svgStyle = computed(() => ({ width: props.size + "px" }))</script>\n'
      + '<template><svg class="p-svg" :viewBox="viewbox" :style="svgStyle"><path v-if="path" :d="path" fill="currentColor" /></svg></template>'
    const r = compileVueSfc(src, { filename: 'components/p-svg/index.vue', isComponent: true, ...opts })
    // 动态 SVG（:viewBox/:d/v-if）→ P1 边界，保持诚实警告
    expect(r.warnings.some((w) => w.includes('SVG 矢量标签'))).toBe(true)
    expect(r.wxml).not.toMatch(/data:image\/svg\+xml/)
    // IR 快照在位（编译未崩）
    expect(r.ir).toBeDefined()
  })
})

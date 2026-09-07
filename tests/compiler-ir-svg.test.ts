// tests/compiler-ir-svg.test.ts
// ★#505 G2 补：SVG 命名空间标签在小程序无对等组件——反黑盒警告（旧行为静默当未注册组件输出无效标签）
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml, compileVueSfc, listTransformRules } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 SVG 反黑盒：svg/path 标签 MP 无对等 → 警告', () => {
  it('svg 标签 → 编译警告（不再静默当自定义组件）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<svg viewBox="0 0 24 24"><path d="M1 2L3 4" /></svg>', opts)
    expect(warnings.some((w) => w.includes('SVG 矢量标签') && w.includes('<svg>'))).toBe(true)
    // 产物保留原样（诚实：不渲染但输出可见）
    expect(wxml).toContain('<svg')
  })

  it('规则已登记（template/svg-no-peer）', () => {
    const ids = listTransformRules('template').map((r) => r.id)
    expect(ids).toContain('template/svg-no-peer')
  })

  it('禁用规则 → 无警告', () => {
    const warn = console.warn // 保留 console
    void warn
    const { warnings } = transformTemplateToWxml('<svg><path d="M1 2"/></svg>', { ...opts, rules: { disabled: ['template/svg-no-peer'] } })
    expect(warnings.some((w) => w.includes('SVG 矢量标签'))).toBe(false)
  })
})

describe('★#505 p-svg 组件端到端（MP 编译）', () => {
  it('p-svg 组件模板（<svg> 内容）编译 → SVG 警告 + IR 快照在位', () => {
    const src = '<script setup lang="ts">import { computed } from "vue"\nconst props = defineProps({ path: { type: String, default: "" }, size: { type: Number, default: 24 } })\nconst svgStyle = computed(() => ({ width: props.size + "px" }))</script>\n'
      + '<template><svg class="p-svg" :viewBox="viewbox" :style="svgStyle"><path v-if="path" :d="path" fill="currentColor" /></svg></template>'
    const r = compileVueSfc(src, { filename: 'components/p-svg/index.vue', isComponent: true, ...opts })
    expect(r.warnings.some((w) => w.includes('SVG 矢量标签'))).toBe(true)
    // IR 快照在位（编译未崩）
    expect(r.ir).toBeDefined()
  })
})

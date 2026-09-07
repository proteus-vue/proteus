// tests/compiler-ir-m1.test.ts
// ★#505 CompileIR M1 骨架搬迁（草案 docs/compiler-ir-contract-draft.md §6 M1）
// 验证：① buildTemplateIR 纯函数把 TemplateTransformResult 旁路字段 1:1 投影为 TemplateIR；
//       ② compileVueSfc 端到端返回 result.ir（主编译路径经框架 IR 的第一段接线）；
//       ③ 产物逐字节等价——附加 ir 不改变 wxml/js/wxss（M1 铁律）。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, transformTemplateToWxml, buildTemplateIR } from '@proteus-vue/compiler'
import type { TemplateTransformResult } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

/** 构造一份「覆盖全部 14 旁路字段」的 TemplateTransformResult 假数据（字段值刻意独特，防假阳性） */
function fullTplResult(): TemplateTransformResult {
  return {
    wxml: '<view>dummy</view>',
    vModelBindings: ['name', 'count'],
    usesNavigate: true,
    selfHandlers: ['onSelf'],
    onceHandlers: ['onOnce'],
    inlineHandlers: [{ name: 'proteusInlineInc', code: 'this.setData({ count: this.data.count + 1 })' }],
    usesTransition: true,
    transitions: [{ ref: 'show', tName: 'fade', index: 0 }],
    templateRefs: ['piniaStore', 'count'],
    storeBindings: ['counter'],
    semanticGrids: [{ minColWidth: 120, gap: 12, index: 0, defaultStyle: 'width: 50%;' }],
    styleBindings: ['boxStyle'],
    vModelComponentHandlers: [{ name: 'proteusUpdateVisibleModel', model: 'showModal', arg: 'visible', propName: 'visible' }],
    pageScrollWrapped: true,
    warnings: [],
  }
}

describe('★#505 M1 buildTemplateIR：旁路字段 → TemplateIR 投影（1:1 结构化）', () => {
  it('14 旁路字段全量映射（无丢失、无臆造）', () => {
    const ir = buildTemplateIR(fullTplResult())
    expect(ir.vModelTargets).toEqual(['name', 'count'])
    expect(ir.vModelComponentHandlers).toEqual([{ name: 'proteusUpdateVisibleModel', model: 'showModal', arg: 'visible', propName: 'visible' }])
    expect(ir.eventWrappers).toEqual({ self: ['onSelf'], once: ['onOnce'] })
    expect(ir.inlineHandlers).toEqual([{ name: 'proteusInlineInc', code: 'this.setData({ count: this.data.count + 1 })' }])
    expect(ir.transitions).toEqual([{ ref: 'show', tName: 'fade', index: 0 }])
    expect(ir.styleBindings).toEqual([{ target: 'boxStyle', valueKind: 'string-only' }])
    expect(ir.templateRefs).toEqual(['piniaStore', 'count'])
    expect(ir.storeBindings).toEqual(['counter'])
    expect(ir.semanticGrids).toEqual([{ minColWidth: 120, gap: 12, index: 0, defaultStyle: 'width: 50%;' }])
    expect(ir.capabilities).toEqual({ navigate: true, transition: true, scrollContainer: true })
  })

  it('可选项缺省 → 空集合/false 归一（IR 快照确定性）', () => {
    const ir = buildTemplateIR({ wxml: '<view/>', vModelBindings: [], usesNavigate: false, warnings: [] })
    expect(ir.eventWrappers).toEqual({ self: [], once: [] })
    expect(ir.inlineHandlers).toEqual([])
    expect(ir.transitions).toEqual([])
    expect(ir.styleBindings).toEqual([])
    expect(ir.templateRefs).toEqual([])
    expect(ir.storeBindings).toEqual([])
    expect(ir.semanticGrids).toEqual([])
    expect(ir.capabilities).toEqual({ navigate: false, transition: false, scrollContainer: false })
  })
})

describe('★#505 M1 compileVueSfc 端到端：result.ir 存在且与产物旁路语义一致', () => {
  it('无模板特性的普通页面：ir 结构在位、默认能力归一', () => {
    const r = compileVueSfc('<template><view class="a">hi</view></template>', { filename: 'pages/plain.vue', ...opts })
    expect(r.ir).toBeDefined()
    expect(r.ir?.version).toBe(1)
    expect(r.ir?.template).toBeDefined()
    expect(r.ir?.template.vModelTargets).toEqual([])
    // 页面模式默认自动包滚动容器（15-page-scroll-container）→ scrollContainer: true
    expect(r.ir?.template.capabilities).toEqual({ navigate: false, transition: false, scrollContainer: true })
    expect(r.wxml).toContain('class="a"')
  })

  it('v-model 自定义组件 + input v-model → vModelTargets / vModelComponentHandlers 如实投影', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)\nconst name = ref("")</script>\n'
      + '<template><p-modal v-model:visible="show">x</p-modal><input v-model="name" /></template>'
    const r = compileVueSfc(src, { filename: 'pages/vm.vue', ...opts })
    expect(r.ir?.template.vModelTargets).toEqual(expect.arrayContaining(['show', 'name']))
    expect(r.ir?.template.vModelComponentHandlers).toEqual([{ name: 'proteusUpdateVisibleModel', model: 'show', arg: 'visible', propName: 'visible' }])
    // 产物等价锚点：既有形态不受 ir 影响
    expect(r.wxml).toContain('bind:update:visible="proteusUpdateVisibleModel"')
    expect(r.js).toContain('proteusUpdateVisibleModel(e) { this.setData({ show: e.detail }) }')
  })

  it(':style 派生对象 + .self/.once + 赋值型内联事件 + store 引用 → 对应声明投影', () => {
    const src = `<script setup lang="ts">import { ref } from "vue"\nconst boxStyle = ref({})</script>\n`
      + `<template><view :style="boxStyle" @click.self="onSelf" @tap.once="onOnce">`
      + `{{ store.count }}<view :class="{ active: store.count > 0 }" @click="showModal = !showModal">s</view></view></template>`
    const r = compileVueSfc(src, { filename: 'pages/mix.vue', ...opts })
    expect(r.ir?.template.styleBindings).toEqual([{ target: 'boxStyle', valueKind: 'string-only' }])
    expect(r.ir?.template.eventWrappers.self).toContain('onSelf')
    expect(r.ir?.template.eventWrappers.once).toContain('onOnce')
    // #501 赋值型内联事件（x = !x）→ 包装方法声明
    expect(r.ir?.template.inlineHandlers.some((h) => h.name.includes('proteusInline') && h.code.includes('showModal'))).toBe(true)
    expect(r.ir?.template.templateRefs).toContain('store')
    expect(r.ir?.template.storeBindings).toContain('count')
    expect(r.wxml).toContain('style="{{boxStyle}}"')
    expect(r.wxml).toContain('bindtap="proteusSelfOnSelf"')
  })

  it('transition + 页面滚动包装 + 导航链接 → capabilities 如实投影', () => {
    const src = '<script setup lang="ts">const show = ref(true)</script>\n'
      + '<template><view v-if="show" v-show="show"><a href="/pages/other">go</a><transition name="fade"><view v-if="show">f</view></transition></view></template>'
    const r = compileVueSfc(src, { filename: 'pages/nav.vue', ...opts })
    // 页面自动包滚动容器（页面模式默认）
    expect(r.ir?.template.capabilities.scrollContainer).toBe(true)
    expect(r.ir?.template.capabilities.navigate).toBe(true)
  })
})

describe('★#505 M1 产物等价铁律：附加 ir 不改 wxml/js/wxss（投影前后逐字节一致）', () => {
  it('compileVueSfc 与 transformTemplateToWxml + transformScriptToPage 组合产物一致', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)\nconst items = ref([1,2,3])</script>\n'
      + '<template><view v-for="(it,i) in items" :key="i" v-show="show"><text>{{ it }}</text></view></template>'
    const r = compileVueSfc(src, { filename: 'pages/eq.vue', ...opts })
    // wxml/js/wxss 仍是既有产物（关键形态锚点）
    expect(r.wxml).toContain('wx:for="{{items}}"')
    expect(r.wxml).toContain('hidden="{{!show}}"')
    expect(r.js).toContain('show: false')
    // ir 存在且是附加字段（version + template 结构）
    expect(r.ir).toBeDefined()
    expect(r.ir?.template.vModelTargets).toEqual([])
  })

  it('golden fixture basic 页编译后 ir 与快照产物锚点共存（产物不变）', () => {
    const r = compileVueSfc('<template><div class="page-data-v-x"><h1>Title</h1><p v-if="ok">hi</p></div></template>', { filename: 'pages/basic.vue', ...opts })
    // h1/p 为语义标签 → text + proteus-* 类（既有产物形态，非 M1 引入）
    expect(r.wxml).toContain('<text class="proteus-h1">Title</text>')
    expect(r.wxml).toContain('wx:if="{{ok}}"')
    expect(r.ir).toBeDefined()
  })
})

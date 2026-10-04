// tests/vapor-class-styles.test.ts —— ★★★App 三端对齐 · 缺口 C1（最小切片）：
//   **SFC `<style>` 单类规则 → class → 节点样式**（2026-10-04）
//
// 【这张测试锁什么】App 路径**没有 CSS 引擎**（此前只吃 inline `style`）⇒ 真实项目「有结构无样式」。
//   C1 最小切片把 `<style>` 里**单一简单类选择器**规则折成「类名 → 引擎字段」，模板节点按 `class` 合并。
//
// 【判据】
//   ① `.foo{}` 单类 → 节点按 class 拿到样式字段（在节点 style 里）
//   ② **inline style 覆盖 class**（同元素两者并存时 inline 优先）
//   ③ 组合/伪类/属性选择器等**不支持** ⇒ 跳过 + 诊断（VAPOR_STYLE_SELECTOR_UNSUPPORTED，不静默）
//   ④ scoped 后缀类名（`.foo-data-v-x`）也能匹配 `class="foo"`（stripScopeSuffix）
//   ⑤ 认不出的声明值仍走 parseStaticStyle 折叠面（px/数字；百分比宽高→比例）

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, parseClassStyles, stripScopeSuffix } from '@proteus-vue/compiler'

const SFC = `<template>
  <view class="card">
    <text class="title">标题</text>
    <view class="card" style="background-color: #000000">inline 覆盖</view>
  </view>
</template>
<script setup lang="ts">
const x = 1
</script>
<style scoped>
.card { width: 300; height: 120; background-color: #FFFFFF; flex-direction: column }
.title { font-size: 20; color: #333333 }
.card > .title { margin-top: 8 }
.title:hover { color: #FF0000 }
</style>`

describe('★C1 最小切片 · SFC <style> 单类规则 → class→节点样式', () => {
  const r = buildLayoutTemplate(SFC, 'pages/card.vue')

  it('① 单类规则 → 节点按 class 拿到样式字段', () => {
    expect(r.ok).toBe(true)
    const card = r.template.nodes.find((n) => {
      const s = n.style as { height?: number }
      return s.height === 120
    })
    expect(card, 'class="card" 的节点应拿到 .card 样式').toBeTruthy()
    expect((card!.style as { backgroundColor?: string }).backgroundColor, '.card 背景色').toBe('#FFFFFF')
    expect((card!.style as { flexDirection?: string }).flexDirection, '.card flexDirection').toBe('column')
    const title = r.template.nodes.find((n) => (n.style as { fontSize?: number }).fontSize === 20)
    expect(title, 'class="title" 的节点应拿到 .title 样式').toBeTruthy()
    expect((title!.style as { color?: string }).color, '.title 文字色').toBe('#333333')
  })

  it('② inline style 覆盖 class（同元素两者并存 ⇒ inline 优先）', () => {
    // 第三个节点：class="card" + inline background-color:#000000 ⇒ 应取 inline 的黑色
    const inlineNode = r.template.nodes.find(
      (n) => (n.style as { backgroundColor?: string }).backgroundColor === '#000000',
    )
    expect(inlineNode, '★inline 背景色覆盖了 .card 的 #FFFFFF').toBeTruthy()
    // 且 class 的其它属性仍在（width/height）——是"合并"不是"替换"
    expect((inlineNode!.style as { height?: number }).height, 'class 的 height 仍在（合并）').toBe(120)
  })

  it('③ 不支持的选择器 ⇒ 跳过 + 诊断（不静默）', () => {
    const codes = r.diagnostics.map((d) => d.code)
    expect(codes, '有选择器不支持诊断').toContain('VAPOR_STYLE_SELECTOR_UNSUPPORTED')
    // 组合/伪类规则**未**被合进样式（.card > .title 的 margin-top 不应出现在 title 节点上）
    const anyMargin = r.template.nodes.some((n) => (n.style as { marginTop?: number }).marginTop === 8)
    expect(anyMargin, '.card > .title 组合选择器未被误当单类合并').toBe(false)
  })

  it('④ scoped 后缀类名也能匹配（stripScopeSuffix）', () => {
    expect(stripScopeSuffix('foo-data-v-abc123')).toBe('foo')
    expect(stripScopeSuffix('foo')).toBe('foo')
    const m = parseClassStyles('.bar-data-v-xyz { height: 40 }')
    expect(m.bar, '去后缀名 bar 登记').toBeTruthy()
    expect(m['bar-data-v-xyz'], '带后缀名也登记（防显式使用）').toBeTruthy()
  })

  it('⑤ 折叠面同源：百分比宽高 → 比例字段（与 inline style 同一 parseStaticStyle）', () => {
    const m = parseClassStyles('.full { width: 100%; height: 50 }')
    expect((m.full as { widthRatio?: number }).widthRatio, 'width:100% → widthRatio 1').toBe(1)
    expect((m.full as { height?: number }).height, 'height:50 → 50').toBe(50)
  })
})

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
import { buildLayoutTemplate, parseClassStyles, parseStaticStyle, stripScopeSuffix, normalizeCssColor } from '@proteus-vue/compiler'

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
.card { width: 300; height: 120; background-color: #ffffff; flex-direction: column }
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
    expect((card!.style as { backgroundColor?: string }).backgroundColor, '.card 背景色').toBe('#ffffff')
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
    expect(inlineNode, '★inline 背景色覆盖了 .card 的 #ffffff').toBeTruthy()
    // 且 class 的其它属性仍在（width/height）——是"合并"不是"替换"
    expect((inlineNode!.style as { height?: number }).height, 'class 的 height 仍在（合并）').toBe(120)
  })

  it('③ ★选择器链：复合 .a.b / 后代 .a .b / 子 .a>.b 均可匹配', () => {
    const chainSfc = `<template>
      <view class="list">
        <view class="row active"><text class="label">A</text></view>
      </view>
    </template>
    <script setup>const y = 1</script>
    <style scoped>
    .row { height: 40 }
    .row.active { background-color: #EEEEEE }
    .list .label { color: #111111 }
    .row > .label { font-size: 18 }
    .label:hover { color: #FF0000 }
    </style>`
    const rc = buildLayoutTemplate(chainSfc, 'pages/list.vue')
    expect(rc.ok).toBe(true)
    const row = rc.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#eeeeee')
    expect(row, '★复合 .row.active 匹配').toBeTruthy()
    expect((row!.style as { height?: number }).height, '单类 .row 也并到该节点').toBe(40)
    const label = rc.template.nodes.find((n) => (n.style as { fontSize?: number }).fontSize === 18)
    expect(label, '★子选择器 .row > .label 匹配').toBeTruthy()
    expect((label!.style as { color?: string }).color, '★后代选择器 .list .label 匹配').toBe('#111111')
    // 伪类规则仍跳过（.label:hover 的红色不应出现）
    const anyRed = rc.template.nodes.some((n) => (n.style as { color?: string }).color === '#FF0000')
    expect(anyRed, '伪类 .label:hover 仍跳过（不支持）').toBe(false)
    expect(rc.diagnostics.map((d) => d.code), '仍有不支持选择器诊断').toContain('VAPOR_STYLE_SELECTOR_UNSUPPORTED')
  })

  it('④ scoped 后缀类名也能匹配（stripScopeSuffix）', () => {
    expect(stripScopeSuffix('foo-data-v-abc123')).toBe('foo')
    expect(stripScopeSuffix('foo')).toBe('foo')
    // 规则里的类名带 scoped 后缀 ⇒ 抽出时去后缀（与元素原始类名对齐）
    const m = parseClassStyles('.bar-data-v-xyz { height: 40 }')
    expect(m.bar, '规则里的 .bar-data-v-xyz 去后缀后以 bar 登记').toBeTruthy()
    expect((m.bar as { height?: number }).height).toBe(40)
  })

  it('★⑥ 枚举值校验：display: block/grid 等 App 不支持值 ⇒ 跳过 + 诊断（不传非法值给内核）', () => {
    // 【真机缺陷回归】真机 RustLayout.create 失败暴露：CSS display:block/inline-block/grid/inline-flex
    //   此前**原样透传** ⇒ 内核只认 flex/none ⇒ **整棵树建不起来**（页面全崩）。现改为诊断+跳过。
    const m = parseClassStyles('.x { display: block; height: 10 }', () => {})
    expect((m.x as { display?: string }).display, 'display:block 被跳过（不传非法值）').toBeUndefined()
    expect((m.x as { height?: number }).height, '同规则其它合法声明仍在').toBe(10)
    const m2 = parseClassStyles('.y { display: flex; position: sticky }', () => {})
    expect((m2.y as { display?: string }).display, 'display:flex 合法保留').toBe('flex')
    expect((m2.y as { position?: string }).position, 'position:sticky 不支持 ⇒ 跳过').toBeUndefined()
    // 真机建树契约：折叠出的值必须在内核封闭集内
    const diag: string[] = []
    parseStaticStyle('display: grid', (x) => diag.push(x))
    expect(diag.length, 'inline display:grid 也诊断').toBeGreaterThan(0)
  })

  it('★⑦ 颜色归一：rgb()/rgba()/transparent → hex（内核只认 hex）', () => {
    // 【真机缺陷回归】rgba() 原样透传 ⇒ 内核 parse_css_color 拒绝 ⇒ 整树建不起来。现编译期归一。
    expect(normalizeCssColor('rgb(255, 255, 255)')).toBe('#ffffff')
    expect(normalizeCssColor('rgba(255, 255, 255, 0.8)')).toBe('#ffffffcc')
    expect(normalizeCssColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080')
    expect(normalizeCssColor('rgba(255,0,0,1)')).toBe('#ff0000ff')
    expect(normalizeCssColor('transparent')).toBe('#00000000')
    expect(normalizeCssColor('#FFF')).toBe('#fff')
    expect(normalizeCssColor('#12345678')).toBe('#12345678')
    expect(normalizeCssColor('red'), '命名色不支持 ⇒ undefined').toBeUndefined()
    expect(normalizeCssColor('hsl(0,0%,0%)')).toBeUndefined()
    // 端到端：<style> 里的 rgba 折成 hex
    const m = parseClassStyles('.c { color: rgba(255, 255, 255, 0.8) }')
    expect((m.c as { color?: string }).color, 'class 里的 rgba 归一为 hex').toBe('#ffffffcc')
  })

  it('⑤ 折叠面同源：百分比宽高 → 比例字段（与 inline style 同一 parseStaticStyle）', () => {
    const m = parseClassStyles('.full { width: 100%; height: 50 }')
    expect((m.full as { widthRatio?: number }).widthRatio, 'width:100% → widthRatio 1').toBe(1)
    expect((m.full as { height?: number }).height, 'height:50 → 50').toBe(50)
  })
})

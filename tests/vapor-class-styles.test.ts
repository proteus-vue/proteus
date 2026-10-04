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

  it('★⑧ 元素/类型选择器 + @keyframes 跳过（C1 收尾）', () => {
    // 【真项目形态】examples 有 9 处元素选择器（h3/code…）+ 6 处 @keyframes 关键帧被误当选择器
    const sfc = `<template>
      <view class="doc">
        <text>普通</text>
        <code>let x = 1</code>
        <h3>标题</h3>
      </view>
    </template>
    <script setup>const z = 1</script>
    <style scoped>
    .doc code { background-color: #f5f5f5; border-radius: 4 }
    h3 { font-size: 22; color: #111111 }
    @keyframes spin { from { opacity: 0 } to { opacity: 1 } 0% { opacity: 0 } 100% { opacity: 1 } }
    </style>`
    const r = buildLayoutTemplate(sfc, 'pages/doc.vue')
    expect(r.ok).toBe(true)
    // 元素选择器 `.doc code`：code 节点拿到背景色（类链 .doc + 元素 code）
    const codeNode = r.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#f5f5f5')
    expect(codeNode, '★元素选择器 .doc code 匹配到 code 节点').toBeTruthy()
    expect(codeNode!.tag, '确实是 code 节点').toBe('code')
    // 纯元素选择器 h3：h3 节点拿到字号
    const h3Node = r.template.nodes.find((n) => (n.style as { fontSize?: number }).fontSize === 22)
    expect(h3Node, '★纯元素选择器 h3 匹配').toBeTruthy()
    expect(h3Node!.tag, '确实是 h3 节点').toBe('h3')
    // @keyframes 的 from/to/0% 不产生样式（不应用到任何节点）
    const anyOpacity = r.template.nodes.some((n) => 'opacity' in (n.style as object))
    expect(anyOpacity, '@keyframes 关键帧不误当选择器').toBe(false)
  })

  it('⑤ 折叠面同源：百分比宽高 → 比例字段（与 inline style 同一 parseStaticStyle）', () => {
    const m = parseClassStyles('.full { width: 100%; height: 50 }')
    expect((m.full as { widthRatio?: number }).widthRatio, 'width:100% → widthRatio 1').toBe(1)
    expect((m.full as { height?: number }).height, 'height:50 → 50').toBe(50)
  })
})

// ★★★批次 1（CSS 兼容对齐 · 层叠正确性）：特异性 + 继承 + `!important`（2026-10-04）
describe('★批次 1 · CSS 层叠正确性（特异性 / 继承 / !important）', () => {
  it('① 特异性：高特异性类盖过低特异性（.a.b > .a，即使 .a 后写）', () => {
    // .a 写在后（源序更晚）但特异性低 ⇒ 高特异性的 .a.b 应胜出（修正"只按源序"的旧缺陷）
    const sfc = `<template><view class="a b">x</view></template>
<script setup>const z = 1</script>
<style>
.a.b { color: #111111 }
.a { color: #999999 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    expect(r.ok).toBe(true)
    const n = r.template.nodes.find((x) => (x.style as { color?: string }).color)
    expect((n!.style as { color?: string }).color, '高特异性 .a.b 胜（不是后写的 .a）').toBe('#111111')
  })

  it('①b 同特异性：后写者胜（源序）', () => {
    const sfc = `<template><view class="a b">x</view></template>
<script setup>const z = 1</script>
<style>
.a { color: #111111 }
.b { color: #222222 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const n = r.template.nodes.find((x) => (x.style as { color?: string }).color)
    expect((n!.style as { color?: string }).color, '同特异性后写 .b 胜').toBe('#222222')
  })

  it('② 继承：color/fontSize 沿树向下传播（子节点无显式值时继承）', () => {
    const sfc = `<template>
      <view class="root">
        <view class="mid"><text class="leaf">深层文本</text></view>
      </view>
    </template>
<script setup>const z = 1</script>
<style>
.root { color: #334455; font-size: 18 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    expect(r.ok).toBe(true)
    // 深层 text 节点（无自己的 color/font-size）应继承 root 的颜色与字号
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    expect((leaf?.style as { color?: string }).color, 'color 继承到深层文本').toBe('#334455')
    expect((leaf?.style as { fontSize?: number }).fontSize, 'font-size 继承到深层文本').toBe(18)
  })

  it('②b 继承：子节点自己的声明覆盖继承值；**背景色不继承**（CSS 语义）', () => {
    const sfc = `<template>
      <view class="root"><text class="leaf">x</text></view>
    </template>
<script setup>const z = 1</script>
<style>
.root { color: #111111; background-color: #eeeeee }
.leaf { color: #ff0000 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    expect((leaf?.style as { color?: string }).color, '子自己的 color 覆盖继承').toBe('#ff0000')
    expect(
      (leaf?.style as { backgroundColor?: string }).backgroundColor,
      '背景色**不**继承（background 不属可继承属性）',
    ).toBeUndefined()
  })

  it('③ !important：class !important 盖过 inline 普通声明', () => {
    const sfc = `<template>
      <view class="a" style="color: #00ff00">x</view>
    </template>
<script setup>const z = 1</script>
<style>
.a { color: #ff0000 !important }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const n = r.template.nodes.find((x) => (x.style as { color?: string }).color)
    expect((n!.style as { color?: string }).color, 'class !important 胜 inline 普通').toBe('#ff0000')
  })

  it('③b !important：inline !important 盖过 class !important（层叠：inline important 最高）', () => {
    const sfc = `<template>
      <view class="a" style="color: #0000ff !important">x</view>
    </template>
<script setup>const z = 1</script>
<style>
.a { color: #ff0000 !important }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const n = r.template.nodes.find((x) => (x.style as { color?: string }).color)
    expect((n!.style as { color?: string }).color, 'inline !important 胜 class !important').toBe('#0000ff')
  })

  it('③c !important 与特异性正交：important 的低特异性也盖过高特异性普通', () => {
    const sfc = `<template><view class="a b">x</view></template>
<script setup>const z = 1</script>
<style>
.a.b { color: #111111 }
.a { color: #999999 !important }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const n = r.template.nodes.find((x) => (x.style as { color?: string }).color)
    expect((n!.style as { color?: string }).color, 'important 优先于特异性').toBe('#999999')
  })

  it('④ parseStaticStyle 剥离 !important 并标记逐属性（保留原值）', () => {
    const imp = new Set<string>()
    const out = parseStaticStyle('width: 100px !important; color: #ffffff', () => {}, imp)
    expect(out.width, '值剥离 !important（100px → 100）').toBe(100)
    expect(out.color).toBe('#ffffff')
    expect([...imp], '仅 width 标记为 important').toEqual(['width'])
  })
})

// ★★★批次 2（CSS 兼容对齐 · 值/简写归一化）：margin/padding 多值 + background 简写（2026-10-04）
//   取证依据：真项目里 `margin: 8px 0` / `padding: 8px 12px` 等**多值简写高频**（此前整体丢弃）。
describe('★批次 2 · 值/简写归一化（四值简写 + background）', () => {
  it('① margin/padding 四值简写按 CSS 标准展开', () => {
    expect(parseStaticStyle('margin: 8px 0', () => {}).margin, '两值 → top/bottom=8, right/left=0').toEqual({ top: 8, right: 0, bottom: 8, left: 0 })
    expect(parseStaticStyle('padding: 8px 12px', () => {}).padding, '两值').toEqual({ top: 8, right: 12, bottom: 8, left: 12 })
    expect(parseStaticStyle('padding: 1px 2px 3px', () => {}).padding, '三值 → top=1,left/right=2,bottom=3').toEqual({ top: 1, right: 2, bottom: 3, left: 2 })
    expect(parseStaticStyle('padding: 1px 2px 3px 4px', () => {}).padding, '四值').toEqual({ top: 1, right: 2, bottom: 3, left: 4 })
  })

  it('①b margin: auto 的边忽略（内核对等无 auto），其余边照设', () => {
    expect(parseStaticStyle('margin: 0 auto', () => {}).margin, '左右 auto 忽略，仅上/下=0').toEqual({ top: 0, bottom: 0 })
  })

  it('② background 简写 → backgroundColor（纯色归一为 hex）', () => {
    expect(parseStaticStyle('background: #eef4ff', () => {}).backgroundColor).toBe('#eef4ff')
    expect(parseStaticStyle('background: rgba(26, 122, 248, 0.06)', () => {}).backgroundColor, 'rgba → hex8').toBe('#1a7af80f')
    expect(parseStaticStyle('background: transparent', () => {}).backgroundColor).toBe('#00000000')
  })

  it('②b background 渐变/图片 ⇒ 跳过 + 诊断（不静默；渐变走引擎 fill-gradient 通道）', () => {
    const diags: string[] = []
    const out = parseStaticStyle('background: linear-gradient(135deg, #fff 0%, #000 100%)', (m) => diags.push(m))
    expect(out.backgroundColor, '渐变不折成 backgroundColor').toBeUndefined()
    expect(diags.some((m) => m.includes('background 简写')), '产诊断').toBe(true)
  })

  it('③ 端到端：多值简写经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="card">x</view></template>
<script setup>const z = 1</script>
<style>
.card { margin: 8px 0; padding: 12px 16px; background: #f5f6f7 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/card.vue')
    expect(r.ok).toBe(true)
    const n = r.template.nodes.find((x) => x.style && (x.style as { margin?: unknown }).margin)
    expect((n!.style as { margin?: unknown }).margin, 'margin 两值').toEqual({ top: 8, right: 0, bottom: 8, left: 0 })
    expect((n!.style as { padding?: unknown }).padding, 'padding 两值').toEqual({ top: 12, right: 16, bottom: 12, left: 16 })
    expect((n!.style as { backgroundColor?: string }).backgroundColor, 'background → backgroundColor').toBe('#f5f6f7')
  })
})

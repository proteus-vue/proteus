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
import { buildLayoutTemplate, parseClassStyles, parseStaticStyle, stripScopeSuffix, normalizeCssColor, parseCssVarTokens, substituteCssVars } from '@proteus-vue/compiler'

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

  it('★⑥ 枚举值校验：display: block/inline-block 等 App 不支持值 ⇒ 跳过 + 诊断（不传非法值给内核）', () => {
    // 【真机缺陷回归】真机 RustLayout.create 失败暴露：CSS display:block/inline-block/inline-flex
    //   此前**原样透传** ⇒ 内核只认 flex/grid/none ⇒ **整棵树建不起来**（页面全崩）。现改为诊断+跳过。
    //   ★批次 12：`grid` 已支持（内核开放 Display::Grid）⇒ 本用例改用仍不支持的 `inline-flex`。
    const m = parseClassStyles('.x { display: block; height: 10 }', () => {})
    expect((m.x as { display?: string }).display, 'display:block 被跳过（不传非法值）').toBeUndefined()
    expect((m.x as { height?: number }).height, '同规则其它合法声明仍在').toBe(10)
    const m2 = parseClassStyles('.y { display: flex; position: sticky }', () => {})
    expect((m2.y as { display?: string }).display, 'display:flex 合法保留').toBe('flex')
    expect((m2.y as { position?: string }).position, 'position:sticky 不支持 ⇒ 跳过').toBeUndefined()
    // 真机建树契约：折叠出的值必须在内核封闭集内
    const diag: string[] = []
    parseStaticStyle('display: inline-flex', (x) => diag.push(x))
    expect(diag.length, 'inline display:inline-flex 也诊断').toBeGreaterThan(0)
  })

  it('★⑦ 颜色归一：rgb()/rgba()/transparent → hex（内核只认 hex）', () => {
    // 【真机缺陷回归】rgba() 原样透传 ⇒ 内核 parse_css_color 拒绝 ⇒ 整树建不起来。现编译期归一。
    expect(normalizeCssColor('rgb(255, 255, 255)')).toBe('#ffffff')
    expect(normalizeCssColor('rgba(255, 255, 255, 0.8)')).toBe('#ffffffcc')
    expect(normalizeCssColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080')
    expect(normalizeCssColor('rgba(255,0,0,1)'), 'alpha=1 ⇒ 不透明，省略 alpha（#ff0000）').toBe('#ff0000')
    expect(normalizeCssColor('transparent')).toBe('#00000000')
    expect(normalizeCssColor('#FFF')).toBe('#fff')
    expect(normalizeCssColor('#12345678')).toBe('#12345678')
    expect(normalizeCssColor('red'), '★批次 14：命名色现支持 ⇒ #ff0000（Web 一致）').toBe('#ff0000')
    expect(normalizeCssColor('white'), '命名色 white').toBe('#ffffff')
    expect(normalizeCssColor('rebeccapurple'), '命名色 rebeccapurple').toBe('#663399')
    expect(normalizeCssColor('hsl(0,0%,0%)'), '★批次 15：hsl 现支持（Web 基准）⇒ #000000').toBe('#000000')
    // 端到端：<style> 里的 rgba 折成 hex
    const m = parseClassStyles('.c { color: rgba(255, 255, 255, 0.8) }')
    expect((m.c as { color?: string }).color, 'class 里的 rgba 归一为 hex').toBe('#ffffffcc')
  })

  it('★⑦b 颜色归一（批次 15 · ★基准 = Web）：4 位 hex / hsl / 现代语法 / alpha 越界→clamp', () => {
    // 【为什么（用户 2026-10-04「以 web 为基准对齐」）】凡 Web 合法的颜色形态都不得丢弃；
    //   Web 对越界 alpha 是 **clamp 到 1**（旧实现 >1 ⇒ /255 会把 rgba(...,2) 画成近乎透明，与 Web 不符）。
    // ① 4 位 hex #RGBA（Web 合法；内核不认 ⇒ 编译期展开为 8 位）
    expect(normalizeCssColor('#f00f'), '#RGBA 展开为 #RRGGBBAA').toBe('#ff0000ff')
    expect(normalizeCssColor('#0f08'), ' #RGBA 含 alpha').toBe('#00ff0088')
    // ② hsl / hsla（三种色相单位 + 现代空格/斜杠语法）
    expect(normalizeCssColor('hsl(0, 100%, 50%)'), 'hsl 红').toBe('#ff0000')
    expect(normalizeCssColor('hsl(120, 100%, 50%)'), 'hsl 绿').toBe('#00ff00')
    expect(normalizeCssColor('hsl(240 100% 50%)'), '现代空格语法').toBe('#0000ff')
    expect(normalizeCssColor('hsla(0, 100%, 50%, 0.5)'), 'hsla alpha').toBe('#ff000080')
    expect(normalizeCssColor('hsl(0 100% 50% / 50%)'), '现代斜杠 alpha').toBe('#ff000080')
    expect(normalizeCssColor('hsl(120deg, 100%, 50%)'), 'deg 单位').toBe('#00ff00')
    expect(normalizeCssColor('hsl(0.5turn, 100%, 50%)'), 'turn 单位').toBe('#00ffff')
    expect(normalizeCssColor('hsl(0, 0%, 50%)'), '无饱和 ⇒ 灰').toBe('#808080')
    // ③ 传统/现代 rgb 语法 + % 通道
    expect(normalizeCssColor('rgb(255 0 0)'), '现代空格 rgb').toBe('#ff0000')
    expect(normalizeCssColor('rgb(100%, 0%, 0%)'), '% 通道').toBe('#ff0000')
    expect(normalizeCssColor('rgb(255 0 0 / 0.5)'), '现代斜杠 alpha').toBe('#ff000080')
    // ④ alpha 按 Web 语义 clamp（越界 ⇒ 1 而非 /255）
    expect(normalizeCssColor('rgba(255, 0, 0, 2)'), 'alpha=2 ⇒ clamp 到 1（不透明，非 /255）').toBe('#ff0000')
    expect(normalizeCssColor('rgba(255, 0, 0, -1)'), 'alpha=-1 ⇒ clamp 到 0').toBe('#ff000000')
    // ⑤ 未支持（Web 合法但需运行时/CSS4 新空间）⇒ 诊断跳过（不猜）
    expect(normalizeCssColor('currentColor'), 'currentColor 需运行时 color ⇒ undefined').toBeUndefined()
    expect(normalizeCssColor('oklch(0.7 0.1 200)'), 'CSS4 新空间未支持').toBeUndefined()
  })

  it('★⑦c opacity 按 Web 语义 clamp 到 0..1（批次 15 · ★基准 = Web）', () => {
    // 【为什么（以 web 为基准）】Web 对 opacity 越界值一律夹取到 [0,1]；% 也收。
    const s1 = parseStaticStyle('opacity: 1.5', () => {})
    expect((s1 as { opacity?: number }).opacity, 'opacity:1.5 ⇒ clamp 到 1').toBe(1)
    const s2 = parseStaticStyle('opacity: -0.2', () => {})
    expect((s2 as { opacity?: number }).opacity, 'opacity:-0.2 ⇒ clamp 到 0').toBe(0)
    const s3 = parseStaticStyle('opacity: 0.35', () => {})
    expect((s3 as { opacity?: number }).opacity, '区间内原样').toBe(0.35)
    const s4 = parseStaticStyle('opacity: 50%', () => {})
    expect((s4 as { opacity?: number }).opacity, '百分比 ⇒ 0.5').toBe(0.5)
    const s5 = parseStaticStyle('opacity: 150%', () => {})
    expect((s5 as { opacity?: number }).opacity, '百分比越界 ⇒ clamp 到 1').toBe(1)
  })

  it('★⑦d text-overflow（批次 16 · ★基准 = Web）：ellipsis 折叠 + 继承 + 未知值诊断', () => {
    // 【为什么（以 web 为基准）】Web 默认 clip（不省略）；ellipsis ⇒ 单行行尾 … 截断（超级应用列表项刚需）。
    const s1 = parseStaticStyle('text-overflow: ellipsis', () => {})
    expect((s1 as { textOverflow?: string }).textOverflow, 'ellipsis 折叠').toBe('ellipsis')
    const s2 = parseStaticStyle('text-overflow: clip', () => {})
    expect((s2 as { textOverflow?: string }).textOverflow, 'clip 折叠').toBe('clip')
    // 大小写不敏感（Web）
    const s3 = parseStaticStyle('text-overflow: ELLIPSIS', () => {})
    expect((s3 as { textOverflow?: string }).textOverflow, '大小写不敏感').toBe('ellipsis')
    // 未知值 ⇒ 诊断 + 跳过（不猜；fade 是 Web 值但 App 不画渐隐）
    const diags: string[] = []
    const s4 = parseStaticStyle('text-overflow: fade', (m: string) => diags.push(m))
    expect((s4 as { textOverflow?: string }).textOverflow, '未知值不落字段').toBeUndefined()
    expect(diags.some((d) => d.includes('text-overflow')), '未知值有诊断').toBe(true)
    // 继承（CSS text-overflow 可继承）：父声明 ⇒ 子文本节点无显式值时继承
    const sfc = `<template>
      <view class="row">
        <text>一段很长的列表项文本内容</text>
      </view>
    </template>
    <style>
      .row { text-overflow: ellipsis; width: 120 }
    </style>`
    const r = buildLayoutTemplate(sfc, 'text-overflow-inherit.vue')
    const textNode = r.template.nodes.find((n) => (n as { text?: string }).text != null)
    expect((textNode?.style as { textOverflow?: string })?.textOverflow, '子文本节点继承 text-overflow').toBe('ellipsis')
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

// ★★★批次 3（CSS 兼容对齐 · 文本属性）：font-weight（真项目第 2 高频丢弃项）——2026-10-04
describe('★批次 3 · font-weight（关键字 + 数值归一）+ 继承', () => {
  it('① 关键字/数值归一为数值（normal→400 / bold→700 / 100–900）', () => {
    expect(parseStaticStyle('font-weight: normal', () => {}).fontWeight).toBe(400)
    expect(parseStaticStyle('font-weight: bold', () => {}).fontWeight).toBe(700)
    expect(parseStaticStyle('font-weight: 600', () => {}).fontWeight).toBe(600)
    expect(parseStaticStyle('font-weight: 900', () => {}).fontWeight).toBe(900)
  })

  it('①b bolder/lighter（依赖父级）⇒ 诊断跳过（不猜）', () => {
    const d: string[] = []
    const out = parseStaticStyle('font-weight: bolder', (m) => d.push(m))
    expect(out.fontWeight).toBeUndefined()
    expect(d.some((m) => m.includes('font-weight'))).toBe(true)
  })

  it('② 继承：font-weight 沿树向下传播（与 color/fontSize 同为文本可继承子集）', () => {
    const sfc = `<template>
      <view class="root"><text class="leaf">x</text></view>
    </template>
<script setup>const z = 1</script>
<style>
.root { font-weight: 700 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    expect((leaf?.style as { fontWeight?: number }).fontWeight, '字重继承到 text').toBe(700)
  })

  it('③ 端到端：font-weight 经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="t">x</view></template>
<script setup>const z = 1</script>
<style>
.t { font-weight: bold }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/t.vue')
    const n = r.template.nodes.find((x) => (x.style as { fontWeight?: number }).fontWeight)
    expect((n!.style as { fontWeight?: number }).fontWeight).toBe(700)
  })
})

// ★★★批次 4（CSS 兼容对齐 · 文本对齐）：text-align（真项目 28 处，22 center）——2026-10-04
describe('★批次 4 · text-align（封闭集 + 端到端）', () => {
  it('① 封闭集：left/center/right 折进；justify ⇒ 诊断跳过', () => {
    expect(parseStaticStyle('text-align: center', () => {}).textAlign).toBe('center')
    expect(parseStaticStyle('text-align: right', () => {}).textAlign).toBe('right')
    expect(parseStaticStyle('text-align: left', () => {}).textAlign).toBe('left')
    const d: string[] = []
    expect(parseStaticStyle('text-align: justify', (m) => d.push(m)).textAlign).toBeUndefined()
    expect(d.some((m) => m.includes('text-align'))).toBe(true)
  })

  it('② 端到端：text-align 经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="t">x</view></template>
<script setup>const z = 1</script>
<style>
.t { text-align: center }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/t.vue')
    const n = r.template.nodes.find((x) => (x.style as { textAlign?: string }).textAlign)
    expect((n!.style as { textAlign?: string }).textAlign).toBe('center')
  })
})

// ★★★批次 5（CSS 兼容对齐 · 边框）：border 简写 → borderWidth + borderColor（uniform）——2026-10-04
describe('★批次 5 · border 简写（uniform 实线）', () => {
  it('① `border: <width> <style> <color>` 任意顺序 → borderWidth + borderColor（颜色归一 hex）', () => {
    expect(parseStaticStyle('border: 1px solid #e3e6eb', () => {})).toEqual({ borderWidth: 1, borderColor: '#e3e6eb' })
    expect(parseStaticStyle('border: solid 2px rgba(0,0,0,0.35)', () => {})).toEqual({ borderWidth: 2, borderColor: '#00000059' })
  })

  it('② 逐边边框（border-bottom 等）⇒ 诊断跳过（仅支持统一边框）', () => {
    const d: string[] = []
    expect(parseStaticStyle('border-bottom: 1px solid #eee', (m) => d.push(m))).toEqual({})
    expect(d.some((m) => m.includes('逐边边框'))).toBe(true)
  })

  it('③ border-style 非 solid ⇒ 诊断（不静默当实线）；solid/none 无操作', () => {
    const d: string[] = []
    parseStaticStyle('border-style: dashed', (m) => d.push(m))
    expect(d.some((m) => m.includes('border-style'))).toBe(true)
    const d2: string[] = []
    parseStaticStyle('border-style: solid', (m) => d2.push(m))
    expect(d2.length).toBe(0)
  })

  it('④ var() 令牌色的边框 ⇒ 宽度保留、颜色诊断（诚实反映不可解析）', () => {
    const d: string[] = []
    const out = parseStaticStyle('border: 1px solid var(--sp-line)', (m) => d.push(m))
    expect(out.borderWidth).toBe(1)
    expect(out.borderColor, 'var() 不可编译期解析 ⇒ 无颜色').toBeUndefined()
    expect(d.some((m) => m.includes('var()'))).toBe(true)
  })

  it('⑤ 直接写 border-width/border-color（引擎折叠面）', () => {
    expect(parseStaticStyle('border-color: #cccccc; border-width: 2', () => {})).toEqual({ borderColor: '#cccccc', borderWidth: 2 })
  })

  it('⑥ 端到端：border 简写经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="card">x</view></template>
<script setup>const z = 1</script>
<style>
.card { border: 1px solid #ddd; border-radius: 8 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/card.vue')
    const n = r.template.nodes.find((x) => (x.style as { borderWidth?: number }).borderWidth)
    expect((n!.style as { borderWidth?: number }).borderWidth).toBe(1)
    expect((n!.style as { borderColor?: string }).borderColor).toBe('#ddd')
  })
})

// ★★★批次 6（CSS 兼容对齐 · [Rust] 布局）：flex-wrap（taffy 原生支持）——2026-10-04
describe('★批次 6 · flex-wrap（引擎闭合集 + 编译折叠）', () => {
  it('① 封闭集 nowrap/wrap/wrap-reverse 折进；未知值 ⇒ 诊断跳过', () => {
    expect(parseStaticStyle('flex-wrap: wrap', () => {}).flexWrap).toBe('wrap')
    expect(parseStaticStyle('flex-wrap: wrap-reverse', () => {}).flexWrap).toBe('wrap-reverse')
    expect(parseStaticStyle('flex-wrap: nowrap', () => {}).flexWrap).toBe('nowrap')
    const d: string[] = []
    expect(parseStaticStyle('flex-wrap: bogus', (m) => d.push(m)).flexWrap).toBeUndefined()
    expect(d.some((m) => m.includes('flexWrap'))).toBe(true)
  })

  it('② 端到端：flex-wrap 经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="wrap">x</view></template>
<script setup>const z = 1</script>
<style>
.wrap { display: flex; flex-direction: row; flex-wrap: wrap }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/w.vue')
    const n = r.template.nodes.find((x) => (x.style as { flexWrap?: string }).flexWrap)
    expect((n!.style as { flexWrap?: string }).flexWrap).toBe('wrap')
  })
})

// ★★★批次 7（CSS 兼容对齐 · flex 简写）：flex → flexGrow/flexShrink/flexBasis——2026-10-04
describe('★批次 7 · flex 简写（展开到引擎已支持的三字段）', () => {
  it('① `flex: <n>` ⇒ grow=n, shrink=1, basis=0（CSS 语义）', () => {
    expect(parseStaticStyle('flex: 1', () => {})).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 0 })
    expect(parseStaticStyle('flex: 2', () => {})).toEqual({ flexGrow: 2, flexShrink: 1, flexBasis: 0 })
  })

  it('② `flex: <g> <s> [<b>]` 三值形态', () => {
    expect(parseStaticStyle('flex: 1 0 auto', () => {}), 'auto basis 略过').toEqual({ flexGrow: 1, flexShrink: 0 })
    expect(parseStaticStyle('flex: 2 1 40px', () => {})).toEqual({ flexGrow: 2, flexShrink: 1, flexBasis: 40 })
  })

  it('③ 关键字 none/auto', () => {
    expect(parseStaticStyle('flex: none', () => {})).toEqual({ flexGrow: 0, flexShrink: 0 })
    expect(parseStaticStyle('flex: auto', () => {})).toEqual({ flexGrow: 1, flexShrink: 1 })
  })

  it('④ 非法值 ⇒ 诊断跳过', () => {
    const d: string[] = []
    expect(parseStaticStyle('flex: bogus', (m) => d.push(m))).toEqual({})
    expect(d.some((m) => m.includes('flex'))).toBe(true)
  })

  it('⑤ 端到端：flex: 1 经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="grow">x</view></template>
<script setup>const z = 1</script>
<style>
.grow { flex: 1 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/g.vue')
    const n = r.template.nodes.find((x) => (x.style as { flexGrow?: number }).flexGrow)
    expect((n!.style as { flexGrow?: number }).flexGrow).toBe(1)
    expect((n!.style as { flexShrink?: number }).flexShrink).toBe(1)
  })
})

// ★★★批次 8（CSS 兼容对齐 · [Rust] 定位）：right/bottom（超级应用刚需）——2026-10-04
describe('★批次 8 · right/bottom（absolute 定位）', () => {
  it('① 数值/px 折进（与 top/left 同解析路径）', () => {
    expect(parseStaticStyle('right: 0; bottom: 0', () => {})).toEqual({ right: 0, bottom: 0 })
    expect(parseStaticStyle('right: 26px; bottom: -40px', () => {})).toEqual({ right: 26, bottom: -40 })
  })

  it('② 端到端：角标定位（position:absolute; right; bottom）折进节点 style', () => {
    const sfc = `<template><view class="badge">3</view></template>
<script setup>const z = 1</script>
<style>
.badge { position: absolute; right: 6; bottom: 6 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/b.vue')
    const n = r.template.nodes.find((x) => (x.style as { right?: number }).right !== undefined)
    expect((n!.style as { right?: number }).right).toBe(6)
    expect((n!.style as { bottom?: number }).bottom).toBe(6)
    expect((n!.style as { position?: string }).position).toBe('absolute')
  })
})

// ★★★批次 9（CSS 兼容对齐 · 超级应用承载）：CSS 自定义属性（设计令牌）编译期折叠——2026-10-04
describe('★批次 9 · CSS 变量（var() 令牌）编译期折叠', () => {
  it('① parseCssVarTokens：解析 --name: value（含注释剔除）', () => {
    const t = parseCssVarTokens('/* c */ :root { --sp-3: 12px; --text: #1c1b22; --brand-soft: rgba(124, 92, 255, 0.10) }')
    expect(t['--sp-3']).toBe('12px')
    expect(t['--text']).toBe('#1c1b22')
    expect(t['--brand-soft']).toBe('rgba(124, 92, 255, 0.10)')
  })

  it('② substituteCssVars：递归展开 + fallback + 未知保留', () => {
    const t = parseCssVarTokens('--a: var(--b); --b: 8px; --c: #fff')
    expect(substituteCssVars('var(--a)', t), '递归 --a→--b→8px').toBe('8px')
    expect(substituteCssVars('var(--missing, 4px)', t), 'fallback').toBe('4px')
    expect(substituteCssVars('var(--missing)', t), '未知无 fallback ⇒ 原样').toBe('var(--missing)')
  })

  it('③ parseStaticStyle + tokens：令牌值折进引擎字段（长度/颜色/多值简写）', () => {
    const t = parseCssVarTokens('--sp-3: 12px; --sp-text: #1c1b22; --gap: 8px')
    expect(parseStaticStyle('padding: var(--sp-3)', () => {}, undefined, t)).toEqual({ padding: { top: 12, right: 12, bottom: 12, left: 12 } })
    expect(parseStaticStyle('color: var(--sp-text)', () => {}, undefined, t)).toEqual({ color: '#1c1b22' })
    expect(parseStaticStyle('padding: var(--sp-3) var(--gap)', () => {}, undefined, t)).toEqual({ padding: { top: 12, right: 8, bottom: 12, left: 8 } })
  })

  it('④ 无 tokens（null）⇒ var() 不折（原样，走既有诊断——不静默）', () => {
    const d: string[] = []
    expect(parseStaticStyle('padding: var(--sp-3)', (m) => d.push(m))).toEqual({})
    expect(d.length).toBeGreaterThan(0)
  })

  it('⑤ 端到端：<style> class 里的 var() 经 tokens 折进节点 style', () => {
    const tokens = parseCssVarTokens('--sp-3: 12px; --line: #e8e9f0; --radius-md: 12px')
    const sfc = `<template><view class="card">x</view></template>
<script setup>const z = 1</script>
<style>
.card { padding: var(--sp-3); border-radius: var(--radius-md); background-color: var(--line) }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/card.vue', undefined, tokens)
    const n = r.template.nodes.find((x) => (x.style as { borderRadius?: number }).borderRadius === 12)
    expect((n!.style as { padding?: unknown }).padding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
    expect((n!.style as { backgroundColor?: string }).backgroundColor).toBe('#e8e9f0')
  })
})

// ★★★批次 10（CSS 兼容对齐 · 超级应用视觉）：box-shadow——2026-10-04
describe('★批次 10 · box-shadow（结构化 + 三端宿主绘制）', () => {
  it('① 单层解析：dx/dy/blur[/spread]/color（颜色归一 hex）', () => {
    expect(parseStaticStyle('box-shadow: 0 2px 8px rgba(0,0,0,0.15)', () => {}).boxShadow).toEqual({ dx: 0, dy: 2, blur: 8, spread: 0, color: '#00000026' })
    expect(parseStaticStyle('box-shadow: 0 0 4px 2px #123456', () => {}).boxShadow).toEqual({ dx: 0, dy: 0, blur: 4, spread: 2, color: '#123456' })
  })

  it('② 多重阴影取首个（含 rgba 内逗号不误切）；inset ⇒ 诊断跳过', () => {
    const multi = parseStaticStyle('box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.08)', () => {}).boxShadow
    expect((multi as { dy?: number }).dy, '取首个（dy=1）').toBe(1)
    const d: string[] = []
    expect(parseStaticStyle('box-shadow: inset 0 1px 2px #000', (m) => d.push(m)).boxShadow).toBeUndefined()
    expect(d.some((m) => m.includes('box-shadow'))).toBe(true)
  })

  it('③ 端到端：box-shadow 经 <style> class 折进节点 style（结构化对象）', () => {
    const sfc = `<template><view class="card">x</view></template>
<script setup>const z = 1</script>
<style>
.card { box-shadow: 0 4px 14px rgba(28,27,34,0.08) }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/card.vue')
    const n = r.template.nodes.find((x) => (x.style as { boxShadow?: unknown }).boxShadow)
    expect((n!.style as { boxShadow?: { blur?: number } }).boxShadow?.blur).toBe(14)
  })
})

// ★★★批次 11（CSS 兼容对齐 · [Rust] 布局）：align-content——2026-10-04
describe('★批次 11 · align-content（多行容器行间对齐）', () => {
  it('① open string：center/space-between 等折进（未知值原样交引擎落默认）', () => {
    expect(parseStaticStyle('align-content: center', () => {}).alignContent).toBe('center')
    expect(parseStaticStyle('align-content: space-between', () => {}).alignContent).toBe('space-between')
    expect(parseStaticStyle('align-content: stretch', () => {}).alignContent).toBe('stretch')
  })

  it('② 端到端：wrap 容器 + align-content 折进节点 style', () => {
    const sfc = `<template><view class="tags">x</view></template>
<script setup>const z = 1</script>
<style>
.tags { display: flex; flex-direction: row; flex-wrap: wrap; align-content: center }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/tags.vue')
    const n = r.template.nodes.find((x) => (x.style as { alignContent?: string }).alignContent)
    expect((n!.style as { alignContent?: string }).alignContent).toBe('center')
  })
})

// ★★★批次 12（CSS 兼容对齐 · [Rust] 栅格）：CSS Grid 显式轨迹——2026-10-04
describe('★批次 12 · CSS Grid（display:grid + 显式轨迹）', () => {
  it('① display: grid 入封闭集', () => {
    expect(parseStaticStyle('display: grid', () => {})).toEqual({ display: 'grid' })
  })

  it('② 显式轨迹 fr/px/数字；repeat(n, X) 展开', () => {
    expect(parseStaticStyle('grid-template-columns: 1fr 1fr 200px', () => {}).gridTemplateColumns).toBe('1fr 1fr 200px')
    expect(parseStaticStyle('grid-template-columns: repeat(3, 1fr)', () => {}).gridTemplateColumns).toBe('1fr 1fr 1fr')
    expect(parseStaticStyle('grid-template-columns: 200px repeat(2, 1fr)', () => {}).gridTemplateColumns).toBe('200px 1fr 1fr')
    expect(parseStaticStyle('grid-template-rows: 100px 100px', () => {}).gridTemplateRows).toBe('100px 100px')
  })

  it('③ 未支持形态（auto/minmax）⇒ 诊断跳过（不猜）', () => {
    const d: string[] = []
    expect(parseStaticStyle('grid-template-columns: auto 1fr', (m) => d.push(m)).gridTemplateColumns).toBeUndefined()
    expect(d.some((m) => m.includes('grid-template'))).toBe(true)
  })

  it('④ 端到端：grid 容器经 <style> class 折进节点 style', () => {
    const sfc = `<template><view class="dash">x</view></template>
<script setup>const z = 1</script>
<style>
.dash { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/dash.vue')
    const n = r.template.nodes.find((x) => (x.style as { display?: string }).display === 'grid')
    expect((n!.style as { gridTemplateColumns?: string }).gridTemplateColumns).toBe('1fr 1fr')
    expect((n!.style as { gap?: number }).gap).toBe(12)
  })
})

// ★★★批次 13（CSS 兼容对齐 · 超级应用文本排版）：line-height——2026-10-04
describe('★批次 13 · line-height（行盒高）', () => {
  it('① 无单位倍数 / 百分比 / 绝对 px 归一为 token', () => {
    expect(parseStaticStyle('line-height: 1.6', () => {}).lineHeight).toBe('1.6')
    expect(parseStaticStyle('line-height: 160%', () => {}).lineHeight).toBe('1.6')
    expect(parseStaticStyle('line-height: 24px', () => {}).lineHeight).toBe('24px')
  })

  it('② normal / 非法 ⇒ 诊断跳过', () => {
    const d: string[] = []
    expect(parseStaticStyle('line-height: normal', (m) => d.push(m)).lineHeight).toBeUndefined()
    expect(d.some((m) => m.includes('line-height'))).toBe(true)
  })

  it('③ 继承：line-height 沿树向下传播（文本可继承子集）', () => {
    const sfc = `<template><view class="root"><text class="leaf">x</text></view></template>
<script setup>const z = 1</script>
<style>
.root { line-height: 1.7 }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    expect((leaf?.style as { lineHeight?: string }).lineHeight, '行高继承到 text').toBe('1.7')
  })
})

// ★★★批次 14（多端一致性审计修）：把「App 折叠但与 Web 语义不一致」的项对齐 CSS 标准——2026-10-04
describe('★批次 14 · 多端一致性审计修（对齐 CSS 标准）', () => {
  it('① 命名色（Web 生效）现归一为 hex —— 此前丢弃致 App 失样式', () => {
    expect(normalizeCssColor('red')).toBe('#ff0000')
    expect(normalizeCssColor('Blue')).toBe('#0000ff')
    expect(normalizeCssColor('white')).toBe('#ffffff')
    expect(parseStaticStyle('color: red', () => {}).color).toBe('#ff0000')
    expect(parseStaticStyle('background-color: white', () => {}).backgroundColor).toBe('#ffffff')
  })

  it('② 非 solid 边框线型 ⇒ **诊断跳过**（不静默画成实线冒充 Web 虚线）', () => {
    const d: string[] = []
    expect(parseStaticStyle('border: 1px dashed #ccc', (m) => d.push(m))).toEqual({})
    expect(d.some((m) => m.includes('dashed'))).toBe(true)
    // solid 仍正常
    expect(parseStaticStyle('border: 1px solid #ccc', () => {})).toEqual({ borderWidth: 1, borderColor: '#ccc' })
  })

  it('③ text-align 作为**继承**属性沿树传播（CSS 标准）', () => {
    const sfc = `<template><view class="root"><view class="mid"><text class="leaf">x</text></view></view></template>
<script setup>const z = 1</script>
<style>
.root { text-align: center }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/s.vue')
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    expect((leaf?.style as { textAlign?: string }).textAlign, 'text-align 继承到深层 text').toBe('center')
  })

  it('④ 枚举关键字**大小写不敏感**（CSS：`display: FLEX` Web 生效）', () => {
    expect(parseStaticStyle('display: FLEX', () => {}).display).toBe('flex')
    expect(parseStaticStyle('overflow: HIDDEN', () => {}).overflow).toBe('hidden')
    expect(parseStaticStyle('flex-direction: ROW-REVERSE', () => {}).flexDirection).toBe('row-reverse')
    expect(parseStaticStyle('justify-content: CENTER', () => {}).justifyContent).toBe('center')
    const d: string[] = []
    expect(parseStaticStyle('display: bogus', (m) => d.push(m)).display, '真非法仍诊断').toBeUndefined()
    expect(d.length).toBeGreaterThan(0)
  })

  it('⑤ box-sizing 非 border-box（App 恒 border-box）⇒ 诊断', () => {
    const d: string[] = []
    parseStaticStyle('box-sizing: content-box', (m) => d.push(m))
    expect(d.some((m) => m.includes('box-sizing'))).toBe(true)
  })
})

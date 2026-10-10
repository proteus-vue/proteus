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
import { buildLayoutTemplate, parseClassStyles, parseStaticStyle, stripScopeSuffix, normalizeCssColor, parseCssVarTokens, substituteCssVars, parseKeyframes } from '@proteus-vue/compiler'

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
    //   ★批次 26/27：`display:block` = App 默认（flex-direction:column·block-like）⇒ 记为 flex（重置值，非非法值）。
    const m = parseClassStyles('.x { display: block; height: 10 }', () => {})
    expect((m.x as { display?: string }).display, 'display:block ⇒ 空记录（App 默认 block-like，不落键）').toBeUndefined()
    expect((m.x as { height?: number }).height, '同规则其它合法声明仍在').toBe(10)
    const mIf = parseClassStyles('.z { display: inline-flex; height: 5 }', () => {})
    expect((mIf.z as { display?: string }).display, 'display:inline-flex 不支持 ⇒ 跳过（不传非法值）').toBeUndefined()
    const m2 = parseClassStyles('.y { display: flex; position: sticky }', () => {})
    expect((m2.y as { display?: string }).display, 'display:flex 合法保留').toBe('flex')
    // ★批 A（2026-10-08 · 决策 #651）：sticky/fixed 已入内核 position 枚举 ⇒ 不再跳过、如实保留
    expect((m2.y as { position?: string }).position, 'position:sticky 现支持 ⇒ 保留').toBe('sticky')
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

  it('★⑦e margin auto（批次 17 · ★基准 = Web）：margin:0 auto 折出 marginAuto 标记', () => {
    // 【为什么（以 web 为基准）】Web 里 margin:0 auto 把剩余空间平分到左右 ⇒ 水平居中；
    //   此前 auto 被**静默丢弃** ⇒ App 不居中（Web 居中）＝静默多端不一致。
    const s1 = parseStaticStyle('margin: 0 auto', () => {})
    expect((s1 as { margin?: Record<string, number> }).margin, '上下数值').toEqual({ top: 0, bottom: 0 })
    expect((s1 as { marginAuto?: Record<string, boolean> }).marginAuto, '左右 auto').toEqual({ left: true, right: true })
    // 简写 auto（四边）
    const s2 = parseStaticStyle('margin: auto', () => {})
    expect((s2 as { marginAuto?: Record<string, boolean> }).marginAuto).toEqual({ top: true, right: true, bottom: true, left: true })
    // 逐边
    const s3 = parseStaticStyle('margin-left: auto', () => {})
    expect((s3 as { marginAuto?: Record<string, boolean> }).marginAuto, '逐边 auto').toEqual({ left: true })
    // 普通数值 margin 不产 marginAuto（零行为变化）
    const s4 = parseStaticStyle('margin: 8px 12px', () => {})
    expect((s4 as { marginAuto?: Record<string, boolean> }).marginAuto, '无 auto ⇒ 不产标记').toBeUndefined()
    expect((s4 as { margin?: Record<string, number> }).margin).toEqual({ top: 8, right: 12, bottom: 8, left: 12 })
    // 混合：margin: 0 auto 12px —— 三值展开
    const s5 = parseStaticStyle('margin: 0 auto 12px', () => {})
    expect((s5 as { margin?: Record<string, number> }).margin, 'top/bottom 数值').toEqual({ top: 0, bottom: 12 })
    expect((s5 as { marginAuto?: Record<string, boolean> }).marginAuto, '左右 auto').toEqual({ left: true, right: true })
  })

  it('★⑦f border-radius 百分比（批次 18 · ★基准 = Web）：50% 折为 borderRadiusPct', () => {
    // 【为什么（以 web 为基准）】Web border-radius:50% = 内切圆/椭圆（头像/圆点）；此前被丢弃。
    const s1 = parseStaticStyle('border-radius: 50%', () => {})
    expect((s1 as { borderRadiusPct?: number }).borderRadiusPct, '50% ⇒ 0.5').toBe(0.5)
    const s2 = parseStaticStyle('border-radius: 100%', () => {})
    expect((s2 as { borderRadiusPct?: number }).borderRadiusPct, '100% ⇒ 1').toBe(1)
    // 数值圆角仍走 borderRadius（既有，零行为变化）
    const s3 = parseStaticStyle('border-radius: 8px', () => {})
    expect((s3 as { borderRadius?: number }).borderRadius, 'px 圆角').toBe(8)
    expect((s3 as { borderRadiusPct?: number }).borderRadiusPct, 'px 不产 pct').toBeUndefined()
    // 多值逐角简写未支持 ⇒ 诊断（不猜）
    const d: string[] = []
    const s4 = parseStaticStyle('border-radius: 8px 4px', (m: string) => d.push(m))
    expect((s4 as { borderRadius?: number }).borderRadius, '多值不落字段').toBeUndefined()
    expect(d.some((x) => x.includes('border-radius')), '多值有诊断').toBe(true)
  })

  it('★⑦g min/max 百分比（批次 19 · ★基准 = Web）：折为 *Pct 派生字段', () => {
    // 【为什么（以 web 为基准）】max-width:100%（不溢出容器）/ min-height:100% 常用；此前被丢弃。
    const s1 = parseStaticStyle('max-width: 100%', () => {})
    expect((s1 as { maxWidthPct?: number }).maxWidthPct, 'max-width:100% ⇒ 1').toBe(1)
    const s2 = parseStaticStyle('min-height: 50%', () => {})
    expect((s2 as { minHeightPct?: number }).minHeightPct, 'min-height:50% ⇒ 0.5').toBe(0.5)
    const s3 = parseStaticStyle('min-width: 33.33%', () => {})
    expect((s3 as { minWidthPct?: number }).minWidthPct, 'min-width:33.33%').toBeCloseTo(0.3333, 4)
    // 数值 min/max 仍走绝对值（既有，零行为变化）
    const s4 = parseStaticStyle('max-width: 320px', () => {})
    expect((s4 as { maxWidth?: number }).maxWidth, 'px max').toBe(320)
    expect((s4 as { maxWidthPct?: number }).maxWidthPct, 'px 不产 Pct').toBeUndefined()
  })

  it('★⑦h letter-spacing（批次 20 · ★基准 = Web）：px 折值 + normal 不发射 + 继承', () => {
    // 【为什么（以 web 为基准）】字距是排版能力；Web normal = 0；px 字距常用。作为文本可继承属性。
    const s1 = parseStaticStyle('letter-spacing: 2px', () => {})
    expect((s1 as { letterSpacing?: number }).letterSpacing, 'px 字距').toBe(2)
    const s2 = parseStaticStyle('letter-spacing: 0.5', () => {})
    expect((s2 as { letterSpacing?: number }).letterSpacing, '数字字距').toBe(0.5)
    // normal = 默认 ⇒ 不发射（零行为变化）
    const s3 = parseStaticStyle('letter-spacing: normal', () => {})
    expect((s3 as { letterSpacing?: number }).letterSpacing, 'normal 不发射').toBeUndefined()
    // em 未支持 ⇒ 诊断
    const d: string[] = []
    parseStaticStyle('letter-spacing: 1.5em', (m: string) => d.push(m))
    expect(d.some((x) => x.includes('letter-spacing')), 'em 有诊断').toBe(true)
  })

  it('★⑦i rpx 折 px（批次 21 · 多端一致）：1rpx = 0.5px（rpxRatio:2 逆）', () => {
    // 【为什么（以 web 为基准）】rpx 是小程序 750 设计单位；Web 端由浏览器/平台处理；
    //   App 折叠此前**丢弃 rpx** ⇒ 真项目（125 处）失样式（尺寸/圆角/字号全丢）。
    //   折为 px（×0.5）＝ 与 rpxRatio:2（px→rpx）互为逆，跨端一致。
    const s1 = parseStaticStyle('width: 100rpx', () => {})
    expect((s1 as { width?: number }).width, '100rpx ⇒ 50px').toBe(50)
    const s2 = parseStaticStyle('font-size: 32rpx', () => {})
    expect((s2 as { fontSize?: number }).fontSize, '32rpx ⇒ 16px').toBe(16)
    const s3 = parseStaticStyle('padding: 16rpx 8rpx', () => {})
    expect((s3 as { padding?: Record<string, number> }).padding, '简写混 rpx').toEqual({ top: 8, right: 4, bottom: 8, left: 4 })
    const s4 = parseStaticStyle('border-radius: 12rpx', () => {})
    expect((s4 as { borderRadius?: number }).borderRadius, '圆角 rpx').toBe(6)
    const s5 = parseStaticStyle('line-height: 40rpx', () => {})
    expect((s5 as { lineHeight?: string }).lineHeight, 'line-height rpx ⇒ px token').toBe('20px')
  })

  it('★⑦j calc() 常量折叠（批次 22 · ★设计令牌算术）：var() 已置换 ⇒ 常量求值', () => {
    // 【为什么（以 web 为基准）】组件库 64 处 calc(var(--x) * N)（间距/字号刻度）；var() 已在前置换。
    const s1 = parseStaticStyle('width: calc(8px * 0.6)', () => {})
    expect((s1 as { width?: number }).width, '乘').toBe(4.8)
    const s2 = parseStaticStyle('padding: calc(4px + 2px)', () => {})
    expect((s2 as { padding?: Record<string, number> }).padding, '加（简写不切碎）').toEqual({ top: 6, right: 6, bottom: 6, left: 6 })
    const s3 = parseStaticStyle('font-size: calc(16px * 1.15)', () => {})
    expect((s3 as { fontSize?: number }).fontSize, '字号刻度').toBe(18.4)
    const s4 = parseStaticStyle('gap: calc(10px / 2)', () => {})
    expect((s4 as { gap?: number }).gap, '除').toBe(5)
    const s5 = parseStaticStyle('margin: calc((4px + 2px) * 2)', () => {})
    expect((s5 as { margin?: Record<string, number> }).margin, '括号').toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
    // 含 % / 相对单位 ⇒ 无上下文不可求值 ⇒ 诊断（不猜）
    const d: string[] = []
    parseStaticStyle('width: calc(100% - 20px)', (m: string) => d.push(m))
    expect(d.length > 0, '% 含入 ⇒ 诊断').toBe(true)
    const d2: string[] = []
    parseStaticStyle('font-size: calc(0.4em + 10px)', (m: string) => d2.push(m))
    expect(d2.length > 0, 'em 含入 ⇒ 诊断').toBe(true)
  })

  it('★⑦k color-mix(in srgb, …)（批次 23 · ★基准 = Web）：常量折叠（设计令牌着色）', () => {
    // 【为什么（以 web 为基准）】组件库 16 处 color-mix 着色/淡化；var() 已置换 ⇒ 两色已知 ⇒ 编译期混合。
    // 色 + 透明（alpha 缩放）：20% 黑 + 80% 透 ⇒ alpha 0.2、色黑
    expect(normalizeCssColor('color-mix(in srgb, #000 20%, transparent)'), '20% 黑 + 透').toBe('#00000033')
    expect(normalizeCssColor('color-mix(in srgb, #ffb13d 18%, transparent)'), '18% 橙').toBe('#ffb13d2e')
    // 两不透明色按权混：10% 黑 + 90% 白 ⇒ #e6e6e6
    expect(normalizeCssColor('color-mix(in srgb, #000000 10%, #ffffff 90%)'), '黑白混').toBe('#e6e6e6')
    // 缺省权重 50/50 + 命名色
    expect(normalizeCssColor('color-mix(in srgb, red, blue)'), 'red/blue 50/50').toBe('#800080')
    // 非 srgb 色彩空间 ⇒ 未支持（诊断）
    expect(normalizeCssColor('color-mix(in oklab, #000 10%, #fff)'), 'oklab 未支持').toBeUndefined()
    // 端到端：border 简写里的 color-mix（括号感知切分）
    const s = parseStaticStyle('border: 1px solid color-mix(in srgb, #000 12%, transparent)', () => {})
    expect((s as { borderColor?: string }).borderColor, 'border 内 color-mix').toBe('#0000001f')
  })

  it('★⑦l aspect-ratio（批次 24 · ★基准 = Web）：数值 + 分数 + auto 不发射', () => {
    // 【为什么（以 web 为基准）】媒体卡/占位图宽高比；Web <n> / <w>/<h>；auto = 默认。
    const s1 = parseStaticStyle('aspect-ratio: 1.5', () => {})
    expect((s1 as { aspectRatio?: number }).aspectRatio, '1.5').toBe(1.5)
    const s2 = parseStaticStyle('aspect-ratio: 16/9', () => {})
    expect((s2 as { aspectRatio?: number }).aspectRatio, '16/9').toBeCloseTo(1.7778, 3)
    const s3 = parseStaticStyle('aspect-ratio: 4 / 3', () => {})
    expect((s3 as { aspectRatio?: number }).aspectRatio, '带空格 4 / 3').toBeCloseTo(1.3333, 3)
    const s4 = parseStaticStyle('aspect-ratio: auto', () => {})
    expect((s4 as { aspectRatio?: number }).aspectRatio, 'auto 不发射').toBeUndefined()
    const d: string[] = []
    parseStaticStyle('aspect-ratio: abc', (m: string) => d.push(m))
    expect(d.length > 0, '非法值诊断').toBe(true)
  })

  it('★⑦m visibility（批次 25 · ★基准 = Web）：hidden/visible + 继承 + 覆盖', () => {
    // 【为什么（以 web 为基准）】visibility:hidden 保留布局（≠display:none）；且可继承、子 visible 可覆盖。
    const s1 = parseStaticStyle('visibility: hidden', () => {})
    expect((s1 as { visibility?: string }).visibility, 'hidden').toBe('hidden')
    const d: string[] = []
    parseStaticStyle('visibility: collapse', (m: string) => d.push(m))
    expect(d.length > 0, 'collapse 诊断').toBe(true)
    // 继承 + 覆盖：父 hidden ⇒ 子继承；子显式 visible 覆盖
    const sfc = `<template>
      <view class="gone"><text>父隐藏</text><text class="show">子覆盖</text></view>
    </template>
    <style>
      .gone { visibility: hidden }
      .show { visibility: visible }
    </style>`
    const r = buildLayoutTemplate(sfc, 'vis-inherit.vue')
    const textNodes = r.template.nodes.filter((n) => (n as { text?: string }).text)
    const inherited = textNodes.find((n) => (n as { text?: string }).text === '父隐藏')
    const overridden = textNodes.find((n) => (n as { text?: string }).text === '子覆盖')
    expect((inherited?.style as { visibility?: string })?.visibility, '子继承父 hidden').toBe('hidden')
    expect((overridden?.style as { visibility?: string })?.visibility, '子 visible 覆盖').toBe('visible')
  })

  it('★⑦n Web 默认值/重置声明（批次 26/27）：不诊断；有 App 字段的记默认值', () => {
    // 【为什么（以 web 为基准）】这些是「无视觉变化」或「= App 默认」的写法；报成缺口是假阳性。
    //   ★批次 27：有 App 字段的**必须记录默认值**（否则 `.b{border:none}` 覆盖不了 `.a{border:1px}`）。
    // 无 App 字段 ⇒ 空记录（不落键）：text-decoration / background-image
    for (const css of ['text-decoration: none', 'background-image: none']) {
      const d: string[] = []
      const out = parseStaticStyle(css, (m: string) => d.push(m))
      expect(d.length, css + ' 不应诊断').toBe(0)
      expect(Object.keys(out).length, css + ' 不应落键').toBe(0)
    }
    // ★★★outline 族项（2026-10-08）：outline 已成真字段 ⇒ `outline:none` 记**重置**（轮廓宽=0，级联覆盖生效）
    {
      const d: string[] = []
      const out = parseStaticStyle('outline: none', (m: string) => d.push(m))
      expect(d.length, 'outline: none 不应诊断').toBe(0)
      expect(out.outlineWidth, 'outline: none → outlineWidth=0（重置，可级联覆盖）').toBe(0)
    }
    // ★批次 39：transform 已成真字段 ⇒ `transform:none` 记录重置（null），级联能覆盖低优先级的 translate/scale/rotate
    expect((parseStaticStyle('transform: none', () => {}) as { transform?: unknown }).transform, 'transform:none ⇒ 重置 null').toBeNull()
    // 有 App 字段 ⇒ 记默认值（重置语义）
    expect((parseStaticStyle('border: none', () => {}) as { borderWidth?: number }).borderWidth, 'border:none ⇒ borderWidth 0').toBe(0)
    expect((parseStaticStyle('background: none', () => {}) as { backgroundColor?: string }).backgroundColor, 'background:none ⇒ 透明').toBe('#00000000')
    expect((parseStaticStyle('display: block', () => {}) as { display?: string }).display, 'display:block ⇒ 空记录（App 默认 block-like）').toBeUndefined()
    // ★批次 29：overflow-x|y:visible（默认）⇒ no-op 不诊断
    for (const css of ['overflow-x: visible', 'overflow-y: visible']) {
      const d: string[] = []
      parseStaticStyle(css, (m: string) => d.push(m))
      expect(d.length, css + ' 不应诊断').toBe(0)
    }
    // ★★全端对齐批（2026-10-05 · white-space 五端对齐）：现为**真字段**（透传宿主）——
    //   合法关键字落键不诊断；break-spaces 归一 pre-wrap；非法值诊断。
    for (const [css, expectVal] of [
      ['white-space: nowrap', 'nowrap'],
      ['white-space: pre', 'pre'],
      ['white-space: pre-wrap', 'pre-wrap'],
      ['white-space: pre-line', 'pre-line'],
      ['white-space: normal', 'normal'],
      ['white-space: break-spaces', 'pre-wrap'],
    ] as const) {
      const d: string[] = []
      const out = parseStaticStyle(css, (m: string) => d.push(m))
      expect(d.length, css + ' 不应诊断').toBe(0)
      expect((out as { whiteSpace?: string }).whiteSpace, css + ' 值应落键').toBe(expectVal)
    }
    const dw: string[] = []
    parseStaticStyle('white-space: balance', (m: string) => dw.push(m))
    expect(dw.length > 0, 'white-space:balance（非法值）仍诊断').toBe(true)
    // ★★★Stage 2（2026-10-09 · 决策 #595）：min-height:100vh **折为内置视口变量** env:--pf-vh
    //   （宿主用真实视口解析——此前是 minHeightPct=1 近似；改为与 Web 同语义的真视口单位）。
    const vhOut = parseStaticStyle('min-height: 100vh', () => {}) as { minHeight?: string }
    expect(vhOut.minHeight, 'min-height:100vh ⇒ env:--pf-vh').toBe('env:--pf-vh')
    // ★★★overflow-x 项（2026-10-06）：overflow-y:hidden **已实现**（逐轴字段直传）——不再是缺口；
    //   级联后的形态收敛由 normalizeOverflowFields 处理（归一 visible→auto）。
    const dy: string[] = []
    const oy = parseStaticStyle('overflow-y: hidden', (m: string) => dy.push(m)) as { overflowY?: string }
    expect(dy.length, 'overflow-y:hidden 不应诊断（已实现）').toBe(0)
    expect(oy.overflowY, 'overflow-y:hidden 直传逐轴字段').toBe('hidden')
    // 真缺口仍诊断（inline 才是不支持；block 是默认）
    const d2: string[] = []
    parseStaticStyle('display: inline', (m: string) => d2.push(m))
    expect(d2.length > 0, 'display:inline 仍诊断').toBe(true)
    // ★批次 39：transform 已支持 2D 子集 ⇒ 未支持的是 3D/skew/matrix（此处用 skewX 验证仍诊断）
    const d3: string[] = []
    parseStaticStyle('transform: skewX(10deg)', (m: string) => d3.push(m))
    expect(d3.length > 0, 'transform:skewX 仍诊断（3D/skew 未支持）').toBe(true)
  })

  it('★⑦o 重置声明的级联覆盖（批次 27 · 修级联缺陷）：b 类 border:none 覆盖 a 类 border:1px', () => {
    // 【为什么（以 web 为基准）】高优先级重置声明必须覆盖低优先级声明；此前**直接 skip** ⇒ 覆盖失效。
    const sfc = `<template>
      <view class="a b"><text>x</text></view>
    </template>
    <style>
      .a { border: 1px solid #cccccc }
      .b { border: none }
    </style>`
    const r = buildLayoutTemplate(sfc, 'cascade-reset.vue')
    const v = r.template.nodes.find((n) => (n as { tag?: string }).tag === 'view')
    expect((v?.style as { borderWidth?: number })?.borderWidth, '重置覆盖 ⇒ borderWidth 0').toBe(0)
  })

  it('★⑦p inherit 关键字（批次 28 · ★基准 = Web）：显式取父值', () => {
    // 【为什么（以 web 为基准）】`color: inherit` 等 = 显式取父 computed 值（覆盖低优先级声明）。
    expect((parseStaticStyle('color: inherit', () => {}) as { color?: string }).color, 'color inherit 记哨兵').toBe('inherit')
    const sfc = `<template>
      <view class="row"><text class="b">B</text></view>
    </template>
    <style>
      .row { color: #ff0000; font-size: 20px }
      .b { color: inherit; font-size: inherit }
    </style>`
    const r = buildLayoutTemplate(sfc, 'inherit-kw.vue')
    const t = r.template.nodes.find((n) => (n as { text?: string }).text === 'B')
    expect((t?.style as { color?: string })?.color, 'inherit ⇒ 父 color').toBe('#ff0000')
    expect((t?.style as { fontSize?: number })?.fontSize, 'inherit ⇒ 父 fontSize').toBe(20)
    // 非可继承字段的 inherit 不落键、不诊断（无法在编译期解析）
    const d: string[] = []
    const w = parseStaticStyle('width: inherit', (m: string) => d.push(m))
    expect((w as { width?: number }).width, 'width:inherit 不落键').toBeUndefined()
    expect(d.length, 'width:inherit 不诊断').toBe(0)
  })

  it('★⑦q 两值 gap / row-gap / column-gap（批次 31 · ★基准 = Web）', () => {
    // 【为什么（以 web 为基准）】gap:<row> <col> 与 row-gap/column-gap 是标准写法；此前只支持单值。
    expect((parseStaticStyle('gap: 8px', () => {}) as { gap?: number }).gap, '单值 ⇒ gap').toBe(8)
    const two = parseStaticStyle('gap: 8px 12px', () => {}) as { gap?: number; rowGap?: number; columnGap?: number }
    expect(two.gap, '两值不产 gap').toBeUndefined()
    expect(two.rowGap, 'row=8').toBe(8)
    expect(two.columnGap, 'col=12').toBe(12)
    expect((parseStaticStyle('row-gap: 6px', () => {}) as { rowGap?: number }).rowGap, 'row-gap').toBe(6)
    expect((parseStaticStyle('column-gap: 16px', () => {}) as { columnGap?: number }).columnGap, 'column-gap').toBe(16)
    // 三值/非法 ⇒ 诊断
    const d: string[] = []
    parseStaticStyle('gap: 1px 2px 3px', (m: string) => d.push(m))
    expect(d.length > 0, '三值诊断').toBe(true)
  })

  it('★⑦r pointer-events（批次 32 · ★基准 = Web）：none ⇒ false + 可继承 + 子 auto 覆盖', () => {
    // 【为什么（以 web 为基准）】浮层/遮罩「穿透」刚需；CSS 可继承、子 auto 可覆盖。
    expect((parseStaticStyle('pointer-events: none', () => {}) as { pointerEvents?: boolean }).pointerEvents, 'none ⇒ false').toBe(false)
    expect((parseStaticStyle('pointer-events: auto', () => {}) as { pointerEvents?: boolean }).pointerEvents, 'auto ⇒ true').toBe(true)
    const sfc = `<template>
      <view class="ov"><text class="t">x</text></view>
    </template>
    <style>
      .ov { pointer-events: none }
      .t { pointer-events: auto }
    </style>`
    const r = buildLayoutTemplate(sfc, 'pe.vue')
    const ov = r.template.nodes.find((n) => (n as { tag?: string }).tag === 'view')
    const tx = r.template.nodes.find((n) => (n as { text?: string }).text === 'x')
    expect((ov?.style as { pointerEvents?: boolean })?.pointerEvents, '父 none').toBe(false)
    expect((tx?.style as { pointerEvents?: boolean })?.pointerEvents, '子 auto 覆盖').toBe(true)
  })

  it('★⑦s CSS 渐变 → fillGradient（批次 33 · ★基准 = Web）：linear/radial + 角度 + 显式位置 + alpha', () => {
    // 【为什么（以 web 为基准）】真实项目用 `background: linear-gradient(...)`；此前要求手写 fill-gradient JSON。
    const g1 = parseStaticStyle('background: linear-gradient(135deg, #1a7af8, #7b5ce0)', () => {}) as { fillGradient?: { kind: string; angle: number; stops: Array<{ offset: number; color: string }> } }
    expect(g1.fillGradient?.kind, 'linear').toBe('linear')
    expect(g1.fillGradient?.angle, '135deg').toBe(135)
    expect(g1.fillGradient?.stops.map((s) => s.color), '两端色').toEqual(['#1a7af8', '#7b5ce0'])
    expect(g1.fillGradient?.stops.map((s) => s.offset), '缺省位置均分').toEqual([0, 1])
    // 方向关键字 + 显式 % 位置
    const g2 = parseStaticStyle('background: linear-gradient(to right, red, blue)', () => {}) as { fillGradient?: { angle: number } }
    expect(g2.fillGradient?.angle, 'to right ⇒ 90').toBe(90)
    const g3 = parseStaticStyle('background: linear-gradient(90deg, #eee 25%, #f5f5f5 37%)', () => {}) as { fillGradient?: { stops: Array<{ offset: number }> } }
    expect(g3.fillGradient?.stops.map((s) => s.offset), '显式位置保留').toEqual([0.25, 0.37])
    // rgba alpha ⇒ 独立 alpha 字段
    const g4 = parseStaticStyle('background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)', () => {}) as { fillGradient?: { stops: Array<{ alpha?: number }> } }
    expect(g4.fillGradient?.stops[0]?.alpha, 'rgba 0.5 ⇒ alpha 0.5').toBeCloseTo(0.5, 2)
    // radial + background-image
    const g5 = parseStaticStyle('background-image: radial-gradient(circle, #fff, #000)', () => {}) as { fillGradient?: { kind: string } }
    expect(g5.fillGradient?.kind, 'radial').toBe('radial')
    // ★shape 参数 + **带空格的 rgba**（标准 CSS）必须能解析（此前按空白切 token ⇒ 判不出色 ⇒ 整条渐变丢失）
    const g6 = parseStaticStyle(
      'background-image: radial-gradient(closest-side, rgba(57, 208, 255, 0.55), rgba(57, 208, 255, 0))',
      () => {},
    ) as { fillGradient?: { kind: string; stops: Array<{ alpha?: number }> } }
    expect(g6.fillGradient?.kind, 'radial+closest-side+带空格 rgba').toBe('radial')
    expect(g6.fillGradient?.stops[0]?.alpha, '首标 alpha≈0.549').toBeCloseTo(0.549, 2)
    expect(g6.fillGradient?.stops[1]?.alpha, '末标 alpha=0').toBe(0)
    // 纯色仍走 backgroundColor（零行为变化）
    expect((parseStaticStyle('background: #fff', () => {}) as { backgroundColor?: string }).backgroundColor, '纯色').toBe('#fff')
  })

  it('★⑦t 逐角 border-radius（批次 34 · ★基准 = Web）：统一半径 + 部分角掩码', () => {
    // 【为什么（以 web 为基准）】真实项目用 `border-radius: 12px 12px 0 0`（上圆下方卡片/弹层）。
    const t1 = parseStaticStyle('border-radius: 12px 12px 0 0', () => {}) as { borderRadius?: number; borderRadiusCorners?: Record<string, boolean> }
    expect(t1.borderRadius, '统一半径 12').toBe(12)
    expect(t1.borderRadiusCorners, '上两角 true / 下两角 false').toEqual({ topLeft: true, topRight: true, bottomRight: false, bottomLeft: false })
    const t2 = parseStaticStyle('border-radius: 0 0 12px 12px', () => {}) as { borderRadiusCorners?: Record<string, boolean> }
    expect(t2.borderRadiusCorners, '下两角圆').toEqual({ topLeft: false, topRight: false, bottomRight: true, bottomLeft: true })
    // 统一值 ⇒ 只 borderRadius（无掩码，零行为变化）
    const t3 = parseStaticStyle('border-radius: 8px', () => {}) as { borderRadius?: number; borderRadiusCorners?: unknown }
    expect(t3.borderRadius, '统一 8').toBe(8)
    expect(t3.borderRadiusCorners, '统一 ⇒ 无掩码').toBeUndefined()
    // 半径不一致（8px 4px）⇒ 诊断（不猜）
    const d: string[] = []
    parseStaticStyle('border-radius: 8px 4px', (m: string) => d.push(m))
    expect(d.length > 0, '不一致半径 ⇒ 诊断').toBe(true)
  })

  it('★⑦u text-decoration（批次 35 · ★基准 = Web）：underline/line-through + 继承 + none 不发射', () => {
    // 【为什么（以 web 为基准）】链接下划线/删除线；CSS 可继承。
    expect((parseStaticStyle('text-decoration: underline', () => {}) as { textDecoration?: string }).textDecoration, 'underline').toBe('underline')
    expect((parseStaticStyle('text-decoration: line-through', () => {}) as { textDecoration?: string }).textDecoration, 'line-through').toBe('line-through')
    expect((parseStaticStyle('text-decoration: none', () => {}) as { textDecoration?: string }).textDecoration, 'none 不发射').toBeUndefined()
    // 继承：父声明 ⇒ 子文本继承
    const sfc = `<template>\n  <view class="u"><text>link</text></view>\n</template>\n<style>\n.u { text-decoration: underline }\n</style>`
    const r = buildLayoutTemplate(sfc, 'td.vue')
    const t = r.template.nodes.find((n) => (n as { text?: string }).text === 'link')
    expect((t?.style as { textDecoration?: string })?.textDecoration, '子继承 underline').toBe('underline')
  })

  it('★⑦v font-family → 字体角色（批次 36 · ★基准 = Web）：清单归一 + 继承 + 自定义族', () => {
    // 【为什么（以 web 为基准）】`font-family` 候选清单 → 角色（与 renderer-app 同一映射）；可继承。
    expect((parseStaticStyle('font-family: monospace', () => {}) as { fontFamily?: string }).fontFamily, 'monospace').toBe('monospace')
    expect((parseStaticStyle("font-family: 'SF Mono', Consolas, monospace", () => {}) as { fontFamily?: string }).fontFamily, '清单首命中').toBe('monospace')
    expect((parseStaticStyle('font-family: system-ui', () => {}) as { fontFamily?: string }).fontFamily, 'system-ui ⇒ system').toBe('system')
    expect((parseStaticStyle("font-family: 'Dancing Script'", () => {}) as { fontFamily?: string }).fontFamily, '自定义族透传').toBe('custom:Dancing Script')
    // 继承：父声明 ⇒ 子文本继承
    const sfc = `<template>\n  <view class="m"><text>code</text></view>\n</template>\n<style>\n.m { font-family: monospace }\n</style>`
    const r = buildLayoutTemplate(sfc, 'ff.vue')
    const t = r.template.nodes.find((n) => (n as { text?: string }).text === 'code')
    expect((t?.style as { fontFamily?: string })?.fontFamily, '子继承 monospace').toBe('monospace')
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

  it('②b background 渐变 → fillGradient（批次 33）；图片 url() ⇒ 诊断', () => {
    const diags: string[] = []
    const out = parseStaticStyle('background: linear-gradient(135deg, #fff 0%, #000 100%)', (m) => diags.push(m))
    expect(out.backgroundColor, '渐变不折成 backgroundColor').toBeUndefined()
    expect((out as { fillGradient?: { kind?: string } }).fillGradient?.kind, '★批次 33：渐变折进 fillGradient').toBe('linear')
    // 图片 url() 仍不支持 ⇒ 诊断（不静默）
    const d2: string[] = []
    parseStaticStyle('background: url(x.png) no-repeat', (m) => d2.push(m))
    expect(d2.some((m) => m.includes('background')), '图片产诊断').toBe(true)
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

  it('② 逐边边框（border-bottom 等）⇒ **逐边字段**（2026-10-05 全端对齐批：不再是缺口）', () => {
    const d: string[] = []
    expect(parseStaticStyle('border-bottom: 1px solid #eee', (m) => d.push(m))).toEqual({
      borderBottomWidth: 1,
      borderBottomColor: '#eee',
    })
    expect(d.length, '不诊断').toBe(0)
    // `none` ⇒ 该边清零（重置语义）
    expect(parseStaticStyle('border-left: none', () => {})).toEqual({ borderLeftWidth: 0 })
    // ★★★边框族收口批（2026-10-05）：非 solid 线型**已支持**（dashed/dotted 落逐边 Style，宿主按线型绘制）
    const d2: string[] = []
    expect(parseStaticStyle('border-top: 1px dashed #ddd', (m) => d2.push(m))).toEqual({
      borderTopWidth: 1, borderTopColor: '#ddd', borderTopStyle: 'dashed',
    })
    expect(d2.length, '不诊断').toBe(0)
    // 不支持线型（double/groove…）仍诊断 + 跳过
    const d3: string[] = []
    expect(parseStaticStyle('border-top: 1px double #ddd', (m) => d3.push(m))).toEqual({})
    expect(d3.some((m) => m.includes('double') || m.includes('线型'))).toBe(true)
  })

  it('③ border-style：dashed/dotted ⇒ 落四边 Style；none ⇒ 四边清零；solid 无操作（2026-10-05 线型批）', () => {
    const d: string[] = []
    expect(parseStaticStyle('border-style: dashed', (m) => d.push(m))).toEqual({
      borderTopStyle: 'dashed', borderRightStyle: 'dashed', borderBottomStyle: 'dashed', borderLeftStyle: 'dashed',
    })
    expect(d.length, '不诊断').toBe(0)
    expect(parseStaticStyle('border-style: none', () => {})).toEqual({
      borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
    })
    const d2: string[] = []
    parseStaticStyle('border-style: solid', (m) => d2.push(m))
    expect(d2.length, 'solid = 缺省（无操作）').toBe(0)
    // 不支持线型仍诊断
    const d4: string[] = []
    parseStaticStyle('border-style: double', (m) => d4.push(m))
    expect(d4.length > 0).toBe(true)
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

  // ★★★grid 轨迹解析升级（2026-10-08）：auto/minmax/% 等**现已支持**（内核 taffy FromStr）——
  //   旧断言「auto/minmax ⇒ 跳过」已随能力升级更新；真正未支持的（命名线 [name] / span 文字）仍诊断跳过。
  it('③ minmax/auto/% 已支持；命名线/span 未支持仍诊断跳过', () => {
    expect((parseStaticStyle('grid-template-columns: auto 1fr', () => {}) as { gridTemplateColumns?: string }).gridTemplateColumns).toBe('auto 1fr')
    expect((parseStaticStyle('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)', () => {}) as { gridTemplateColumns?: string }).gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1fr)')
    expect((parseStaticStyle('grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))', () => {}) as { gridTemplateColumns?: string }).gridTemplateColumns).toBe('repeat(auto-fill, minmax(150px, 1fr))')
    // 真正未支持：命名线 ⇒ 诊断跳过
    const d: string[] = []
    expect((parseStaticStyle('grid-template-columns: [a] 1fr', (m) => d.push(m)) as { gridTemplateColumns?: string }).gridTemplateColumns).toBeUndefined()
    expect(d.some((m) => m.includes('grid-template'))).toBe(true)
  })
  it('③b grid-auto-columns/rows（隐式轨道尺寸）折叠', () => {
    expect((parseStaticStyle('grid-auto-columns: minmax(0, 1fr)', () => {}) as { gridAutoColumns?: string }).gridAutoColumns).toBe('minmax(0, 1fr)')
    expect((parseStaticStyle('grid-auto-rows: minmax(0, auto)', () => {}) as { gridAutoRows?: string }).gridAutoRows).toBe('minmax(0, auto)')
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

  it('② 非 solid 边框线型 ⇒ **已支持**（dashed/dotted 落四边 Style——2026-10-05 线型批）', () => {
    const d: string[] = []
    expect(parseStaticStyle('border: 1px dashed #ccc', (m) => d.push(m))).toEqual({
      borderWidth: 1, borderColor: '#ccc',
      borderTopStyle: 'dashed', borderRightStyle: 'dashed', borderBottomStyle: 'dashed', borderLeftStyle: 'dashed',
    })
    expect(d.length, '不诊断').toBe(0)
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

// ★★★批次 37（对齐 Web · 选择器面扩展）：**静态结构伪类**（:first-child / :last-child / :nth-child）
//   + **通配 `*`** + **`:not(<简单选择器>)`** + **Vue 作用域穿透 `:deep()/::v-deep()/>>>`**（2026-10-04）
//
// 【为什么能做】App 无 CSS 引擎，但**元素兄弟序在编译期树遍历里已知** ⇒ 结构伪类编译期算一次。
// 【诚实边界】**状态伪类**（:hover/:active/:focus/:checked）需运行时状态通道 ⇒ 仍诊断跳过；
//   `:not()` 只支持**单段简单选择器**（类/标签/通配/结构伪类）；`::before/::after` 伪元素、属性/兄弟选择器不支持。
describe('★批次 37 · 静态结构伪类 + 通配 + :not + :deep（对齐 Web 选择器）', () => {
  const styleOf = (n: { style?: unknown }) => (n.style ?? {}) as Record<string, unknown>

  it('① :first-child / :last-child（元素兄弟序，编译期定位）', () => {
    const sfc = `<template><view class="list"><view>a</view><view>b</view><view>c</view></view></template>
<style>
.list > view:first-child { background-color: #111111 }
.list > view:last-child { background-color: #222222 }
</style>`
    const r = buildLayoutTemplate(sfc, 'first.vue')
    expect(r.ok).toBe(true)
    const first = r.template.nodes.find((n) => styleOf(n).backgroundColor === '#111111')
    const last = r.template.nodes.find((n) => styleOf(n).backgroundColor === '#222222')
    expect(first, ':first-child 命中').toBeTruthy()
    expect(last, ':last-child 命中').toBeTruthy()
    expect(first!.id, '首个子节点').toBe(1)
    expect(last!.id, '末个子节点').toBe(3)
  })

  it('② :nth-child(odd/even/An+B)（含 2n 与整数位置）', () => {
    const sfc = `<template><view><view>1</view><view>2</view><view>3</view><view>4</view></view></template>
<style>
view:nth-child(odd) { color: #aa0000 }
view:nth-child(2n) { font-size: 20 }
view:nth-child(3) { color: #00aa00 }
</style>`
    const r = buildLayoutTemplate(sfc, 'nth.vue')
    const kids = r.template.nodes.filter((n) => n.parentId === 0)
    expect(kids.length, '4 个元素子节点').toBe(4)
    // odd ⇒ 1/3 命中 #aa0000；第 3 个被更晚同特异性的 :nth-child(3) 覆盖为 #00aa00
    expect(styleOf(kids[0]!).color, '第 1（odd）').toBe('#aa0000')
    expect(styleOf(kids[1]!).fontSize, '第 2（2n）').toBe(20)
    expect(styleOf(kids[2]!).color, '第 3（nth-child(3) 覆盖 odd）').toBe('#00aa00')
    expect(styleOf(kids[3]!).fontSize, '第 4（2n）').toBe(20)
  })

  it('③ 通配 *（.box > * 匹配任意元素子）', () => {
    const sfc = `<template><view class="box"><text>a</text><view>b</view></view></template>
<style>
.box > * { border-width: 2 }
</style>`
    const r = buildLayoutTemplate(sfc, 'star.vue')
    const kids = r.template.nodes.filter((n) => n.parentId === 0)
    for (const k of kids) expect(styleOf(k).borderWidth, `${k.tag} 命中通配`).toBe(2)
  })

  it('④ :not(.x) 取反（命中非该类的兄弟）', () => {
    const sfc = `<template><view><view class="x">a</view><view class="y">b</view><view class="x">c</view></view></template>
<style>
view:not(.x) { background-color: #333333 }
</style>`
    const r = buildLayoutTemplate(sfc, 'not.vue')
    const kids = r.template.nodes.filter((n) => n.parentId === 0)
    expect(styleOf(kids[0]!).backgroundColor, '.x 不命中').toBeUndefined()
    expect(styleOf(kids[1]!).backgroundColor, '.y 命中').toBe('#333333')
    expect(styleOf(kids[2]!).backgroundColor, '.x 不命中').toBeUndefined()
  })

  it('⑤ Vue :deep() 展开为后代选择器（穿透子组件的类）', () => {
    const sfc = `<template><view class="wrap"><text class="inner">a</text></view></template>
<style>
.wrap :deep(.inner) { color: #008800 }
</style>`
    const r = buildLayoutTemplate(sfc, 'deep.vue')
    const inner = r.template.nodes.find((n) => n.tag === 'text')
    expect(styleOf(inner!).color, ':deep(.inner) 命中').toBe('#008800')
  })

  it('⑥ 状态伪类仍诊断跳过（:hover 需运行时状态通道，不静默）', () => {
    const sfc = `<template><view class="btn">a</view></template>
<style>
.btn:hover { background-color: #999999 }
</style>`
    const r = buildLayoutTemplate(sfc, 'hover.vue')
    const btn = r.template.nodes.find((n) => n.tag === 'view')
    expect(styleOf(btn!).backgroundColor, ':hover 不生效').toBeUndefined()
    expect(r.diagnostics.some((d) => d.code === 'VAPOR_STYLE_SELECTOR_UNSUPPORTED'), '产选择器诊断').toBe(true)
  })

  it('⑦ 行内（v-for）结构伪类 ⇒ 诊断（不静默：运行期每行克隆同一模板）', () => {
    const sfc = `<template><view class="list"><view class="item" v-for="it in items">{{ it }}</view></view></template>
<style>
.item:first-child { background-color: #111111 }
</style>`
    const r = buildLayoutTemplate(sfc, 'vfor.vue')
    expect(
      r.diagnostics.some((d) => d.code === 'VAPOR_STRUCTURAL_PSEUDO_IN_LIST'),
      'v-for 行内结构伪类产诊断',
    ).toBe(true)
    // 非行内（静态兄弟）不产该诊断
    const sfc2 = `<template><view><view class="a">1</view><view class="a">2</view></view></template>
<style>
.a:first-child { background-color: #111111 }
</style>`
    const r2 = buildLayoutTemplate(sfc2, 'static.vue')
    expect(
      r2.diagnostics.some((d) => d.code === 'VAPOR_STRUCTURAL_PSEUDO_IN_LIST'),
      '静态兄弟结构伪类不产该诊断',
    ).toBe(false)
  })

})

// ★批次 38（对齐 Web · 削减胶水）：**`inset` 简写**（`top/right/bottom/left` 的 1–4 值缩写）——2026-10-04
//   真项目 15 处（路由层/浮层/scrim 的 `position:absolute; inset:0`）；纯编译期展开为四边数值。
describe('★批次 38 · inset 简写（对齐 Web 定位缩写）', () => {
  const styleOf = (n: { style?: unknown }) => (n.style ?? {}) as Record<string, unknown>

  it('① 1–4 值展开为 top/right/bottom/left（CSS 标准）', () => {
    expect(parseStaticStyle('inset: 0', () => {})).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(parseStaticStyle('inset: 10px', () => {})).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
    expect(parseStaticStyle('inset: 8px 12px', () => {})).toEqual({ top: 8, right: 12, bottom: 8, left: 12 })
    expect(parseStaticStyle('inset: 1px 2px 3px 4px', () => {})).toEqual({ top: 1, right: 2, bottom: 3, left: 4 })
  })

  it('② auto 边 = 默认偏移（该边不设，忠实不猜）', () => {
    expect(parseStaticStyle('inset: 0 auto', () => {})).toEqual({ top: 0, bottom: 0 })
    expect(parseStaticStyle('inset: 8px 0', () => {})).toEqual({ top: 8, right: 0, bottom: 8, left: 0 })
  })

  it('③ 端到端：class 里的 inset:0 → 节点 style 四边 0（覆盖层刚需）', () => {
    const sfc = `<template><view class="wrap"><view class="scrim">x</view></view></template>
<style>
.wrap { position: relative; width: 200px; height: 100px }
.scrim { position: absolute; inset: 0; background-color: #000000 }
</style>`
    const r = buildLayoutTemplate(sfc, 'inset.vue')
    const scrim = r.template.nodes.find((n) => styleOf(n).backgroundColor === '#000000')
    expect(scrim, 'scrim 节点命中').toBeTruthy()
    expect([styleOf(scrim!).top, styleOf(scrim!).right, styleOf(scrim!).bottom, styleOf(scrim!).left], '四边 0').toEqual([0, 0, 0, 0])
    expect(styleOf(scrim!).position, 'absolute').toBe('absolute')
  })
})

// ★批次 39（对齐 Web · 削减胶水）：**静态 `transform`** —— 位移/缩放/旋转折成数值集（宿主逐节点变换通道复用）——2026-10-04
//   真项目 73 处 transform（多为 transition 态；静态折叠面给"静态摆位"用）；
//   支持 2D 子集（translate/scale/rotate），3D/skew/matrix 如实诊断。
describe('★批次 39 · 静态 transform（对齐 Web 2D 变换）', () => {
  const tf = (css: string) => (parseStaticStyle(css, () => {}) as { transform?: Record<string, number> }).transform

  it('① translate / translateX / translateY（px；%→盒比例）', () => {
    expect(tf('transform: translateY(-2px)')).toMatchObject({ tyPx: -2 })
    expect(tf('transform: translateX(10px)')).toMatchObject({ txPx: 10 })
    expect(tf('transform: translate(4px, 8px)')).toMatchObject({ txPx: 4, tyPx: 8 })
    expect(tf('transform: translate(-50%,-50%)')).toMatchObject({ txPct: -0.5, tyPct: -0.5 })
  })

  it('② scale / rotate（等比 + 角度单位）', () => {
    expect(tf('transform: scale(1.5)')).toMatchObject({ sx: 1.5, sy: 1.5 })
    expect(tf('transform: rotate(45deg)')).toMatchObject({ rotate: 45 })
    expect(tf('transform: rotate(0.5turn)')).toMatchObject({ rotate: 180 })
    expect(tf('transform: rotate(100grad)')).toMatchObject({ rotate: 90 })
  })

  it('③ 复合：translateX(10px) scale(2)', () => {
    expect(tf('transform: translateX(10px) scale(2)')).toMatchObject({ txPx: 10, sx: 2, sy: 2 })
  })

  it('④ none ⇒ 级联重置标记（null）；单位变换 ⇒ 不发射', () => {
    // `transform: none` 记录重置（null）——让级联能覆盖低优先级的 translate/scale/rotate（批 27 纪律）
    expect(tf('transform: none')).toBeNull()
    // 单位变换（visual no-op）⇒ 不发射（undefined）
    expect(tf('transform: translate(0,0)')).toBeUndefined()
  })

  it('⑤ 不支持形态如实诊断（3D/skew/matrix/非等比）', () => {
    for (const bad of ['transform: skewX(10deg)', 'transform: matrix(1,0,0,1,0,0)', 'transform: translate3d(0,0,0)', 'transform: scaleX(2)']) {
      const d: string[] = []
      expect((parseStaticStyle(bad, (m) => d.push(m)) as { transform?: unknown }).transform, bad).toBeUndefined()
      expect(d.length, `${bad} 应诊断`).toBeGreaterThan(0)
    }
  })

  it('⑥ 端到端：class 里的 transform → 节点 style', () => {
    const sfc = `<template><view class="wrap"><view class="chip">x</view></view></template>
<style>
.chip { width: 100px; height: 30px; background-color: #ff8a3d; transform: translateY(6px) scale(0.92) }
</style>`
    const r = buildLayoutTemplate(sfc, 'tf.vue')
    const chip = r.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#ff8a3d')
    expect((chip?.style as { transform?: Record<string, number> })?.transform).toMatchObject({ tyPx: 6, sx: 0.92 })
  })
})

// ★批次 40（对齐 Web · 补齐批 39）：**`transform-origin`** —— 旋转/缩放锚点（盒分数）——2026-10-04
//   宿主通道已在（Android/iOS 建层读 + 动画 applyTransform）⇒ 编译器折成 {x,y} 即可。
describe('★批次 40 · transform-origin（变换锚点，对齐 Web）', () => {
  const to = (css: string) => (parseStaticStyle(css, () => {}) as { transformOrigin?: { x: number; y: number } }).transformOrigin

  it('① 关键字（单/双值；轴序无关）', () => {
    expect(to('transform-origin: center')).toBeUndefined()   // 默认居中 ⇒ 不发射
    expect(to('transform-origin: bottom')).toEqual({ x: 0.5, y: 1 })
    expect(to('transform-origin: left')).toEqual({ x: 0, y: 0.5 })
    expect(to('transform-origin: top left')).toEqual({ x: 0, y: 0 })
    expect(to('transform-origin: left top')).toEqual({ x: 0, y: 0 })
    expect(to('transform-origin: center bottom')).toEqual({ x: 0.5, y: 1 })
  })

  it('② 百分比 / 0 → 分数', () => {
    expect(to('transform-origin: 0 0')).toEqual({ x: 0, y: 0 })
    expect(to('transform-origin: 50% 100%')).toEqual({ x: 0.5, y: 1 })
    expect(to('transform-origin: 100% 50%')).toEqual({ x: 1, y: 0.5 })
  })

  it('③ 非零 px 需盒尺寸 ⇒ 如实诊断跳过', () => {
    const d: string[] = []
    expect((parseStaticStyle('transform-origin: 100px 100px', (m) => d.push(m)) as { transformOrigin?: unknown }).transformOrigin).toBeUndefined()
    expect(d.length).toBeGreaterThan(0)
  })

  it('④ 端到端：class 里的 transform-origin → 节点 style', () => {
    const sfc = `<template><view class="wrap"><view class="tip">x</view></view></template>
<style>
.tip { width: 80px; height: 40px; background-color: #ff8a3d; transform: rotate(10deg); transform-origin: bottom }
</style>`
    const r = buildLayoutTemplate(sfc, 'to.vue')
    const tip = r.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#ff8a3d')
    expect((tip?.style as { transformOrigin?: { x: number; y: number } })?.transformOrigin).toEqual({ x: 0.5, y: 1 })
    expect((tip?.style as { transform?: Record<string, number> })?.transform).toMatchObject({ rotate: 10 })
  })
})

// ★批次 41（CSS Grid 补全 · 批 12 续）：`grid-column` / `grid-row` **线号放置**（对齐 Web）——2026-10-04
//   真项目 36 处（`1`/`2`、`1 / -1` 全宽——仪表盘 KPI 卡）；内核 taffy `Line<GridPlacement>`。
describe('★批次 41 · grid-column / grid-row 线号放置（补齐 CSS Grid）', () => {
  const gc = (css: string) => (parseStaticStyle(css, () => {}) as { gridColumn?: { start?: number; end?: number; span?: number } }).gridColumn
  const gr = (css: string) => (parseStaticStyle(css, () => {}) as { gridRow?: { start?: number; end?: number; span?: number } }).gridRow

  it('① 单值线号 / start-end / 负线号', () => {
    expect(gc('grid-column: 1')).toEqual({ start: 1 })
    expect(gc('grid-column: 1 / 3')).toEqual({ start: 1, end: 3 })
    expect(gc('grid-column: 1 / -1')).toEqual({ start: 1, end: -1 })
    expect(gr('grid-row: 2')).toEqual({ start: 2 })
    expect(gr('grid-row: 1 / 3')).toEqual({ start: 1, end: 3 })
  })

  it('①b ★2026-10-08 span：`span n` / `start / span n` / `span n / end`（案例 D 卡位错修复）', () => {
    expect(gr('grid-row: span 2')).toEqual({ span: 2 })
    expect(gc('grid-column: span 2')).toEqual({ span: 2 })
    expect(gc('grid-column: 1 / span 2')).toEqual({ start: 1, span: 2 })
    expect(gr('grid-row: span 2 / 3')).toEqual({ end: 3, span: 2 })
  })

  it('② auto / 命名线 ⇒ 如实诊断跳过；span 0 亦跳过', () => {
    for (const bad of ['grid-column: auto', 'grid-column: foo-start', 'grid-row: span 0']) {
      const d: string[] = []
      expect((parseStaticStyle(bad, (m) => d.push(m)) as { gridColumn?: unknown; gridRow?: unknown }).gridColumn ?? (parseStaticStyle(bad, () => {}) as { gridRow?: unknown }).gridRow, bad).toBeUndefined()
      expect(d.length, `${bad} 应诊断`).toBeGreaterThan(0)
    }
  })

  it('③ 端到端：class 里的 grid-column: 1 / -1 → 节点 style', () => {
    const sfc = `<template><view class="grid"><view class="full">x</view></view></template>
<style>
.grid { display: grid; grid-template-columns: 1fr 1fr; width: 300px }
.full { grid-column: 1 / -1; height: 40px; background-color: #12b886 }
</style>`
    const r = buildLayoutTemplate(sfc, 'grid.vue')
    const full = r.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#12b886')
    expect((full?.style as { gridColumn?: { start: number; end?: number } })?.gridColumn).toEqual({ start: 1, end: -1 })
  })
})

// ★批次 42（动效 · 对齐 Web）：**CSS @keyframes + animation** —— 编译期折叠为内核 keyframe 动画 ——2026-10-04
//   App 端此前整条丢弃；现折成逐通道 `{kind, from, keyframes:[{to,durMs,curve}]}`（挂载后由宿主 animStart 播）。
describe('★批次 42 · CSS @keyframes + animation（对齐 Web 动效）', () => {
  const kf = (css: string) => parseKeyframes(css)

  it('① @keyframes 解析（from/to/% → 停靠点 + opacity/transform 通道）', () => {
    expect(kf('@keyframes a { from { opacity: 0 } to { opacity: 1 } }').a).toEqual([
      { offset: 0, decls: { opacity: 0 } },
      { offset: 1, decls: { opacity: 1 } },
    ])
    const k = kf('@keyframes b { 0% { opacity: 0 } 50% { opacity: 0.5 } 100% { opacity: 1 } }').b!
    expect(k.map((s) => s.offset)).toEqual([0, 0.5, 1])
  })

  it('② animation 简写 → 逐通道 keyframe 规格（含时长/曲线）', () => {
    const kfm = kf('@keyframes fade-in { from { opacity: 0.1 } to { opacity: 1 } }')
    const o = parseStaticStyle('animation: fade-in 0.3s ease forwards', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ kind: number; from: number; keyframes: Array<{ to: number; durMs: number; curve: number }> }>
    }
    expect(o.animation).toBeTruthy()
    expect(o.animation![0]).toMatchObject({ kind: 4, from: 0.1 })
    expect(o.animation![0]!.keyframes[0]).toEqual({ to: 1, durMs: 300, curve: 3 })
  })

  it('③ transform 通道（translateY px 关键帧）', () => {
    const kfm = kf('@keyframes slide-up { from { transform: translateY(40px) } to { transform: translateY(0) } }')
    const o = parseStaticStyle('animation: slide-up 0.32s ease-out', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ kind: number; from: number }>
    }
    expect(o.animation!.some((c) => c.kind === 1 && c.from === 40), 'translateY 通道 from=40').toBe(true)
  })

  it('④ 未知名与无时长 ⇒ 诊断跳过（不静默）', () => {
    const d1: string[] = []
    parseStaticStyle('animation: nope 0.3s', (m) => d1.push(m), undefined, undefined, {})
    expect(d1.some((m) => m.includes('@keyframes nope'))).toBe(true)
    const d2: string[] = []
    parseStaticStyle('animation: x', (m) => d2.push(m), undefined, undefined, {})
    expect(d2.length).toBeGreaterThan(0)
  })

  it('⑤ 端到端：class 里的 animation → 节点 style', () => {
    const sfc = `<template><view class="fade">x</view></template>
<style>
@keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
.fade { width: 100px; height: 40px; animation: fade-in 0.3s ease }
</style>`
    const r = buildLayoutTemplate(sfc, 'anim.vue')
    const f = r.template.nodes.find((n) => (n.style as { animation?: unknown }).animation !== undefined)
    expect(f, '节点带 animation 规格').toBeTruthy()
    expect((f!.style as { animation: Array<{ kind: number }> }).animation[0]!.kind).toBe(4)
  })

  it('⑥ animation-delay（第 2 个时间 token）→ 通道 delayMs（真实水波多圈错时的关键）', () => {
    const kfm = kf('@keyframes ripple { from { transform: scale(0); opacity: 0.8 } to { transform: scale(1); opacity: 0 } }')
    const o = parseStaticStyle('animation: ripple 0.6s ease-out 0.18s', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ kind: number; delayMs: number }>
    }
    expect(o.animation).toBeTruthy()
    // 所有通道带 delayMs=180（第 2 个时间 token）
    expect(o.animation!.every((c) => c.delayMs === 180), 'delayMs=180').toBe(true)
    // 无 delay ⇒ delayMs=0（零行为变化）
    const o2 = parseStaticStyle('animation: ripple 0.6s', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ delayMs: number }>
    }
    expect(o2.animation!.every((c) => c.delayMs === 0)).toBe(true)
  })

  it('⑦ animation-iteration-count：infinite ⇒ iterations=-1（持续脉冲）；n ⇒ n；0 ⇒ 不发射', () => {
    const kfm = kf('@keyframes pulse { from { transform: scale(0); opacity: 0.6 } to { transform: scale(1); opacity: 0 } }')
    const inf = parseStaticStyle('animation: pulse 1.2s ease-out infinite', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ iterations: number }>
    }
    expect(inf.animation!.every((c) => c.iterations === -1), 'infinite ⇒ -1').toBe(true)
    const n3 = parseStaticStyle('animation: pulse 1.2s 3', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ iterations: number }>
    }
    expect(n3.animation!.every((c) => c.iterations === 3), '数字 3 ⇒ 3').toBe(true)
    // delay + infinite 同行（第 2 个时间 token = delay，无单位整数 = iterations）
    const both = parseStaticStyle('animation: pulse 1.2s ease-out 0.6s infinite', () => {}, undefined, undefined, kfm) as {
      animation?: Array<{ delayMs: number; iterations: number }>
    }
    expect(both.animation!.every((c) => c.delayMs === 600 && c.iterations === -1), 'delay 600 + infinite').toBe(true)
    // 迭代 0 ⇒ 不发射（CSS：不播放；内核拒 0）
    const d: string[] = []
    const z = parseStaticStyle('animation: pulse 1.2s 0', (m) => d.push(m), undefined, undefined, kfm) as { animation?: unknown }
    expect(z.animation, 'iteration-count 0 ⇒ 不发射').toBeUndefined()
    expect(d.length, 'iteration-count 0 ⇒ 有诊断').toBeGreaterThan(0)
  })
})

// ★★★flex-direction 项（2026-10-08 · 用户抓出 Web 分歧）：display:flex 容器补初值 row（CSS 初值）——
//   内核只有 flex（未声明 display 的 block 近似走 column）；显式 display:flex + 未写 flex-direction
//   ⇒ 补 row（让 Web 标准写法在 App 直接成立，无需胶水补 flex-direction:row）。
describe('★flex-direction 初值归一（display:flex 缺省补 row · 对齐 Web）', () => {
  const nodeStyle = (sfc: string, n = 0) => buildLayoutTemplate(sfc, 'fd.vue').template.nodes[n]!.style as Record<string, unknown>

  it('① display:flex 未声明 flex-direction ⇒ 补 row（Web 初值）', () => {
    const st = nodeStyle('<template><view class="b"></view></template><style>.b{display:flex;justify-content:center}</style>')
    expect(st.flexDirection, 'display:flex 缺省补 row').toBe('row')
  })

  it('② 显式 flex-direction:column ⇒ 保留（不被覆盖）', () => {
    const st = nodeStyle('<template><view class="b"></view></template><style>.b{display:flex;flex-direction:column}</style>')
    expect(st.flexDirection).toBe('column')
  })

  it('③ 未声明 display（block 近似）⇒ 不补（内核默认 column 不变）', () => {
    const st = nodeStyle('<template><view class="b"></view></template><style>.b{justify-content:center}</style>')
    expect(st.flexDirection, '未声明 display 不补 flexDirection').toBeUndefined()
  })

  it('④ 跨规则级联：父规则 display:flex + 子规则 flex-direction:column ⇒ column（级联后归一，非 per-rule）', () => {
    const st = nodeStyle('<template><view class="b bcol"></view></template><style>.b{display:flex}.bcol{flex-direction:column}</style>')
    expect(st.flexDirection, '显式声明胜出（级联后补初值）').toBe('column')
  })

  it('★★★vw/vh 单位（2026-10-08 · 决策 #595 · Stage 2）：折为内置视口变量 env:--pf-vw/--pf-vh（含缩放）', () => {
    expect(parseStaticStyle('width: 30vw', () => {})).toEqual({ width: 'env:--pf-vw*0.3' })
    expect(parseStaticStyle('height: 20vh', () => {})).toEqual({ height: 'env:--pf-vh*0.2' })
    expect(parseStaticStyle('min-height:100vh', () => {})).toEqual({ minHeight: 'env:--pf-vh' })
    expect(parseStaticStyle('padding-top:10vh', () => {})).toEqual({ padding: { top: 'env:--pf-vh*0.1' } })
    // calc 内 env*vw 缩放
    expect(parseStaticStyle('width:calc(var(--pf-vw) * 0.5)', () => {})).toEqual({ width: 'env:--pf-vw*0.5' })
  })
  it('★★★批 A 定位族（2026-10-08 · 决策 #651）：position fixed/sticky 如实透传（不再被静默改写）', () => {
    // 旧批次 45 把 fixed 静默改成 absolute（理由"App 单全屏视口等价"）——内容滚动后不成立 ⇒ 移除。
    expect(parseStaticStyle('position: fixed; top: 0; left: 0', () => {})).toEqual({ position: 'fixed', top: 0, left: 0 })
    expect(parseStaticStyle('position: sticky; top: 8px', () => {})).toEqual({ position: 'sticky', top: 8 })
    // static/relative/absolute 不变
    expect(parseStaticStyle('position: absolute; right: 6', () => {})).toEqual({ position: 'absolute', right: 6 })
  })
  it('★★★E 组设备标量 --pf-hairline（2026-10-08 · 决策 #598）：边框细线宽度折 env（长手 + 简写 + 四值）', () => {
    // 边框宽度**长手**（绘制侧长度字段）
    expect(parseStaticStyle('border-bottom-width: var(--pf-hairline)', () => {})).toEqual({ borderBottomWidth: 'env:--pf-hairline' })
    // 边框**简写**（border-bottom: <w> solid <c>）中的宽度
    expect(parseStaticStyle('border-bottom: var(--pf-hairline) solid #5b5bd6', () => {}))
      .toEqual({ borderBottomWidth: 'env:--pf-hairline', borderBottomColor: '#5b5bd6' })
    // border-width 单值 ⇒ uniform 字段；四值 ⇒ 逐边落（env 与数值可混）
    expect(parseStaticStyle('border-width: var(--pf-hairline)', () => {})).toEqual({ borderWidth: 'env:--pf-hairline' })
    expect(parseStaticStyle('border-width: var(--pf-hairline) 2px', () => {})).toEqual({
      borderTopWidth: 'env:--pf-hairline', borderRightWidth: 2, borderBottomWidth: 'env:--pf-hairline', borderLeftWidth: 2,
    })
  })
  it('⑤ display:grid ⇒ 不补（网格不用主轴 flex-direction）', () => {
    const st = nodeStyle('<template><view class="b"></view></template><style>.b{display:grid;grid-template-columns:1fr 1fr}</style>')
    expect(st.flexDirection).toBeUndefined()
  })
})

describe('★App 页根「块级满宽」（对齐 Web · 用户实测「text-align:center + 根 padding 渲染成顶左」）', () => {
  // ★CSS：块级页根宽度 = 包含块宽（auto 宽填满）；App 内核把单根当 flex 容器，auto 宽按内容收缩
  //   （实测 292px vs 视口 400px）⇒ 页根缩到文字宽 ⇒ text-align:center 只在小盒里居中（"顶左"）。
  //   ⇒ 单根且未声明宽度 ⇒ 补 widthRatio:1（= width:100%）。
  const rootStyle = (sfc: string): Record<string, unknown> => {
    const r = buildLayoutTemplate(sfc, 'pages/p.vue')
    const root = r.template.nodes.find((n) => n.id === r.template.roots[0])!
    return root.style as Record<string, unknown>
  }
  it('单根未声明宽度 ⇒ 补 widthRatio:1（页根满宽）', () => {
    const st = rootStyle('<template><div class="home"><h1>Hi</h1></div></template><style>.home{text-align:center;padding:48px 0}</style>')
    expect(st.widthRatio).toBe(1)
    expect(st.textAlign).toBe('center') // 其它声明不受影响
  })
  it('根显式声明宽度 ⇒ 不动（尊重显式声明）', () => {
    expect(rootStyle('<template><div style="width:200px">x</div></template>').widthRatio).toBeUndefined()
    expect(rootStyle('<template><div style="width:100%">x</div></template>').widthRatio).toBe(1) // 100% 本就是 1
    expect(rootStyle('<template><div style="min-width:50px">x</div></template>').widthRatio).toBeUndefined()
  })
  it('多根（片段）⇒ 不补（各根按各自语义）', () => {
    const r = buildLayoutTemplate('<template><text>a</text><text>b</text></template>', 'pages/p.vue')
    for (const id of r.template.roots) {
      const n = r.template.nodes.find((x) => x.id === id)!
      expect((n.style as Record<string, unknown>).widthRatio).toBeUndefined()
    }
  })
})

// ★★★S1.1（2026-10-10 · 输入延迟专项 #767）：`:active` → 节点 `press*` 字段（按下态原生即时应用）
describe('★S1.1 · `<style> .x:active{}` → 节点 press* 字段（按下态交宿主原生应用）', () => {
  const SFC = `<template>\n  <view class="btn">x</view>\n</template>\n<style>\n.btn { background-color: #112233 }\n.btn:active { background-color: #ff0000; border-radius: 8 }\n</style>\n`
  const r = buildLayoutTemplate(SFC, 'press.vue')
  const btn = r.template.nodes.find((n) => (n.tag === 'view'))!
  it('① 按下态声明折成 press* 键（不进常驻 styles）', () => {
    const s = btn.style as Record<string, unknown>
    expect(s.backgroundColor, '常驻背景色仍是常态值（未被按下色覆盖）').toBe('#112233')
    expect(s.pressBackgroundColor, ':active 背景 → pressBackgroundColor').toBe('#ff0000')
    expect(s.pressBorderRadius, ':active 圆角 → pressBorderRadius').toBe(8)
    expect(s.borderRadius, '按下态圆角不进常驻').toBeUndefined()
  })
  it('② 无 :active ⇒ 无 press* 字段（零行为变化）', () => {
    const r2 = buildLayoutTemplate(`<template><view class="p">x</view></template><style>.p{color:#000}</style>`, 'p2.vue')
    const s = (r2.template.nodes.find((n) => n.tag === 'view')!.style) as Record<string, unknown>
    expect(Object.keys(s).some((k) => k.startsWith('press')), '无 :active ⇒ 无 press*').toBe(false)
  })
  it('③ :active 不再产"选择器不支持"诊断', () => {
    expect(r.diagnostics.map((d) => d.code)).not.toContain('VAPOR_STYLE_SELECTOR_UNSUPPORTED')
  })
})

// ★★★CSS 伪元素 `::before`/`::after`（本批）：编译期**物化**一个装饰子节点（内核/宿主按普通节点渲染）
describe('★CSS 伪元素 · `::before`/`::after` 物化为装饰子节点', () => {
  const SFC = `<template>\n  <view class="pad"><text class="lbl">hi</text></view>\n</template>\n<style>\n@keyframes ripple { from { transform: scale(0); opacity: 0.6 } to { transform: scale(1); opacity: 0 } }\n.pad { position: relative; overflow: hidden; background-color: #141a24 }\n.pad:active { background-color: #1b3550 }\n.pad::after { content: ''; position: absolute; width: 20px; height: 20px; border-radius: 50%; background-color: #39d0ff }\n.pad:active::after { animation: ripple 0.5s ease-out }\n</style>\n`
  const r = buildLayoutTemplate(SFC, 'pseudo.vue')
  const pad = r.template.nodes.find((n) => (n.style as { backgroundColor?: string }).backgroundColor === '#141a24')!
  const isPseudo = (n: unknown) => (n as { pseudo?: string }).pseudo !== undefined
  const pseudoNodes = r.template.nodes.filter(isPseudo)

  it('① 物化一个 ::after 装饰子节点（parentId = 原元素；在真子节点之后）', () => {
    expect(pseudoNodes.length, '应物化 1 个伪元素节点').toBe(1)
    const pe = pseudoNodes[0]!
    expect((pe as { pseudo?: string }).pseudo).toBe('after')
    expect(pe.parentId, '伪元素挂在原元素之下').toBe(pad.id)
    expect(pad.id, '原元素在伪元素之前（pre-order）').toBeLessThan(pe.id)
  })
  it('② 伪元素样式来自 `.pad::after` 规则 + 强制 pointer-events:none（不抢事件）', () => {
    const s = pseudoNodes[0]!.style as Record<string, unknown>
    expect(s.position).toBe('absolute')
    expect(s.width).toBe(20)
    expect(s.borderRadiusPct, 'border-radius:50% → 半径比例 0.5').toBe(0.5)
    expect(s.backgroundColor).toBe('#39d0ff')
    expect(s.pointerEvents, '伪元素强制 pointer-events:none（布尔 false）').toBe(false)
  })
  it('③ `:active::after{animation}` 折成伪节点的 pressAnimation（按下才播）', () => {
    const s = pseudoNodes[0]!.style as Record<string, unknown>
    expect(Array.isArray(s.pressAnimation), '按下触发动画折成 pressAnimation').toBe(true)
    expect(s.animation, '按下态动画不进常驻 animation').toBeUndefined()
  })
  it('④ 原元素常态不被伪元素规则污染', () => {
    const s = pad.style as Record<string, unknown>
    expect(s.backgroundColor, '原元素态仍是常态色').toBe('#141a24')
    expect(s.position).toBe('relative')
    expect(s.width, '伪元素的 width 不进原元素').toBeUndefined()
  })
  it('⑤ `content:none` / 缺省 ⇒ 不物化（CSS 语义）', () => {
    const r2 = buildLayoutTemplate(`<template><view class="b">y</view></template><style>.b::after{content:none;color:red}</style>`, 'p2.vue')
    expect(r2.template.nodes.some(isPseudo), 'content:none ⇒ 不产伪元素节点').toBe(false)
    const r3 = buildLayoutTemplate(`<template><view class="c">y</view></template><style>.c::before{color:red}</style>`, 'p3.vue')
    expect(r3.template.nodes.some(isPseudo), '无 content ⇒ 不产伪元素节点').toBe(false)
  })
  it('⑥ ::before 排在真子节点之前', () => {
    const r4 = buildLayoutTemplate(`<template><view class="a"><text class="t">x</text></view></template><style>.a::before{content:'B'}</style>`, 'p4.vue')
    const before = r4.template.nodes.find((n) => (n as { pseudo?: string }).pseudo === 'before')!
    const realChild = r4.template.nodes.find((n) => n.tag === 'text')!
    expect(before.id).toBeLessThan(realChild.id)
  })
  it('⑦ 不支持的选择器（::placeholder）仍诊断（不静默）', () => {
    const r5 = buildLayoutTemplate(`<template><view class="d">y</view></template><style>.d::placeholder{color:red}</style>`, 'p5.vue')
    expect(r5.diagnostics.map((d) => d.code)).toContain('VAPOR_STYLE_SELECTOR_UNSUPPORTED')
  })
  it('⑧ `content:attr()` 形态 ⇒ 精确诊断（不物化）', () => {
    const r6 = buildLayoutTemplate(`<template><view class="e" data-x="1">y</view></template><style>.e::after{content:attr(data-x)}</style>`, 'p6.vue')
    expect(r6.diagnostics.map((d) => d.code)).toContain('VAPOR_PSEUDO_CONTENT_UNSUPPORTED')
    expect(r6.template.nodes.some(isPseudo)).toBe(false)
  })
})

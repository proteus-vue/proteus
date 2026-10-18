// tests/text-decoration.test.ts —— ★★★text-decoration 三兄弟（2026-10-18 · 批 B F3 · 基准 = Web）
//
// 【Web 真值（真 Chromium 151 实测）】
//   · `text-decoration-color` 的**初值是 currentColor** ⇒ 未声明时跟随**自身文字色**（实测：父 color:blue
//     的子元素 underline 也是蓝的，取的是自己的 color）
//   · `text-decoration-style` 初值 `solid`；支持 solid/double/dotted/dashed/wavy
//   · `text-decoration-thickness` 初值 `auto`（还有 `from-font`）；`10%` 在 computed 里**保持百分比**
//     （相对字号 ⇒ 需要字号才能绝对化，三端通道未统一 ⇒ 本版诊断跳过）
//
// 【为什么简写必须扩展】`underline red` / `underline 1px dashed #f00` 是真实项目高频写法，
//   此前整条被丢弃（只认单个 `underline`/`line-through` 词）——**静默失样式**。
//
// 【三端绘制形态】
//   Android：**改手绘**（原生 setUnderlineText 只画"文字色单实线"且线宽不可控）·
//   iOS：NSUnderlineStyle 选项集 + underlineColor/strikethroughColor（**wavy 不在枚举** ⇒ 实线+厚度近似）·
//   鸿蒙：OH_Drawing_SetTextStyleDecoration{Color,Style,ThicknessScale}。
//   Skyline：`-color`/`-style` 官方支持，`-thickness` 未收录（具名引擎边界）。

import { describe, it, expect } from 'vitest'
import { parseStaticStyle } from '@proteus-vue/compiler'

describe('★★★text-decoration 三兄弟（批 B F3 · 基准 = Web）', () => {
  it('① 三条长手各自折叠：颜色归一 hex / 线型发射 / 线宽发射', () => {
    expect((parseStaticStyle('text-decoration-color: red', () => {}) as { textDecorationColor?: string }).textDecorationColor, '命名色归一').toBe('#ff0000')
    expect((parseStaticStyle('text-decoration-color: rgb(255, 0, 0)', () => {}) as { textDecorationColor?: string }).textDecorationColor).toBe('#ff0000')
    expect((parseStaticStyle('text-decoration-style: dotted', () => {}) as { textDecorationStyle?: string }).textDecorationStyle).toBe('dotted')
    expect((parseStaticStyle('text-decoration-style: wavy', () => {}) as { textDecorationStyle?: string }).textDecorationStyle).toBe('wavy')
    expect((parseStaticStyle('text-decoration-thickness: 3px', () => {}) as { textDecorationThickness?: number }).textDecorationThickness).toBe(3)
  })

  it('② 初值不发射（solid / auto / from-font），非法值诊断', () => {
    expect((parseStaticStyle('text-decoration-style: solid', () => {}) as { textDecorationStyle?: string }).textDecorationStyle, 'solid = 初值').toBeUndefined()
    expect((parseStaticStyle('text-decoration-thickness: auto', () => {}) as { textDecorationThickness?: number }).textDecorationThickness, 'auto = 初值').toBeUndefined()
    expect((parseStaticStyle('text-decoration-thickness: from-font', () => {}) as { textDecorationThickness?: number }).textDecorationThickness, 'from-font = 字体自带').toBeUndefined()
    const d: string[] = []
    expect((parseStaticStyle('text-decoration-thickness: 10%', (m: string) => d.push(m)) as { textDecorationThickness?: number }).textDecorationThickness, '百分比需字号').toBeUndefined()
    expect(d.some((x) => x.includes('text-decoration-thickness')), '百分比有诊断').toBe(true)
    const d2: string[] = []
    parseStaticStyle('text-decoration-style: blink', (m: string) => d2.push(m))
    expect(d2.some((x) => x.includes('text-decoration-style')), '非法线型有诊断').toBe(true)
  })

  it('③ 简写扩展：`underline red` / `underline 1px dashed #f00` 不再整条丢弃', () => {
    // 【为什么（真缺陷）】此前简写只认单值 underline/line-through，带颜色的真实写法被**整条**丢弃
    const s1 = parseStaticStyle('text-decoration: underline red', () => {}) as Record<string, unknown>
    expect(s1.textDecoration, 'line 折出').toBe('underline')
    expect(s1.textDecorationColor, '颜色折出').toBe('#ff0000')

    const s2 = parseStaticStyle('text-decoration: underline 1px dashed #ff0000', () => {}) as Record<string, unknown>
    expect(s2.textDecoration).toBe('underline')
    expect(s2.textDecorationStyle).toBe('dashed')
    expect(s2.textDecorationThickness).toBe(1)
    expect(s2.textDecorationColor).toBe('#ff0000')

    // 顺序无关（CSS `||` 语义）
    const s3 = parseStaticStyle('text-decoration: #00ff00 dotted line-through', () => {}) as Record<string, unknown>
    expect(s3.textDecoration).toBe('line-through')
    expect(s3.textDecorationStyle).toBe('dotted')
    expect(s3.textDecorationColor).toBe('#00ff00')

    // none 清空（初值语义）
    const s4 = parseStaticStyle('text-decoration: none', () => {}) as Record<string, unknown>
    expect(Object.keys(s4).length, 'none ⇒ 不发射任何字段').toBe(0)

    // 不支持的 token ⇒ 诊断（不静默）
    const d: string[] = []
    parseStaticStyle('text-decoration: underline blink red', (m: string) => d.push(m))
    expect(d.some((x) => x.includes('text-decoration')), '未知 token 有诊断').toBe(true)
  })

  it('④ 纯色简写（无 line）也能折出颜色（Web 允许 `text-decoration: red`）', () => {
    // CSS 的 `text-decoration` 里 line 是**必需**的，只写颜色在 Web 上整条无效 ⇒ 本实现同口径：
    // 只折出颜色、不折 line（宿主按"有颜色无 line ⇒ 无装饰"处理，与 Web 一致）
    const s = parseStaticStyle('text-decoration: red', () => {}) as Record<string, unknown>
    expect(s.textDecoration, '不折 line').toBeUndefined()
    expect(s.textDecorationColor, '颜色照折').toBe('#ff0000')
  })
})

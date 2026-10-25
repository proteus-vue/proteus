// tests/text-indent-spacing-wrap.test.ts —— ★★★批 B F3 收尾三项（2026-10-25 · 基准 = Web）
//   `text-indent` / `word-spacing` / `overflow-wrap`（含 `word-wrap` 旧别名）
//
// 【Web 真值（真 Chromium 实测 · 与浏览器逐条对齐）】
//   · `overflow-wrap`：初值 `normal` ⇒ **长不可断词整体溢出**（实测：100px 盒 + 28 个 a ⇒ scrollWidth 211、
//     高度 1 行）；`break-word` / `anywhere` ⇒ 长词按盒宽折断（高度 3 行）。
//     `word-wrap: break-word` 是 **`overflow-wrap: break-word` 的别名**（computed 同为 break-word）；
//     `word-wrap: anywhere` ⇒ computed `anywhere`。别名必须归一，否则同一语义两条路径各自实现。
//   · `text-indent`：<length>（% 相对包含块宽——需运行时盒宽，本版诊断跳过），**只缩进首行**，
//     且是**可继承**属性（父设、子未声明时继承）。
//   · `word-spacing`：<length>（可为负），**可继承**；初值 `normal` = 0。
//
// 【三端承载】
//   Android：`Paint.setWordSpacing`（**API 29+**；minSdk 24 ⇒ 低版本如实不生效并告警）·
//            `LeadingMarginSpan.Standard`（首行缩进）· `overflow-wrap` = **解除长词抑制**（引擎本就会断长词）·
//   iOS：`NSMutableParagraphStyle.firstLineHeadIndent` · 空格段 `.kern` 叠加（词距）· `effectiveWrap` 放行长词 ·
//   鸿蒙：`OH_Drawing_TypographySetIndents` · `OH_Drawing_SetTextStyleWordSpacing` · `WORD_BREAK_TYPE_BREAK_WORD`。
//   Skyline：官方表**收录 `word-spacing`**（normal / <length>）；`text-indent` / `overflow-wrap` 未收录
//            （后者因引擎**默认就断长词**≈ break-word ⇒ 具名引擎边界，见能力清单 engineLockedEnds）。

import { describe, it, expect } from 'vitest'
import { parseStaticStyle } from '@proteus-vue/compiler'

describe('★★★批 B F3 收尾（text-indent / word-spacing / overflow-wrap · 基准 = Web）', () => {
  it('① overflow-wrap：break-word / anywhere 发射；normal 是初值不发射', () => {
    expect((parseStaticStyle('overflow-wrap: break-word', () => {}) as { overflowWrap?: string }).overflowWrap).toBe('break-word')
    expect((parseStaticStyle('overflow-wrap: anywhere', () => {}) as { overflowWrap?: string }).overflowWrap).toBe('anywhere')
    expect(
      (parseStaticStyle('overflow-wrap: normal', () => {}) as { overflowWrap?: string }).overflowWrap,
      'normal = CSS 初值（不发射，零行为变化）',
    ).toBeUndefined()
  })

  it('② word-wrap 旧别名归一为 overflowWrap（同一语义只有一条路径）', () => {
    expect((parseStaticStyle('word-wrap: break-word', () => {}) as { overflowWrap?: string }).overflowWrap).toBe('break-word')
    expect((parseStaticStyle('word-wrap: anywhere', () => {}) as { overflowWrap?: string }).overflowWrap).toBe('anywhere')
  })

  it('③ overflow-wrap 非法值诊断（不静默近似）', () => {
    const d: string[] = []
    const v = (parseStaticStyle('overflow-wrap: sideways', (m: string) => d.push(m)) as { overflowWrap?: string }).overflowWrap
    expect(v).toBeUndefined()
    expect(d.some((x) => x.includes('overflowWrap') || x.includes('overflow-wrap'))).toBe(true)
  })

  it('④ text-indent：px 折叠为数值；0 是初值不发射；百分比诊断跳过', () => {
    expect((parseStaticStyle('text-indent: 24px', () => {}) as { textIndent?: number }).textIndent).toBe(24)
    expect((parseStaticStyle('text-indent: 0px', () => {}) as { textIndent?: number }).textIndent, '0 = 初值').toBeUndefined()
    expect((parseStaticStyle('text-indent: 0', () => {}) as { textIndent?: number }).textIndent, '裸 0 = 初值').toBeUndefined()
    const d: string[] = []
    expect(
      (parseStaticStyle('text-indent: 10%', (m: string) => d.push(m)) as { textIndent?: number }).textIndent,
      '百分比需包含块宽（本版边界）',
    ).toBeUndefined()
    expect(d.some((x) => x.includes('text-indent') || x.includes('textIndent')), '百分比有诊断').toBe(true)
  })

  it('⑤ word-spacing：正/负/0 与 normal 初值', () => {
    expect((parseStaticStyle('word-spacing: 6px', () => {}) as { wordSpacing?: number }).wordSpacing).toBe(6)
    // 负词距是合法 CSS（紧排）；Web computed 为 -3px
    expect((parseStaticStyle('word-spacing: -3px', () => {}) as { wordSpacing?: number }).wordSpacing).toBe(-3)
    expect((parseStaticStyle('word-spacing: 0px', () => {}) as { wordSpacing?: number }).wordSpacing, '0 = 初值').toBeUndefined()
    expect((parseStaticStyle('word-spacing: normal', () => {}) as { wordSpacing?: number }).wordSpacing, 'normal = 初值').toBeUndefined()
  })
})

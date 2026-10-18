// tests/vapor-font-shorthand.test.ts —— ★★★font 简写（2026-10-18 · 批 B F3 · 基准 = Web）
//
// 【为什么单独成文件】`font` 是**重置型简写**：未给的 style/weight/line-height 一律重置为
//   initial（normal/400/normal），与"只管给了的分量"的直觉相反；且语法有多个易错点
//   （修饰词任意顺序 / 多个 normal 占位 / 斜杠两侧空白 / size 与 weight 的歧义）。
//   这些判据值得独立锁住，也避免 vapor-class-styles.test.ts 继续巨型化（check:file-size 棘轮）。
//
// 【判据（真 Chromium 实测 · 见 packages/compiler/src/font-shorthand.ts 头注）】
//   ① 五长手展开（style/weight/size/line-height/family）
//   ② 未给分量 = initial（包括 line-height ⇒ normal：父级 3 倍行高不得漏进子节点）
//   ③ 修饰词顺序无关；多个 normal 不吞掉字重/字号
//   ④ 无宿主通道的形态（small-caps / stretch / 系统字体关键字）⇒ 诊断，不静默近似
//   ⑤ font-style 长手：显式 normal 也必须发射（否则 = inherit，父级 italic 会串下来）

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, parseStaticStyle } from '@proteus-vue/compiler'

describe('★★★font 简写（批 B F3 · 基准 = Web）', () => {
  it('★⑦h2 font-style（2026-10-18 · 批 B F3 · ★基准 = Web）：italic/oblique 折值 + normal 不发射 + 带角度诊断', () => {
    // 【为什么（以 web 为基准）】斜体是排版能力；★normal **必须显式发射**——CSS 里它压掉父级继承
    //   （不发射 = inherit，实测 italic 父 + normal 子会被错误继承为斜体）。
    //   ★带角度的 `oblique 10deg` 三端字体引擎都无角度语义（Skyline 只有 italic）⇒ 必须诊断，不静默近似。
    const s1 = parseStaticStyle('font-style: italic', () => {})
    expect((s1 as { fontStyle?: string }).fontStyle, 'italic 折值').toBe('italic')
    const s2 = parseStaticStyle('font-style: oblique', () => {})
    expect((s2 as { fontStyle?: string }).fontStyle, 'oblique 折值').toBe('oblique')
    const s3 = parseStaticStyle('font-style: normal', () => {})
    expect((s3 as { fontStyle?: string }).fontStyle, 'normal 显式发射（压掉继承）').toBe('normal')
    const d: string[] = []
    parseStaticStyle('font-style: oblique 10deg', (m: string) => d.push(m))
    expect(d.some((x) => x.includes('font-style')), '带角度有诊断').toBe(true)
  })

  it('★⑦h3 font 简写（2026-10-18 · 批 B F3 · ★基准 = Web）：展开成五个字段 + 未指定分量重置', () => {
    // 【为什么（以 web 为基准）】`font` 是**重置型简写**：未指定的 style/weight/line-height
    //   **全部**复位为 initial（normal/400/normal）。真 Chromium 实测值见 expandFontShorthand 头注。
    const s1 = parseStaticStyle('font: italic bold 20px/1.5 "Helvetica", sans-serif', () => {}) as Record<string, unknown>
    expect(s1.fontStyle, 'style 展开').toBe('italic')
    expect(s1.fontWeight, 'weight 展开').toBe(700)
    expect(s1.fontSize, 'size 展开').toBe(20)
    expect(s1.lineHeight, 'line-height 展开（1.5 倍数）').toBe('1.5')
    // ★与长手 font-family **同一角色归一**（原始候选串 => system 角色，宿主按其解析字体）
    expect(s1.fontFamily, 'family 展开（归一为角色）').toBe('system')
    // 未指定的 weight/style/line-height ⇒ 全部重置为 initial（400 / normal / normal）
    const s2 = parseStaticStyle('font: 16px monospace', () => {}) as Record<string, unknown>
    expect(s2.fontWeight, '省略 weight ⇒ 400').toBe(400)
    expect(s2.fontStyle, '省略 style ⇒ 重置为 normal（显式发射：压掉继承的 italic）').toBe('normal')
    expect(s2.lineHeight, '省略 line-height ⇒ 重置为 normal（压掉继承的 3 倍）').toBe('normal')
    // size/line-height 分开写（斜杠后带空格）
    const s3 = parseStaticStyle('font: bold 18px / 24px serif', () => {}) as Record<string, unknown>
    expect(s3.fontSize).toBe(18)
    expect(s3.lineHeight).toBe('24px')
    // 修饰词顺序无关 + 多个 normal 占位（Chromium 真值：weight 仍为 700、size 仍为 14）
    const s4 = parseStaticStyle('font: normal normal 700 14px serif', () => {}) as Record<string, unknown>
    expect(s4.fontWeight, '多个 normal 不吞掉字重').toBe(700)
    expect(s4.fontSize, 'size 不被字重污染').toBe(14)
    const s5 = parseStaticStyle('font: italic normal 16px serif', () => {}) as Record<string, unknown>
    expect(s5.fontStyle).toBe('italic')
    expect(s5.fontWeight).toBe(400)
    // 不支持的分量 ⇒ 诊断（不静默近似）
    const d: string[] = []
    parseStaticStyle('font: small-caps bold 16px serif', (m: string) => d.push(m))
    expect(d.some((x) => x.includes('font')), 'small-caps 有诊断').toBe(true)
    const d2: string[] = []
    parseStaticStyle('font: menu', (m: string) => d2.push(m))
    expect(d2.some((x) => x.includes('font')), '系统字体关键字有诊断').toBe(true)
    // font: inherit / unset ⇒ 五字段显式继承（可继承属性）；initial 跨端不可知 ⇒ 诊断
    const s6 = parseStaticStyle('font: inherit', () => {}) as Record<string, unknown>
    expect(s6.fontFamily, 'inherit 五字段').toBe('inherit')
    expect(s6.lineHeight).toBe('inherit')
    const d3: string[] = []
    parseStaticStyle('font: initial', (m: string) => d3.push(m))
    expect(d3.some((x) => x.includes('font')), 'initial 有诊断').toBe(true)
  })

  it('★font 简写端到端（2026-10-18 · 批 B F3）：折进节点 style + 显式 normal 压掉继承', () => {
    // 【为什么（以 web 为基准）】简写是**重置型**：父 .root 的 line-height/font-weight 不应漏进
    //   声明了 `font` 的子节点；同时子节点显式 normal 必须能压掉父的 italic（= CSS）。
    const sfc = `<template><view class="root"><text class="leaf">x</text></view></template>
<script setup>const z = 1</script>
<style>
.root { line-height: 3; font-weight: 300; font-style: italic }
.leaf { font: bold 16px serif }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/fs.vue')
    // .root 自身：字体声明与简写不在同一条规则 ⇒ line-height 保持显式 3
    const root = r.template.nodes.find((x) => x.tag === 'view')
    expect((root?.style as { lineHeight?: string }).lineHeight, '父自身 line-height').toBe('3')
    const leaf = r.template.nodes.find((x) => x.tag === 'text')
    const ls = leaf?.style as { fontWeight?: number; fontStyle?: string; lineHeight?: string; fontSize?: number; fontFamily?: string }
    expect(ls.fontWeight, '简写重置父的 300').toBe(700)
    expect(ls.fontStyle, '简写重置父的 italic').toBe('normal')
    expect(ls.lineHeight, '简写重置父的 3 倍行高').toBe('normal')
    expect(ls.fontSize).toBe(16)
    expect(ls.fontFamily, 'serif 角色').toBe('serif')
  })
  it('★`:style` 对象字面量的常量 font 同样展开（与静态 style 同口径）', () => {
    // 【为什么】两条通道若不同源，`<text :style="{ font: ... }">` 会被静默丢弃（本仓踩过的静默类缺陷）。
    const sfc = `<template><view><text :style="{ font: 'bold 16px serif' }">B</text></view></template>
<script setup>const z = 1</script>`
    const r = buildLayoutTemplate(sfc, 'pages/so.vue')
    const t = r.template.nodes.find((n) => n.tag === 'text')!.style as Record<string, unknown>
    expect(t.fontWeight, 'weight').toBe(700)
    expect(t.fontSize).toBe(16)
    expect(t.fontStyle, '未给 style ⇒ 重置 normal').toBe('normal')
    expect(t.lineHeight, '未给行高 ⇒ 重置 normal').toBe('normal')
    expect(t.fontFamily).toBe('serif')
    expect(r.diagnostics.filter((d) => /font/.test(d.message)).length, '不产假诊断').toBe(0)
  })
})

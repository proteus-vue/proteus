// tests/cse-explain.test.ts
// ★★★G-61 B1：**`proteus explain --style` 端到端**（CSE trace 的消费面）
//
// 【为什么单测这条链路（不是"看一次输出就完"）】plan `03-consistency-gates.md` §3.3 把
//   「`proteus explain` 能 trace 到规则与层叠步」列为 B1 的**验收判据**——它是"引擎"与
//   "字段折叠器"的**分界线**。⇒ 必须有机器判据：trace 里出现**选择器 / 层 / 特异性 / 源序 /
//   简写来源 / 继承标记**，且 `--style` 与既有输出（transform trace）共存不破。
//
// 【覆盖】① SFC → 提取 → 计算 → 渲染全链 ② 关键 trace 形态（简写来源 · 层 · important ·
//   继承）③ 未映射项如实显示 ④ 动态 class/style 的如实记录（不静默）
import { describe, it, expect } from 'vitest'
import { explainStyle } from '../packages/cli/src/explain'

const SFC = `<template>
  <view class="page">
    <text class="title">你好</text>
    <view class="card" id="main"><text class="label">卡片</text></view>
  </view>
</template>
<style scoped>
.page { display: flex; padding: 12px 16px }
.title { font-size: 20px; color: #1f2329; margin: 0; margin-top: 8px }
.card { margin-top: 8px; border-radius: 12px 12px 0 0 }
#main { border-top: 1px solid #eeeeee; box-decoration-break: clone }
.label { color: rgb(91, 91, 214) }
</style>
`

describe('★★★G-61 B1 · explain --style（CSE trace 消费面）', () => {
  it('渲染全链：规则数/层/节点 + 逐字段来源（选择器 · 特异性 · 源序）', () => {
    const out = explainStyle(SFC)
    expect(out).toContain('样式计算（G-61 CSE 编译期 CSS 引擎')
    expect(out).toContain('规则 5 条')
    // 字段 ← 选择器 [无层 · 特异性(0,1,0) · 源序#N]
    expect(out).toMatch(/paddingTop = \{"kind":"absolute","dp":12\}\s+← \.page\s+\[无层 · 特异性\(0,1,0\) · 源序#0 · 简写 padding\]/)
    // id 特异性 (1,0,0) + 简写 border-top
    expect(out).toMatch(/borderTopWidth = 1\s+← #main\s+\[无层 · 特异性\(1,0,0\) · 源序#3 · 简写 border-top\]/)
  })

  it('★长手竞争：margin: 0 与 margin-top: 8px 逐长手取胜', () => {
    const out = explainStyle(SFC)
    // .title 的 marginTop 是 8（长手后写胜），其余三边来自简写 0
    expect(out).toMatch(/marginTop = \{"kind":"absolute","dp":8\}\s+← \.title/)
    expect(out).toMatch(/marginLeft = \{"kind":"absolute","dp":0\}\s+← \.title\s+\[.*简写 margin\]/)
  })

  it('继承标记（无本节点规则的字段）', () => {
    const out = explainStyle(SFC)
    expect(out).toContain('← 继承（无本节点规则）')
  })

  it('未映射项如实显示（引擎不消费的长手——不静默丢）', () => {
    const out = explainStyle(SFC)
    // ★★★边框族收口批（2026-10-05）：`border-<side>-style` 已映射（线型批）；
    //   ★★★outline 族项（2026-10-08）：`outline-style` **已映射**（outline 族落地）⇒ 改用仍未映射的长手
    //   `outline-color`…（其实已映射）——用真正不消费的：`box-decoration-break`（App 引擎不消费，非本仓面）。
    expect(out).toContain('未映射到 IR（引擎不消费）：box-decoration-break: clone')
  })

  it('动态 :class / :style 如实记录（v1 不展开——不静默）', () => {
    const dyn = `<template><view :class="{ on: x }" :style="{ color: c }">x</view></template><script setup>const x = true, c = '#000'</script>`
    const out = explainStyle(dyn)
    expect(out).toContain('提取期未展开')
    expect(out).toMatch(/dynamic-class×1/)
    expect(out).toMatch(/dynamic-style×1/)
  })

  it('@layer 与 !important 在 trace 中可见', () => {
    const layered = `<template><view class="a">x</view></template>
<style>
@layer base, theme;
@layer base { .a { margin-top: 4px } }
@layer theme { .a { margin-top: 12px !important } }
</style>`
    const out = explainStyle(layered)
    expect(out).toContain('层 base → theme')
    expect(out).toMatch(/marginTop = \{"kind":"absolute","dp":12\}\s+← \.a\s+\[@layer theme/)
    expect(out).toContain('!important')
  })

  it('--max-nodes 限制输出（防爆炸）', () => {
    const many = `<template><view class="a"><view class="a"><view class="a"><view class="a">x</view></view></view></view></template><style>.a{margin-top:1px}</style>`
    const out = explainStyle(many, { maxNodes: 2 })
    expect(out).toContain('个节点略——用 --max-nodes 调')
  })
})

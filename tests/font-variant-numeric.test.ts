// tests/font-variant-numeric.test.ts —— ★★★`font-variant-numeric: tabular-nums`（2026-10-18 · 批 B F3 · 基准 = Web）
//
// 【判据来源（真 Chromium 151 实测）】`tabular-nums` vs `proportional-nums` 的**宽度差取决于字族**：
//   · Helvetica Neue：pnum 100.53 → tnum **155.69**（+55%）
//   · SF Pro / Georgia：两者相同（字族本身已等宽）
//   ⇒ 该属性是否"看得见"由**字族是否带 tnum 特性**决定（不带则静默无效，与浏览器一致）。
//   ⇒ 本测试不断言像素宽度，只锁**编译期折叠/继承**与**平台层判据同源**。
//
// 【三端通道（都在平台层的唯一设置点）】
//   Android `Paint.setFontFeatureSettings("\"tnum\" 1")` · iOS `UIFontDescriptor.featureSettings`
//   （kNumberSpacing/kMonospacedNumbersSelector）· 鸿蒙 `OH_Drawing_TextStyleAddFontFeature("tnum",1)`。
//   ★tnum 是**另一套字形**（字宽不同）⇒ 度量与绘制必须同源（本仓已因分叉踩过"字被裁而报告全绿"）。
//
// 【MP/Skyline】官方样式表**无该属性** ⇒ 引擎锁死（具名），且无法编译期模拟（字形选择不是字符串变换）。

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, buildVaporSubscriptions, compileVueSfc, parseStaticStyle } from '@proteus-vue/compiler'

const BT = String.fromCharCode(96)

describe('★★★font-variant-numeric: tabular-nums（批 B F3 · 基准 = Web）', () => {
  it('① 编译器折叠：tabular-nums 发射；normal 不发射；其余特性诊断', () => {
    expect((parseStaticStyle('font-variant-numeric: tabular-nums', () => {}) as { fontVariantNumeric?: string }).fontVariantNumeric).toBe('tabular-nums')
    // ★显式 normal **必须发射**：CSS 里它压掉父级继承的 tabular-nums（跳过 = inherit，实测会错继承）
    expect((parseStaticStyle('font-variant-numeric: normal', () => {}) as { fontVariantNumeric?: string }).fontVariantNumeric, 'normal 显式发射').toBe('normal')
    // 其余数字特性无宿主通道 ⇒ 诊断（不静默近似）
    for (const v of ['slashed-zero', 'ordinal', 'diagonal-fractions', 'lining-nums', 'oldstyle-nums', 'proportional-nums']) {
      const d: string[] = []
      const r = parseStaticStyle(`font-variant-numeric: ${v}`, (m: string) => d.push(m)) as { fontVariantNumeric?: string }
      expect(r.fontVariantNumeric, `${v} 不发射`).toBeUndefined()
      expect(d.some((x) => x.includes('font-variant-numeric')), `${v} 有诊断`).toBe(true)
    }
  })

  it('② CSS 继承：子节点未声明时沿用父值（Web 真值）', () => {
    const sfc = BT + `<template><view class="kpi"><text class="plain">1,234</text><text class="off">5,678</text></view></template>
<script setup>const z = 1</script>
<style>
.kpi { font-variant-numeric: tabular-nums }
.off { font-variant-numeric: normal }
</style>` + BT
    const r = buildLayoutTemplate(sfc, 'pages/kpi.vue')
    const styles = r.template.nodes.map((n) => n.style as { fontVariantNumeric?: string })
    expect(styles[0]!.fontVariantNumeric, '父节点').toBe('tabular-nums')
    expect(styles[1]!.fontVariantNumeric, '未声明的子节点继承').toBe('tabular-nums')
    // ★显式 normal 覆盖父值（子节点拿到的是 normal，不是父的 tabular-nums）
    expect(styles[2]!.fontVariantNumeric, '子节点显式 normal 压掉继承').toBe('normal')
  })

  it('③ 订阅槽位 + 节点样式都带值（App 两条路径同源）', () => {
    const sfc = BT + `<template><view class="kpi"><text>{{ price }}</text></view></template>
<script setup>
import { ref } from 'vue'
const price = ref('1,234')
</script>
<style>.kpi { font-variant-numeric: tabular-nums }</style>` + BT
    const sub = buildVaporSubscriptions(sfc, 'pages/kpi.vue')
    const textSlots = sub.table.sources.flatMap((s) => s.slots).filter((s) => s.kind === 'text')
    expect(textSlots.length, '有文本槽位').toBeGreaterThan(0)
    // ★字形选择在**宿主选字体时**消费（不需要指令流）⇒ 关键是节点样式带值
    const tpl = buildLayoutTemplate(sfc, 'pages/kpi.vue')
    expect((tpl.template.nodes[0]!.style as { fontVariantNumeric?: string }).fontVariantNumeric).toBe('tabular-nums')
  })

  it('④ MP 端：静态文本**不被变换**（字形选择不是字符串变换）', () => {
    const sfc = BT + `<template><view class="kpi"><text>1,234</text></view></template>
<script setup>const z = 1</script>
<style>.kpi { font-variant-numeric: tabular-nums }</style>` + BT
    const r = compileVueSfc(sfc, { filename: 'pages/kpi.vue' })
    expect(r.wxml).toContain('1,234')
    // ★诚实边界：Skyline 无该属性（引擎锁死，已在能力清单具名）⇒ 该端数字不等宽。
    //   与 text-transform 的区别：后者可**编译期变换静态文本**，前者不能（字形不是字符串）。
  })
})

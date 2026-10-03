// tests/vapor-dynamic-component.test.ts —— ★★★P3 **动态组件 `:is`**判据（2026-10-03）
//
// 【这一批补的是什么（P3 段）】`<component :is="expr">` 此前产物形态是"空壳"：
//   `:is` 的绑定**从产物里完全消失**（不进 sources、不进 constantSlots、**也无诊断**）
//   ⇒ 节点渲染成不认识的东西且零提示（最危险的一类静默）。
//   本批交出**首帧解析**：
//     · 编译期：`:is` 表达式进 `SubscriptionTable.componentIs`（nodeId + 求值器）；
//       静态 `is="Name"` 直接当静态组件（与 `<Name>` 等价——零新机制）；
//       缺 `:is` / 运行时切换边界各有精确诊断。
//     · 实例化期：求值 → 名字符串 → 查注册表 → 走**静态组件同一条展开链**（子树/偏移/props）。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① 编译：`:is` 进表（不再消失）；静态 `is` 打 component 标记
//   ② 解析：动态值 ⇒ 正确组件展开（子树真建出来、props 走同一条链）
//   ③ 边界：假值 ⇒ 整节点摘除（Vue 同）；非字符串 / 未注册 ⇒ note（不静默）；运行时切换诊断

import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string, script = "const which = ref('PanelA')\n"): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

const PANEL_A = sfc(`<p-view style="height: 30px"><p-text style="color: #ffffff">AAA</p-text></p-view>`)
const PANEL_B = sfc(`<p-view style="height: 40px"><p-text style="color: #ffffff">BBB</p-text></p-view>`)

function build(src: string, name: string): { tpl: LayoutTemplate; table: SubscriptionTable } {
  return { tpl: buildLayoutTemplate(src, name).template, table: buildVaporSubscriptions(src, name).table }
}

function inst(parentSrc: string, read: (n: string) => unknown = (n) => (n === 'which' ? 'PanelA' : undefined)): ReturnType<typeof instantiateTemplate> {
  const parent = build(parentSrc, 'p.vue')
  const a = build(PANEL_A, 'a.vue')
  const b = build(PANEL_B, 'b.vue')
  return instantiateTemplate(parent.tpl, {
    viewport: { width: 1080, height: 800 },
    read,
    table: parent.table,
    registry: new ListRegistry(),
    components: { PanelA: { template: a.tpl, table: a.table }, PanelB: { template: b.tpl, table: b.table } },
  })
}

describe('★P3 动态组件 · 编译期（`:is` 不再消失）', () => {
  it('`:is="expr"` ⇒ 打 componentIs 标记 + 进 componentIs 表（此前完全消失）', () => {
    const src = sfc(`<p-view><component :is="which" /></p-view>`)
    const t = build(src, 'p.vue')
    expect(t.tpl.nodes[1]!.componentIs).toEqual({ expr: 'which' })
    expect(t.table.componentIs).toHaveLength(1)
    expect(t.table.componentIs![0]!.nodeId).toBe(1)
    expect(t.table.componentIs![0]!.expr).toBe('which')
    // ★回归锁：`:is` **不得**再作为渲染槽位出现（不建 sources/constantSlots）
    const allSlots = t.table.sources.flatMap((s) => s.slots).concat(t.table.constantSlots ?? [])
    expect(allSlots.some((sl) => sl.propKey === 'attr.is')).toBe(false)
  })

  it('★静态 `is="PanelB"` ⇒ 当静态组件（与 `<PanelB>` 等价——零新机制）', () => {
    const t = build(sfc(`<p-view><component is="PanelB" /></p-view>`), 'p.vue')
    expect(t.tpl.nodes[1]!.component).toBe('PanelB')
    expect(t.tpl.nodes[1]!.componentIs).toBeUndefined()
    expect(t.table.componentIs ?? []).toHaveLength(0)
  })

  it('★缺 `:is` 必须产诊断（不静默空壳）', () => {
    const msgs = buildLayoutTemplate(sfc(`<p-view><component /></p-view>`), 'p.vue')
      .diagnostics.map((d) => `${d.code}:${d.message}`).join('|')
    expect(msgs).toContain('VAPOR_DYNAMIC_COMPONENT_NO_IS')
  })

  it('★运行时切换的边界必须说清（含替代路径）', () => {
    const d = buildLayoutTemplate(sfc(`<p-view><component :is="which" /></p-view>`), 'p.vue')
      .diagnostics.find((x) => x.code === 'VAPOR_DYNAMIC_COMPONENT_IS')!
    expect(d.message).toContain('按**首帧值**解析组件')
    expect(d.hint).toContain('v-if/v-show')
  })
})

describe('★P3 动态组件 · 实例化（走静态组件同一条展开链）', () => {
  it('动态值解析 ⇒ 正确组件展开（子树真建出来，挂在同一个边界节点下）', () => {
    const r = inst(sfc(`<p-view style="flex-direction: column"><component :is="which" /></p-view>`))
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('AAA')
    expect(texts).not.toContain('BBB')
    expect((r.componentMounts ?? []).map((m) => m.name)).toEqual(['PanelA'])
    // ★标记已摘（分发/解析中间态不进最终树）
    expect(r.nodes.every((n) => !(n as { componentIs?: unknown }).componentIs)).toBe(true)
    // note 如实记录解析结果（不静默）
    expect((r.notes ?? []).join('|')).toContain('解析为 PanelA')
  })

  it('同一条链的**第二个**动态节点解析成另一个组件（不是"都渲染第一个"）', () => {
    const r = inst(
      sfc(`<p-view style="flex-direction: column"><component :is="which" /><component :is="other" /></p-view>`,
        `const which = ref('PanelA')\nconst other = ref('PanelB')\n`),
      (n) => (n === 'which' ? 'PanelA' : n === 'other' ? 'PanelB' : undefined),
    )
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('AAA')
    expect(texts).toContain('BBB')
    expect((r.componentMounts ?? []).map((m) => m.name).sort()).toEqual(['PanelA', 'PanelB'])
  })

  it('★假值 ⇒ 整节点摘除（Vue：`:is` 为假渲染空——不留空壳）', () => {
    const r = inst(sfc(`<p-view style="flex-direction: column"><component :is="none" /><p-text>keep</p-text></p-view>`, `const none = ref('')\n`),
      () => '')
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('keep')
    expect(r.stats.droppedNodeIds, '假值节点进丢弃集').toBeTruthy()
    expect((r.notes ?? []).join('|')).toContain('求值为假')
  })

  it('★边界：非字符串值 / 未注册名 ⇒ 不展开 + note（不静默）', () => {
    const notStr = inst(sfc(`<p-view><component :is="obj" /></p-view>`, `const obj = ref(1)\n`), () => 42)
    expect((notStr.notes ?? []).join('|')).toContain('不是字符串')
    const unknown = inst(sfc(`<p-view><component :is="which" /></p-view>`), () => 'NoSuchComp')
    expect((unknown.notes ?? []).join('|')).toContain('未在注册表里')
  })

  it('★反向：无 `:is` 的普通模板**不产出 componentIs 字段**（既有产物逐字节不变）', () => {
    const t = build(sfc(`<p-view><p-text>x</p-text></p-view>`), 'p.vue')
    expect(t.table.componentIs).toBeUndefined()
    expect(JSON.stringify(t.table)).not.toContain('componentIs')
  })
})

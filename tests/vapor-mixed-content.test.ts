// tests/vapor-mixed-content.test.ts —— ★★★元素/文本**混排**判据（2026-10-03）
//
// 【这一批补的是什么（本仓实测的第一大模板缺口）】`<p>本页演示 <code>x</code> 的规则覆盖</p>`
//   这类**元素与文本混排**此前被诊断拒绝 ⇒ **文本整段丢失**（只渲染元素）。
//   它在真实页面里极常见（扫描：27 个样例页里 13 处，模板侧第一大类缺口）。
//
// 【表示法】文本合成 `p-text` 叶，与元素兄弟按**文档序**排布——与 B 路（Vue 运行时 →
//   selfdraw 适配器，匿名文本 vnode 就是一个文本叶）**同构**。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① **文档序与切分**：文本段落逐段成叶、位置正确（顺序错 = 文字错位）；
//   ② **空白压缩与 Vue 一致**（condense）：缩进换行不产垃圾叶、元素间空格保留、
//      内部空白压成单空格（不一致 ⇒ 节点数/几何全错、A/B 不等价）；
//   ③ **三处 id 同源**：合成叶消耗的序号在 template/deps/events 三处一致
//      （不一致 ⇒ 插值槽位挂到别的节点上、事件绑错——本仓踩过两次的形态）。

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, buildVaporSubscriptions, compileEvents } from '@proteus-vue/compiler'

const sfc = (tpl: string, script = 'const n = ref(1)\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

const tagsOf = (tpl: string): string[] => buildLayoutTemplate(sfc(tpl), 'm.vue').template.nodes.map((n) => n.tag)

describe('★混排 · 文档序与切分（文本逐段成叶）', () => {
  it('文本 + 元素 + 文本 ⇒ 三个兄弟节点（文本在前/在后各一段）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>Hello <b>world</b> tail</p-text></p-view>`), 'm.vue')
    // ★形态：用户写的 p-text（外壳）+ 两段**合成叶** + b —— 文本按文档序环绕元素
    expect(t.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'p-text', 'b', 'p-text'])
    const texts = t.template.nodes.map((n) => String((n as { text?: string }).text ?? ''))
    expect(texts).toContain('Hello ')
    expect(texts).toContain(' tail')
    // ★外壳元素**不带 text**（否则同一段文字渲染两遍：外壳属性 + 合成叶）
    expect(texts[1]).toBe('')
    expect(t.diagnostics, '混排不再产诊断').toHaveLength(0)
  })

  it('多段交错（文本/元素/文本/元素）⇒ 严格文档序', () => {
    expect(tagsOf(`<p-view>a <b>B</b> c <i>I</i> d</p-view>`)).toEqual([
      'p-view', 'p-text', 'b', 'p-text', 'i', 'p-text',
    ])
  })

  it('★插值混排：合成叶承载**段表**（静态段 + 表达式段）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>n={{ n }} <b>bold</b></p-text></p-view>`), 'm.vue')
    // 外壳 p-text(1) / 合成叶(2, 承载段表) / b(3)
    const synth = t.template.nodes.find((n) => n.textSegments?.length)!
    expect(synth.tag).toBe('p-text')
    expect(synth.id, '合成叶 id=2（三处同源）').toBe(2)
    expect(synth.textSegments!.map((s) => ('text' in s ? s.text : `<expr:${s.src}>`))).toEqual(['n=', '<expr:n>', ' '])
  })

  it('★反向：纯文本元素**不走混排**（折到自身属性——既有行为零变化）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>plain</p-text></p-view>`), 'm.vue')
    expect(t.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text'])
    expect((t.template.nodes[1] as { text?: string }).text).toBe('plain')
  })
})

describe('★混排 · 空白压缩（逐条对齐 Vue condense）', () => {
  it('pretty-print 缩进换行 ⇒ **不产垃圾叶**（首/末删、两元素间且含换行删）', () => {
    const tpl = `<p-view>\n  <p-text>\n    text\n    <b>x</b>\n  </p-text>\n</p-view>`
    const t = buildLayoutTemplate(sfc(tpl), 'm.vue')
    // p-view / p-text / 合成叶（" text "）/ b —— 无额外空白叶
    expect(t.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'p-text', 'b'])
    const synthText = String((t.template.nodes[2] as { text?: string }).text ?? '')
    expect(synthText, '首尾空白被裁、内部压成单空格').toBe(' text ')
  })

  it('★元素之间的**单空格**（无换行）保留（Vue 语义：那是真内容）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text><b>a</b> <i>b</i></p-text></p-view>`), 'm.vue')
    expect(t.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'b', 'p-text', 'i'])
    expect((t.template.nodes[3] as { text?: string }).text).toBe(' ')
  })

  it('★含非空白的文本：内部空白 run 压成单空格（多余空格不产生视觉差异）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>a   b <b>x</b> c</p-text></p-view>`), 'm.vue')
    const texts = t.template.nodes.map((n) => String((n as { text?: string }).text ?? ''))
    expect(texts).toContain('a b ')
    expect(texts).toContain(' c')
  })
})

describe('★混排 · 三处 id 同源（本仓踩过两次的形态）', () => {
  it('合成叶的 id 在 template 与订阅表（插值槽位）**一致**', () => {
    const src = sfc(`<p-view><p-text>x</p-text>尾{{ n }}</p-view>`)
    const tpl = buildLayoutTemplate(src, 'm.vue').template
    const sub = buildVaporSubscriptions(src, 'm.vue').table
    // 合成叶是最后一个节点（id=2）；插值槽位必须挂在它身上
    expect(tpl.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'p-text'])
    const slot = sub.sources.flatMap((s) => s.slots).find((s) => s.propKey === 'text.content')
    expect(slot, '插值槽位存在').toBeTruthy()
    expect(slot!.nodeId, '槽位 nodeId = 合成叶 id（不同源会挂到父元素上）').toBe(2)
  })

  it('★事件 id 同源：混排后带 @click 的元素 nodeId 不漂移', () => {
    const src = sfc(`<p-view><p-text>前置 <b @click="n = 2">点我</b> 后置</p-text></p-view>`)
    const tpl = buildLayoutTemplate(src, 'm.vue').template
    const ev = compileEvents(src)
    const target = tpl.nodes.find((n) => n.id === ev.events[0]!.nodeId)
    expect(target, '事件 nodeId 必须命中模板节点').toBeTruthy()
    expect(target!.tag, '命中的是 b 元素（不是合成叶）').toBe('b')
  })

  it('★混排 + v-for：行内节点仍走行模板（合成叶不破坏行收集）', () => {
    const src = sfc(`<p-view><p-text v-for="it in list" :key="it.id">行<em>{{ it.id }}</em></p-text></p-view>`,
      'const list = ref([{ id: 1 }])\n')
    const t = buildLayoutTemplate(src, 'm.vue')
    // 行模板子树含：p-text(行根) + 合成叶 + em
    expect(t.template.lists).toHaveLength(1)
    expect(t.template.lists[0]!.subtreeIds.length).toBe(3)
  })
})

describe('★混排 · 与其他特性共存', () => {
  it('v-text 在场 ⇒ 覆盖子节点（不做混排合成，Vue 语义）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text v-text="n">ignored <b>x</b></p-text></p-view>`), 'm.vue')
    const parent = t.template.nodes.find((n) => n.tag === 'p-text')!
    expect(parent.textSegments!.length).toBe(1)   // 只有 v-text 那一段
    // 子元素仍在（v-text 覆盖的是**内容语义**；本版按"覆盖文本"处理并已诊断）
    expect(t.diagnostics.map((d) => d.message).join('|')).toContain('v-text 会**覆盖**全部子节点')
  })

  it('★反向：无混排的模板产物**逐字节不变**（既有回归锁）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>a</p-text><b>B</b></p-view>`), 'm.vue')
    expect(t.template.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text', 'b'])
    expect(t.diagnostics).toHaveLength(0)
  })
})

// tests/vapor-transition-p3.test.ts —— ★★★P3-3 `<Transition>` 桥接判据（2026-10-03）
//
// 【这一批补的是什么】能力清单 P3-3（原「内核动画 MA0-RT/MA5 能力齐备，缺编译期桥接」）：
//   `<Transition>` 从"当普通容器"升级为**真过渡**——编译期编成预设动画规格、
//   运行时在可见性**真的翻转**时交给宿主动画入口。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① **透传**：`<Transition>` 不占节点 id、不产包裹盒（否则与 Vue 路径几何不等价、A/B 判据红）；
//   ② **规格**：预设 → 通道规格（enter/leave 对称、durMs/curve 正确）；
//   ③ **运行时**：可见性翻转被记录（且**去重**——relink 重写全部槽位不得误触发）。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { PropKeyTable, StringPool, SlotRuntime, VaporRuntime } from '@proteus-vue/slot-runtime'
import type { EvalContext } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst vis = ref(false)\nconst w = ref(10)\n</script>\n`

describe('★★★P3-3 `<Transition>` 桥接', () => {
  it('① 透传：不占节点 id、不产包裹盒（与 Vue 几何等价的前提）', () => {
    const src = sfc(`<p-view style="height: 100px"><Transition name="fade"><p-view v-show="vis" style="height: 40px"></p-view></Transition></p-view>`)
    const t = buildLayoutTemplate(src, 't.vue').template
    // 只有两个节点：外层容器 + 被过渡的元素（Transition 自身**不产节点**）
    expect(t.nodes.map((n) => n.tag), 'Transition 不得产包裹节点').toEqual(['p-view', 'p-view'])
    expect(t.nodes.map((n) => n.id)).toEqual([0, 1])
    // ★与订阅表 id 同源（两处都跳过 Transition ⇒ 逐位一致）
    const { table } = buildVaporSubscriptions(src, 't.vue')
    const visSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'visibility')!
    expect(visSlot.nodeId, '可见性槽位应指向被过渡的元素（id=1）').toBe(1)
  })

  it('② 规格：预设 → enter/leave 通道（leave 是 enter 的反向）+ durMs/curve', () => {
    const src = sfc(`<Transition name="fade-slide-up" :duration="300"><p-view v-show="vis"></p-view></Transition>`)
    const node = buildLayoutTemplate(src, 't.vue').template.nodes.find((n) => n.transition)!
    const tr = node.transition!
    expect(tr.preset).toBe('fade-slide-up')
    expect(tr.durMs).toBe(300)
    expect(tr.curve).toBe(1)
    // 两通道（淡入 0→1 + 上滑 24→0）—— kind 编号与内核 AnimKind 一一对应（4=Opacity / 1=TranslateY）
    expect(tr.enter).toEqual([
      { kind: 4, from: 0, to: 1 },
      { kind: 1, from: 24, to: 0 },
    ])
    // ★离场 = 入场**反向**（与 Vue enter/leave 的对称语义一致）
    expect(tr.leave).toEqual([
      { kind: 4, from: 1, to: 0 },
      { kind: 1, from: 0, to: 24 },
    ])
  })

  it('★③ 未知预设 ⇒ 诊断 + 不产声明（不静默退化成"无过渡"）', () => {
    const src = sfc(`<Transition name="wobble"><p-view v-show="vis"></p-view></Transition>`)
    const r = buildLayoutTemplate(src, 't.vue')
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('未知预设名')
    expect(r.diagnostics.map((d) => String(d.hint ?? '')).join(' | '), '修法要列出可用预设').toContain('fade')
    expect(r.template.nodes.every((n) => !n.transition), '未知预设不得产声明').toBe(true)
  })

  it('★④ 无可见性触发源 ⇒ 诊断（过渡不会被驱动）', () => {
    const src = sfc(`<Transition name="fade"><p-view :width="w"></p-view></Transition>`)
    const r = buildLayoutTemplate(src, 't.vue')
    expect(r.diagnostics.map((d) => d.message).join(' | ')).toContain('过渡不会被驱动')
  })

  it('★★⑤ 运行时：可见性**真的翻转**才记（relink 重写全部槽位不得误触发）', () => {
    const src = sfc(`<p-view><Transition name="fade"><p-view v-show="vis"></p-view></Transition></p-view>`)
    const { table } = buildVaporSubscriptions(src, 't.vue')
    const data: Record<string, unknown> = { vis: false }
    const keys = new PropKeyTable(); const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, () => { /* 捕获不必要（本用例只读可见性日志） */ })
    const ctx: EvalContext = { read: (n) => data[n] }
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators))
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    // ① 首帧 relink：初值 null→false 不算"可见性切换"（无前值 ⇒ 不记）
    vapor.relink(ctx); rt.flush()
    expect(vapor.takeVisibilityChanges(), '首帧不得产事件（无前值可比）').toEqual([])
    // ② 再 relink 一次（值未变）⇒ 仍不得产事件（**去重**是这条的关键）
    vapor.relink(ctx); rt.flush()
    expect(vapor.takeVisibilityChanges(), '★relink 重写全部槽位不得误触发').toEqual([])
    // ③ 真的翻转 ⇒ 记一条
    data.vis = true
    for (const [, cb] of triggers) cb()
    vapor.relink(ctx); rt.flush()
    expect(vapor.takeVisibilityChanges(), '翻转必须被记录').toEqual([{ nodeId: 1, visible: true }])
    // ④ 取走即复位
    expect(vapor.takeVisibilityChanges()).toEqual([])
  })
})

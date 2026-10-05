// tests/cse-dynamic-integration.test.ts
// ★★★G-61 B2：**端到端集成**（SFC → 订阅表发射 classPlans → 运行期查表 → 首帧/增量两条通路）
//
// 【为什么单列（不只靠单测）】B2 的真价值在"**编译产物**能被运行期正确消费"——
//   两套 id 体系（CSE 路径键 ⇄ 运行期 nodeId）与两条通路（instantiate 首帧 / VaporRuntime 增量）
//   任一接错都会**静默错样式**。本文件锁：
//   ① buildVaporSubscriptions 发射的 `classPlans` 键是**运行期 nodeId**（与 slot.nodeId 同空间）
//   ② 映射校验生效（tag 不符 ⇒ 不发射 + 诊断，不硬配）
//   ③ instantiate 首帧：计划在场 ⇒ 字段完整写入（含基线回退）
//   ④ VaporRuntime 增量：类切换 ⇒ onPaintProp 收到正确字段（含关闭时回退）
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { extractFromSfc, buildDynamicClassPlans } from '@proteus-vue/compiler'
import { mapPlansToTemplateNodes } from '../packages/compiler/src/cse/dynamic'
import { ListRegistry, SlotRuntime, VaporRuntime, instantiateTemplate, PropKeyTable, StringPool } from '@proteus-vue/slot-runtime'

const SFC = `<template>
  <view class="card" :class="{ on: a }"><text class="label">x</text></view>
</template>
<script setup>
import { ref } from 'vue'
const a = ref(false)
</script>
<style>
.card { padding: 8px; background-color: #ffffff; color: #333333 }
.on { background-color: #ff0000; color: #ffffff }
</style>`

describe('★★★G-61 B2 · 端到端集成（发射 → 首帧 → 增量）', () => {
  it('① 发射：classPlans 键 = 运行期 nodeId（与 slot.nodeId 同空间）', () => {
    const r = buildVaporSubscriptions(SFC, 't.vue')
    const plans = r.table.classPlans ?? {}
    const keys = Object.keys(plans)
    expect(keys.length).toBeGreaterThan(0)
    // 键必须是该表里真实存在的 nodeId（动态类绑定所在的节点）
    const classSlot = r.table.sources.flatMap((s) => s.slots).find((sl) => sl.propKey === 'paint.class')
    expect(classSlot, '有 paint.class 槽位').toBeTruthy()
    expect(keys).toContain(String(classSlot!.nodeId))
  })

  it('② 映射校验：tag 不符 ⇒ 拒绝硬配（返回 reason，不发射）', () => {
    const ex = extractFromSfc(SFC)
    const { plans } = buildDynamicClassPlans(ex.roots, ex.sheet, ex.classBindings)
    // 人为改 tag ⇒ 校验必须拦住
    const badNodes = [{ id: 0, tag: 'div' }, { id: 1, tag: 'text' }]
    const bad = mapPlansToTemplateNodes(ex.roots, plans, badNodes)
    expect(Object.keys(bad.byNodeId).length).toBe(0)
    expect(bad.reason).toBeTruthy()
    // 数量不符 —— 同样拦住
    const short = mapPlansToTemplateNodes(ex.roots, plans, [{ id: 0, tag: 'view' }])
    expect(short.reason).toContain('元素数不一致')
  })

  it('③ instantiate 首帧：计划在场 ⇒ 写完整字段（含基线回退）', () => {
    const r = buildVaporSubscriptions(SFC, 't.vue')
    const tpl = buildLayoutTemplate(SFC, 't.vue').template
    const data: Record<string, unknown> = { a: false }
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 },
      read: (n) => data[n],
      table: r.table,
      registry: new ListRegistry(),
    })
    const card = inst.nodes.find((n) => (n as { tag?: string }).tag === 'view')!
    // 未激活 ⇒ 基线（来自计划表，而非"空"）
    expect((card as { backgroundColor?: unknown }).backgroundColor).toBe('#ffffff')
    expect((card as { color?: unknown }).color).toBe('#333333')
  })

  it('④ 增量：`a` 翻转 ⇒ onPaintProp 收到新值；翻回 ⇒ **写回基线**（回退）', () => {
    const r = buildVaporSubscriptions(SFC, 't.vue')
    const data: Record<string, unknown> = { a: false }
    const paints: Array<{ nodeId: number; propKey: string; value: unknown }> = []
    const table = JSON.parse(JSON.stringify(r.table)) as typeof r.table
    // SlotRuntime 需要三件套：键表 / 字符串池 / 指令 sink（本测只关心 onPaintProp ⇒ sink 收下即可）
    const slotRt = new SlotRuntime(new PropKeyTable(), new StringPool(), (b: Uint8Array) => { void b })
    const runtime = new VaporRuntime(
      table,
      slotRt,
      VaporRuntime.buildEvaluators(table.evaluators),
      new ListRegistry(),
      undefined,
      0,
      undefined,
      (nodeId, propKey, value) => paints.push({ nodeId, propKey, value }),
    )
    const ctx = { read: (n: string) => (n === 'a' ? data['a'] : undefined) }
    runtime.load(ctx, () => {})
    const flip = (v: boolean): void => {
      data['a'] = v
      runtime.relink(ctx)
    }
    flip(false)
    flip(true)
    const onPaints = paints.filter((p) => p.propKey === 'paint.backgroundColor')
    expect(onPaints.length).toBeGreaterThanOrEqual(1)
    expect(onPaints[onPaints.length - 1]!.value).toBe('#ff0000')
    // 翻回 false ⇒ 必须写回基线（#ffffff）——旧通路做不到（只下发"激活贡献"，靠宿主清旧值）
    flip(false)
    const last = paints.filter((p) => p.propKey === 'paint.backgroundColor').pop()!
    expect(last.value, '关闭后应写回基线（表保证回退）').toBe('#ffffff')
  })
})

// tests/vapor-v3.test.ts
// ★Vapor for Proteus IR · V3：订阅表驱动的槽位运行时（方案 §1.3 L1 完整形态）
//
// 【本文件要证明的核心命题（对应里程碑 V3 的 TS 侧半边）】
//   ① 订阅表能被**加载**：源 → 槽位订阅建立，L1/L0 对账正确
//   ② ★源变化 → 自动求值 → 直写槽位 → 发射指令（**不需要 render、不需要 diff**）
//   ③ 求值函数从**可序列化声明**重建（`member` 免解析；不支持形态必须**上报**而非静默跳过）
//   ④ 首帧 `relink()` 让 L1 槽位出现初值
//   ⑤ 未建立订阅的槽位必须可见（否则是"以为接管了其实没有"）
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { SlotRuntime, VaporRuntime, PropKeyTable, StringPool, decodeOps } from '@proteus-vue/slot-runtime'
import type { EvalContext, OpSink, UpdateOp, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

/** 收集提交的指令（测试用） */
function collector() {
  const ops: UpdateOp[] = []
  const sink: OpSink = (bytes) => {
    ops.push(...decodeOps(bytes).ops)
  }
  return { ops, sink }
}

/** 从订阅表构建运行时 + 桩订阅（记录注册了哪些源） */
function makeRuntime(table: SubscriptionTable) {
  const { ops, sink } = collector()
  const keys = new PropKeyTable()
  const strings = new StringPool()
  const rt = new SlotRuntime(keys, strings, sink)
  const evaluators = VaporRuntime.buildEvaluators(table.evaluators)
  const vapor = new VaporRuntime(table, rt, evaluators)
  const watched = new Set<string>()
  const triggers = new Map<string, () => void>()
  return { ops, rt, vapor, evaluators, watched, triggers }
}

describe('V3 · 订阅表加载与对账', () => {
  it('★加载订阅表：L1 槽位建订阅，L0 计数正确', () => {
    const src = sfc(
      `const a = ref(1)\nconst count = ref(2)\n`,
      `<p-view :style="a" />\n<p-text v-if="a">{{ count }}</p-text>`,
    )
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { vapor, rt } = makeRuntime(table)
    const ctx: EvalContext = { read: (n) => (n === 'a' ? 1 : 2) }
    const res = vapor.load(ctx, (name, cb) => { vapor['watched' as never]; cb; })

    expect(res.l1Slots).toBeGreaterThan(0)
    expect(res.l0Slots).toBeGreaterThan(0) // v-if 内的 slot 走 L0
    expect(res.unsupportedEvaluators).toEqual([])
    // L1 槽位表可对账
    expect(vapor.slotIds().length).toBe(res.l1Slots)
    void rt
  })

  it('★每个 L1 槽位能查出驱动它的源（诊断：解释"这个槽位归谁管"）', () => {
    const src = sfc(`const a = ref(1)\n`, `<p-view :style="a" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { vapor } = makeRuntime(table)
    vapor.load({ read: () => 1 }, () => {})
    const slotId = vapor.slotIds()[0]
    expect(vapor.depsOf(slotId)).toContain('a')
  })
})

describe('V3 · ★源变化 → 自动直写槽位 → 发射指令', () => {
  it('★★核心链路：改源值 ⇒ 一条指令写到位（无 render、无 diff）', () => {
    const src = sfc(`const w = ref(10)\n`, `<p-view :style="w" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { ops, rt, vapor } = makeRuntime(table)

    // 源值容器（模拟 ref.value）
    let wValue = 10
    const ctx: EvalContext = { read: (n) => (n === 'w' ? wValue : undefined) }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    const firstBatch = ops.length
    expect(firstBatch).toBeGreaterThan(0) // 首帧写入

    // ★改源 → 触发订阅 → 自动写槽位
    wValue = 200
    triggers.get('w')!()
    expect(rt.dirtyCount).toBe(1) // 只有一个槽位脏
    rt.flush()
    expect(ops.length).toBeGreaterThan(firstBatch)
    const last = ops[ops.length - 1] as { op: number; value: number }
    expect(last.value).toBe(200)
  })

  it('★源值不变 ⇒ 不产生指令（Object.is 短路仍然生效）', () => {
    const src = sfc(`const w = ref(10)\n`, `<p-view :style="w" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { ops, rt, vapor } = makeRuntime(table)
    const ctx: EvalContext = { read: () => 10 }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    const before = ops.length
    triggers.get('w')!() // 值没变
    rt.flush()
    expect(ops.length).toBe(before)
    expect(rt.getStats().shortCircuits).toBeGreaterThan(0)
  })

  it('★多个槽位共享一个源：源变化时**全部**被写（不遗漏）', () => {
    const src = sfc(`const w = ref(1)\n`, `<p-view :style="w" />\n<p-view :width="w" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { rt, vapor } = makeRuntime(table)
    let wValue = 1
    const ctx: EvalContext = { read: (n) => (n === 'w' ? wValue : undefined) }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))

    wValue = 5
    triggers.get('w')!()
    // 该源驱动的所有槽位都应标脏
    expect(rt.dirtyCount).toBe(table.sources.find((s) => s.sourceName === 'w')!.slots.length)
  })

  it('★首帧 relink 让 L1 槽位出现初值（否则首屏缺这些值）', () => {
    const src = sfc(`const t = ref('hi')\n`, `<p-text>{{ t }}</p-text>`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { ops, rt, vapor } = makeRuntime(table)
    const ctx: EvalContext = { read: () => 'hi' }
    vapor.load(ctx, () => {})
    expect(rt.dirtyCount).toBe(0) // 还没 relink
    vapor.relink(ctx)
    expect(rt.dirtyCount).toBeGreaterThan(0)
    rt.flush()
    expect(ops.length).toBeGreaterThan(0)
  })
})

describe('V3 · 求值函数重建（声明 → 实现）', () => {
  it('★member 形态：纯路径访问（免解析，热路径主力）', () => {
    const table: SubscriptionTable = {
      version: 1,
      sources: [],
      evaluators: [{ evaluatorId: 0, form: 'member', root: 'item', path: 'item.name' }],
      l0Slots: [],
      stats: { l1: 0, l0: 0, l1Rate: 0 },
    }
    const impls = VaporRuntime.buildEvaluators(table.evaluators)
    const ctx: EvalContext = { read: () => ({ name: '耳机' }) }
    expect(impls.get(0)!(ctx)).toBe('耳机')
  })

  it('★member 形态：中途 undefined 不抛错（返回 undefined，由上层决定）', () => {
    const table: SubscriptionTable = {
      version: 1,
      sources: [],
      evaluators: [{ evaluatorId: 0, form: 'member', root: 'a', path: 'a.b.c' }],
      l0Slots: [],
      stats: { l1: 0, l0: 0, l1Rate: 0 },
    }
    const impls = VaporRuntime.buildEvaluators(table.evaluators)
    expect(impls.get(0)!({ read: () => ({ b: null }) })).toBeUndefined()
  })

  it('★const 形态：常量（含数字/布尔/字符串）', () => {
    const table: SubscriptionTable = {
      version: 1,
      sources: [],
      evaluators: [
        { evaluatorId: 0, form: 'const', expr: '42' },
        { evaluatorId: 1, form: 'const', expr: 'true' },
        { evaluatorId: 2, form: 'const', expr: "'hi'" },
      ],
      l0Slots: [],
      stats: { l1: 0, l0: 0, l1Rate: 0 },
    }
    const impls = VaporRuntime.buildEvaluators(table.evaluators)
    const ctx: EvalContext = { read: () => undefined }
    expect(impls.get(0)!(ctx)).toBe(42)
    expect(impls.get(1)!(ctx)).toBe(true)
    expect(impls.get(2)!(ctx)).toBe('hi')
  })

  it('★★不支持的表达式形态必须**上报**（不许静默跳过 = 静默不更新）', () => {
    const src = sfc(`const n = ref(1)\n`, `<p-view :style="n + 1" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    // `n + 1` 是 expr 形态且非纯路径 ⇒ 本参考实现不实例化
    const { vapor } = makeRuntime(table)
    const res = vapor.load({ read: () => 1 }, () => {})
    expect(res.unsupportedEvaluators.length).toBeGreaterThan(0)
    expect(res.unsupportedEvaluators[0].reason).toContain('未实例化')
  })

  it('★expr 形态但内容是纯路径（编译器可能产出）⇒ 仍可实例化', () => {
    const table: SubscriptionTable = {
      version: 1,
      sources: [],
      evaluators: [{ evaluatorId: 0, form: 'expr', expr: 'user.name' }],
      l0Slots: [],
      stats: { l1: 0, l0: 0, l1Rate: 0 },
    }
    const impls = VaporRuntime.buildEvaluators(table.evaluators)
    expect(impls.get(0)!({ read: () => ({ name: 'x' }) })).toBe('x')
  })
})

describe('V3 · 端到端一致性（编译产物 ↔ 运行时行为）', () => {
  it('★★SFC → 订阅表 → 槽位直写：与 V0 探针同一语义（一条指令改一个节点）', () => {
    // 复刻 V0 探针的核心断言：改一个尺寸 = 一条指令、一个脏槽位
    const src = sfc(`const dotW = ref(36)\n`, `<p-view :style="dotW" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const { ops, rt, vapor } = makeRuntime(table)

    let dotW = 36
    const ctx: EvalContext = { read: (n) => (n === 'dotW' ? dotW : undefined) }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)
    rt.flush()
    const before = ops.length

    dotW = 20
    triggers.get('dotW')!()
    rt.flush()

    // ★V0 探针的目标：改一个节点 = 1 条指令（而不是 5003 次 patchProp）
    expect(ops.length - before).toBe(1)
  })

  it('★订阅表 JSON 往返后仍可用（产物可下发的实证）', () => {
    const src = sfc(`const w = ref(1)\n`, `<p-view :style="w" />`)
    const { table } = buildVaporSubscriptions(src, 'a.vue')
    const roundTripped = JSON.parse(JSON.stringify(table)) as SubscriptionTable
    const { rt, vapor } = makeRuntime(roundTripped)
    vapor.load({ read: () => 1 }, () => {})
    vapor.relink({ read: () => 1 })
    expect(rt.dirtyCount).toBeGreaterThan(0)
  })
})

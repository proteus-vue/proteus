// tests/vapor-list-e2e.test.ts
// ★★V4：**真实 v-for 列表的端到端接线**（编译器 → 订阅表 → ListRegistry → 指令）
//
// 【为什么必须有这一层（前面测的都是零件）】
//   · `vapor-list-registry.test.ts` 测的是注册表**自己**（手工构造 slot）
//   · 本文件测的是**编译器真的为 v-for 产出 list-item 槽位**，且运行时能把它
//     解析到具体行的节点上——这是「列表 item 级更新」真正可用的判据。
//
// 【★这条链此前是断的（本仓实测发现的功能缺口）】
//   编译器把 `{{ item.title }}` 当普通槽位产出（nodeId = 模板级序号），
//   而 v-for 的行会实例化 N 次 ⇒ 没有单一固定 nodeId ⇒ 指令会写到"模板那个节点"上。
//   本文件同时锁定「修复后必须带 listId/itemSlotId」这一点。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { ListRegistry, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, OpCode, decodeOps } from '@proteus-vue/slot-runtime'
import type { EvalContext, OpSink, UpdateOp, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

function collector() {
  const ops: UpdateOp[] = []
  const sink: OpSink = (bytes) => {
    ops.push(...decodeOps(bytes).ops)
  }
  return { ops, sink }
}

describe('V4 · ★编译器为 v-for 产出 list-item 槽位', () => {
  it('★★行内绑定带 listId / itemSlotId / itemKind（而不是模板级普通槽位）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, w: 10, title: 'a' }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w">{{ item.title }}</p-text>\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const items = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')

    expect(items.length).toBeGreaterThanOrEqual(2) // :width 与 {{ }} 各一个
    for (const it of items) {
      expect(it.listId).toBe(0)
      expect(typeof it.itemSlotId).toBe('number')
      expect(it.itemKind).toBeDefined()
    }
    // itemSlotId 在行模板内**唯一且连续**
    const ids = items.map((x) => x.itemSlotId!).sort()
    expect(ids).toEqual([...new Set(ids)]) // 无重复
  })

  it('★样式项 itemKind=style、文本项 itemKind=text（决定发 SET_STYLE 还是 SET_TEXT）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, w: 10, title: 'a' }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w">{{ item.title }}</p-text>\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const items = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    const byProp = Object.fromEntries(items.map((x) => [x.propKey, x.itemKind]))
    expect(byProp['layout.width']).toBe('style')
    expect(byProp['text.content']).toBe('text')
  })

  it('★`:key` 不建槽位（它是行标识、非可更新渲染属性）', () => {
    const src = sfc(
      `const list = ref([{ id: 1 }])\n`,
      `<p-view v-for="item in list" :key="item.id">{{ item.id }}</p-view>`,
    )
    const { table, notes } = buildVaporSubscriptions(src, 'l.vue')
    const slots = table.sources.flatMap((s) => s.slots)
    // :key 的 propKey 是 attr.key —— 不应出现在槽位里
    expect(slots.some((x) => x.propKey === 'attr.key')).toBe(false)
    expect(notes.some((n) => n.includes(':key=') && n.includes('不建槽位'))).toBe(true)
  })

  it('★无 :key 的 v-for 会留下诊断（行标识不稳定 ⇒ 运行时须用下标兜底）', () => {
    const src = sfc(`const list = ref([{ w: 1 }])\n`, `<p-view v-for="item in list"><p-text :width="item.w" /></p-view>`)
    const { notes } = buildVaporSubscriptions(src, 'l.vue')
    expect(notes.some((n) => n.includes('无 :key'))).toBe(true)
  })
})

describe('V4 · ★★端到端：行内更新写到**正确的行节点**', () => {
  it('★★注册两行 ⇒ 更新第 2 行 ⇒ 指令打到第 2 行的节点（而非模板级节点）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, w: 10 }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w" />\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const listSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!

    // 模拟真实列表：两行，nodeId 分别为 1001 / 1002
    const reg = new ListRegistry()
    reg.registerItems(listSlot.listId!, [
      { itemKey: '1', slotNodes: { [listSlot.itemSlotId!]: 1001 } },
      { itemKey: '2', slotNodes: { [listSlot.itemSlotId!]: 1002 } },
    ])

    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)

    // 源值：两行的 w（行 1 = 10，行 2 = 20）
    const rows: Record<string, { id: number; w: number }> = { '1': { id: 1, w: 10 }, '2': { id: 2, w: 20 } }
    let currentKey = '1'
    const ctx: EvalContext = {
      read: (n) => (n === 'list' ? Object.values(rows) : n === 'item' ? rows[currentKey] : undefined),
    }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    // ★先建立基线（首次同步会写**全部行**——这是正确行为，相当于 relink）
    //   否则无法区分「首次全量」与「增量只改一行」。本仓纪律：测增量前必须先有基线。
    vapor.relink(ctx)
    rt.flush()
    ops.length = 0

    // 改第 2 行（同步 ctx.read 里的数据源）
    currentKey = '2'
    rows['2'].w = 99
    // ★ctx.read 返回的是 Object.values(rows) 的**快照**——需真实反映变更：
    //   这里用 `list` 源读数组本身（引用同一批 row 对象，改 w 即改数组元素）
    triggers.get('list')!()
    rt.flush()

    // ★判据：指令目标是**第 2 行的节点 1002**（而不是 1001，也不是模板级序号）
    expect(ops.length).toBeGreaterThan(0)
    const styleOps = ops.filter((o) => o.op === OpCode.SET_STYLE) as Array<{ nodeId: number; value: number }>
    expect(styleOps.length).toBe(1)
    expect(styleOps[0].nodeId).toBe(1002)
    expect(styleOps[0].value).toBe(99)
  })

  it('★★未注册行 ⇒ 回退 LIST_UPDATE（不静默丢弃、不写错节点）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, w: 10 }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w" />\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    // 空注册表 ⇒ 解析不到
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry())
    const ctx: EvalContext = { read: (n) => (n === 'list' ? [{ id: 1, w: 5 }] : n === 'item' ? { id: 1, w: 5 } : undefined) }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    triggers.get('list')!()
    rt.flush()
    expect(ops.some((o) => o.op === OpCode.LIST_UPDATE)).toBe(true)
  })

  it('★key 语义：编译产物必须带 scope / itemKeyField / itemValueField（运行时行求值的前提）', () => {
    // 【诚实记录（本仓实测）】我曾想用"两行同值"或"行序与 id 解耦"的数据来**击倒**
    //   "按值反查行"这个错误设计，构造了三轮都**击不倒**——因为值的来源与行的位置
    //   在这套模型里同构（值总是来自某一行，而该值又唯一标识了它）。
    //   ⇒ 与其留一条**通不过破坏性验证**的用例（假绿），不如**直接锁定可验证的语义**：
    //     编译产物必须给出这三个字段，运行时才有"按行取值、按 :key 定位"的依据。
    const src = sfc(
      `const list = ref([{ id: 1, w: 10 }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w" />\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const it0 = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    expect(it0.scope).toBe('item')          // 行作用域别名（rowCtx 求值用）
    expect(it0.itemKeyField).toBe('id')     // 行标识字段（来自 :key="item.id"）
    expect(it0.itemValueField).toBe('w')    // 取值字段（来自依赖路径 item.w）
  })

  it('★跨行不串（更新行 1 不影响行 2 的节点）', () => {
    const src = sfc(
      `const list = ref([{ id: 1, w: 10 }])\n`,
      `<p-view v-for="item in list" :key="item.id">\n  <p-text :width="item.w" />\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'l.vue')
    const listSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    const reg = new ListRegistry()
    reg.registerItems(listSlot.listId!, [
      { itemKey: '1', slotNodes: { [listSlot.itemSlotId!]: 1001 } },
      { itemKey: '2', slotNodes: { [listSlot.itemSlotId!]: 1002 } },
    ])
    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)
    const rows: Record<string, { id: number; w: number }> = { '1': { id: 1, w: 10 }, '2': { id: 2, w: 20 } }
    let cur = '1'
    const ctx: EvalContext = { read: (n) => (n === 'list' ? Object.values(rows) : n === 'item' ? rows[cur] : undefined) }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    // ★先建基线（首次同步写全部行）
    vapor.relink(ctx)
    rt.flush()
    ops.length = 0

    cur = '1'
    rows['1'].w = 77
    triggers.get('list')!()
    rt.flush()
    const targets = (ops.filter((o) => o.op === OpCode.SET_STYLE) as Array<{ nodeId: number }>).map((o) => o.nodeId)
    expect(targets).toContain(1001)
    expect(targets).not.toContain(1002) // ★不串到第 2 行
  })
})

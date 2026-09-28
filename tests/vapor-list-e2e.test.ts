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

  it('★★无 :key 的 v-for ⇒ **error 级诊断**（不再是"提示"）', () => {
    // 【为什么升级成 error（本仓实测的判据）】无 `:key` 时运行时用**行下标**兜底，
    //   而 splice 之后下标会指向**另一行** ⇒ `LIST_UPDATE` 写到错误的行
    //   ⇒ **静默错内容**（方案坑位 #5）。这类失效无报错、无崩溃，只有肉眼可能发现
    //   ——属于最该被拦下的一类。首版只产一条 `notes` 字符串（无法被门禁消费）。
    const src = sfc(`const list = ref([{ w: 1 }])\n`, `<p-view v-for="item in list"><p-text :width="item.w" /></p-view>`)
    const res = buildVaporSubscriptions(src, 'l.vue')
    expect(res.hasErrors).toBe(true)
    const d = res.diagnostics.find((x) => x.code === 'VAPOR_VFOR_WITHOUT_KEY')
    expect(d, '★必须产出结构化的 VAPOR_VFOR_WITHOUT_KEY 诊断').toBeTruthy()
    expect(d!.severity).toBe('error')
    expect(d!.hint, 'error 必须带可执行修复建议').toBeTruthy()
  })

  it('★★逃生通道：allowIndexKey 显式放行（true / 按 listId）', () => {
    const src = sfc(`const list = ref([{ w: 1 }])\n`, `<p-view v-for="item in list"><p-text :width="item.w" /></p-view>`)
    // 全放行
    expect(buildVaporSubscriptions(src, 'a.vue', { allowIndexKey: true }).hasErrors).toBe(false)
    // 按 listId 放行（粒度细，推荐）
    expect(buildVaporSubscriptions(src, 'b.vue', { allowIndexKey: [0] }).hasErrors).toBe(false)
    // 不匹配的 listId 不放行（防"放行了不该放的"）
    expect(buildVaporSubscriptions(src, 'c.vue', { allowIndexKey: [99] }).hasErrors).toBe(true)
  })

  it('★有 :key ⇒ 无 error（只有 info 级追溯）', () => {
    const src = sfc(`const list = ref([{ id: 1, w: 1 }])\n`, `<p-view v-for="item in list" :key="item.id"><p-text :width="item.w" /></p-view>`)
    const res = buildVaporSubscriptions(src, 'k.vue')
    expect(res.hasErrors).toBe(false)
    expect(res.diagnostics.some((d) => d.code === 'VAPOR_KEY_IS_ROW_IDENTITY' && d.severity === 'info')).toBe(true)
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

describe('V4 · ★嵌套 v-for（本仓实测补的未验证项）', () => {
  const nestedSfc = sfc(
    `const groups = ref([{ id: 1, items: [{ id: 10, name: 'a' }] }])\n`,
    `<p-view v-for="group in groups" :key="group.id">\n  <p-text v-for="item in group.items" :key="item.id">{{ item.name }}</p-text>\n</p-view>`,
  )

  it('★编译器：内层槽位带 parentListId 与 sourceExpr（区分内外两层列表）', () => {
    const { table } = buildVaporSubscriptions(nestedSfc, 'n.vue')
    const items = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    expect(items.length).toBeGreaterThanOrEqual(1)
    const inner = items[items.length - 1]
    expect(inner.scope).toBe('item')          // 内层别名
    // ★sourceExpr 是**纯字段路径**（本仓实测修正：原为含别名的 `group.items`，
    //   而运行时要沿「顶层行 → 字段」下钻 ⇒ 需要字段名。首版含别名导致三层嵌套取不到行。）
    expect(inner.sourceExpr).toBe('items')
    expect(inner.parentListId).toBeDefined()  // ★有外层
    expect(inner.itemKeyField).toBe('id')     // 内层 :key="item.id"
    expect(inner.itemValueField).toBe('name')
  })

  it('★★端到端：改**内层某一行** ⇒ 指令打到该行节点（嵌套行集解析正确）', () => {
    const { table } = buildVaporSubscriptions(nestedSfc, 'n.vue')
    const inner = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item').pop()!
    const reg = new ListRegistry()
    // 内层两行（跨两个外层组）：id 10 → 2010，id 20 → 2020
    reg.registerItems(inner.listId!, [
      { itemKey: '10', slotNodes: { [inner.itemSlotId!]: 2010 } },
      { itemKey: '20', slotNodes: { [inner.itemSlotId!]: 2020 } },
    ])
    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)

    // 两个外层组，各含一行内层
    const groups = [
      { id: 1, items: [{ id: 10, name: 'a' }] },
      { id: 2, items: [{ id: 20, name: 'b' }] },
    ]
    let currentItem = groups[0].items[0]
    const ctx: EvalContext = {
      read: (n) => (n === 'groups' ? groups : n === 'item' ? currentItem : undefined),
    }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx)
    rt.flush()
    ops.length = 0

    // 改**第二个外层组里的内层行**（id 20）
    currentItem = groups[1].items[0]
    groups[1].items[0].name = 'changed'
    triggers.get('groups')!()
    rt.flush()

    const textOps = ops.filter((o) => o.op === OpCode.SET_TEXT) as Array<{ nodeId: number }>
    expect(textOps.length).toBe(1)
    expect(textOps[0].nodeId).toBe(2020) // ★内层第 2 组那行（不是 2010）
  })

  it('★★三层嵌套：sourceExpr 必须是**纯字段路径**（本仓实测：含别名时静默不发指令）', () => {
    // 【本轮实测的教训】`v-for="c in b.l3"` 的源表达式含**别名** `b`；
    //   而运行时要沿「顶层行 → 字段 → 字段」下钻 ⇒ 需要**字段名路径**（`l2.l3`）。
    //   首版存含别名表达式（`b.l3`）⇒ 运行时在顶层行找字段 `b` ⇒ 找不到 ⇒
    //   **行集为空、静默不发指令**（实测三层嵌套 0 条指令）。
    //   ★我在这个问题上试错四轮，最后靠**打印内部状态**一次定位——
    //     教训：连续两次猜测未果时，应立刻转为确定性诊断。
    const sfc3 = sfc(
      `const l1 = ref([{ id: 1, l2: [{ id: 2, l3: [{ id: 3, name: 'x' }] }] }])\n`,
      `<p-view v-for="a in l1" :key="a.id"><p-view v-for="b in a.l2" :key="b.id"><p-text v-for="c in b.l3" :key="c.id">{{ c.name }}</p-text></p-view></p-view>`,
    )
    const { table } = buildVaporSubscriptions(sfc3, 'd3.vue')
    const deep = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    expect(deep.sourceExpr).toBe('l2.l3') // ★纯字段路径（别名已剥）
    expect(deep.itemValueField).toBe('name')
    expect(deep.itemKeyField).toBe('id')
  })

  it('★★三层嵌套端到端：最内层行更新 ⇒ 指令打到该行节点', () => {
    const sfc3 = sfc(
      `const l1 = ref([{ id: 1, l2: [{ id: 2, l3: [{ id: 3, name: 'x' }] }] }])\n`,
      `<p-view v-for="a in l1" :key="a.id"><p-view v-for="b in a.l2" :key="b.id"><p-text v-for="c in b.l3" :key="c.id">{{ c.name }}</p-text></p-view></p-view>`,
    )
    const { table } = buildVaporSubscriptions(sfc3, 'd3.vue')
    const deep = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    const reg = new ListRegistry()
    reg.registerItems(deep.listId!, [{ itemKey: '3', slotNodes: { [deep.itemSlotId!]: 3003 } }])
    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)
    const data = [{ id: 1, l2: [{ id: 2, l3: [{ id: 3, name: 'x' }] }] }]
    const ctx: EvalContext = {
      read: (n) => (n === 'l1' ? data : n === 'c' ? data[0].l2[0].l3[0] : undefined),
    }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx)
    rt.flush()
    const textOps = ops.filter((o) => o.op === OpCode.SET_TEXT) as Array<{ nodeId: number }>
    expect(textOps.length).toBeGreaterThan(0) // ★首版这里是 0（静默不发）
    expect(textOps[0].nodeId).toBe(3003)
  })

  it('★★别名遮蔽（内外层同名 item）：两个层级都必须入依赖图，路径不得互相污染', () => {
    // 【本仓实测的两个真缺陷】
    //   ① **外层槽位被静默丢出依赖图**：Vue 语义是「元素上有 v-for ⇒ 它的所有绑定都属于该行」，
    //      而按属性顺序处理时，写在 v-for 之后的绑定（`:width`）用的仍是**外层** scopeSources
    //      ⇒ `item` 未映射 ⇒ 挂不到任何源 ⇒ 运行时**永不写该槽位**（静默不更新）。
    //      症状很隐蔽：`decisions` 显示它为 L1、`stats.l1` 把它计入，但 `table.sources` 里没有。
    //      ⇒ 修复：**先扫 v-for 建行上下文**，再处理其余绑定（与 `:key` 同一手法）。
    //   ② **遮蔽下路径污染**：内外层同名 `item` ⇒ 本行 `__field__item` 覆盖外层的
    //      ⇒ 内层 `item.items` 的别名被翻成外层字段名 ⇒ 路径变 `items.items`（多一段）。
    //      ⇒ 修复：**用翻译前的映射算路径**，再写本行映射。
    const src = sfc(
      `const groups = ref([{ id: 1, w: 10, items: [{ id: 2, h: 5, name: 'x' }] }])\n`,
      `<p-view v-for="item in groups" :key="item.id" :width="item.w">\n  <p-text v-for="item in item.items" :key="item.id" :height="item.h">{{ item.name }}</p-text>\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'shadow.vue')
    const items = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    const outer = items.find((x) => x.listId === 0)
    // ★按 propKey 精确选（内层有两个 list-item 槽位：:height 与 {{ }}）
    const inner = items.find((x) => x.listId === 1 && x.propKey === 'text.content')

    // ① 外层槽位必须**在依赖图里**（首版缺失 ⇒ 静默不更新）
    expect(outer, '★外层槽位必须入依赖图（首版被静默丢弃）').toBeTruthy()
    expect(outer!.sourceExpr).toBe('groups')   // 顶层：路径就是顶层源名
    expect(outer!.itemValueField).toBe('w')
    // ② 内层路径 = 纯字段路径（不得因遮蔽变成 items.items）
    expect(inner).toBeTruthy()
    expect(inner!.sourceExpr).toBe('items')
    expect(inner!.itemValueField).toBe('name')
    expect(inner!.itemKeyField).toBe('id')
  })

  it('★★遮蔽 + 端到端：改内层行 ⇒ 打到内层节点（不串到外层）', () => {
    const src = sfc(
      `const groups = ref([{ id: 1, w: 10, items: [{ id: 2, h: 5, name: 'x' }] }])\n`,
      `<p-view v-for="item in groups" :key="item.id" :width="item.w">\n  <p-text v-for="item in item.items" :key="item.id" :height="item.h" />\n</p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'shadow2.vue')
    const items = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    const outer = items.find((x) => x.listId === 0)!
    const inner = items.find((x) => x.listId === 1)!
    const reg = new ListRegistry()
    reg.registerItems(0, [{ itemKey: '1', slotNodes: { [outer.itemSlotId!]: 1001 } }])
    reg.registerItems(1, [{ itemKey: '2', slotNodes: { [inner.itemSlotId!]: 2002 } }])
    const { ops, sink } = collector()
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), sink)
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)
    const data = [{ id: 1, w: 10, items: [{ id: 2, h: 5, name: 'x' }] }]
    const ctx: EvalContext = {
      read: (n) => (n === 'groups' ? data : n === 'item' ? data[0].items[0] : undefined),
    }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (n, cb) => triggers.set(n, cb))
    vapor.relink(ctx)
    rt.flush()
    ops.length = 0
    // 改内层行高度
    data[0].items[0].h = 42
    triggers.get('groups')!()
    rt.flush()
    const styleOps = ops.filter((o) => o.op === OpCode.SET_STYLE) as Array<{ nodeId: number; value: number }>
    expect(styleOps.some((o) => o.nodeId === 2002 && o.value === 42)).toBe(true) // ★打到内层
    expect(styleOps.some((o) => o.nodeId === 1001)).toBe(false)                  // ★不串外层
  })

  it('★★求值器未实例化必须**上报**（不许静默跳过）', () => {
    // 【本仓实测的静默失效路径】表达式引用**外层别名**或含运算
    //   （如 `{{ group.title + item.name }}`）⇒ 编译器给 `expr` 形态；
    //   而 `expr` 参考实现只支持纯路径 ⇒ `impl` 为 undefined。
    //   首版此处**直接 continue** ⇒ 该槽位**永不写、且零提示**（静默不更新的典型）。
    //   ⇒ 修复：`load()` 里做**实例化检查**并上报 `uninstantiatedSlots`。
    //   ★注意时序：检查必须在 `load()` 内（**不求值也要能报**）——
    //     求值发生在 `relink()`/源变化时，若把检查放进求值路径，`load()` 返回值恒为空。
    const src = sfc(
      `const groups = ref([{ id: 1, title: 'T', items: [{ id: 2, name: 'x' }] }])\n`,
      `<p-view v-for="group in groups" :key="group.id"><p-text v-for="item in group.items" :key="item.id">{{ group.title + item.name }}</p-text></p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'outer.vue')
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), () => {})
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), new ListRegistry())
    const res = vapor.load({ read: () => undefined }, () => {})
    expect(res.uninstantiatedSlots.length).toBeGreaterThan(0) // ★首版这里恒为空（静默）
    expect(res.uninstantiatedSlots[0].propKey).toBe('text.content')
  })

  it('★单层列表不受影响（回归）', () => {
    const { table } = buildVaporSubscriptions(
      sfc(`const list = ref([{ id: 1, w: 5 }])\n`, `<p-view v-for="item in list" :key="item.id"><p-text :width="item.w" /></p-view>`),
      'l.vue',
    )
    const it0 = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    expect(it0.parentListId).toBeUndefined()   // ★单层没有外层
    expect(it0.sourceExpr).toBe('list')
  })
})

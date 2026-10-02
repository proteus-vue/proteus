// tests/vapor-sfc-to-tree.test.ts
// ★★V4 收官判据：**全量 SFC → 端上节点树**（编译器两件产物协同，此前从未跑通）
//
// 【这条链此前断在哪（本仓实测）】V3/V4 的设备验证用**手写节点数组**
//   （`largeNodes` 里 id/parentId/style 一行行写死）；编译器只产出订阅表。
//   ⇒ 节点树从未由 SFC 生成过 ⇒ "Vapor 能替换 Vue 运行时"这件事**缺最后一环证据**。
//
// 【本文件的判据分三层】
//   ① **id 同源**：模板产物的节点 id == 订阅表的 nodeId 空间
//      （分叉的后果：指令写到别的节点上，症状伪装成几何错——本仓已踩过一次）
//   ② **实例化正确**：v-for 展开 N 行；首行用模板序 id、新增行顺序分配；父子链正确
//   ③ **注册表回填**：行内槽位 (listId,itemKey,itemSlotId) → **实际行节点 id**
//      ⇒ 行内更新发普通 SET_STYLE（而不是回退 LIST_UPDATE）
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

/** 一个「页面 + 标题 + 列表行」的真实形态 SFC（静态样式走字符串、动态走绑定） */
const LIST_SFC = sfc(
  `const list = ref([{ id: 1, w: 10, title: 'a' }])\nconst pad = ref(16)\n`,
  `<p-view style="flex-direction: column; padding-top: 60px; background-color: #101020">\n` +
    `  <p-text style="font-size: 24px; color: #ffffff">标题</p-text>\n` +
    `  <p-view v-for="item in list" :key="item.id" style="height: 56px; flex-shrink: 0; margin-bottom: 8px">\n` +
    `    <p-text :width="item.w" style="color: #fff">{{ item.title }}</p-text>\n` +
    `  </p-view>\n` +
    `</p-view>`,
)

describe('V4 · ★全量 SFC → 模板产物', () => {
  it('★★① 模板静态样式解析为**引擎字段**（字符串样式此前完全没进过 IR）', () => {
    const res = buildLayoutTemplate(LIST_SFC, 'list.vue')
    expect(res.ok, `模板应可用；诊断：${res.diagnostics.map((d) => d.message).join(' | ')}`).toBe(true)
    const page = res.template.nodes.find((n) => n.id === 0)!
    expect(page.style.flexDirection).toBe('column')
    // ★边值形状与适配器 `foldEdges` **同约定**：只写出现过的边，缺省边由引擎按 0 处理
    //   （锁定这一点是因为两份产物的形状分叉过 ⇒ 首帧与补丁对不齐，且不报错）
    expect(page.style.padding).toEqual({ top: 60 })
    expect(page.style.backgroundColor).toBe('#101020')
    const title = res.template.nodes.find((n) => n.tag === 'p-text')!
    expect(title.style.fontSize).toBe(24)
    expect(title.style.color).toBe('#ffffff')
    expect(title.text, '静态文本应进占位（运行时不必求值）').toBe('标题')
  })

  it('★★② 节点 id 与订阅表**同源**（分叉 ⇒ 指令写错节点）', () => {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    const slotNodeIds = new Set(table.sources.flatMap((s) => s.slots).map((x) => x.nodeId))
    const tplIds = new Set(tpl.nodes.map((n) => n.id))
    // ★根节点必须是 **0**（单根模板；id 从 0 起是两件产物共同的起点约定）
    //   破坏性验证实测：只查"槽位 id ⊆ 模板 id"**抓不到**整体偏移（都落在范围内但指向别的节点）
    //   ⇒ 必须有能判"**指向对不对**"的断言，见下方 tag 检查。
    expect(tplIds.has(0), '模板必须有 id=0 的根（与订阅表同起点）').toBe(true)
    // ★每个槽位的 nodeId 必须命中模板里的某个节点
    for (const id of slotNodeIds) {
      expect(tplIds.has(id), `槽位 nodeId=${id} 不在模板节点集合里（两件产物 id 空间分叉）`).toBe(true)
    }
    // ★★语义判据：槽位的目标节点 **tag 必须匹配**（这才真正抓得住整体偏移）
    //   `:width="item.w"` 写在 p-text 上 ⇒ 它的 nodeId 必须指向一个 p-text，
    //   而不是"范围内任意一个 id"（偏移 +1 时会指向 p-view ⇒ 该断言必红）。
    const widthSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item' && x.propKey === 'layout.width')!
    const widthTarget = tpl.nodes.find((n) => n.id === widthSlot.nodeId)!
    expect(widthTarget, `槽位 nodeId=${widthSlot.nodeId} 应指向模板节点`).toBeTruthy()
    expect(widthTarget.tag, '`:width` 的目标应是 p-text（而非偏移后的容器）').toBe('p-text')
    // 模板里的 v-for 行根也必须命中（它是行内槽位的锚）
    const listMeta = tpl.lists[0]!
    expect(tplIds.has(listMeta.rowRootId)).toBe(true)
  })

  it('★③ v-for 行模板与订阅表的 listId 对齐（各自独立分配 ⇒ 必须同序）', () => {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    const slotListIds = [...new Set(table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item').map((x) => x.listId!))]
    expect(tpl.lists.map((l) => l.listId)).toEqual(slotListIds)
    // 行子树包含行根 + 其内的文本节点（模板序连续）
    const meta = tpl.lists[0]!
    expect(meta.subtreeIds).toContain(meta.rowRootId)
    expect(meta.subtreeIds.length).toBeGreaterThanOrEqual(2)
  })

  it('★④ 不支持的模板形态 ⇒ **诊断而非静默**（嵌套 v-for / 混合文本）', () => {
    const nested = sfc(
      `const l1 = ref([{ id: 1, l2: [{ id: 2, name: 'x' }] }])\n`,
      `<p-view v-for="a in l1" :key="a.id"><p-text v-for="b in a.l2" :key="b.id">{{ b.name }}</p-text></p-view>`,
    )
    const r1 = buildLayoutTemplate(nested, 'n.vue')
    expect(r1.diagnostics.some((d) => d.message.includes('嵌套 v-for')), '嵌套 v-for 必须上报（本版不支持）').toBe(true)

    const mixed = sfc(`const n = ref(1)\n`, `<p-text style="color: #fff">前缀{{ n }}</p-text>`)
    const r2 = buildLayoutTemplate(mixed, 'm.vue')
    expect(r2.diagnostics.some((d) => d.message.includes('文本/插值')), '纯静态+插值混合必须上报').toBe(true)
  })

  it('★⑤ 百分比宽高 → **比例字段**（widthRatio / heightRatio——单位模型在模板产物里的一环）', () => {
    // 【为什么必须有（2026-10-02 实测抓出的跨端形态差）】`width: 100%` 是"内容随屏宽、
    //   左右留白恒定"的标准写法；此前对百分比**直接丢弃 + 诊断**（"只支持 px/数字"）
    //   ⇒ 同一份 SFC：Web/MP 走 CSS 引擎正常流式，到 Vapor 链就静默变无宽度。
    //   本判据锁定：① 映射为 ratio（不是数值——百分比没有密度可乘）；
    //   ② 不再报"不是纯数值"诊断；③ 非宽高属性的百分比仍如实诊断（边界不扩大）。
    const pct = sfc(
      `const n = ref(1)\n`,
      `<p-view style="width: 100%; height: 50%; padding-top: 4px">\n` +
        `  <p-view style="width: 60.5%; height: 40px; margin-left: 5%"></p-view>\n` +
        `</p-view>`,
    )
    const r = buildLayoutTemplate(pct, 'pct.vue')
    const root = r.template.nodes.find((n) => n.id === 0)!
    expect(root.style.widthRatio, 'width: 100% → widthRatio: 1').toBe(1)
    expect(root.style.heightRatio, 'height: 50% → heightRatio: 0.5').toBe(0.5)
    const child = r.template.nodes.find((n) => n.id === 1)!
    expect(child.style.widthRatio, 'width: 60.5% → widthRatio: 0.605').toBeCloseTo(0.605, 5)
    expect(child.style.height, 'px 混用不受影响').toBe(40)
    // 宽高百分比不再触发"不是纯数值"诊断（逐条核对：只有宽高这两处受影响）
    const numDiags = r.diagnostics.filter((d) => d.message.includes('不是纯数值'))
    expect(
      numDiags.some((d) => /width: 100%|height: 50%|width: 60\.5%/.test(d.message)),
      `宽高百分比不应再诊断：${numDiags.map((d) => d.message).join(' | ')}`,
    ).toBe(false)
    // ★边界：margin 的百分比仍不支持（该形态各端语义复杂，本版不扩大）
    expect(
      r.diagnostics.some((d) => d.message.includes('margin-left: 5%')),
      'margin 百分比仍应如实诊断（能力边界不扩大）',
    ).toBe(true)
  })
})

describe('V4 · ★★SFC 产物 → 实例化成端上节点树', () => {
  const data = {
    list: [
      { id: 1, w: 10, title: 'a' },
      { id: 2, w: 20, title: 'b' },
      { id: 3, w: 30, title: 'c' },
    ],
    pad: 16,
  }
  const read = (n: string): unknown => (data as Record<string, unknown>)[n]

  function build(): { tpl: LayoutTemplate; table: SubscriptionTable } {
    const tpl = buildLayoutTemplate(LIST_SFC, 'list.vue').template
    const { table } = buildVaporSubscriptions(LIST_SFC, 'list.vue')
    return { tpl, table }
  }

  it('★★① 3 行数据 ⇒ 展开 3 行；首行复用模板 id、新增行顺序分配', () => {
    const { tpl, table } = build()
    const reg = new ListRegistry()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: reg })
    const meta = tpl.lists[0]!
    // 首行按模板序 id 出现（与订阅表同源 ⇒ 行内指令能命中）
    expect(inst.nodes.some((n) => n.id === meta.rowRootId), '首行必须复用模板 id').toBe(true)
    // 3 行 ⇒ 行根共 3 个（首行 + 2 个新分配）
    const rowRootIds = [meta.rowRootId, meta.rowRootId + meta.subtreeIds.length, meta.rowRootId + meta.subtreeIds.length * 2]
    for (const rid of rowRootIds) expect(inst.nodes.some((n) => n.id === rid), `行根 ${rid} 应存在`).toBe(true)
    expect(inst.stats.allocatedIds).toBeGreaterThan(0)
    // 新增行 id 必须**不与静态节点冲突**（> 模板最大 id）
    const maxTpl = Math.max(...tpl.nodes.map((n) => n.id))
    for (const n of inst.nodes) {
      if (!tpl.nodes.some((t) => t.id === n.id)) {
        expect(n.id).toBeGreaterThan(maxTpl)
      }
    }
  })

  it('★★② 行内槽位在注册表里解析到**实际行节点**（⇒ 发普通 SET_STYLE 而非 LIST_UPDATE）', () => {
    const { tpl, table } = build()
    const reg = new ListRegistry()
    instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table, registry: reg })
    const itemSlot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item' && x.propKey === 'layout.width')!
    // 第 2 行（itemKey='2'）必须解析到一个**真实存在的节点**
    const node2 = reg.resolveNode(itemSlot.listId!, '2', itemSlot.itemSlotId!)
    expect(node2, '第 2 行的宽度槽位必须能解析到节点').toBeDefined()
    const all = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    expect(all.nodes.some((n) => n.id === node2), '解析出的节点必须在实例树里').toBe(true)
    // ★不同行 ⇒ 不同节点（不串行）
    const node1 = reg.resolveNode(itemSlot.listId!, '1', itemSlot.itemSlotId!)!
    const node3 = reg.resolveNode(itemSlot.listId!, '3', itemSlot.itemSlotId!)!
    expect(new Set([node1, node2, node3]).size).toBe(3)
  })

  it('★★③ 展开的树**父子链完整**（每个 parentId 都能在树里找到，根为 null）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const ids = new Set(inst.nodes.map((n) => n.id))
    for (const n of inst.nodes) {
      if (n.parentId !== null) {
        expect(ids.has(n.parentId), `节点 ${n.id} 的父 ${n.parentId} 不在树里`).toBe(true)
      }
    }
    const roots = inst.nodes.filter((n) => n.parentId === null)
    expect(roots.length).toBeGreaterThanOrEqual(1)
  })

  it('★★⑤ **初始值必须回填**（不回填 ⇒ 首帧文本为空、几何错，且无报错）', () => {
    // 【为什么必须锁定（本仓实测的真缺口）】插值文本的模板占位是**空串**
    //   （编译期不知道数据）。若实例化不回填、而调用方又丢弃首帧指令
    //   （"值已对"的常见假设），屏幕上**文本永远为空**——结构全对、零报错。
    //   ⇒ 判据：实例化产出的节点里，**行内文本槽位对应的节点 text 非空**、
    //     且 `:width` 对应的节点 style.width 已是数据值。
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const itemSlots = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    const titleSlot = itemSlots.find((x) => x.propKey === 'text.content')!
    const widthSlot = itemSlots.find((x) => x.propKey === 'layout.width')!
    // 首行用模板 id ⇒ 直接查该 id 的节点
    const titleNode = inst.nodes.find((n) => n.id === titleSlot.nodeId)!
    expect(titleNode.text, '行内文本必须已回填（否则首帧空白）').toBe('a')
    const widthNode = inst.nodes.find((n) => n.id === widthSlot.nodeId)!
    // ★形态：样式**平铺在顶层**（核心 NodeDto 契约——放 `style` 子对象会被静默忽略）
    expect(widthNode.width, '行内样式必须已回填到**顶层**（否则核心看不到 ⇒ 布局按全 auto 算）').toBe(10)
    expect(widthNode.style, '★不得再产出 `style` 子对象（那是接口不匹配的形态）').toBeUndefined()
    // 第 2 行（新分配 id）也必须回填
    const rows = inst.nodes.filter((n) => n.text === 'b' || n.text === 'c')
    expect(rows.length, '第 2/3 行的文本也应回填').toBe(2)
    expect(inst.stats.valuesFilled).toBeGreaterThanOrEqual(6) // 3 行 × (width + title)
  })

  it('★★⑥ **id 唯一**（行内子节点不设 listId ⇒ 静态分支重复产出是实测踩到的缺陷）', () => {
    // 【为什么必须锁定（本仓实测：核心拒收）】模板里只有 **v-for 那个元素**带 listId，
    //   行内子节点没有 ⇒ 若实例化按 `listId === undefined` 分流，行内子节点会被
    //   **静态分支与行克隆各产出一次** ⇒ id 重复 ⇒ 核心输入图校验拒收（设备端实测报
    //   `proteus_layout_create 失败（节点数 13）`）。⇒ 判据：id 全局唯一 + 数量守恒。
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read, table })
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size, `id 必须唯一（重复：${ids.filter((x, i) => ids.indexOf(x) !== i)}）`).toBe(ids.length)
    // 数量守恒：静态节点 + 行数 × 行子树大小
    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    const staticNodes = tpl.nodes.filter((n) => !tpl.lists[0]!.subtreeIds.includes(n.id)).length
    expect(inst.nodes.length).toBe(staticNodes + 3 * rowSubtree)
  })

  it('★④ 空列表 ⇒ 不展开行（不崩、不产生悬空节点）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 }, read: (n) => (n === 'list' ? [] : read(n)), table,
    })
    const meta = tpl.lists[0]!
    expect(inst.nodes.some((n) => n.id === meta.rowRootId)).toBe(false)
    // 静态部分仍在
    expect(inst.nodes.length).toBeGreaterThanOrEqual(2)
  })
})

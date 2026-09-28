// tests/vapor-long-list-instantiate.test.ts
// ★★V11：**真实长列表**下的模板实例化 + ListRegistry 行内解析
//
// 【为什么要这一层（本仓实测的覆盖缺口）】
//   `instantiateTemplate` 与 `ListRegistry` 在 V6 用例里只跑过 **3 行 / 11 节点**——
//   而"真实长列表"（数百至数千行）才是这套机制的实际目标场景。规模上去后会暴露：
//   ① **id 分配**是否会与模板 id 冲突（首行复用模板 id，后续行另分配）
//   ② **行集解析**是否随行数线性（不能退化成 O(n²)）
//   ③ **注册表**在 N 行下是否每条都能解析到正确节点（不串行）
//   ④ **父子链**是否完整（几千节点里漏一个就是静默坏树）
//
// 【诚实边界】本测试跑在 Node（桌面），**不是真机**——它验证的是**逻辑正确性与复杂度**；
//   真机端到端另有 `V6`/`V11` 用例（`--bench --cases=V11`）。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

/** 与 gen-vapor-table.mjs 同构的「页面 + 标题 + 行列表」SFC（行内含 :width 与 {{ }}） */
const LIST_SFC = sfc(
  `const list = ref([{ id: 1, dotW: 36, textW: 120, title: 'a' }])\n`,
  `<p-view style="flex-direction: column; padding-top: 60px; background-color: #101020">\n` +
    `  <p-text style="font-size: 24px; color: #ffffff">标题</p-text>\n` +
    `  <p-view v-for="item in list" :key="item.id" style="flex-direction: row; align-items: center; height: 56px; flex-shrink: 0; margin-bottom: 8px">\n` +
    `    <p-view :width="item.dotW" style="height: 36px; flex-shrink: 0" />\n` +
    `    <p-text :width="item.textW" style="font-size: 16px">{{ item.title }}</p-text>\n` +
    `  </p-view>\n` +
    `</p-view>`,
)

type NodeLite = { id: number; parentId: number | null }

function build(): { tpl: LayoutTemplate; table: SubscriptionTable } {
  const tpl = buildLayoutTemplate(LIST_SFC, 'long.vue').template
  const { table } = buildVaporSubscriptions(LIST_SFC, 'long.vue')
  return { tpl, table }
}

function makeRows(n: number): Array<{ id: number; dotW: number; textW: number; title: string }> {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, dotW: 36, textW: 120, title: `行 ${i + 1}`,
  }))
}

describe('V11 · 长列表实例化（规模上去后的正确性与复杂度）', () => {
  it('★★① 1000 行 ⇒ 节点数 = 静态 + 行数 × 行子树（不重不漏）', () => {
    const { tpl, table } = build()
    const rows = makeRows(1000)
    const data: Record<string, unknown> = { list: rows }
    const reg = new ListRegistry()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 },
      read: (n) => data[n],
      table,
      registry: reg,
    })
    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    const staticNodes = tpl.nodes.filter((n) => !tpl.lists[0]!.subtreeIds.includes(n.id)).length
    expect(rowSubtree, '行子树应含 3 个模板节点（行根 + 圆点 + 文本）').toBe(3)
    expect(inst.nodes.length, '节点数 = 静态 + 1000×行子树').toBe(staticNodes + 1000 * rowSubtree)
    // ★id 唯一（重复 id 会让核心拒收 —— 本仓踩过）
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size, '1000 行下 id 仍必须唯一').toBe(ids.length)
  })

  it('★★② 每条注册表项都能解析到**真实存在**的节点（1000 行不串行）', () => {
    const { tpl, table } = build()
    const rows = makeRows(1000)
    const data: Record<string, unknown> = { list: rows }
    const reg = new ListRegistry()
    instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table, registry: reg })
    const itemSlots = table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
    expect(itemSlots.length, '本 SFC 应产出 3 个行内槽位（dotW / textW / title）').toBe(3)

    const allIds = new Set(
      instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table }).nodes.map((n) => n.id),
    )
    // ★每一行的每个槽位都要解析到树里的**真实节点**
    //
    // ★判据修正（本仓实测的自我纠错）：首版断言"3 槽位 × 5 行 = 15 个不同节点"——
    //   **错的**：同一行的多个槽位可以指向**同一个节点**（`{{ item.title }}` 与
    //   `:width="item.textW"` 本来就作用在同一个 `p-text` 上）⇒ 15 个槽位只对应 10 个节点。
    //   ⇒ 正确判据：**按行**看（每行解析出的节点集），**跨行不得相同**。
    const perRow: Array<Set<number>> = []
    for (const key of ['1', '2', '500', '999', '1000']) {
      const rowNodes = new Set<number>()
      for (const sl of itemSlots) {
        const node = reg.resolveNode(sl.listId!, key, sl.itemSlotId!)
        expect(node, `行 ${key} 槽位 ${sl.itemSlotId} 应能解析`).toBeDefined()
        expect(allIds.has(node!), `行 ${key} 槽位 ${sl.itemSlotId} 解析出的节点应在树里`).toBe(true)
        rowNodes.add(node!)
      }
      expect(rowNodes.size, `行 ${key} 应解析到 ≥2 个不同节点（行根内至少两个元素）`).toBeGreaterThanOrEqual(2)
      perRow.push(rowNodes)
    }
    // ★跨行不得串：任意两行的节点集**不相交**
    for (let i = 0; i < perRow.length; i++) {
      for (let j = i + 1; j < perRow.length; j++) {
        const inter = [...perRow[i]!].filter((x) => perRow[j]!.has(x))
        expect(inter, `行 ${i} 与行 ${j} 解析到了相同节点（跨行串了）：${inter}`).toEqual([])
      }
    }
  })

  it('★★③ 行集解析必须是**线性**的（4000 行不得退化——本仓对 O(n²) 有实测教训）', () => {
    const { tpl, table } = build()
    const measure = (n: number): number => {
      const rows = makeRows(n)
      const data: Record<string, unknown> = { list: rows }
      const t0 = performance.now()
      instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (k) => data[k], table })
      return performance.now() - t0
    }
    // 预热（JIT）
    measure(200)
    const t1k = measure(1000)
    const t4k = measure(4000)
    // 线性 ⇒ 4× 规模约 4× 耗时；给 12× 余量避开抖动（O(n²) 会是 16×）
    const ratio = t4k / Math.max(t1k, 0.01)
    expect(ratio, `4000/1000 耗时比 ${ratio.toFixed(2)}×（线性≈4× · O(n²)≈16×）`).toBeLessThan(12)
  })

  it('★④ 空列表 ⇒ 只出静态部分（不崩、不留悬空行）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 },
      read: (n) => (n === 'list' ? [] : undefined),
      table,
    })
    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    const staticNodes = tpl.nodes.filter((n) => !tpl.lists[0]!.subtreeIds.includes(n.id)).length
    expect(inst.nodes.length).toBe(staticNodes)
    // 每个 parentId 都能在树里找到（除根）
    const ids = new Set(inst.nodes.map((n) => n.id))
    for (const n of inst.nodes) {
      if (n.parentId !== null) expect(ids.has(n.parentId), `父 ${n.parentId} 应在树里`).toBe(true)
    }
  })

  it('★★⑤ 父子链完整（抽 1000 行的**全部**节点逐一校验）', () => {
    const { tpl, table } = build()
    const rows = makeRows(1000)
    const data: Record<string, unknown> = { list: rows }
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table })
    const ids = new Set(inst.nodes.map((n) => n.id))
    let roots = 0
    for (const n of inst.nodes) {
      if (n.parentId === null) { roots += 1; continue }
      expect(ids.has(n.parentId), `节点 ${n.id} 的父 ${n.parentId} 必须在树里（1000 行下漏一个就是静默坏树）`).toBe(true)
    }
    expect(roots, '应有唯一根').toBe(1)
  })
})

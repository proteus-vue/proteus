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

  /* ─────────────── ★★虚拟化描述（宿主按行物化/回收的前提）─────────────── */

  it('★★⑥ 虚拟化行表：行数/顺序/整行覆盖都正确（宿主按它物化 ⇒ 错一个就是错一层）', () => {
    const { tpl, table } = build()
    const N = 500
    const rows = makeRows(N)
    const data: Record<string, unknown> = { list: rows }
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table })

    expect(inst.virtual, '单列表必须给出虚拟化描述').toBeTruthy()
    const vr = inst.virtual!.rows
    expect(vr.length).toBe(N)
    // ★行号必须**升序**（宿主对可见区做二分查找的前提）
    expect(vr.map((r) => r.index)).toEqual(Array.from({ length: N }, (_, i) => i))
    // ★行键来自数据（订阅表的 itemKeyField = id）
    expect(vr[0]!.key).toBe('1')
    expect(vr[N - 1]!.key).toBe(String(N))

    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    const instIds = new Set(inst.nodes.map((n) => n.id))
    const seen = new Set<number>()
    for (const r of vr) {
      expect(r.ids.length, `行 ${r.index} 的节点数应等于行子树规模`).toBe(rowSubtree)
      // 行根必须是该行 ids 的**首个**（宿主按 ids 顺序建层，父必须在前）
      expect(r.ids[0], `行 ${r.index} 的 ids[0] 应为行根`).toBe(r.root)
      // 整行覆盖：每个 id 真实存在、且**不跨行复用**
      for (const id of r.ids) {
        expect(instIds.has(id), `行 ${r.index} 的节点 ${id} 不在实例树里`).toBe(true)
        expect(seen.has(id), `节点 ${id} 同时属于多行（行集合重叠 ⇒ 宿主会重复建/错杀层）`).toBe(false)
        seen.add(id)
      }
    }
    // ★行节点总数 + 静态节点 = 全树（不重不漏的定量判据）
    const staticNodes = tpl.nodes.filter((n) => !tpl.lists[0]!.subtreeIds.includes(n.id)).length
    expect(seen.size + staticNodes).toBe(inst.nodes.length)
  })

  it('★★⑦ 破坏性：若行表只含行根（= 宿主自己按 listId 分组的做法），⑥ 的覆盖判据必须变红', () => {
    const { tpl, table } = build()
    const rows = makeRows(20)
    const data: Record<string, unknown> = { list: rows }
    const inst = instantiateTemplate(tpl, { viewport: { width: 390, height: 844 }, read: (n) => data[n], table })
    const rowSubtree = tpl.lists[0]!.subtreeIds.length
    // ⇒ 反例：宿主自行按 listId 分组 —— 行内子节点不带 listId ⇒ 只能拿到行根
    const rootOnly = inst.virtual!.rows.map((r) => ({ ...r, ids: [r.root] }))
    expect(rootOnly.every((r) => r.ids.length === 1), '反例构造应确实只含行根').toBe(true)
    // ⇒ 用反例去跑⑥的"整行覆盖"判据，必须失败（证明该判据有区分力）
    const covered = new Set(rootOnly.flatMap((r) => r.ids))
    const expected = inst.virtual!.rows.flatMap((r) => r.ids)
    expect(covered.size, '只拿行根覆盖不到整行 ⇒ ⑥ 的判据会红').toBeLessThan(expected.length)
    expect(expected.length / rowSubtree, '行表应覆盖全部行的全部节点').toBe(rows.length)
  })
})

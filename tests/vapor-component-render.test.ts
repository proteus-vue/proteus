// tests/vapor-component-render.test.ts —— ★★★P1-3 **组件内部渲染**判据（2026-10-03）
//
// 【这一批补的是什么（能力清单 P1-3）】P1 第一批只交"组件边界标记 + props 通道"——
//   组件**内部是空的**（标记在那儿，没人渲染它）。本批交出**内部渲染**：
//     · 实例化按**注册表**展开组件内部（子树 + id 平移，可递归）；
//     · props **下行**（父源 → 子组件求值上下文的首帧值）；
//     · props **上行更新**（父源变化 → 回调 → 子运行时把变化编成**它自己的指令流**）。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① **展开**：子树真的建出来、挂在边界节点下、id **不撞父树**（不偏移必撞——实测过）；
//   ② **下行**：子节点首帧就带 props 值（响应式 props 取源值 / 字面量 props 走常量求值）；
//   ③ **上行**：父改 props ⇒ 子运行时发的指令 `nodeId` 落在**父树空间**（指向子节点，
//      而不是父树的同名 local id——本仓实测：不加偏移会静默写到父级容器上）。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, OpCode, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, decodeOps, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { EvalContext, LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

// ★与设备夹具**同形**（含静态段 `child-`——顺带覆盖"组件内的混合文本"，P2-2 那条链）
const CHILD = `<template>
  <p-view style="height: 24px">
    <p-text :width="labelW" style="color: #ffffff">child-{{ label }}</p-text>
  </p-view>
</template>

<script setup lang="ts">
const props = defineProps<{ label: string; labelW: number }>()
</script>
`

/** 父：一个组件边界（props 绑响应式源）+ 一个普通元素 */
const parentSfc = (kidUsage: string): string =>
  `<template>\n<p-view style="height: 100px">\n${kidUsage}\n<p-view style="height: 10px"></p-view>\n</p-view>\n</template>\n\n<script setup lang="ts">\nconst kidLabel = ref('k0')\nconst kidLabelW = ref(40)\n</script>\n`

function build(): { tpl: LayoutTemplate; table: SubscriptionTable; childTpl: LayoutTemplate; childTable: SubscriptionTable } {
  const src = parentSfc(`<KidPanel :label="kidLabel" :labelW="kidLabelW" style="height: 30px"></KidPanel>`)
  return {
    tpl: buildLayoutTemplate(src, 'p.vue').template,
    table: buildVaporSubscriptions(src, 'p.vue').table,
    childTpl: buildLayoutTemplate(CHILD, 'c.vue').template,
    childTable: buildVaporSubscriptions(CHILD, 'c.vue').table,
  }
}

describe('★★★P1-3 组件内部渲染', () => {
  it('① 注册表命中 ⇒ 组件内部**展开**（子树挂在边界节点下、id 平移不与父树撞车）', () => {
    const { tpl, table, childTpl, childTable } = build()
    const data: Record<string, unknown> = { kidLabel: 'k0', kidLabelW: 40 }
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 300, height: 400 },
      read: (n) => data[n],
      table,
      registry: new ListRegistry(),
      components: { KidPanel: { template: childTpl, table: childTable } },
    })
    // ★展开产出：父 3 节点（根/边界/普通）+ 子 2 节点 = 5
    expect(inst.stats.componentNodes, '组件展开产出 2 个节点').toBe(2)
    expect(inst.nodes.length).toBe(5)
    // id 唯一（不偏移必与父树撞车——本仓实测）
    const ids = inst.nodes.map((n) => n.id)
    expect(new Set(ids).size, `id 必须唯一（重复：${ids.filter((x, i) => ids.indexOf(x) !== i)}）`).toBe(ids.length)
    // 子树根挂在**边界节点**下（不是 null、不是别的节点）
    const mount = (inst.componentMounts ?? [])[0]!
    const kidRoot = inst.nodes.find((n) => n.id === mount.nodeIds[0])!
    expect(kidRoot.parentId, '子树根应挂到边界节点下').toBe(mount.boundaryNodeId)
    // ★首帧 props 下行：子文本节点带完整值
    const kidText = inst.nodes.find((n) => (n as { tag?: string }).tag === 'p-text')!
    expect((kidText as { text?: string }).text, '子组件文本 = props 求值结果').toBe('child-k0')
    expect((kidText as { width?: number }).width, '子组件样式 = props 求值结果').toBe(40)
  })

  it('★反向：注册表**缺失** ⇒ 边界保留、内部留空 + note（不静默假装渲染了）', () => {
    const { tpl, table } = build()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 300, height: 400 },
      read: () => undefined,
      table,
      registry: new ListRegistry(),
    })
    expect(inst.stats.componentNodes, '未展开 ⇒ 0').toBe(0)
    expect(inst.nodes.length, '只有父级 3 节点').toBe(3)
    expect(inst.componentMounts ?? [], '无挂载记录').toEqual([])
    // 边界标记仍在（P1 第一批的语义：宿主仍知道"这里是组件位"）
    expect(inst.nodes.some((n) => (n as { component?: string }).component === 'KidPanel')).toBe(true)
  })

  it('★★② 上行更新：父改 props ⇒ 子运行时指令的 nodeId 落在**父树空间**（指向子节点）', () => {
    const { tpl, table, childTpl, childTable } = build()
    const data: Record<string, unknown> = { kidLabel: 'k0', kidLabelW: 40 }
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 300, height: 400 },
      read,
      table,
      registry,
      components: { KidPanel: { template: childTpl, table: childTable } },
    })
    const mount = (inst.componentMounts ?? [])[0]!

    const keys = new PropKeyTable(); const strings = new StringPool()
    const captured: Uint8Array[] = []
    const childRt = new SlotRuntime(keys, strings, (b) => captured.push(b))
    const childVapor = new VaporRuntime(
      childTable, childRt, VaporRuntime.buildEvaluators(childTable.evaluators), mount.registry,
      undefined, mount.idOffset,
    )
    childVapor.load(mount.ctx, () => { /* 源订阅（本用例手动驱动） */ })
    childVapor.relink(mount.ctx); childRt.flush()
    captured.length = 0

    // 父改 props（模拟桥的 onComponentProp：写进 props 对象 + 驱动子运行时）
    const childNodeIds = new Set(mount.nodeIds)
    mount.props.label = 'k9'
    mount.props.labelW = 99
    childVapor.writeSlotsOfSource('label', mount.ctx)
    childVapor.writeSlotsOfSource('labelW', mount.ctx)
    childRt.flush()

    expect(captured.length, '子组件应产出指令').toBeGreaterThan(0)
    const all: Array<{ op: number; nodeId: number; text?: string }> = []
    for (const b of captured) {
      const d = decodeOps(b)
      for (const op of d.ops) {
        const nodeId = (op as { nodeId?: number }).nodeId ?? -1
        const text = (op as { textRef?: number }).textRef !== undefined ? d.strings.valueOf((op as { textRef: number }).textRef) : undefined
        all.push({ op: op.op, nodeId, ...(text !== undefined ? { text } : {}) })
      }
    }
    // ★最强判据：**每一条指令都指向子树的节点**（不是父树的 local 同号节点）
    for (const op of all) {
      expect(childNodeIds.has(op.nodeId), `指令 nodeId=${op.nodeId} 必须落在子树内（父树空间）`).toBe(true)
    }
    const setText = all.find((x) => x.op === OpCode.SET_TEXT)!
    expect(setText.text, 'SET_TEXT 载荷是新 props 值').toBe('child-k9')
    const setStyle = all.find((x) => x.op === OpCode.SET_STYLE)!
    expect(setStyle.nodeId, '样式指令也指向同一个子节点').toBe(setText.nodeId)
  })
})

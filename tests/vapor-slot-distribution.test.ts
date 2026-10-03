// tests/vapor-slot-distribution.test.ts —— ★★★P1-3 **插槽分发**判据（2026-10-03）
//
// 【这一批补的是什么（能力清单 P1-3 剩余项）】组件内部渲染（上一批）之后，组件里写
//   `<slot>` 仍然是"一个空盒 + 诊断拒绝"⇒ **插槽内容分发不存在**。本批交出分发：
//     · 编译期：`<slot>` 打 `slotOutlet` 标记；父侧内容根打 `slotFor` 标记；
//       **`<template #x>` 不产节点**（Vue 语义：模板/片段不渲染元素——此前会多一层盒）。
//     · 实例化期：出口**溶解**（内容件挂到出口位置）；无内容 ⇒ 走**后备**
//       （元素后备整体顶位 / 裸文本后备改造成文本元素 / 空出口摘除）；
//       父级提供但无出口接住的内容**整棵摘除**（Vue 同）。
//
// 【为什么判据必须机器化（本仓"几何等价"同一纪律）】分发的每一处判断出错都不报错：
//   出口多留一层盒 = A/B 几何不等价；内容没落位 = 空页；后备没遮 = 内容双份（叠影）。
//   ⇒ 判据核"**最终树**"（给内核的那一份）：节点集合、父子链、文本内容、丢弃清单。

import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate, compileEvents } from '@proteus-vue/compiler'
import { ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\nconst a = ref('A')\nconst kl = ref('x')\n</script>\n`

function build(sfcSrc: string, name: string): { tpl: LayoutTemplate; table: SubscriptionTable } {
  return {
    tpl: buildLayoutTemplate(sfcSrc, name).template,
    table: buildVaporSubscriptions(sfcSrc, name).table,
  }
}

/** 实例化父模板（组件注册表由调用方给） */
function inst(parentSrc: string, childSrc?: string): ReturnType<typeof instantiateTemplate> {
  const parent = build(sfc(parentSrc), 'p.vue')
  const child = childSrc ? build(sfc(childSrc), 'c.vue') : undefined
  return instantiateTemplate(parent.tpl, {
    viewport: { width: 1080, height: 800 },
    read: (n) => (n === 'kl' ? 'K' : n === 'a' ? 'A' : undefined),
    table: parent.table,
    registry: new ListRegistry(),
    ...(child ? { components: { Kid: { template: child.tpl, table: child.table } } } : {}),
  })
}

describe('★P1-3 插槽分发 · 编译期标记（不产包裹盒是几何等价的前提）', () => {
  it('`<slot>` 打出口标记（静态名/缺省名）；`<template #x>` 不产节点（此前多一层盒）', () => {
    const parent = build(
      sfc(`<p-view><Kid><template #header><p-text>h</p-text></template><p-text>d</p-text></Kid></p-view>`),
      'p.vue',
    )
    // 父模板节点：p-view(0) / Kid(1) / p-text 具名内容(2) / p-text 默认内容(3)
    //   ★`<template #header>` 不占 id（否则 p-text 会偏到 3、4——本仓此前实测过同类偏移）
    expect(parent.tpl.nodes.map((n) => n.tag)).toEqual(['p-view', 'Kid', 'p-text', 'p-text'])
    // 具名/默认内容根都带 slotFor 标记
    expect(parent.tpl.nodes[2]!.slotFor).toEqual({ name: 'header' })
    expect(parent.tpl.nodes[3]!.slotFor).toEqual({ name: 'default' })

    const child = build(sfc(`<p-view><slot name="header" /><slot /></p-view>`), 'c.vue')
    expect(child.tpl.nodes[1]!.slotOutlet).toEqual({ name: 'header' })
    expect(child.tpl.nodes[2]!.slotOutlet).toEqual({ name: 'default' })
  })

  it('★三处 id 同源：`<slot>` 与 `<template #x>` 都不占 id（事件 nodeId 不漂移）', () => {
    const src = sfc(
      `<p-view>\n` +
        `<p-view @click="a = 'x'" style="height: 10px"></p-view>\n` +
        `<Kid><template #h><p-text>t</p-text></template></Kid>\n` +
        `<p-view @click="a = 'y'" style="height: 10px"></p-view>\n` +
        `</p-view>`,
    )
    const ev = compileEvents(src)
    const tpl = buildLayoutTemplate(src, 'p.vue').template
    // 两个 @click 的事件 id 必须命中**模板里同一位置的元素**（用"是哪个元素"证明不漂移）
    for (const e of ev.events) {
      const target = tpl.nodes.find((n) => n.id === e.nodeId)
      expect(target, `事件 nodeId=${e.nodeId} 必须命中模板节点`).toBeTruthy()
      expect(target!.tag).toBe('p-view')
    }
    // 恰好 2 个事件、2 个具名容器；`<template #h>` 的 p-text 是 tpl.nodes[3]
    expect(ev.events).toHaveLength(2)
    expect(tpl.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-view', 'Kid', 'p-text', 'p-view'])
  })

  it('★逻辑容器的隐藏缺陷回归：`<KeepAlive>` 之后的事件 nodeId 不再漂移（此前正则平扫 +1）', () => {
    const src = sfc(
      `<p-view>\n` +
        `<KeepAlive><Comp /></KeepAlive>\n` +
        `<p-view @click="a = 'x'"></p-view>\n` +
        `</p-view>`,
    )
    const ev = compileEvents(src)
    const tpl = buildLayoutTemplate(src, 'p.vue').template
    // template.ts: p-view(0) / Comp(1) / p-view(2)——第 3 个元素才是带 @click 的
    const target = tpl.nodes.find((n) => n.id === ev.events[0]!.nodeId)
    expect(target!.tag).toBe('p-view')
    expect(ev.events[0]!.nodeId).toBe(2)
  })
})

describe('★P1-3 插槽分发 · 实例化（最终树 = 给内核的那份）', () => {
  const CHILD = `<p-view style="flex-direction: column; height: 100px"><p-text>head</p-text><slot name="header" /><slot>raw-fb</slot><slot name="empty" /></p-view>`

  it('具名/默认内容**真的落到出口位置**（出口不产盒——内容的父是子组件容器）', () => {
    const r = inst(
      `<p-view><Kid><template #header><p-view style="height: 20px"></p-view></template><p-text>dft</p-text></Kid></p-view>`,
      CHILD,
    )
    // 无 slot/slotFor 标记残留（分发期语义不进最终树）
    expect(r.nodes.every((n) => !(n as { slotFor?: unknown }).slotFor && !(n as { slotOutlet?: unknown }).slotOutlet)).toBe(true)
    // 内容的文本在里面、父链指向子组件容器（不是出口——出口已溶解）
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('dft')
    expect(texts).toContain('head')
    // slotMounts 记录分发结果
    const sm = (r.slotMounts ?? []) as Array<{ name: string; filled: boolean; contentIds: number[]; outletNodeId: number }>
    const header = sm.find((x) => x.name === 'header')!
    expect(header.filled).toBe(true)
    expect(header.contentIds.length).toBe(1)
    const dft = sm.find((x) => x.name === 'default')!
    expect(dft.filled).toBe(true)
    // 空出口：无内容无后备 ⇒ 丢弃（id 进 droppedNodeIds）
    const empty = sm.find((x) => x.name === 'empty')!
    expect(empty.filled).toBe(false)
    expect(r.stats.droppedNodeIds).toContain(empty.outletNodeId)
  })

  it('无内容 ⇒ 后备：元素后备顶位 / 裸文本后备改造成文本元素 / 空出口摘除', () => {
    const r = inst(`<p-view><Kid /></p-view>`, CHILD)
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('raw-fb') // 裸文本后备（改造后的 p-text）
    expect(texts).toContain('head')
    expect(texts).not.toContain('dft')
  })

  it('父级提供但**无出口接住**的内容 ⇒ 整棵摘除（Vue 同——不静默留盒）', () => {
    const r = inst(
      `<p-view><Kid><template #orphan><p-text>never</p-text></template></Kid></p-view>`,
      `<p-view style="height: 50px"><p-text>only</p-text></p-view>`,
    )
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).not.toContain('never')
    expect((r.notes ?? []).join(' | ')).toContain('无出口接住')
  })

  it('★反向：既无组件也无插槽的模板**逐字节不变**（分发不误伤普通树）', () => {
    const r = inst(`<p-view style="height: 30px"><p-text>plain</p-text></p-view>`)
    expect(r.nodes.map((n) => n.tag)).toEqual(['p-view', 'p-text'])
    expect(r.stats.droppedNodeIds).toBeUndefined()
    expect(r.slotMounts).toBeUndefined()
  })

  it('★命名对齐：具名内容进具名出口，不与默认内容互换（错配时几何/内容全错）', () => {
    const r = inst(
      `<p-view><Kid><template #header><p-text>IN-HEADER</p-text></template><p-text>IN-DEFAULT</p-text></Kid></p-view>`,
      `<p-view style="flex-direction: column"><slot name="header" /><slot /></p-view>`,
    )
    const findParent = (text: string): string | undefined => {
      const t = r.nodes.find((n) => n.text === text)!
      const p = r.nodes.find((n) => n.id === t.parentId)
      return p?.tag
    }
    // 两个内容都在，且各自的父都是子组件容器 p-view（出口溶解后内容直接挂容器）
    expect(r.nodes.some((n) => n.text === 'IN-HEADER')).toBe(true)
    expect(r.nodes.some((n) => n.text === 'IN-DEFAULT')).toBe(true)
    expect(findParent('IN-HEADER')).toBe('p-view')
    expect(findParent('IN-DEFAULT')).toBe('p-view')
  })
})

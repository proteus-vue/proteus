// tests/vapor-scoped-slots.test.ts —— ★★★P1-3 **作用域插槽**判据（2026-10-03）
//
// 【这一批补的是什么（P1-3 最后一项缺口）】插槽分发之后，`<slot :count="n">` + `#default="sp"`
//   这组写法**部分失效**：文本插值恰好能编译（段求值，但 `sp` 读 undefined）；而
//   **样式绑定**（`:width="sp.w"`）会被标成"列表相对路径"⇒ 挂不到任何源 ⇒
//   **整条绑定从产物里消失**（只留一条误导性提示）⇒ 静默不生效。
//   本批交出：
//     · 编译期：出口 props 名单（`slotOutlet.props`）+ 作用域变量（`slotFor.scope`）+
//       `SubscriptionTable.slotScopedSlots`（分发时求值通道）。
//     · 实例化期：分发时在**子组件作用域**求出口 props → 用它重求内容子树的**文本段**与
//       **作用域样式绑定**。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① 编译：出口 props / 作用域变量 / slotScopedSlots 都在（缺了 = 能力没上线）；
//   ② 求值：文本段重求值后的**完整串**（不是空串、不是 `undefined` 字样）；
//   ③ 几何输入：作用域样式真的写进了节点字段（内核据此布局）。
//   ★反向：非作用域插槽**不得**受影响（逐字节不变）；解构形态必须诊断（不静默半支持）。

import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'
import { ListRegistry, instantiateTemplate } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string, script = ''): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

const CHILD = sfc(
  `<p-view style="flex-direction: column; height: 80px"><slot :count="n" :w="n * 10"><p-text style="font-size: 10px">fb</p-text></slot></p-view>`,
  `const props = defineProps<{ n: number }>()\n`,
)

const PARENT = sfc(
  `<p-view style="flex-direction: column"><Kid :n="kidN">\n` +
    `<template #default="sp"><p-text :width="sp.w" style="font-size: 12px">cnt-{{ sp.count }}</p-text></template>\n` +
    `</Kid></p-view>`,
  `const kidN = ref(3)\n`,
)

function build(src: string, name: string): { tpl: LayoutTemplate; table: SubscriptionTable } {
  return { tpl: buildLayoutTemplate(src, name).template, table: buildVaporSubscriptions(src, name).table }
}

function inst(parentSrc: string, childSrc: string): ReturnType<typeof instantiateTemplate> {
  const parent = build(parentSrc, 'p.vue')
  const child = build(childSrc, 'c.vue')
  return instantiateTemplate(parent.tpl, {
    viewport: { width: 1080, height: 800 },
    read: (n) => (n === 'kidN' ? 3 : undefined),
    table: parent.table,
    registry: new ListRegistry(),
    components: { Kid: { template: child.tpl, table: child.table } },
  })
}

describe('★P1-3 作用域插槽 · 编译期（三件标记）', () => {
  it('出口 props 名单 + 内容作用域变量 + slotScopedSlots 都在', () => {
    const child = build(CHILD, 'c.vue')
    const outlet = child.tpl.nodes.find((n) => n.slotOutlet)!
    expect(outlet.slotOutlet).toMatchObject({ name: 'default', props: ['count', 'w'] })

    const parent = build(PARENT, 'p.vue')
    const forNode = parent.tpl.nodes.find((n) => n.slotFor)!
    expect(forNode.slotFor).toMatchObject({ name: 'default', scope: 'sp' })
    // 作用域绑定（文本 + 样式各一条）进 slotScopedSlots（不再"消失"）
    const scoped = parent.table.slotScopedSlots ?? []
    expect(scoped.map((s) => s.propKey).sort()).toEqual(['layout.width', 'text.content'])
    expect(scoped.every((s) => s.scope === 'sp')).toBe(true)
  })

  it('★解构形态（`#x="{ count }"`）**已真支持**（2026-10-03）——零诊断 + scopeBindings 标记', () => {
    // ★此前被拒（真实缺口：组件库页面的错误提示就是这么写的）；现在解析成 local/key 绑定，
    //   分发时解构出口 props 进内容作用域（Vue 语义）。仍**不支持**的三类各有精确诊断（见下）。
    const src = sfc(
      `<p-view><Kid><template #default="{ count }"><p-text>x</p-text></template></Kid></p-view>`,
    )
    const t = buildLayoutTemplate(src, 'p.vue')
    expect(t.diagnostics, '解构不再被拒').toHaveLength(0)
    const node = t.template.nodes.find((n) => n.slotFor)!
    expect(node.slotFor!.scopeBindings).toEqual([{ local: 'count', key: 'count' }])
  })

  it('★解构的**不支持子形态**仍各有精确诊断（默认值 / 剩余项 / 嵌套解构）', () => {
    const diagOf = (scope: string): string =>
      buildLayoutTemplate(
        sfc(`<p-view><Kid><template #default="${scope}"><p-text>x</p-text></template></Kid></p-view>`),
        'p.vue',
      ).diagnostics.map((d) => d.message).join(' | ')
    expect(diagOf('{ a = 1 }')).toContain('默认值')
    expect(diagOf('{ ...rest }')).toContain('剩余项')
    expect(diagOf('{ a: { b } }')).toContain('嵌套解构')
  })

  it('★反向：非作用域插槽不产出 slotScopedSlots（既有产物不变）', () => {
    const src = sfc(`<p-view><Kid><template #header><p-text>h</p-text></template></Kid></p-view>`)
    const t = build(src, 'p.vue')
    expect(t.table.slotScopedSlots).toBeUndefined()
    expect(t.tpl.nodes.find((n) => n.slotFor)?.slotFor).toEqual({ name: 'header' })
  })
})

describe('★P1-3 作用域插槽 · 分发时求值（文本 + 样式）', () => {
  it('出口 props 在**子组件作用域**求值；内容文本段按它重求值（完整串，不是空/undefined）', () => {
    const r = inst(PARENT, CHILD)
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    // `cnt-{{ sp.count }}` ⇒ `cnt-3`（出口 :count="n" 的 n 来自 props.kidN = 3）
    expect(texts).toContain('cnt-3')
    expect(texts.join('|')).not.toContain('undefined')
  })

  it('作用域**样式**绑定真的写进节点字段（`:width="sp.w"` ⇒ 30；内核据此布局）', () => {
    const r = inst(PARENT, CHILD)
    const wide = r.nodes.filter((n) => typeof (n as { width?: unknown }).width === 'number')
    // `:w="n * 10"` ⇒ 3*10 = 30（出口表达式在子作用域求值——不是父级 read）
    expect(wide.some((n) => (n as unknown as { width: number }).width === 30)).toBe(true)
  })

  it('★反向：未提供内容 ⇒ 走后备（作用域求值不干扰后备路径）', () => {
    const r = inst(`<template><p-view><Kid :n="kidN" /></p-view></template>`, CHILD)
    const texts = r.nodes.filter((n) => typeof n.text === 'string' && n.text).map((n) => n.text)
    expect(texts).toContain('fb')
    expect(texts.join('|')).not.toContain('cnt-')
  })

  it('分发记录 note 写明作用域绑定与出口 props（"不静默"——审计可查）', () => {
    const r = inst(PARENT, CHILD)
    const notes = (r.notes ?? []).join(' | ')
    expect(notes).toContain('作用域 `sp`')
    expect(notes).toContain('"count":3')
  })
})

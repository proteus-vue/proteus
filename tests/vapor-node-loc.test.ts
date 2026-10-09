// tests/vapor-node-loc.test.ts —— ★★节点模板源位置（决策 #713）判据
//
// 【锁什么】`buildLayoutTemplate(..., dev=true)` 为每个节点发射 `loc`（整份 `.vue` 的 1 基行 +
//   模板内容相对列）——这是 DevTools 面板「Elements 选中 / 就地编辑 → 跳回源行」的**唯一**数据源
//   （App 页面 SFC 不打包、无 esbuild sourcemap）。
//
// 【三条硬约束（防"看起来对、其实错"）】
//   ① **dev 才有**：缺省（release）产物**逐字节不变**（无 `loc`）——否则 golden/体积全动；
//   ② **行口径**：`loc.line` 是**整份 `.vue`** 行（前导注释/上方 `<script>` 都要算进去），
//      与事件 `EventBinding.loc` **同一口径**（否则两处对不上同一份源码）；
//   ③ **实例化透传**：loc 随节点透传（列表行/组件展开重编号后 loc 仍是源属性）。
import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry } from '@proteus-vue/slot-runtime'
import type { LayoutNode } from '@proteus-vue/slot-runtime'

const sfc = (template: string, script = `const count = ref(0)\n`): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}</script>\n`

describe('★节点模板源位置（决策 #713）', () => {
  it('① dev=false（缺省）⇒ 节点**不带** loc（产物逐字节不变的保证）', () => {
    const r = buildLayoutTemplate(sfc(`<p-view><p-text>a</p-text></p-view>`), 'p.vue')
    expect(r.template.nodes.every((n) => n.loc === undefined)).toBe(true)
  })

  it('② dev=true ⇒ 每个节点带 loc；**行 = 整份 .vue**（含前导注释偏移）', () => {
    // 前导注释 ⇒ `<template>` 在第 2 行 ⇒ 元素在文件第 3 行（不是模板内容相对的第 2 行）
    const src = `<!-- 头部注释 -->\n<template>\n  <p-view>\n    <p-text>a</p-text>\n  </p-view>\n</template>\n<script setup lang="ts">\nconst n = ref(1)\n</script>\n`
    const r = buildLayoutTemplate(src, 'p.vue', undefined, undefined, undefined, undefined, true)
    const view = r.template.nodes.find((n) => n.tag === 'p-view')!
    const text = r.template.nodes.find((n) => n.tag === 'p-text')!
    expect(view.loc, 'p-view 应有 loc').toBeTruthy()
    expect(view.loc!.line, '行 = 整份 .vue 行（3）').toBe(3)
    expect(text.loc!.line, 'p-text 在文件第 4 行').toBe(4)
    // 列 = 模板内容相对列（p-view 缩进 2 ⇒ 列 3，1 基）
    expect(view.loc!.column).toBe(3)
  })

  it('②b 行口径与事件 loc **同源**（同一份源码两处必须对得上）', () => {
    const src = sfc(`<p-view @tap="count++"><p-text>x</p-text></p-view>`)
    const r = buildLayoutTemplate(src, 'p.vue', undefined, undefined, undefined, undefined, true)
    const view = r.template.nodes.find((n) => n.tag === 'p-view')!
    // 事件与节点都在模板第 2 行（文件第 2 行）——若两处行口径分叉，这里会差 1
    expect(view.loc!.line).toBe(2)
  })

  it('③ 实例化透传：loc 随节点进 InstantiatedNode（列表行重编号后 loc 不变）', () => {
    const src = sfc(
      `<p-view v-for="item in list" :key="item.id"><p-text>{{ item.title }}</p-text></p-view>`,
      `const list = ref([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])\n`,
    )
    const r = buildLayoutTemplate(src, 'list.vue', undefined, undefined, undefined, undefined, true)
    const { table } = buildVaporSubscriptions(src, 'list.vue')
    const tpl = r.template
    const rowTpl = tpl.nodes.find((n: LayoutNode) => n.listId !== undefined)!
    expect(rowTpl.loc, '行模板节点应有 loc').toBeTruthy()
    // ★列表展开需订阅表（`table`）——缺它 `instantiateTemplate` 不展开 v-for（既有形态）
    const inst = instantiateTemplate(tpl, {
      viewport: { width: 390, height: 844 },
      read: (n: string) => (n === 'list' ? [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] : undefined),
      table,
      registry: new ListRegistry(),
    })
    // 展开出的每个行节点都应带 loc（= 行模板的那一行）——id 重编号了，loc 是源属性不变
    const withLoc = inst.nodes.filter((n) => (n as { loc?: unknown }).loc)
    expect(withLoc.length, '实例化后应有带 loc 的节点').toBeGreaterThan(0)
    const anyRow = (inst.nodes as Array<{ loc?: { line: number } }>).find((n) => n.loc)!
    expect(anyRow.loc!.line).toBe(rowTpl.loc!.line)
  })
})

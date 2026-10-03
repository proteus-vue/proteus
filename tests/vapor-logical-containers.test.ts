// tests/vapor-logical-containers.test.ts —— ★★★P3 批次：**逻辑容器透传**判据（2026-10-03）
//
// 【这一批补的是什么（本仓实测的几何等价缺陷）】Vue 里 `KeepAlive` / `Teleport` / `Suspense` /
//   `Transition` 都是**逻辑容器**（缓存/传送/异步/过渡）——**不渲染包裹元素**。
//   此前除 `Transition`（P3-3 已修）外，其余三个都**当普通容器建了节点** ⇒ 同一份 SFC 在
//   Vapor 链上**多一层盒** ⇒ 布局多一层、几何与 Vue 路径**不等价**（A/B 判据会红）。
//
// 【判据打在三处】
//   ① **不产节点**（tag 列表里没有它自己）；
//   ② **id 同源**（订阅表槽位的 nodeId 指向"被包的那个元素"，不是错位一格）；
//   ③ **诊断精确**（说明"哪部分不支持 + 当前行为 + 替代路径"，不是笼统的"未支持"）。
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'

const sfc = (tpl: string): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst vis = ref(true)\nconst w = ref(10)\n</script>\n`

/** 内层元素带 :width（便于用订阅表槽位反查 id 是否对齐） */
const INNER = `<p-view v-show="vis" :width="w" style="height: 5px"></p-view>`

describe('★★★P3 逻辑容器透传（KeepAlive / Teleport / Suspense / Transition）', () => {
  const cases: Array<[string, string]> = [
    ['KeepAlive', `<p-view><KeepAlive>${INNER}</KeepAlive></p-view>`],
    ['Teleport', `<p-view><Teleport to="#x">${INNER}</Teleport></p-view>`],
    [
      'Suspense',
      `<p-view><Suspense><template #default>${INNER}</template><template #fallback><p-text>x</p-text></template></Suspense></p-view>`,
    ],
    ['Transition', `<p-view><Transition name="fade">${INNER}</Transition></p-view>`],
  ]

  for (const [name, tpl] of cases) {
    it(`① ${name} 不产包裹节点（且 id 与订阅表同源）`, () => {
      const t = buildLayoutTemplate(sfc(tpl), 't.vue').template
      // ① 不产节点：只有外层容器 + 被包元素两个 p-view（**没有** KeepAlive/Teleport/... 节点）
      expect(t.nodes.map((n) => n.tag), `${name} 不得产包裹节点`).toEqual(['p-view', 'p-view'])
      expect(t.nodes.map((n) => n.id)).toEqual([0, 1])
      // ② id 同源：width 槽位必须指向**被包的那个元素（id=1）**——错位一格是本仓踩过的老坑
      const { table } = buildVaporSubscriptions(sfc(tpl), 't.vue')
      const wSlot = table.sources.flatMap((s) => s.slots).find((x) => x.propKey === 'layout.width')!
      expect(wSlot.nodeId, `${name}：width 槽位应指向被包元素`).toBe(1)
      const target = t.nodes.find((n) => n.id === wSlot.nodeId)!
      expect(target.tag, `${name}：槽位目标必须是元素（不是错位节点）`).toBe('p-view')
    })
  }

  it('★② Suspense 只走 #default（`#fallback` 不得建节点——否则内容双份）', () => {
    const tpl = `<p-view><Suspense><template #default><p-text>loaded</p-text></template><template #fallback><p-text>loading</p-text></template></Suspense></p-view>`
    const t = buildLayoutTemplate(sfc(tpl), 't.vue').template
    expect(t.nodes.map((n) => n.tag), '只有 default 的 p-text（fallback 的不能建）').toEqual(['p-view', 'p-text'])
    const texts = t.nodes.map((n) => n.text).filter(Boolean)
    expect(texts, 'fallback 文案不得出现').toEqual(['loaded'])
  })

  it('★反向：普通元素**不得**被透传（只有四个逻辑容器标签享有该待遇）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-view>${INNER}</p-view></p-view>`), 't.vue').template
    expect(t.nodes.map((n) => n.tag), '普通嵌套 p-view 照常产节点').toEqual(['p-view', 'p-view', 'p-view'])
    // 另一个反向：PascalCase 组件**仍**是组件边界（有 component 标记，不因"逻辑容器"误伤）
    const t2 = buildLayoutTemplate(sfc(`<p-view><MyComp :p="w" /></p-view>`), 'c.vue').template
    expect(t2.nodes.map((n) => n.tag)).toEqual(['p-view', 'MyComp'])
    expect(t2.nodes[1]!.component, 'PascalCase 组件仍标边界').toBe('MyComp')
  })

  it('★★③ 诊断精确（说明"哪部分不支持 + 当前行为 + 替代路径"）', () => {
    const ka = buildLayoutTemplate(sfc(`<KeepAlive>${INNER}</KeepAlive>`), 'k.vue').diagnostics.map((d) => d.message).join(' | ')
    // ★本仓实测纠正：`KeepAlive` 是**组件级**缓存，与"页面级 app-stack 保活"不是同一件事——
    //   诊断必须分开说（首版曾写"可直接复用 app-stack"⇒ 不实）。
    expect(ka, '说明能力边界').toContain('组件级缓存')
    expect(ka, '当前行为（内容仍渲染）').toContain('内容正常渲染')
    expect(ka, '替代路径（页面级保活）').toContain('meta.branch.keepAlive')

    const tp = buildLayoutTemplate(sfc(`<Teleport to="#x">${INNER}</Teleport>`), 't.vue').diagnostics.map((d) => d.message).join(' | ')
    expect(tp, '当前行为（原位置渲染）').toContain('原位置')

    const sp = buildLayoutTemplate(sfc(`<Suspense><template #default>${INNER}</template></Suspense>`), 's.vue').diagnostics.map((d) => d.message).join(' | ')
    expect(sp, '说明只渲染 default').toContain('#fallback')
  })
})

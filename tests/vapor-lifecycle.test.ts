// tests/vapor-lifecycle.test.ts —— ★★★P1-3 **生命周期（@vue:mounted）**判据（2026-10-03）
//
// 【这一批补的是什么（P1-3 最后一项）】
//   ① **修一个静默真缺陷**：`@vue:mounted` 此前落进"组件自定义事件"分支（`componentEmit`）
//      ⇒ 产物里出现对 `vue:mounted` 事件的监听——而子组件**永远不会** `$emit('vue:mounted')`
//      ⇒ 钩子永不执行、且零诊断（最危险的一类静默）。现在它是**一等生命周期产物**。
//   ② **脚本级钩子不运行可见化**：`onMounted(() => {...})` 在端上不执行（Vapor 不跑 script）
//      ——此前编译期零提示 ⇒ 现在产 `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN`（带替代路径修法）。
//   ③ 不支持的 vnode 钩子（unmounted / updated / …）各有精确诊断（不静默丢弃）。
//
// 【判据打在三处】① 编译产物形态（lifecycle 绑定存在、且**不在** events 里）
//   ② 反向：无钩子 ⇒ 不产出字段（既有产物逐字节不变）③ 诊断形态（脚本钩子/未支持钩子）。

import { describe, it, expect } from 'vitest'
import { compileEvents, buildVaporSubscriptions, buildLayoutTemplate } from '@proteus-vue/compiler'

const sfc = (tpl: string, script = 'const lifeW = ref(0)\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('★P1-3 生命周期 · 编译（@vue:mounted 是一等产物）', () => {
  it('@vue:mounted ⇒ lifecycle 绑定 + 动作表（普通元素与组件都支持）', () => {
    const r = compileEvents(sfc(`<p-view><p-view @vue:mounted="lifeW = 250" /></p-view>`))
    expect(r.diagnostics, '不该有诊断').toHaveLength(0)
    expect(r.lifecycle).toHaveLength(1)
    const b = r.lifecycle![0]!
    expect(b.phase).toBe('mounted')
    expect(b.nodeId).toBe(1)
    expect(r.handlers[b.handler]).toMatchObject([{ op: 'set', source: 'lifeW' }])

    const onComp = compileEvents(sfc(`<p-view><Kid @vue:mounted="lifeW = 1" /></p-view>`))
    expect(onComp.lifecycle).toHaveLength(1)
    // ★组件上也不算"自定义事件"（这是本批修的静默缺陷：此前编成 componentEmit）
    expect(onComp.events.filter((e) => e.componentEmit)).toHaveLength(0)
  })

  it('★反向（本批修的静默缺陷回归锁）：`vue:` 前缀**不得**落进 events', () => {
    const r = compileEvents(sfc(`<p-view @vue:mounted="lifeW = 1" /></p-view>`))
    expect(r.events.filter((e) => String(e.event).startsWith('vue:'))).toHaveLength(0)
  })

  it('无 @vue:mounted ⇒ **不产出 lifecycle 字段**（既有产物逐字节不变）', () => {
    const r = compileEvents(sfc(`<p-view @click="lifeW = 1" /></p-view>`))
    expect(r.lifecycle).toBeUndefined()
    // 且产物 JSON 里不含该键（"既有产物不变"的严格形态）
    expect(JSON.stringify(r)).not.toContain('lifecycle')
  })

  it('★不支持形态必须产精确诊断（unmounted / updated / 修饰符）', () => {
    const un = compileEvents(sfc(`<p-view @vue:unmounted="lifeW = 1"></p-view>`))
    expect(un.diagnostics.map((d) => d.message).join('|')).toContain('@vue:unmounted 未支持')
    const up = compileEvents(sfc(`<p-view @vue:updated="lifeW = 1"></p-view>`))
    expect(up.diagnostics.map((d) => d.message).join('|')).toContain('@vue:updated 未支持')
    const mod = compileEvents(sfc(`<p-view @vue:mounted.stop="lifeW = 1"></p-view>`))
    expect(mod.diagnostics.map((d) => d.message).join('|')).toContain('不支持修饰符')
  })
})

describe('★P1-3 生命周期 · 脚本级钩子可见化（不执行 ⇒ 必须说）', () => {
  const diagsOf = (script: string): string =>
    buildVaporSubscriptions(sfc(`<p-view :width="lifeW" />`, script), 'p.vue')
      .diagnostics.map((d) => `${d.code}:${d.message}`)
      .join(' | ')

  it('onMounted（脚本级）⇒ VAPOR_SCRIPT_LIFECYCLE_NOT_RUN（带替代路径修法）', () => {
    const s = diagsOf(`const lifeW = ref(0)\nonMounted(() => { lifeW.value = 99 })`)
    expect(s).toContain('VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')
    expect(s).toContain('onMounted')
    // 修法指向模板钩子（真支持的替代路径）
    const hint = buildVaporSubscriptions(sfc(`<p-view :width="lifeW" />`, `const lifeW = ref(0)\nonMounted(() => {})`), 'p.vue')
      .diagnostics.find((d) => d.code === 'VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')?.hint ?? ''
    expect(hint).toContain('@vue:mounted')
  })

  it('onUnmounted / onUpdated 同样可见（各自的替代路径说明）', () => {
    expect(diagsOf(`onUnmounted(() => {})`)).toContain('VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')
    expect(diagsOf(`onUpdated(() => {})`)).toContain('VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')
  })

  it('★反向：没有脚本钩子 ⇒ 不产该诊断（防诊断噪声；且不误报同名前缀）', () => {
    expect(diagsOf(`const lifeW = ref(0)`)).not.toContain('VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')
    // 前缀同名：`myonMounted(` 不是钩子调用
    expect(diagsOf(`function myonMounted(x) { return x }\nmyonMounted(1)`)).not.toContain('VAPOR_SCRIPT_LIFECYCLE_NOT_RUN')
  })
})

describe('★P1-3 生命周期 · 模板产物与动作表同源（id 对齐）', () => {
  it('lifecycle.nodeId 命中模板里的**同一个元素**（id 空间三处同源）', () => {
    const src = sfc(`<p-view><p-view style="height: 5px" /><p-view @vue:mounted="lifeW = 7" /></p-view>`)
    const tpl = buildLayoutTemplate(src, 'p.vue').template
    const r = compileEvents(src)
    const target = tpl.nodes.find((n) => n.id === r.lifecycle![0]!.nodeId)
    expect(target, 'lifecycle nodeId 必须命中模板节点').toBeTruthy()
    expect(r.lifecycle![0]!.nodeId).toBe(2) // 第三个元素才是带钩子的那个
  })
})

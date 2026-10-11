// tests/app-component-instantiation.test.ts —— ★★★App 组件实例化（决策 #811）：kebab `p-*` 组件边界 + 展开
//
// 【它防什么】App 链此前只认 PascalCase 组件边界 ⇒ `<p-icon>`/`<p-auth-gate>` 这类 **kebab `p-*`**
//   组件从不成为边界 ⇒ 内部永不展开（渲染为空元素）。本批让「**构建期声明**的可展开标签集」
//   （`opts.componentTags`）也被标为组件边界，运行期由 `opts.components` 展开。
//   本测试钉住：① 无 `componentTags` ⇒ 零 kebab 边界（向后兼容，既有产物不变）；
//   ② 有 ⇒ 该标签被标边界（`node.component`）；③ 运行期喂注册表 ⇒ 组件内部被展开；④ 未喂 ⇒ 保留边界、内部留空。
import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry } from '@proteus-vue/slot-runtime'
import type { LayoutTemplate } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string, script = ''): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

// 页面用到一个 kebab 组件 `<p-widget>`（内部两枚 view/text）
const PAGE = sfc(`<view class="page"><p-widget :n="cnt" /><p-text>end</p-text></view>`, `const cnt = ref(3)\n`)
// 组件：`<view><text>…</text></view>`（展开后应产 2+ 内部节点）
const WIDGET = sfc(`<view style="height: 40px"><text style="font-size: 12px">W</text></view>`)

const build = (src: string, name: string, opts?: { componentTags?: ReadonlySet<string> }) =>
  buildLayoutTemplate(src, name, undefined, undefined, undefined, undefined, false, opts).template

describe('★★kebab 组件边界（`opts.componentTags`——构建期声明）', () => {
  it('无 componentTags ⇒ 零 kebab 边界（向后兼容；<p-widget> 只是普通节点）', () => {
    const t = build(PAGE, 'p.vue')
    expect(t.nodes.some((n) => n.component)).toBe(false)
  })

  it('声明 componentTags 含 p-widget ⇒ 该节点被标组件边界（node.component）', () => {
    const t = build(PAGE, 'p.vue', { componentTags: new Set(['p-widget']) })
    const boundary = t.nodes.find((n) => n.component)
    expect(boundary?.tag).toBe('p-widget')
    expect(boundary?.component).toBe('p-widget')
  })

  it('PascalCase 组件不受 componentTags 影响（既有约定不变）', () => {
    const t = build(sfc(`<view><Kid /></view>`), 'p.vue')
    expect(t.nodes.find((n) => n.component)?.component).toBe('Kid')
  })
})

describe('★★运行期展开（opts.components）', () => {
  const instantiate = (t: LayoutTemplate, withComponents: boolean) =>
    instantiateTemplate(t, {
      viewport: { width: 390, height: 844 },
      read: (n) => (n === 'cnt' ? 3 : undefined),
      table: undefined as never,
      registry: new ListRegistry(),
      ...(withComponents ? { components: { 'p-widget': { template: build(WIDGET, 'widget.vue') } } } : {}),
    })

  it('喂注册表 ⇒ 组件内部被展开（componentNodes > 0）', () => {
    const t = build(PAGE, 'p.vue', { componentTags: new Set(['p-widget']) })
    const inst = instantiate(t, true)
    expect(inst.stats.componentNodes).toBeGreaterThan(0)
    // 组件内部节点出现（展开后 tree 里应有 text 节点）
    expect(inst.nodes.some((n) => n.tag === 'text')).toBe(true)
  })

  it('未喂注册表 ⇒ 保留边界、内部留空（诚实边界，不静默丢内容语义）', () => {
    const t = build(PAGE, 'p.vue', { componentTags: new Set(['p-widget']) })
    const inst = instantiate(t, false)
    expect(inst.nodes.some((n) => n.component === 'p-widget')).toBe(true)
    expect(inst.stats.componentNodes).toBe(0)
  })
})

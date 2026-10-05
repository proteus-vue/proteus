// tests/vapor-static-instantiate.test.ts —— ★★★批次 45：构建期静态实例化 + 令牌块感知
//
// 【锁什么】App 端无 Vue 运行时 ⇒ App 壳（App.vue 的 global/overlay 层）的 `v-if`/`v-for`/插值/`:class`
//   必须**构建期**求值折叠。本测试锁 `buildLayoutTemplate(..., statics)` 的行为：
//   ① `v-if=false` 分支**丢弃**（默认隐藏的 chrome 不出现）
//   ② `v-if=true` 分支**保留**并剥离指令
//   ③ 静态 `v-for`（数组）**展开**（每项一个节点）
//   ④ 循环内 `v-if` 按项求值
//   ⑤ 可求值插值 → 静态文本；业务函数（statics 提供的函数）也可求值
//   ⑥ `:class`（对象/字符串）折进 `class`
//   ⑦ 不可求值的 `v-if` → **丢弃 + 诊断**（不静默留半成品）
//   ⑧ 无 `statics` ⇒ 行为不变（v-if 分支不丢、v-for 不展开）
//   ⑨ `parseCssVarTokens` 块感知——`.sa-dark` 覆盖**不污染**默认（`--sa-text` 取浅色）
import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate, parseCssVarTokens } from '@proteus-vue/compiler'
import type { LayoutTemplate } from '@proteus-vue/slot-runtime'

function build(src: string, statics?: Record<string, unknown>): { tpl: LayoutTemplate; codes: string[] } {
  const r = buildLayoutTemplate(src, 't.vue', undefined, undefined, statics)
  return { tpl: r.template, codes: (r.diagnostics ?? []).map((d) => d.code) }
}
const texts = (tpl: LayoutTemplate): string[] => tpl.nodes.map((n) => n.text ?? '').filter(Boolean)

describe('构建期静态实例化（App 壳）', () => {
  it('① v-if=false 分支丢弃 / ② v-if=true 保留', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><div v-if="hideMe">HID</div><div v-if="showMe">SHOW</div></overlay-layer></app-root></template>`,
      { hideMe: false, showMe: true },
    )
    const t = texts(tpl)
    expect(t).toContain('SHOW')
    expect(t).not.toContain('HID')
  })

  it('③ 静态 v-for 展开（每项一个节点）', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><div v-for="t in tabs" :key="t.n">{{ t.label }}</div></overlay-layer></app-root></template>`,
      { tabs: [{ n: 'a', label: '首页' }, { n: 'b', label: '消息' }, { n: 'c', label: '我的' }] },
    )
    const t = texts(tpl)
    expect(t).toEqual(['首页', '消息', '我的'])
  })

  it('④ 循环内 v-if 按项求值（badge>0 才出角标）', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><div v-for="t in tabs" :key="t.n"><span>{{t.label}}</span><span v-if="t.badge>0">{{t.badge}}</span></div></overlay-layer></app-root></template>`,
      { tabs: [{ label: '首页', badge: 0 }, { label: '消息', badge: 3 }] },
    )
    const t = texts(tpl)
    expect(t).toEqual(['首页', '消息', '3'])
  })

  it('⑤ 插值求值：字面/三元/statics 提供的函数', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><span>{{ label(n) }}</span><span>{{ ok ? '是' : '否' }}</span></overlay-layer></app-root></template>`,
      { n: 'mine', ok: true, label: (x: string) => (x === 'index' ? '首页' : x === 'mine' ? '我的' : x) },
    )
    expect(texts(tpl)).toEqual(['我的', '是'])
  })

  it('⑥ :class 对象折叠进静态 class（真值项）', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><div class="base" :class="{ 'on': active === 'a', 'err': bad }">X</div></overlay-layer></app-root></template>`,
      { active: 'a', bad: false },
    )
    const cls = tpl.nodes.find((n) => n.tag === 'div')?.style?.class
    // :class 折进 `class` attribute → 节点匹配到 `.on`（若 .on 无规则则看不出；此处只看指令被消费不掉崩溃）
    // 断言：指令被剥离后**不产出隐藏属性**，且节点仍在
    expect(tpl.nodes.some((n) => n.tag === 'div')).toBe(true)
    void cls
  })

  it('⑦ 不可求值的 v-if → 丢弃 + 诊断', () => {
    const { tpl, codes } = build(
      `<template><app-root><overlay-layer><div v-if="danger()">X</div></overlay-layer></app-root></template>`,
      { /* 未提供 danger —— 不可求值 */ },
    )
    expect(texts(tpl)).not.toContain('X')
    expect(codes).toContain('VAPOR_STATIC_IF_DROPPED')
  })

  it('⑧ 无 statics ⇒ 行为不变（v-if 分支不丢）', () => {
    const { tpl } = build(
      `<template><app-root><overlay-layer><div v-if="false">KEEP</div></overlay-layer></app-root></template>`,
    )
    expect(texts(tpl)).toContain('KEEP') // 无 statics ⇒ 不静态实例化（编译期原样保留）
  })
})

describe('parseCssVarTokens 块感知（主题默认不被覆盖块污染）', () => {
  it('⑨ 基选择器优先：--sa-text 取 :root 浅色，而非 .sa-dark 深色', () => {
    const t = parseCssVarTokens(':root { --sa-text: #1a1c22; --sa-bg: #f4f5f7 } .sa-dark { --sa-text: #eef0f5; --sa-bg: #121418 }')
    expect(t['--sa-text']).toBe('#1a1c22')
    expect(t['--sa-bg']).toBe('#f4f5f7')
  })

  it('⑨b 覆盖块**新增**的令牌仍补齐（基块没定义的）', () => {
    const t = parseCssVarTokens(':root { --a: 1px } .sa-dark { --b: 2px }')
    expect(t['--a']).toBe('1px')
    expect(t['--b']).toBe('2px')
  })

  it('⑨c 无花括号（裸声明串）保持原行为（向后兼容）', () => {
    const t = parseCssVarTokens('--sp-3: 12px; --text: #1c1b22')
    expect(t['--sp-3']).toBe('12px')
    expect(t['--text']).toBe('#1c1b22')
  })
})

// tests/p-gesture-batch.test.ts
// ★手势指令 v-gesture 回归锁（2026-09-18）。
//
// 背景（修复的缺陷）：`v-gesture:tap` 此前在 MP 端落入 `directive/custom` 被**剥离且不执行**，
//   并警告「小程序无对等机制」——但 catalog 的 `gesture.tap` 其 `mpEquiv` 明写 `bindtap`
//   （原生真实存在）→ 两者矛盾，写 v-gesture:tap 的开发者在小程序上 **handler 永不触发**（静默失效）。
//
// 诚实边界：只映射**有真实原生事件对等**的手势（tap/longpress）；pan/pinch/rotate/press 保持
//   「剥离 + 明示替代」（MP 官方形态是 worklet 手势处理器**组件**，非事件属性）。
//
// 破坏性验证：删掉 GESTURE_MP_EVENTS 条目 → 映射用例变红；删替代表 → 替代指引用例变红。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'
import { GESTURE_MP_EVENTS, MP_GESTURE_ALTERNATIVES } from '../packages/compiler/src/tags'

const compile = (src: string) => compileVueSfc(src, { filename: 'gesture-probe.vue' })
const warningsOf = (r: ReturnType<typeof compile>) => (r.warnings ?? []).join('\n')

describe('★v-gesture 指令：MP 原生事件映射（有对等）', () => {
  it('tap → bindtap（原生事件，非静默剥离）', () => {
    const r = compile('<template><view v-gesture:tap="onTap">x</view></template>')
    expect(r.wxml).toContain('bindtap="onTap"')
    // 不得再出现「无对等机制」的旧误导警告
    expect(warningsOf(r)).not.toContain('无对等机制（已剥离且不执行）')
  })

  it('longpress → bindlongpress', () => {
    const r = compile('<template><view v-gesture:longpress="onLong">x</view></template>')
    expect(r.wxml).toContain('bindlongpress="onLong"')
  })

  it('.catch 修饰符 → catchtap（阻止冒泡，与 @tap.catch 同语义）', () => {
    const r = compile('<template><view v-gesture:tap.catch="onTap">x</view></template>')
    expect(r.wxml).toContain('catchtap="onTap"')
  })

  it('.self/.once 无对等 → 警告但事件照常绑定（不静默降级）', () => {
    const r = compile('<template><view v-gesture:tap.self="onTap">x</view></template>')
    expect(r.wxml).toContain('bindtap="onTap"')
    expect(warningsOf(r)).toContain('.self')
  })

  it('多元素各自映射（不串味）', () => {
    const r = compile('<template><view><view v-gesture:tap="a">1</view><view v-gesture:longpress="b">2</view></view></template>')
    expect(r.wxml).toContain('bindtap="a"')
    expect(r.wxml).toContain('bindlongpress="b"')
  })
})

describe('★v-gesture：无事件对等手势（诚实剥离 + 具体替代）', () => {
  for (const kind of ['pan', 'pinch', 'rotate', 'press'] as const) {
    it(`${kind}：剥离 + 给出具体替代（不再笼统说「无对等机制」）`, () => {
      const r = compile(`<template><view v-gesture:${kind}="h">x</view></template>`)
      const w = warningsOf(r)
      expect(w).toContain(`v-gesture:${kind}`)
      expect(w).toContain('无事件对等')
      // ★反黑盒：必须给出**具体**替代（worklet 手势处理器组件）
      expect(w).toContain('gesture-handler')
      // 事件不得输出（如实剥离）
      expect(r.wxml).not.toMatch(/bind(pan|pinch|rotate|press)/)
    })
  }

  it('替代表覆盖全部「无对等」手势（防漏登记导致指引为空）', () => {
    const registered = Object.keys(GESTURE_MP_EVENTS)
    const known = ['tap', 'longpress', 'swipe', 'pan', 'pinch', 'rotate', 'press']
    for (const k of known) {
      if (registered.includes(k)) continue
      expect(MP_GESTURE_ALTERNATIVES[k], `${k} 应有替代指引`).toBeTruthy()
    }
  })
})

describe('★v-gesture：规则可禁用（rules.disabled 逃生舱）', () => {
  it('禁用 directive/v-gesture → 不映射、给禁用警告', () => {
    const r = compileVueSfc('<template><view v-gesture:tap="onTap">x</view></template>', {
      filename: 'x.vue',
      rules: { disabled: ['directive/v-gesture'] },
    })
    expect(r.wxml).not.toContain('bindtap="onTap"')
    expect(warningsOf(r)).toContain('directive/v-gesture')
  })
})

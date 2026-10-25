// tests/cse-batch-b-tail.test.ts —— ★★★批 B F3 收尾三项的 **CSE 路径**判据（2026-10-25）
//
// 【为什么单独一份】`tests/text-indent-spacing-wrap.test.ts` 验的是 **App 折叠面**（parseStaticStyle）；
//   CSE 是**第二条编译路径**（Web/MP 走它）。破坏性验证实测：把 CSE 的继承集/别名归一删掉，
//   折叠面测试**全绿** ⇒ 说明 CSE 侧当时**没有任何判据**（真缺口，不是测试写法问题）。
//   ★本仓纪律：同一语义的两条路径必须各有一条判据（否则改一条路径另一条静默漂移）。
//
// 【CSE 侧要验的三件事】
//   ① 长手 → IR 字段（textIndent / wordSpacing 走 ResolvedLength；overflowWrap 关键字直通）
//   ② **继承**（CSS Text 里三项都是继承属性 ⇒ 父设、子未声明时子取父值）
//   ③ `word-wrap` **别名归一**（归一发生在 parse/extract 入口——不归一就会变成两条独立属性）

import { describe, it, expect } from 'vitest'
import { parseStyleSheet, computeTree, CSE_INHERITED_PROPS } from '@proteus-vue/compiler'
import type { CseNode } from '@proteus-vue/compiler'

function node(tag: string, classes: string[], children: CseNode[] = [], id?: string): CseNode {
  return { key: id ?? `${tag}.${classes.join('.')}#${Math.random().toString(36).slice(2, 7)}`, tag, classes, id, index: 0, count: 1, children }
}

describe('★★★批 B F3 收尾三项 · CSE 路径（基准 = Web）', () => {
  it('① 三条长手 → IR 字段（长度两项为 ResolvedLength，关键字直通）', () => {
    const n = node('div', ['a'], [], 'a')
    const sheet = parseStyleSheet('.a { text-indent: 24px; word-spacing: 6px; overflow-wrap: break-word }')
    const f = computeTree([n], sheet, { viewport: { width: 390, height: 844 } }).byKey['a']!.fields
    expect(f['textIndent']).toEqual({ kind: 'absolute', dp: 24 })
    expect(f['wordSpacing']).toEqual({ kind: 'absolute', dp: 6 })
    expect(f['overflowWrap']).toBe('break-word')
  })

  it('② 三项都在 CSE 继承集里（与 App 折叠面 APP_INHERITABLE_FIELDS 同一集合）', () => {
    // 【为什么】不继承 ⇒ 父容器声明、文本子节点继承不到 ⇒ App 把值传下去了而 Web/MP 没有（两端分叉）
    expect(CSE_INHERITED_PROPS.has('text-indent')).toBe(true)
    expect(CSE_INHERITED_PROPS.has('word-spacing')).toBe(true)
    expect(CSE_INHERITED_PROPS.has('overflow-wrap')).toBe(true)
  })

  it('③ 继承真的生效：父声明、子未声明 ⇒ 子拿到父值', () => {
    const child = node('span', ['child'], [], 'child')
    const parent = node('div', ['parent'], [child], 'parent')
    const sheet = parseStyleSheet('.parent { text-indent: 20px; word-spacing: 4px; overflow-wrap: anywhere }')
    const r = computeTree([parent], sheet, { viewport: { width: 390, height: 844 } })
    const cf = r.byKey['child']!.fields
    expect(cf['textIndent']).toEqual({ kind: 'absolute', dp: 20 })
    expect(cf['wordSpacing']).toEqual({ kind: 'absolute', dp: 4 })
    expect(cf['overflowWrap']).toBe('anywhere')
  })

  it('④ word-wrap 别名归一：在 parse 入口就变成 overflow-wrap（同一语义只有一条路径）', () => {
    // 【为什么】CSE 的级联与继承都以 prop 字符串为键；不归一 ⇒ 父设 word-wrap、子继承不到 overflow-wrap
    const s1 = parseStyleSheet('.a { word-wrap: break-word }')
    const props = s1.rules[0]!.decls.map((d) => d.prop)
    expect(props, 'word-wrap 已归一到 overflow-wrap').toContain('overflow-wrap')
    expect(props, '不再保留原名').not.toContain('word-wrap')

    const n = node('div', ['a'], [], 'a')
    const f = computeTree([n], s1, { viewport: { width: 390, height: 844 } }).byKey['a']!.fields
    expect(f['overflowWrap']).toBe('break-word')
  })

  it('⑤ 别名在 inline style 入口同样归一（两个入口共用同一张表）', () => {
    const n = node('div', ['a'], [], 'a')
    const sheet = parseStyleSheet('.a { color: #111111 }')
    const r = computeTree([n], sheet, {
      inlineStyles: { [n.key]: [{ prop: 'word-wrap', value: 'anywhere' }] },
    })
    expect(r.byKey['a']!.fields['overflowWrap']).toBe('anywhere')
  })

  it('⑥ 初值不发散：overflow-wrap: normal / word-spacing: normal / text-indent: 0px 都不产出变更值', () => {
    const n = node('div', ['a'], [], 'a')
    const sheet = parseStyleSheet('.a { overflow-wrap: normal; word-spacing: normal; text-indent: 0px }')
    const f = computeTree([n], sheet, { viewport: { width: 390, height: 844 } }).byKey['a']!.fields
    // 初值允许以"初值形态"出现（CSE 会记 initial），但不得被当成别的值
    expect(f['overflowWrap'] ?? 'normal').toBe('normal')
    expect(f['textIndent']).toEqual({ kind: 'absolute', dp: 0 })
  })
})

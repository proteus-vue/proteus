// tests/vapor-events.test.ts —— ★★**事件编译器**判据（交互闭环的编译期半边）
//
// 【为什么必须有】事件编译是"点得动"的**唯一入口**：它编不出事件 ⇒ 真机上手势能识别、
//   hitTest 能命中，而**没有任何 handler 可跑**（现象是"点了没反应"，且链路上零报错）。
//   本文件的判据分三层：① 支持形态**编对了**（动作语义正确）；② 不支持形态**编不出但产诊断**
//   （不静默）；③ **节点 id 与模板同序**（与 `buildLayoutTemplate` 的 id 分配同源——
//   分叉的后果是 handler 挂到别的节点上，症状伪装成"点错地方"）。
import { describe, it, expect } from 'vitest'
import { compileEvents, buildLayoutTemplate } from '@proteus-vue/compiler'

const sfc = (template: string, script = `const count = ref(0)\nconst toggle = ref(false)\nconst boxW = ref(120)\nconst list = ref([{ id: 1, w: 10 }])\n`): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}</script>\n`

describe('Vapor 事件编译 · 支持形态', () => {
  it('`count++` → set/add 动作（自增编成 add + 字面量 1）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    expect(r.events).toEqual([{ nodeId: 0, event: 'tap', handler: 'h0' }])
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'count', program: { k: 'lit', v: 1 } }])
  })

  it('`count--` / `++count` / `--count` 都归一为 add（含符号）', () => {
    expect(compileEvents(sfc(`<p-view @click="count--"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: -1 },
    })
    expect(compileEvents(sfc(`<p-view @click="++count"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: 1 },
    })
    expect(compileEvents(sfc(`<p-view @click="--count"></p-view>`)).handlers.h0![0]).toMatchObject({
      op: 'add',
      program: { k: 'lit', v: -1 },
    })
  })

  it('`boxW += 30` → add（右侧求值为 30）', () => {
    const r = compileEvents(sfc(`<p-view @click="boxW += 30"></p-view>`))
    expect(r.handlers.h0).toEqual([{ op: 'add', source: 'boxW', program: { k: 'lit', v: 30 } }])
  })

  it('`count = count * 2 + 1` → set + 表达式程序（含算术）', () => {
    const r = compileEvents(sfc(`<p-view @click="count = count * 2 + 1"></p-view>`))
    expect(r.diagnostics).toHaveLength(0)
    const act = r.handlers.h0![0]!
    expect(act.op).toBe('set')
    expect((act as { program: { k: string; op: string } }).program).toMatchObject({ k: 'bin', op: '+' })
  })

  it('`toggle = !toggle` → set + 一元非（布尔取反）', () => {
    const r = compileEvents(sfc(`<p-view @click="toggle = !toggle"></p-view>`))
    expect(r.handlers.h0).toEqual([
      { op: 'set', source: 'toggle', program: { k: 'un', op: '!', arg: { k: 'root', name: 'toggle' } } },
    ])
  })

  it('`@longpress` 映射为 longpress 语义（不是 tap）', () => {
    const r = compileEvents(sfc(`<p-view @longpress="count--"></p-view>`))
    expect(r.events[0]!.event).toBe('longpress')
  })

  it('多个事件 → 多条绑定 + 多个 handler（按出现序命名 h0/h1）', () => {
    const r = compileEvents(sfc(`<p-view @click="count++"></p-view><p-view @click="boxW += 30"></p-view>`))
    expect(r.events.map((e) => e.handler)).toEqual(['h0', 'h1'])
    expect(Object.keys(r.handlers)).toEqual(['h0', 'h1'])
  })
})

describe('Vapor 事件编译 · ★不支持形态必须产诊断（不静默）', () => {
  const cases: Array<[string, string, string]> = [
    ['修饰符', `<p-view @click.stop="count++"></p-view>`, '修饰符'],
    ['调用表达式', `<p-view @click="submit()"></p-view>`, 'handler 形态不支持'],
    ['多语句', `<p-view @click="count++; toggle = !toggle"></p-view>`, '多条语句'],
    ['未支持事件', `<p-view @input="count++"></p-view>`, '事件未支持'],
    ['空 handler', `<p-view @click=""></p-view>`, 'handler 为空'],
  ]
  for (const [label, template, expectMsg] of cases) {
    it(`${label} ⇒ 诊断（含修法）+ 不产出事件`, () => {
      const r = compileEvents(sfc(template))
      expect(r.events, `${label} 不应产出事件`).toHaveLength(0)
      expect(r.diagnostics.length, `${label} 必须产诊断`).toBeGreaterThan(0)
      const msg = r.diagnostics.map((d) => d.message).join(' | ')
      expect(msg).toContain(expectMsg)
      // ★诊断必须带修法（本仓纪律：报错要能照着改）
      expect(r.diagnostics.every((d) => (d.hint ?? '').length > 0), '每条诊断都要有修法').toBe(true)
    })
  }
})

describe('Vapor 事件编译 · ★节点 id 与模板**同序**（分叉 ⇒ handler 挂错节点）', () => {
  it('嵌套结构下 id 对齐（`<p-view><p-view @click>` ⇒ 内层 id=1）', () => {
    const template = `<p-view><p-view @click="count++"></p-view></p-view>`
    const ev = compileEvents(sfc(template))
    const tpl = buildLayoutTemplate(sfc(template), 'align.vue').template
    // 事件编译给出的 nodeId 必须是模板里的**同一个元素**
    const target = tpl.nodes.find((n) => n.id === ev.events[0]!.nodeId)!
    expect(target, '事件 nodeId 必须命中模板节点').toBeTruthy()
    // ★语义判据：内层是第二个元素（id=1），而它才是带 @click 的那个
    expect(ev.events[0]!.nodeId).toBe(1)
    expect(tpl.nodes).toHaveLength(2)
  })

  it('自闭合标签也计入元素序（与 template.ts 的 nextElementIndex++ 同纪律）', () => {
    const template = `<p-view /><p-view @click="count++" />`
    const ev = compileEvents(sfc(template))
    expect(ev.events[0]!.nodeId).toBe(1)
  })
})

describe('Vapor 事件编译 · 确定性（同一源码两次编译逐字节一致）', () => {
  it('handler 命名与动作表稳定（可对账）', () => {
    const template = `<p-view @click="count++"></p-view><p-view @click="toggle = !toggle"></p-view>`
    const a = compileEvents(sfc(template))
    const b = compileEvents(sfc(template))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

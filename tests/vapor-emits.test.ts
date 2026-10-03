// tests/vapor-emits.test.ts —— ★★★P1-3 **emits（子 → 父）**判据（2026-10-03）
//
// 【这一批补的是什么（能力清单 P1-3 最后一项缺口）】组件内部渲染 + 插槽分发之后，
//   子组件**向父级通信**仍无通路：模板里 `$emit(...)` 会被当作"调用表达式"拒绝（诊断），
//   父级写在组件上的 `@my-event` 被当作"事件未支持"。本批交出：
//     · 编译期：`$emit('name', payload?)` → `{op:'emit', event, program?}` 动作；
//       组件边界上的**非手势事件名** → `componentEmit` 绑定（不冒泡、不 hitTest）。
//     · 运行时：子组件动作表挂在派发索引里（handler 名带 `@child:<i>:` 前缀区分）；
//       emit 动作按「边界节点 + 事件名」查父级绑定 → 跑父级 handler，`$event` = 载荷。
//
// 【判据打在三处（各自对应一个会静默出错的环节）】
//   ① 编译：动作表里真有 emit 动作、绑带上真有 componentEmit 标记（缺了 = 能力没上线）；
//   ② 派发区分：手势派发**不**跑 componentEmit 绑定（否则点名会误触发父级');
//   ③ 端到端：子 emit ⇒ 父源真的变（值 = 载荷 + 偏移——`$event` 求值正确）。

import { describe, it, expect } from 'vitest'
import { compileEvents, buildLayoutTemplate } from '@proteus-vue/compiler'
import { createDispatchState, indexEventBindings } from '@proteus-vue/slot-runtime'
import type { EventBinding } from '@proteus-vue/slot-runtime'
import { dispatchGesture } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\nconst bumpTotal = ref(0)\nconst emitVal = ref(3)\n</script>\n`

describe('★P1-3 emits · 编译期（动作 + 绑定）', () => {
  it('子组件里的 `$emit(\'bump\', expr)` ⇒ emit 动作（含载荷程序）', () => {
    const r = compileEvents(sfc(`<p-view><p-text @tap="$emit('bump', emitVal)">b</p-text></p-view>`))
    expect(r.diagnostics, '不该有诊断').toHaveLength(0)
    const acts = Object.values(r.handlers).flat()
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ op: 'emit', event: 'bump' })
    expect((acts[0] as { program?: unknown }).program).toBeTruthy()
  })

  it('无载荷 `$emit(\'ping\')` ⇒ emit 动作（无 program）', () => {
    const r = compileEvents(sfc(`<p-view><p-text @tap="$emit('ping')">b</p-text></p-view>`))
    const acts = Object.values(r.handlers).flat()
    expect(acts[0]).toMatchObject({ op: 'emit', event: 'ping' })
    expect((acts[0] as { program?: unknown }).program).toBeUndefined()
  })

  it('组件边界上的自定义事件 ⇒ componentEmit 绑定（非组件元素仍走诊断）', () => {
    const tpl = buildLayoutTemplate(sfc(`<p-view><Kid @bump="bumpTotal = $event + 100" /></p-view>`), 'p.vue').template
    expect(tpl.nodes.map((n) => n.tag)).toEqual(['p-view', 'Kid'])
    const r = compileEvents(sfc(`<p-view><Kid @bump="bumpTotal = $event + 100" /></p-view>`))
    expect(r.diagnostics, '组件自定义事件不该被拒绝').toHaveLength(0)
    const b = r.events[0]!
    expect(b.componentEmit).toBe(true)
    expect(b.event).toBe('bump')
    // 绑定落在**组件边界节点**上（id=1 是 Kid）
    expect(b.nodeId).toBe(1)
    // ★反向：非组件元素上的自定义事件名仍必须诊断（不能被静默吞掉）
    const bad = compileEvents(sfc(`<p-view @bump="bumpTotal = 1"></p-view>`))
    expect(bad.diagnostics.map((d) => d.message).join('|')).toContain('事件未支持')
    expect(bad.events).toHaveLength(0)
  })

  it('★不符形态必须产诊断（多实参 / 非 $emit 调用）', () => {
    const multi = compileEvents(sfc(`<p-view><p-text @tap="$emit('bump', 1, 2)">b</p-text></p-view>`))
    expect(multi.diagnostics.map((d) => d.message).join('|')).toContain('只支持一个实参')
    expect(Object.keys(multi.handlers)).toHaveLength(0)
    const wrong = compileEvents(sfc(`<p-view><p-text @tap="emit('bump')">b</p-text></p-view>`))
    expect(wrong.diagnostics.map((d) => d.message).join('|')).toContain('受支持的 $emit 形态')
  })
})

describe('★P1-3 emits · 派发区分（手势不跑组件事件绑定）', () => {
  it('componentEmit 绑定**不参与手势派发**（点名组件时父级 handler 不许被误触发）', () => {
    const src = sfc(`<p-view><Kid @bump="bumpTotal = $event + 100" /></p-view>`)
    const ev = compileEvents(src)
    const index = indexEventBindings(ev.events)
    const state = createDispatchState()
    const ran: string[] = []
    const r = dispatchGesture([1, 0], 'tap', index, state, (h) => {
      ran.push(h)
      return true
    })
    expect(ran, '手势派发不得命中 componentEmit 绑定').toEqual([])
    expect(r.fired).toEqual([])
  })

  it('★反向：手势绑定照常（区分不是靠"全都不跑"实现的）', () => {
    const src = sfc(`<p-view><p-text @click="emitVal = 9">b</p-text></p-view>`)
    const ev = compileEvents(src)
    const index = indexEventBindings(ev.events)
    const r = dispatchGesture([1, 0], 'tap', index, createDispatchState(), () => true)
    expect(r.fired).toEqual([1])
  })
})

describe('★P1-3 emits · 端到端（$event 载荷求值 + 父级落点）', () => {
  it('子 emit ⇒ 父 handler 跑（值 = 载荷 + 100，`$event` 真的绑上了载荷）', () => {
    // 与设备夹具同形的两个产物段：父（绑定）/ 子（emit 动作）
    const parentSrc = sfc(`<p-view><Kid @bump="bumpTotal = $event + 100" /></p-view>`)
    const childSrc = `<template><p-view><p-text @tap="$emit('bump', emitVal)">b</p-text></p-view></template>`
    const parent = compileEvents(parentSrc)
    const child = compileEvents(childSrc)
    // —— 模拟桥的装配（与 entry-vapor 的 runChildHandler 同一套步骤）——
    const store: Record<string, unknown> = { bumpTotal: 0, emitVal: 3 }
    const emitIndex = new Map<string, string>()
    for (const e of parent.events) if (e.componentEmit) emitIndex.set(`${e.nodeId}:${e.event}`, e.handler)
    const runParent = (name: string, payload: unknown): void => {
      for (const a of parent.handlers[name] ?? []) {
        if (a.op === 'emit') continue
        const v = evalExprLocal(a.program, { $event: payload, ...store })
        store[a.source] = a.op === 'set' ? v : (Number(store[a.source]) || 0) + (Number(v) || 0)
      }
    }
    // 子动作表：emit 动作 → 查父级绑定（边界 id = 1，与 parent.events 的 nodeId 同源）
    const childActs = Object.values(child.handlers).flat()
    const em = childActs.find((a) => a.op === 'emit') as { event: string; program?: unknown }
    expect(em).toBeTruthy()
    const payload = evalExprLocal(em.program, store)
    const parentHandler = emitIndex.get(`1:${em.event}`)
    expect(parentHandler, '边界 1 + bump 必须命中父级绑定').toBeTruthy()
    runParent(parentHandler!, payload)
    expect(store.bumpTotal, '父级落点 = 载荷(3) + 100').toBe(103)
  })

  it('无对应父级监听 ⇒ 路由结果为空（调用方会记 note——本仓"不静默"纪律）', () => {
    const parent = compileEvents(sfc(`<p-view><Kid /></p-view>`))
    const emitIndex = new Map<string, string>()
    for (const e of parent.events) if (e.componentEmit) emitIndex.set(`${e.nodeId}:${e.event}`, e.handler)
    expect(emitIndex.get('1:bump')).toBeUndefined()
  })
})

/** 与设备端 evalExpr 等价的极简求值（仅本测试用的形态：root/mem/lit/bin） */
function evalExprLocal(prog: unknown, store: Record<string, unknown>): unknown {
  const p = prog as { k: string; [k: string]: unknown }
  switch (p.k) {
    case 'root':
      return store[String(p.name)]
    case 'lit':
      return p.v
    case 'undef':
      return undefined
    case 'mem': {
      const o = evalExprLocal(p.obj, store) as Record<string, unknown> | null | undefined
      return o == null ? undefined : o[String(p.key)]
    }
    case 'bin': {
      const l = Number(evalExprLocal(p.l, store)) || 0
      const r = Number(evalExprLocal(p.r, store)) || 0
      return l + r
    }
    default:
      throw new Error(`测试求值器不覆盖：${p.k}`)
  }
}

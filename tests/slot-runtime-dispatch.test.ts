// tests/slot-runtime-dispatch.test.ts —— ★★P2-3 **手势派发语义**判据（修饰符的运行时半边）
//
// 【为什么必须有（本仓核实的缺口）】编译期只是"把修饰符记进产物"；**语义**发生在派发时
//   （链序 + 何时停 + 跳过谁）。此前这份语义只内联在 Android 桥里，且不支持任何修饰符：
//   `@click.stop` 要么被拒绝、要么在"允许但忽略"下**静默多派发**（点按钮把祖先 handler 也跑了）。
//   ⇒ 本模块（`slot-runtime/dispatch.ts`）是各端共用的唯一实现，本文件判它：
//     ① 链序（自深到浅，逐个派发）；② `.stop` 终止；③ `.self` 只命中自身；
//     ④ `.once` 只跑一次（状态可重置 ⇒ 重挂载重新生效）；⑤ 无修饰符 ⇒ 既有行为逐字不变。
//
// 【★破坏性验证（本仓纪律：判据要能在实现被改坏时变红）】见文件末尾一组：把 `.stop`
//   的"先跑后停"改成"直接停"、把 `.self` 判据写成恒真 —— 对应断言分别变红（下方注释标注）。
import { describe, it, expect } from 'vitest'
import { compileEvents } from '@proteus-vue/compiler'
import { dispatchGesture, indexEventBindings, createDispatchState } from '@proteus-vue/slot-runtime'
import type { EventBinding } from '@proteus-vue/slot-runtime'

/** 一个「祖先容器 @click」+「子按钮 @click」的链：链 = [child(2), mid(1), root(0)]（自深到浅） */
const CHAIN = [2, 1, 0]

function makeSut(bindings: EventBinding[], ran: Set<string>) {
  const index = indexEventBindings(bindings)
  const state = createDispatchState()
  const run = (h: string): boolean => {
    ran.add(h)
    return true
  }
  return { index, state, run, ran }
}

describe('★★P2-3 手势派发（共享实现 · 各端宿主同一套语义）', () => {
  it('① 无修饰符：沿链**全部**派发（DOM 冒泡语义，既有行为）', () => {
    const bindings: EventBinding[] = [
      { nodeId: 0, event: 'tap', handler: 'hRoot' },
      { nodeId: 1, event: 'tap', handler: 'hMid' },
      { nodeId: 2, event: 'tap', handler: 'hChild' },
    ]
    const { index, state, run, ran } = makeSut(bindings, new Set())
    const r = dispatchGesture(CHAIN, 'tap', index, state, run)
    expect(r.fired, '链上三个节点都跑（自深到浅）').toEqual([2, 1, 0])
    expect([...ran]).toEqual(['hChild', 'hMid', 'hRoot'])
    expect(r.stopped).toBe(false)
  })

  it('② `.stop` 在子节点 ⇒ 本跳跑完后**终止冒泡**（祖先不跑）', () => {
    const bindings: EventBinding[] = [
      { nodeId: 0, event: 'tap', handler: 'hRoot' },
      { nodeId: 1, event: 'tap', handler: 'hMid' },
      { nodeId: 2, event: 'tap', handler: 'hChild', stop: true },
    ]
    const { index, state, run, ran } = makeSut(bindings, new Set())
    const r = dispatchGesture(CHAIN, 'tap', index, state, run)
    // ★破坏性验证锚点：把实现改成"直接停"（不跑本跳）⇒ fired 变 [] ⇒ 本断言必红
    expect(r.fired, '.stop 的节点**自身必须跑**（先跑后停）').toEqual([2])
    expect([...ran]).toEqual(['hChild'])
    expect(r.stopped).toBe(true)
  })

  it('③ `.self` 在祖先（命中不是它）⇒ 跳过；在命中节点 ⇒ 正常跑', () => {
    const bindings: EventBinding[] = [
      { nodeId: 0, event: 'tap', handler: 'hRoot', self: true }, // 祖先 .self：命中是 2，不是 0 ⇒ 跳过
      { nodeId: 2, event: 'tap', handler: 'hChild', self: true }, // 命中节点 .self ⇒ 跑
    ]
    const { index, state, run, ran } = makeSut(bindings, new Set())
    const r = dispatchGesture(CHAIN, 'tap', index, state, run)
    expect(r.fired).toEqual([2])
    expect(r.skippedSelf, '祖先被 .self 挡下要可见（诊断用）').toEqual([0])
    expect([...ran]).toEqual(['hChild'])
    // ★破坏性验证锚点：把 `.self` 判据写成恒真 ⇒ skippedSelf 变 []、fired 变 [2,0] ⇒ 两条断言必红
  })

  it('④ `.once` 只跑一次；**状态重置**（页面重挂载）后重新生效', () => {
    const bindings: EventBinding[] = [{ nodeId: 2, event: 'tap', handler: 'hOnce', once: true }]
    const { index, state, run, ran } = makeSut(bindings, new Set())
    expect(dispatchGesture(CHAIN, 'tap', index, state, run).fired).toEqual([2])
    const second = dispatchGesture(CHAIN, 'tap', index, state, run)
    expect(second.fired, '第二次不得再跑').toEqual([])
    expect(second.skippedOnce).toEqual([2])
    expect([...ran]).toEqual(['hOnce'])
    // ★重挂载 ⇒ 新状态 ⇒ `.once` 重新生效（与官方 Vue 同语义）
    const fresh = createDispatchState()
    expect(dispatchGesture(CHAIN, 'tap', index, fresh, run).fired, '新状态应重新跑').toEqual([2])
  })

  it('⑤ 未命中节点（chain 为空）⇒ 什么也不跑，不崩', () => {
    const { index, state, run, ran } = makeSut([{ nodeId: 0, event: 'tap', handler: 'h' }], new Set())
    const r = dispatchGesture([], 'tap', index, state, run)
    expect(r.fired).toEqual([])
    expect(r.handler).toBe('')
    expect([...ran]).toEqual([])
  })

  it('⑥ `:tap` 兜底查找（宿主上报 longpress 而绑定在 tap 上——既有行为不变）', () => {
    const bindings: EventBinding[] = [{ nodeId: 2, event: 'tap', handler: 'hTap' }]
    const { index, state, run, ran } = makeSut(bindings, new Set())
    const r = dispatchGesture([2], 'longpress', index, state, run)
    expect(r.fired, 'longpress 落在只有 tap 绑定的节点上仍走兜底').toEqual([2])
    expect([...ran]).toEqual(['hTap'])
  })

  it('⑦ 与编译产物**端到端**：SFC 的 `.stop` ⇒ 事件绑定带 stop ⇒ 派发真的停住', () => {
    // 这条把两半接起来（编译期置位 + 运行时语义），防"字段名/含义两处漂移"
    const sfc = `<template>
  <p-view @click="padW += 5">
    <p-view @click.stop="boxW += 30"></p-view>
  </p-view>
</template>
<script setup lang="ts">
const boxW = ref(120)
const padW = ref(300)
</script>
`
    const ev = compileEvents(sfc)
    expect(ev.events.map((e) => e.stop), '外层无 stop、内层有 stop').toEqual([undefined, true])
    // 元素序：外层 p-view = 0，内层 = 1；链 = [1, 0]（自深到浅）
    const index = indexEventBindings(ev.events)
    const state = createDispatchState()
    const store: Record<string, number> = { boxW: 120, padW: 300 }
    const run = (h: string): boolean => {
      const acts = ev.handlers[h]
      if (!acts) return false
      for (const a of acts) {
        if (a.op !== 'set' && a.op !== 'add') continue // 只处理 set/add（let/if/emit/nav 跳过）
        store[a.source] = (store[a.source] ?? 0) + 30
      }
      return true
    }
    const r = dispatchGesture([1, 0], 'tap', index, state, run)
    expect(r.fired, '只有内层跑（.stop）').toEqual([1])
    expect(store.boxW, '内层 handler 生效').toBe(150)
    expect(store.padW, '★祖先 handler 被 .stop 挡下（这正是"点了按钮祖先也动"的缺陷形态）').toBe(300)
  })
})

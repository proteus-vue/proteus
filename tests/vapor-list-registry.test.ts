// tests/vapor-list-registry.test.ts
// ★V4：列表项注册表 —— 让 `LIST_UPDATE` 落地（方案 §2.3）
//
// 【本文件要证明的核心命题】
//   ① 注册表能把 (listId, itemKey, slotId) 解析成 nodeId —— 这是 V3 遗留的功能缺口
//   ② ★解析成功时发的是**普通指令**（SET_STYLE/SET_TEXT），**不是 LIST_UPDATE**
//      ⇒ 核心无需懂列表语义（列表知识留在 JS 侧，它本来就知道）
//   ③ 解析不到时**回退 LIST_UPDATE**（宿主自持映射的场景）——不静默丢弃
//   ④ 删除项后不再命中（防 key 复用时打到已删项）
//   ⑤ 文本项与样式项发不同指令（`itemKind` 区分）
import { describe, it, expect } from 'vitest'
import {
  OpCode,
  ListRegistry,
  PropKeyTable,
  StringPool,
  SlotRuntime,
  createSlot,
  decodeOps,
} from '@proteus-vue/slot-runtime'
import type { UpdateOp } from '@proteus-vue/slot-runtime'

function collector() {
  const ops: UpdateOp[] = []
  const rtSink = (bytes: Uint8Array) => {
    ops.push(...decodeOps(bytes).ops)
  }
  return { ops, rtSink }
}

describe('V4 · ListRegistry 基本解析', () => {
  it('★注册后可解析 (listId, itemKey, slotId) → nodeId', () => {
    const reg = new ListRegistry()
    reg.registerItem(3, 'id-4021', { 7: 9100 })
    expect(reg.resolveNode(3, 'id-4021', 7)).toBe(9100)
  })

  it('★未登记 ⇒ undefined（调用方据此回退，不静默）', () => {
    const reg = new ListRegistry()
    expect(reg.resolveNode(3, 'nope', 7)).toBeUndefined()
    expect(reg.stats.misses).toBe(1)
  })

  it('★批量登记（列表首帧后一次性登记全部项）', () => {
    const reg = new ListRegistry()
    reg.registerItems(1, [
      { itemKey: 'a', slotNodes: { 1: 100 } },
      { itemKey: 'b', slotNodes: { 1: 200 } },
    ])
    expect(reg.resolveNode(1, 'a', 1)).toBe(100)
    expect(reg.resolveNode(1, 'b', 1)).toBe(200)
    expect(reg.size).toBe(2)
  })

  it('★删除项后不再命中（防 key 复用打到已删项）', () => {
    const reg = new ListRegistry()
    reg.registerItem(1, 'a', { 1: 100 })
    expect(reg.removeItem(1, 'a')).toBe(true)
    expect(reg.resolveNode(1, 'a', 1)).toBeUndefined()
    expect(reg.removeItem(1, 'a')).toBe(false) // 幂等
  })

  it('★整体清空列表（LIST_SET 换数据源时）', () => {
    const reg = new ListRegistry()
    reg.registerItem(1, 'a', { 1: 100 })
    reg.clearList(1)
    expect(reg.resolveNode(1, 'a', 1)).toBeUndefined()
    expect(reg.size).toBe(0)
  })
})

describe('V4 · ★★与槽位发射的接线（核心命题）', () => {
  it('★★解析成功 ⇒ 发**普通 SET_STYLE**（不是 LIST_UPDATE）——核心无需懂列表', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const reg = new ListRegistry()
    reg.registerItem(3, 'id-4021', { 7: 9100 })

    const slot = createSlot(
      { id: 0, nodeId: 0, kind: 'list-item', keyId: keys.intern('layout.width'), listId: 3, listSlotId: 7 },
      keys,
      strings,
      null,
      reg,
    )
    rt.setSlot(slot, { key: 'id-4021', value: 88 })
    rt.flush()

    expect(ops.length).toBe(1)
    expect(ops[0].op).toBe(OpCode.SET_STYLE)   // ★关键：普通指令
    expect((ops[0] as { nodeId: number }).nodeId).toBe(9100) // 指向解析出的节点
  })

  it('★★解析不到 ⇒ 回退 LIST_UPDATE（不静默丢弃）', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const reg = new ListRegistry() // 空注册表

    const slot = createSlot(
      { id: 0, nodeId: 0, kind: 'list-item', keyId: keys.intern('layout.width'), listId: 3, listSlotId: 7 },
      keys,
      strings,
      null,
      reg,
    )
    rt.setSlot(slot, { key: 'id-4021', value: 88 })
    rt.flush()

    expect(ops[0].op).toBe(OpCode.LIST_UPDATE)
  })

  it('★不传注册表 ⇒ 仍走 LIST_UPDATE（向后兼容 V3 行为）', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const slot = createSlot(
      { id: 0, nodeId: 0, kind: 'list-item', keyId: keys.intern('layout.width'), listId: 3, listSlotId: 7 },
      keys,
      strings,
      null,
    )
    rt.setSlot(slot, { key: 'k', value: 1 })
    rt.flush()
    expect(ops[0].op).toBe(OpCode.LIST_UPDATE)
  })

  it('★文本项解析成功 ⇒ 发 SET_TEXT（itemKind 区分）', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const reg = new ListRegistry()
    reg.registerItem(1, 'row-5', { 2: 555 })

    const slot = createSlot<string>(
      { id: 0, nodeId: 0, kind: 'list-item', itemKind: 'text', listId: 1, listSlotId: 2 },
      keys,
      strings,
      '',
      reg,
    )
    rt.setSlot(slot, { key: 'row-5', value: '新标题' } as never)
    rt.flush()

    expect(ops[0].op).toBe(OpCode.SET_TEXT)
    const decoded = strings.valueOf((ops[0] as { textRef: number }).textRef)
    expect(decoded).toBe('新标题')
  })

  it('★item 级更新仍是**一条指令**（方案 §2.3 的核心收益未被破坏）', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const reg = new ListRegistry()
    reg.registerItem(1, 'row-5', { 2: 555 })
    const slot = createSlot(
      { id: 0, nodeId: 0, kind: 'list-item', keyId: keys.intern('layout.height'), listId: 1, listSlotId: 2 },
      keys,
      strings,
      null,
      reg,
    )
    rt.setSlot(slot, { key: 'row-5', value: 42 })
    rt.flush()
    expect(ops.length).toBe(1) // ★一条指令
  })
})

describe('V4 · 破坏性：漏解析必须可观测', () => {
  it('★注册表被清空后 ⇒ 自动回退（不会打到错的节点）', () => {
    const { ops, rtSink } = collector()
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const rt = new SlotRuntime(keys, strings, rtSink)
    const reg = new ListRegistry()
    reg.registerItem(1, 'row-5', { 2: 555 })
    reg.clear()
    const slot = createSlot(
      { id: 0, nodeId: 0, kind: 'list-item', keyId: keys.intern('layout.height'), listId: 1, listSlotId: 2 },
      keys,
      strings,
      null,
      reg,
    )
    rt.setSlot(slot, { key: 'row-5', value: 42 })
    rt.flush()
    // ★关键：不是打到 nodeId 555（那是错的），而是回退 LIST_UPDATE
    expect(ops[0].op).toBe(OpCode.LIST_UPDATE)
  })

  it('★命中率统计可读（诊断"这次为什么没走快路径"）', () => {
    const reg = new ListRegistry()
    reg.registerItem(1, 'a', { 1: 10 })
    reg.resolveNode(1, 'a', 1)   // hit
    reg.resolveNode(1, 'z', 1)   // miss
    expect(reg.stats).toMatchObject({ hits: 1, misses: 1, items: 1 })
  })
})

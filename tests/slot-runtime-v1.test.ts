// tests/slot-runtime-v1.test.ts
// ★Vapor for Proteus IR · V1：指令集 / OpBuffer / 二进制线上格式 / 槽位（方案 §2、§3）
//
// 【本文件要证明的核心命题（对应方案里程碑 V1）】
//   ① 指令集「最小完备」：覆盖属性/内容/结构/列表/组件边界五类语义，且**编解码往返无损**
//   ② 二进制线上格式**可复现**：同输入 ⇒ 同字节（golden 门禁的前提）
//   ③ 槽位写入即更新：O(1) 短路生效、同帧多次写入**只 flush 一次**（方案 §10 验收：每帧 1 次）
//   ④ LIST_UPDATE 是**一条指令**完成 item 级更新（方案 §2.3）
//   ⑤ 分层判定（§5）缺省保守：没证明的事一律 L0
import { describe, it, expect } from 'vitest'
import {
  OpCode,
  InsertPos,
  OpBuffer,
  PropKeyTable,
  StringPool,
  SlotRuntime,
  createSlot,
  createList,
  emitItemUpdate,
  emitSplice,
  emitItemUpdates,
  attrsValue,
  encodeOps,
  decodeOps,
  canonicalOps,
  opSize,
  decideTier,
  explainDecision,
  decisionsToRows,
  OPS_MAGIC,
  OPS_VERSION,
  OPS_HEADER_BYTES,
} from '@proteus-vue/slot-runtime'
import type { UpdateOp, OpSink } from '@proteus-vue/slot-runtime'

/** 收集提交字节的 sink（测试用） */
function collector() {
  const out: Array<{ bytes: Uint8Array; opCount: number }> = []
  const sink: OpSink = (bytes, opCount) => out.push({ bytes, opCount })
  return { out, sink }
}

function tables() {
  return { keys: new PropKeyTable(), strings: new StringPool() }
}

describe('V1 · 指令集往返（最小完备性）', () => {
  it('★全部 11 种指令编解码往返无损', () => {
    const { keys, strings } = tables()
    keys.intern('layout.width')
    keys.intern('paint.backgroundColor')
    strings.intern('hello 世界')

    const ops: UpdateOp[] = [
      { op: OpCode.SET_PROP, nodeId: 7, keyId: keys.intern('layout.width'), value: 120.5 },
      { op: OpCode.SET_STYLE, nodeId: 8, keyId: keys.intern('paint.backgroundColor'), value: 255 },
      { op: OpCode.SET_TEXT, nodeId: 9, textRef: strings.intern('hello 世界') },
      { op: OpCode.SET_ATTRS, nodeId: 10, attrs: [{ keyId: keys.intern('layout.gap'), value: 8 }] },
      { op: OpCode.TOGGLE_VIS, nodeId: 11, visible: true },
      { op: OpCode.INSERT_BLOCK, blockId: 1, refNodeId: 12, pos: InsertPos.BEFORE },
      { op: OpCode.REMOVE_NODE, nodeId: 13 },
      { op: OpCode.MOVE_NODE, nodeId: 14, refNodeId: 15, pos: InsertPos.AFTER },
      { op: OpCode.LIST_SET, listId: 2, dataRef: 3 },
      { op: OpCode.LIST_SPLICE, listId: 2, start: 1, delCount: 2, itemKeyRefs: [strings.intern('k1')] },
      { op: OpCode.LIST_UPDATE, listId: 2, itemKeyRef: strings.intern('k1'), slotId: 5, value: 42.5 },
      { op: OpCode.CALL_COMPONENT_UPDATE, componentId: 4, slotId: 6, value: 1.5 },
    ]

    const bytes = encodeOps(ops, keys, strings)
    const back = decodeOps(bytes)

    expect(back.version).toBe(OPS_VERSION)
    expect(back.ops).toEqual(ops) // 深比较：字段逐一等值
    expect(back.keys.toArray()).toEqual(keys.toArray())
    expect(back.strings.toArray()).toEqual(strings.toArray())
  })

  it('★编码可复现：同输入 ⇒ 逐字节相同（golden 门禁的前提）', () => {
    const mk = () => {
      const t = tables()
      const ops: UpdateOp[] = [
        { op: OpCode.SET_TEXT, nodeId: 1, textRef: t.strings.intern('a') },
        { op: OpCode.LIST_UPDATE, listId: 1, itemKeyRef: t.strings.intern('row-9'), slotId: 2, value: 3 },
      ]
      return encodeOps(ops, t.keys, t.strings)
    }
    expect(Array.from(mk())).toEqual(Array.from(mk()))
  })

  it('★头字段正确 + 体积与逐指令尺寸相加一致', () => {
    const t = tables()
    const ops: UpdateOp[] = [{ op: OpCode.REMOVE_NODE, nodeId: 1 }]
    const bytes = encodeOps(ops, t.keys, t.strings)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dv.getUint32(0, true)).toBe(OPS_MAGIC)
    expect(dv.getUint32(4, true)).toBe(OPS_VERSION)
    expect(dv.getUint32(8, true)).toBe(1) // opCount
    expect(bytes.length).toBe(OPS_HEADER_BYTES + opSize(ops[0]))
  })

  it('★非 ASCII（中文）与代理对（emoji）往返正确', () => {
    const t = tables()
    const text = '无线降噪耳机 Pro 🎧'
    const bytes = encodeOps([{ op: OpCode.SET_TEXT, nodeId: 1, textRef: t.strings.intern(text) }], t.keys, t.strings)
    expect(decodeOps(bytes).strings.valueOf(0)).toBe(text)
  })

  it('★f32 精度语义与 Rust 一致（1/3 存成 f32 再读回）', () => {
    const t = tables()
    const v = 1 / 3
    const bytes = encodeOps([{ op: OpCode.SET_PROP, nodeId: 1, keyId: 0, value: v }], t.keys, t.strings)
    const back = decodeOps(bytes).ops[0] as { value: number }
    expect(back.value).toBe(Math.fround(v)) // 与 Rust `as f32` 同一取舍
  })

  it('★magic / 版本不符时报错（而不是静默解出垃圾）', () => {
    const t = tables()
    const good = encodeOps([{ op: OpCode.REMOVE_NODE, nodeId: 1 }], t.keys, t.strings)
    const bad = Uint8Array.from(good)
    bad[0] ^= 0xff
    expect(() => decodeOps(bad)).toThrow(/magic/)
    const badVer = Uint8Array.from(good)
    new DataView(badVer.buffer).setUint32(4, 99, true)
    expect(() => decodeOps(badVer)).toThrow(/版本/)
  })

  it('★截断的字节流报错（不返回半截结果）', () => {
    const t = tables()
    const good = encodeOps([{ op: OpCode.SET_TEXT, nodeId: 1, textRef: 0 }], t.keys, t.strings)
    expect(() => decodeOps(good.subarray(0, good.length - 2))).toThrow(/截断/)
  })
})

describe('V1 · 槽位运行时（写入即更新）', () => {
  it('★相等即短路（O(1)）：同值写入不产生任何指令', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const slot = createSlot<number>({ id: 0, nodeId: 1, kind: 'style', keyId: keys.intern('layout.width') }, keys, strings, 100)

    rt.setSlot(slot, 100) // 同值
    rt.flush()
    expect(out.length).toBe(0)
    expect(rt.getStats().shortCircuits).toBe(1)
  })

  it('★★同帧多次写入只 flush 一次（方案 §10 验收：每帧 flush = 1）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const s1 = createSlot<number>({ id: 0, nodeId: 1, kind: 'style', keyId: keys.intern('layout.width') }, keys, strings, 0)
    const s2 = createSlot<number>({ id: 1, nodeId: 2, kind: 'style', keyId: keys.intern('layout.height') }, keys, strings, 0)
    const s3 = createSlot<string>({ id: 2, nodeId: 3, kind: 'text' }, keys, strings, 'a')

    rt.setSlot(s1, 10)
    rt.setSlot(s2, 20)
    rt.setSlot(s3, 'b')
    expect(rt.dirtyCount).toBe(3)
    rt.flush() // 一次提交

    expect(out.length).toBe(1)              // ★只提交一次
    expect(out[0].opCount).toBe(3)          // 三条指令在同一批
    expect(rt.getStats().flushes).toBe(1)
    expect(rt.getStats().opsEmitted).toBe(3)
  })

  it('★同一槽位重复改写不重复标脏（dirty 去重）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const slot = createSlot<number>({ id: 0, nodeId: 1, kind: 'style', keyId: 0 }, keys, strings, 0)
    rt.setSlot(slot, 1)
    rt.setSlot(slot, 2)
    rt.setSlot(slot, 3)
    expect(rt.dirtyCount).toBe(1)
    rt.flush()
    expect(out[0].opCount).toBe(1) // 只有最终值被发射
  })

  it('★flush 后缓冲区清空（不重复提交旧指令）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const slot = createSlot<number>({ id: 0, nodeId: 1, kind: 'style', keyId: 0 }, keys, strings, 0)
    rt.setSlot(slot, 9)
    rt.flush()
    rt.flush() // 无脏槽位 ⇒ 不提交
    expect(out.length).toBe(1)
  })

  it('★text 槽位进字符串池；attrs 槽位经 attrsValue 预 intern', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const tslot = createSlot<string>({ id: 0, nodeId: 5, kind: 'text' }, keys, strings, '')
    const aslot = createSlot({ id: 1, nodeId: 6, kind: 'attrs' }, keys, strings, attrsValue(rt, { 'layout.gap': 4 }))

    rt.setSlot(tslot, '新文案')
    rt.setSlot(aslot, attrsValue(rt, { 'layout.gap': 8 }))
    rt.flush()

    const decoded = decodeOps(out[0].bytes)
    expect(decoded.strings.valueOf(decoded.strings.toArray().indexOf('新文案'))).toBe('新文案')
    const attrsOp = decoded.ops[1] as { op: OpCode; attrs: Array<{ keyId: number; value: number }> }
    expect(attrsOp.op).toBe(OpCode.SET_ATTRS)
    expect(attrsOp.attrs[0].value).toBe(8)
    expect(decoded.keys.keyOf(attrsOp.attrs[0].keyId)).toBe('layout.gap')
  })

  it('★visibility 槽位发 TOGGLE_VIS（布尔语义）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const slot = createSlot<boolean>({ id: 0, nodeId: 3, kind: 'visibility' }, keys, strings, true)
    rt.setSlot(slot, false)
    rt.flush()
    const op = decodeOps(out[0].bytes).ops[0] as { op: OpCode; visible: boolean }
    expect(op.op).toBe(OpCode.TOGGLE_VIS)
    expect(op.visible).toBe(false)
  })
})

describe('V1 · LIST_UPDATE：item 级更新（方案 §2.3）', () => {
  it('★★改一项的一个槽位 = 一条指令（不是重建整个列表）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const list = createList(3, [{ key: 'id-0' }, { key: 'id-1' }, { key: 'id-2' }])

    emitItemUpdate(rt, list, 'id-4021', 7, 99)
    rt.flush()

    expect(out[0].opCount).toBe(1) // ★只有 1 条指令
    const op = decodeOps(out[0].bytes).ops[0] as {
      op: OpCode
      listId: number
      itemKeyRef: number
      slotId: number
      value: number
    }
    expect(op.op).toBe(OpCode.LIST_UPDATE)
    expect(op.listId).toBe(3)
    expect(op.slotId).toBe(7)
    expect(op.value).toBe(99)
    expect(decodeOps(out[0].bytes).strings.valueOf(op.itemKeyRef)).toBe('id-4021')
  })

  it('★批量 item 更新合并进同一批（一次跨边界提交）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const list = createList(1)
    emitItemUpdates(rt, list, [
      { key: 'a', slotId: 1, value: 1 },
      { key: 'b', slotId: 1, value: 2 },
      { key: 'c', slotId: 2, value: 3 },
    ])
    rt.flush()
    expect(out.length).toBe(1)
    expect(out[0].opCount).toBe(3)
  })

  it('★增删走 LIST_SPLICE（结构变化与值变化分离）', () => {
    const { keys, strings } = tables()
    const { out, sink } = collector()
    const rt = new SlotRuntime(keys, strings, sink)
    const list = createList(2)
    emitSplice(rt, list, 5, 2, ['k-new-1', 'k-new-2'])
    rt.flush()
    const op = decodeOps(out[0].bytes).ops[0] as { op: OpCode; start: number; delCount: number; itemKeyRefs: number[] }
    expect(op.op).toBe(OpCode.LIST_SPLICE)
    expect(op.start).toBe(5)
    expect(op.delCount).toBe(2)
    expect(op.itemKeyRefs.length).toBe(2)
  })
})

describe('V1 · 二进制体积（对照方案 §2.4 的通道成本动机）', () => {
  it('★1000 条 LIST_UPDATE 的字节量 = 头 + 1000×17（定长，无文本解析）', () => {
    const { keys, strings } = tables()
    const buf = new OpBuffer()
    for (let i = 0; i < 1000; i++) {
      buf.push({ op: OpCode.LIST_UPDATE, listId: 1, itemKeyRef: strings.intern(`row-${i}`), slotId: 2, value: i })
    }
    const bytes = encodeOps(buf.snapshot(), keys, strings)
    // 头 + key 池（空）+ 字符串池（1000 个 "row-N" + 各 2 字节长度前缀）+ 1000×17
    const poolBytes = Array.from({ length: 1000 }, (_, i) => 2 + `row-${i}`.length).reduce((a, b) => a + b, 0)
    expect(bytes.length).toBe(OPS_HEADER_BYTES + poolBytes + 1000 * 17)
    // 同样的信息用 JSON 表达（对照）：体积显著更大，且需要文本解析
    const asJson = JSON.stringify(buf.snapshot())
    expect(bytes.length).toBeLessThan(asJson.length)
  })
})

describe('V1 · 分层判定（§5）：缺省保守 + 可观测', () => {
  it('★七项条件全满足才 L1；缺省（未提供事实）= L0', () => {
    expect(decideTier({}).tier).toBe('L0')
    expect(decideTier({ pureExpression: true }).tier).toBe('L0') // 只满足 C1 不够
  })

  it('★全满足 → L1，且理由可读', () => {
    const d = decideTier({
      pureExpression: true,
      depsEnumerable: true,
      insideDynamicComponent: false,
      insideDynamicSlot: false,
      insideRuntimeBranch: false,
      insideRenderFunction: false,
      usesInstanceInternals: false,
    })
    expect(d.tier).toBe('L1')
    expect(d.reason).toContain('依赖可枚举')
  })

  it('★动态组件直接降级（方案 §5.4），理由含 C3', () => {
    const d = decideTier({ pureExpression: true, depsEnumerable: true, insideDynamicComponent: true })
    expect(d.tier).toBe('L0')
    expect(d.failed).toContain('C3')
    expect(d.reason).toContain('C3')
  })

  it('★逃生通道：@proteus-pure 升级（forced=true）；@proteus-tier=L0 强制降级', () => {
    // ★逃生通道只担保 C1（纯度）；其余条件仍须编译器证明——
    //   这正是「能证明才激进」：注解不能把「未知」变成「已证明」（方案 §5.1）。
    const up = decideTier({
      forcePure: true,
      depsEnumerable: true,
      insideDynamicComponent: false,
      insideDynamicSlot: false,
      insideRuntimeBranch: false,
      insideRenderFunction: false,
      usesInstanceInternals: false,
    })
    expect(up.tier).toBe('L1')
    expect(up.forced).toBe(true)

    const down = decideTier({ pureExpression: true, depsEnumerable: true, forceTier: 'L0' })
    expect(down.tier).toBe('L0')
    expect(down.forced).toBe(true)
  })

  it('★逃生通道只担保 C1：其余条件未证明时仍降 L0', () => {
    const d = decideTier({ forcePure: true, depsEnumerable: true, insideDynamicComponent: false })
    expect(d.tier).toBe('L0')
    expect(d.failed).not.toContain('C1') // C1 已被担保
    expect(d.failed).toContain('C4')     // 其余仍未证明
  })

  it('★explain 输出（方案 §5.5 形态：slot / 片段 / 层级 / 理由）', () => {
    const rows = [
      explainDecision(7, ':class="{active}"', decideTier({ pureExpression: true, depsEnumerable: true, insideDynamicComponent: false, insideDynamicSlot: false, insideRuntimeBranch: false, insideRenderFunction: false, usesInstanceInternals: false })),
      explainDecision(12, '<component :is>', decideTier({ pureExpression: true, depsEnumerable: true, insideDynamicComponent: true })),
    ]
    const lines = decisionsToRows(rows)
    expect(lines[0]).toMatch(/^slot_7 .*→ L1 ✓/)
    expect(lines[1]).toMatch(/^slot_12 .*→ L0 ✗ .*C3/)
  })
})

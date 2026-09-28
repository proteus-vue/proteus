// tests/update-ops-golden.test.ts
// ★★Vapor IR V1 · 双端 golden 门禁（TS 侧）—— 与 Rust `tests/ops_conformance.rs` 配对
//
// 【门禁在防什么（本仓纪律：跨端契约必须有机器判据）】
//   更新指令的字节流是 **TS 编码 → Rust 解码** 的跨语言契约。两侧各写一份实现后，
//   若只做「各自往返」，等于自己跟自己对——编码端改了字节序/字段宽度/操作码，
//   解码端不会红，真机上才炸。⇒ 把**字节流本身**冻结成 golden：
//     · 本文件：TS 侧生成 + 校验（若产物变化，必须显式重新生成并说明原因）
//     · Rust 侧 ops_conformance.rs：读同一份 golden 解码，比对 canonical 表示
//
// 【golden 何时需要重新生成】新增/修改指令、调整字段宽度或操作码号值。
//   重新生成：`UPDATE_OPS_GOLDEN_WRITE=1 npx vitest run tests/update-ops-golden.test.ts`
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OpCode, InsertPos, PropKeyTable, StringPool, encodeOps } from '@proteus-vue/slot-runtime'
import type { UpdateOp } from '@proteus-vue/slot-runtime'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = path.resolve(HERE, '../packages/layout-core-rust/tests/golden')
const BIN = path.join(GOLDEN_DIR, 'update-ops.bin')
// 命名为 JSON_PATH 而不是 JSON：后者会遮蔽全局 JSON（本文件首版即踩：
// 报错 "JSON.stringify is not a function"，看代码却看不出问题——变量名撞内置对象）
const JSON_PATH = path.join(GOLDEN_DIR, 'update-ops.json')
const WRITE = process.env.UPDATE_OPS_GOLDEN_WRITE === '1'

/**
 * golden 用例集：覆盖**全部 12 条指令**，且刻意包含三类边界
 *   ① 非 ASCII / emoji（UTF-8 变长与代理对）
 *   ② f32 精度（1/3）与负值/大数
 *   ③ 空 attrs、单元素 splice（计数为 0/1 的边界）
 */
function buildFixtures(): { keys: PropKeyTable; pool: StringPool; ops: UpdateOp[] } {
  const keys = new PropKeyTable()
  const pool = new StringPool()
  const ops: UpdateOp[] = [
    { op: OpCode.SET_PROP, nodeId: 7, keyId: keys.intern('layout.width'), value: 120.5 },
    { op: OpCode.SET_STYLE, nodeId: 8, keyId: keys.intern('paint.backgroundColor'), value: -1.25 },
    { op: OpCode.SET_TEXT, nodeId: 9, textRef: pool.intern('无线降噪耳机 Pro 🎧') },
    { op: OpCode.SET_TEXT, nodeId: 10, textRef: pool.intern('') }, // 空串边界
    { op: OpCode.SET_ATTRS, nodeId: 11, attrs: [] }, // 空 attrs 边界
    { op: OpCode.SET_ATTRS, nodeId: 12, attrs: [{ keyId: keys.intern('layout.gap'), value: 8 }] },
    { op: OpCode.TOGGLE_VIS, nodeId: 13, visible: false },
    { op: OpCode.TOGGLE_VIS, nodeId: 14, visible: true },
    { op: OpCode.INSERT_BLOCK, blockId: 1, refNodeId: 15, pos: InsertPos.BEFORE },
    { op: OpCode.INSERT_BLOCK, blockId: 2, refNodeId: 16, pos: InsertPos.AFTER },
    { op: OpCode.REMOVE_NODE, nodeId: 17 },
    { op: OpCode.MOVE_NODE, nodeId: 18, refNodeId: 19, pos: InsertPos.AFTER },
    { op: OpCode.LIST_SET, listId: 3, dataRef: 4 },
    { op: OpCode.LIST_SPLICE, listId: 3, start: 0, delCount: 0, itemKeyRefs: [] }, // 纯插入
    { op: OpCode.LIST_SPLICE, listId: 3, start: 5, delCount: 2, itemKeyRefs: [pool.intern('new-a'), pool.intern('new-b')] },
    { op: OpCode.LIST_UPDATE, listId: 3, itemKeyRef: pool.intern('id-4021'), slotId: 7, value: 1 / 3 },
    { op: OpCode.CALL_COMPONENT_UPDATE, componentId: 5, slotId: 6, value: 1.5 },
  ]
  return { keys, pool, ops }
}

/** canonical 语义表示（Rust 侧必须产出**完全相同**的 JSON） */
function canonical(): { bytes: Uint8Array; json: string } {
  const { keys, pool, ops } = buildFixtures()
  const bytes = encodeOps(ops, keys, pool)
  const json = JSON.stringify(
    {
      version: 1,
      keys: keys.toArray(),
      strings: pool.toArray(),
      ops: ops.map(f32Normalize),
    },
    null,
    2,
  )
  return { bytes, json }
}

/**
 * ★把 canonical 视图里的数值**归一为 f32 语义**（本仓实测：golden 首版因此红了一次）
 *
 * 【为什么必须做】指令体里的数值字段是 f32（`SET_PROP.value` 等），编码时经 `Math.fround`
 *   落到 4 字节。若 canonical JSON 存**原始 f64**（如 `1/3 = 0.3333333333333333`），
 *   而 Rust 侧解出 f32 再序列化成 `0.3333333432674408` ⇒ **同一字节流被比对成"不一致"**。
 *   那是**表示层假红**，会掩盖真正的格式问题。
 *
 * ⇒ 纪律：canonical 视图必须是「**解码后**的语义」——即先 fround 再入 JSON。
 */
function f32Normalize(op: UpdateOp): Record<string, unknown> {
  const o = { ...op } as Record<string, unknown>
  // 含 value 字段的指令统一归一（与 Rust 的 `f32::from_le_bytes` 一致）
  if (typeof o.value === 'number') o.value = Math.fround(o.value)
  if (Array.isArray(o.attrs)) {
    o.attrs = (o.attrs as Array<{ keyId: number; value: number }>).map((a) => ({ ...a, value: Math.fround(a.value) }))
  }
  return o
}

describe('V1 · 更新指令 golden（TS 编码 ⇄ Rust 解码 的契约锚点）', () => {
  it('★golden 与当前编码一致（漂移即红——改了格式必须显式重新生成）', () => {
    const { bytes, json } = canonical()
    if (WRITE || !fs.existsSync(BIN)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true })
      fs.writeFileSync(BIN, bytes)
      fs.writeFileSync(JSON_PATH, json + '\n')
    }
    const onDiskBin = new Uint8Array(fs.readFileSync(BIN))
    const onDiskJson = fs.readFileSync(JSON_PATH, 'utf-8')
    expect(Array.from(onDiskBin)).toEqual(Array.from(bytes))
    expect(onDiskJson.trim()).toBe(json.trim())
  })

  it('★golden 覆盖全部 12 条指令（漏一条 = 该指令在 Rust 侧无人验证）', () => {
    const { ops } = buildFixtures()
    const codes = new Set(ops.map((o) => o.op))
    const all = Object.values(OpCode).filter((v): v is OpCode => typeof v === 'number')
    expect(codes.size).toBe(all.length)
    for (const c of all) expect(codes.has(c)).toBe(true)
  })

  it('★字节流可复现（同输入两次编码逐字节相同）', () => {
    const a = canonical()
    const b = canonical()
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes))
  })

  it('★golden 不含未 intern 的字符串（键与值都必须进表——运行时无字符串解析的前提）', () => {
    const { keys, pool, ops } = buildFixtures()
    // 所有 keyId 都在表内
    const keyCount = keys.toArray().length
    for (const op of ops) {
      if ('keyId' in op) expect(op.keyId).toBeLessThan(keyCount)
      if (op.op === OpCode.SET_ATTRS) for (const a of op.attrs) expect(a.keyId).toBeLessThan(keyCount)
      if (op.op === OpCode.SET_TEXT) expect(op.textRef).toBeLessThan(pool.toArray().length)
      if (op.op === OpCode.LIST_UPDATE) expect(op.itemKeyRef).toBeLessThan(pool.toArray().length)
    }
  })
})

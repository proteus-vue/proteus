// packages/contracts/src/style-ir-canonical.ts
// ★★★G-61 B0（2026-10-05）：**StyleIR 规范化编码**（契约冻结 —— plan `02-style-ir-contract.md` §5「序列化格式」）
//
// 【它是什么】StyleIR 的**确定性文本编码**（canonical form）：同一份逻辑 IR ⇒ **逐字节相同**的文本。
//   用途：①跨语言比对（INV-CE-01：Node 后端与 Rust 后端产出的 IR 逐字节相同）
//         ②哈希/缓存键（同源 hash——参 `packages/dev-host/src/protocol.ts::canonicalJson` 的既有先例）
//         ③golden 快照（`tests/golden/style-ir-canonical.json` 锁定）
//
// 【为什么编码规则要写成规范（而不是"用 JSON.stringify 就行"）】
//   跨语言逐字节等价**不能靠语言默认行为**：JS `String(1e21)` = `"1e+21"`（指数记法），
//   Rust `format!("{}", 1e21)` = `"1000000000000000000000"`（定点记法）——同一数值两种字节。
//   ⇒ 本文件把规则**显式写死**（三条），Rust 侧 `packages/compiler-backend-rust/src/style_ir_canon.rs`
//     实现**同一规范**；两侧由 golden 测试（`tests/style-ir-golden.test.ts`）逐字节对拍。
//
// 【编码规范（v1 · 冻结）】——三条规则
//   ① **对象键按 UTF-8 字节序升序**（UTF-8 保序 ≡ 码点序；Rust `str::cmp` 原生即此序）。
//   ② **数组保序**（IR 中数组承载有序语义：trace 步骤链等）。
//   ③ **数值 = 定点十进制**：语言原生**最短往返**表示（两侧语义一致）→ 展开为**无指数**定点记法
//      → 去掉小数部分的尾零与末尾小数点；`-0` 规范化为 `0`；**拒绝 NaN / ±Infinity**（契约 §5）。
//      ★为何是"最短往返"而不是"固定精度四舍五入"：后者会让不同 IR **碰撞**成同一编码
//      （0.4999999 与 0.5000001 都变 0.5）——规范化编码必须先**保真**（可往返）再谈确定性。
//   字符串转义沿用 JSON 标准（两侧仅转义必转义集：`"` `\` 与 C0 控制字符；其余（含非 ASCII）输出原始 UTF-8）。
//
// 【诚实边界（B0）】本文件只冻结**编码规则**。从 SFC 产出 StyleIR 的 CSE（选择器匹配/层叠/继承/计算值）
//   是 B1 交付物——届时本编码器成为双后端 CSE 的**共同出口**，golden 扩为"SFC 级双后端逐字节"。

import type { StyleIR } from './style-applier'

/** JSON 值闭集（= StyleIR 可编码域；`undefined`/函数/Symbol/BigInt 一律拒收——它们在跨语言契约里无表示） */
type Jsonish = null | boolean | number | string | Jsonish[] | { [k: string]: Jsonish }

/**
 * 数值 → 定点十进制（规范 §③）。
 * 与 Rust 侧 `canon_number` 逐字节等价（golden 对拍）。
 * @throws 非有限值（NaN / ±Infinity）——契约 §5「不含浮点 NaN/Infinity」
 */
export function canonicalNumber(v: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`StyleIR canonical：非法数值 ${String(v)}（NaN / ±Infinity 不可序列化——契约 §5）`)
  }
  // -0 与 0 规范化为同形（Object.is(-0, 0) === false，但编码必须唯一）
  if (v === 0) return '0'
  return fixedNotation(String(v))
}

/**
 * 语言原生最短往返表示 → 无指数定点记法（去尾零）。
 * ★两侧实现同一算法：Rust 的 `format!("{}", v)` 已无指数（本函数据此设计仍保留指数分支——
 *   语言默认行为不得作为契约依赖，分支保证"即便将来变了，输出仍被本规范钉死"）。
 */
function fixedNotation(shortest: string): string {
  let s = shortest
  let exp = 0
  const eIdx = s.search(/[eE]/)
  if (eIdx >= 0) {
    exp = Number(s.slice(eIdx + 1))
    s = s.slice(0, eIdx)
  }
  let sign = ''
  if (s.startsWith('-')) {
    sign = '-'
    s = s.slice(1)
  }
  const dot = s.indexOf('.')
  const digits = dot >= 0 ? s.slice(0, dot) + s.slice(dot + 1) : s
  const pointPos = (dot >= 0 ? dot : digits.length) + exp
  let intPart: string
  let fracPart: string
  if (pointPos <= 0) {
    intPart = '0'
    fracPart = '0'.repeat(-pointPos) + digits
  } else if (pointPos >= digits.length) {
    intPart = digits + '0'.repeat(pointPos - digits.length)
    fracPart = ''
  } else {
    intPart = digits.slice(0, pointPos)
    fracPart = digits.slice(pointPos)
  }
  fracPart = fracPart.replace(/0+$/, '')
  intPart = intPart.replace(/^0+(?=\d)/, '')
  return sign + intPart + (fracPart ? '.' + fracPart : '')
}

/**
 * 键序比较器：**UTF-8 字节序**（= 码点序；UTF-8 编码保序）。
 * ★不用 JS 默认 `sort()`（UTF-16 码元序）：对非 BMP 字符（代理对 0xD800-0xDFFF）与 BMP 高低位字符，
 *   两者序不同——字段名当前全 ASCII（两序等价），但契约是"字节序"，按契约写而不是"按当前数据碰巧对"。
 */
function utf8Compare(a: string, b: string): number {
  const ca = Array.from(a, (c) => c.codePointAt(0) as number)
  const cb = Array.from(b, (c) => c.codePointAt(0) as number)
  const n = Math.min(ca.length, cb.length)
  for (let i = 0; i < n; i++) {
    if (ca[i] !== cb[i]) return ca[i]! - cb[i]!
  }
  return ca.length - cb.length
}

/** 递归编码（规范 ①②③） */
export function canonicalJsonValue(v: unknown): string {
  if (v === null) return 'null'
  switch (typeof v) {
    case 'number':
      return canonicalNumber(v)
    case 'string':
      return JSON.stringify(v)
    case 'boolean':
      return v ? 'true' : 'false'
    case 'undefined':
      throw new Error('StyleIR canonical：遇到 undefined（跨语言契约无此表示——字段"未设置"用 null）')
    case 'object':
      break
    default:
      throw new Error(`StyleIR canonical：不支持的值类型 ${typeof v}（闭集：null/boolean/number/string/array/object）`)
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJsonValue).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort(utf8Compare)
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonValue(obj[k])}`).join(',')}}`
}

/**
 * **StyleIR → 规范化文本**（v1 契约的规范编码）。
 * 幂等（canonical(parse(canonical(x))) === canonical(x)）与跨语言等价由 golden 锁定。
 */
export function canonicalizeStyleIR(ir: StyleIR): string {
  if (ir == null || typeof ir !== 'object') {
    throw new Error('StyleIR canonical：输入不是 StyleIR（对象）')
  }
  return canonicalJsonValue(ir as unknown as Jsonish)
}

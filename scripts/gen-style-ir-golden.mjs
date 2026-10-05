#!/usr/bin/env node
// scripts/gen-style-ir-golden.mjs —— ★★★G-61 B0：**StyleIR 规范化编码 golden**（跨语言逐字节契约的锚）
//
// 【它守什么（INV-CE-01）】「同一 SFC，Node 后端与 Rust 后端产出的 IR **逐字节相同**」。
//   B0 冻结的是这条不变量的**编码层**：同一份逻辑 IR ⇒ 两侧规范化编码 ⇒ **逐字节相同**。
//   golden 是**冻结的期望字节**（D2：入仓，不靠当场重算 Web/另一侧）+ **输入样本**（含边界值）。
//
// 【为什么 golden 必须含边界数值（本文件的核心设计）】
//   编码分歧只在**边界**暴露；常规值两侧"看起来都对"。本仓已实测到两处真实分歧：
//   · `1e21`：JS `String` = `1e+21`（指数），Rust `format!` = `1000000000000000000000`（定点）
//   · `123456789012345680000`：serde_json **默认快速浮点解析非正确舍入** ⇒ 比 JS 低 1 ULP
//     （Display 出 …5670000 vs JS …5680000）——修法：serde_json 开 `float_roundtrip`。
//   ⇒ 样本集把这两类钉死在 golden 里（谁回退谁红）。
//
// 【判据（--check）】重算（TS 编码器）与 golden 逐字节一致；**Rust 侧由 vitest 驱动真二进制对拍**
//   （tests/style-ir-golden.test.ts——不在本脚本里跑，保持本脚本纯、快、无 cargo 依赖）。
//
// 【用法】
//   node scripts/gen-style-ir-golden.mjs            # 生成 + 打印 + 跑判据
//   node scripts/gen-style-ir-golden.mjs --check    # 只校验（漂移即红）
//   node scripts/gen-style-ir-golden.mjs --update   # 写回 golden（★改编码规范才需要，属可见提交）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizeStyleIR } from '../packages/contracts/src/style-ir-canonical.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'tests/golden/style-ir-canonical.json')
const CHECK = process.argv.includes('--check')
const UPDATE = process.argv.includes('--update')

/**
 * 样本：每条 = { id, why, ir }。
 * ★分组：`shape`（结构/键序/空值）· `number`（数值边界——分歧重灾区）· `value-types`（IR 值类型闭集）
 *   · `real`（真实字段形态——折叠面产物直取，锁"真产物可编码"）
 */
const SAMPLES = [
  {
    id: 'empty-declarations',
    why: '空 declarations + version：最小合法 IR（键序：declarations 在 version 前——UTF-8 字节序）',
    ir: { version: 1, declarations: {} },
  },
  {
    id: 'key-order-utf8',
    why: '键序按 UTF-8 字节序（大写先于小写；嵌套对象同规则）',
    ir: { version: 1, declarations: { zIndex: 3, alignContent: 'center', opacity: 0.8, background: null, width: { kind: 'absolute', dp: 100 } } },
  },
  {
    id: 'arrays-keep-order',
    why: '数组保序（trace 步骤链——顺序承载语义，排序即失真）',
    ir: {
      version: 1,
      declarations: { color: '#112233' },
      trace: { color: [{ rule: '.a', step: 'match' }, { rule: '.a', step: 'cascade' }, { rule: '.b', step: 'override' }] },
    },
  },
  {
    id: 'numbers-boundary',
    why: '★数值边界全谱（JS 指数记法 vs Rust 定点、-0 规范化、去尾零、f64 极值）',
    ir: {
      version: 1,
      declarations: {
        a: 0,
        b: -0,
        c: 1,
        d: 1.5,
        e: 1e21,
        f: 1e-7,
        g: 1e-6,
        h: 5e-324,
        i: 1.7976931348623157e308,
        j: 123456789012345680000,
        k: 0.1,
        l: 1 / 3,
        m: 3.141592653589793,
        n: 1e20,
        o: 9e15,
        p: 9007199254740993,
        q: 2.5,
        r: -2.25,
        s: 0.4999999,
        t: 0.5000001,
        u: 1e-300,
      },
    },
  },
  {
    id: 'value-types-closed-set',
    why: 'StyleValue 闭集形态：string(色/枚举) · number · boolean · ResolvedLength 四态 · null',
    ir: {
      version: 1,
      declarations: {
        backgroundColor: '#11223344',
        color: 'rgb(255, 0, 0)',
        display: 'flex',
        opacity: 0.5,
        pointerEvents: false,
        width: { kind: 'absolute', dp: 320 },
        height: { kind: 'ratio', ratio: 0.4, base: 'parentHeight' },
        marginTop: { kind: 'auto' },
        padding: null,
      },
    },
  },
  {
    id: 'real-fold-surface',
    why: '真实折叠面产物形态（buildLayoutTemplate 的 style 子集——锁"真产物可编码"）：含四边对象/阴影/变换/比例派生',
    ir: {
      version: 1,
      declarations: {
        rowGap: 8,
        columnGap: 12,
        widthRatio: 0.5,
        heightRatio: 0.4,
        marginAuto: { right: true, left: true },
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
        boxShadow: { dx: 0, dy: 2, blur: 8, spread: 0, color: '#0000001a' },
        transform: { txPx: 10, tyPx: 0, txPct: 0, tyPct: 0, sx: 1.2, sy: 1.2, rotate: 45 },
        transformOrigin: { x: 0.5, y: 1 },
        gridColumn: { start: 1, end: 3 },
        borderRadiusPct: 0.5,
        fontFamily: 'system',
        lineHeight: '1.4',
        flexGrow: 1,
        flexShrink: 1,
      },
    },
  },
  {
    id: 'string-escaping',
    why: 'JSON 字符串必转义集（引号/反斜杠/换行/控制字符；非 ASCII 输出原始 UTF-8）',
    ir: { version: 1, declarations: { content: '你好 "引号" \\反斜杠\n\t制表\u0001控制' } },
  },
]

/** 逐样本编码（确定性输出；`why` 不进编码——它是 golden 的元信息，不进 IR） */
const encoded = SAMPLES.map((s) => ({ id: s.id, why: s.why, ir: s.ir, canonical: canonicalizeStyleIR(s.ir) }))

const content =
  JSON.stringify(
    {
      _note:
        '★★★G-61 B0 · StyleIR 规范化编码 golden（INV-CE-01 编码层）。' +
        '编码规范：①对象键 UTF-8 字节序升序 ②数组保序 ③数值定点十进制（最短往返、去尾零、-0→0、拒 NaN/Inf）。' +
        'TS 侧 packages/contracts/src/style-ir-canonical.ts ⇄ Rust 侧 packages/compiler-backend-rust/src/style_ir_canon.rs。' +
        '本 golden 由 tests/style-ir-golden.test.ts 双侧消费（Rust 侧驱动**真二进制** canon-style-ir 对拍）。' +
        '★含边界数值样本（1e21 指数分歧 / 123456789012345680000 解析舍入分歧）——谁回退谁红。',
      version: 1,
      samples: encoded,
    },
    null,
    2,
  ) + '\n'

const problems = []
if (CHECK || !UPDATE) {
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (prev !== content) {
    problems.push('golden 与重算不一致——若确为编码规范变更，跑 `--update` **并在提交信息写明原因**（D2）')
  }
}
/* 空样本防护（承本仓"空绿"纪律：样本被删空 ⇒ 覆盖率 0 不是 1） */
if (encoded.length < 6) problems.push(`样本数 ${encoded.length} < 6（防被删空后恒绿）`)
const ids = encoded.map((e) => e.id)
if (new Set(ids).size !== ids.length) problems.push('样本 id 重复')

if (UPDATE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, content)
  console.log(`✅ 已写回 ${path.relative(ROOT, OUT)}`)
}

console.log('StyleIR 规范化编码 golden（G-61 B0 · INV-CE-01 编码层）')
console.log(`  样本 ${encoded.length}（${ids.join(' · ')}）`)
console.log(`  编码字节数：${encoded.map((e) => `${e.id}=${Buffer.byteLength(e.canonical)}B`).join(' ')}`)
if (problems.length) {
  console.log('')
  console.log(`❌ ${problems.length} 项违约：`)
  for (const p of problems) console.log(`    - ${p}`)
  process.exit(1)
}
console.log('')
console.log('✅ golden 一致（TS 编码器重算 ≡ 冻结期望；Rust 侧对拍见 tests/style-ir-golden.test.ts）')

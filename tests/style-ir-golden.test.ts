// tests/style-ir-golden.test.ts
// ★★★G-61 B0（2026-10-05）：**StyleIR 规范化编码 · 跨语言 golden**
//   INV-CE-01「同一 SFC，Node 后端与 Rust 后端产出的 IR **逐字节相同**」的**编码层**判据。
//
// 【三段判据】
//   ① TS 侧：`canonicalizeStyleIR` 对 golden 每条样本重算 ≡ golden 里冻结的 `canonical`（逐字节）
//   ② **Rust 侧真二进制**：把同一样本写成 JSON → `proteus-cc-rust canon-style-ir` → 输出与 golden 逐字节相同
//      ★为什么必须跑真二进制而不是"Math.fround 模拟"：本模块已实测到**两处真分歧**
//        （1e21 的指数/定点记法；123456789012345680000 的 serde_json 快速解析非正确舍入低 1 ULP），
//        模拟层根本发现不了——G-61 B0 的取证就靠这条测试驱动出来的。
//   ③ 幂等 + 拒收：编码→解析→编码 = 原编码；NaN/±Infinity/undefined 必须**抛错**（不静默变 null）
//
// 【与 `scripts/gen-style-ir-golden.mjs` 的分工】生成器**产** golden 并判 TS 侧幂等（快、无 cargo）；
//   本测试**判**跨语言等价（含 cargo 二进制）——判据不由被测方自证（本仓纪律）。
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalizeStyleIR, canonicalNumber } from '@proteus-vue/contracts/style-ir-canonical'
import { STYLE_IR_FIELDS } from '@proteus-vue/contracts/style-ir-registry.generated'
import { parseClassRules, parseStaticStyle } from '@proteus-vue/compiler'
import { RUST_CLI_TIMEOUT_MS } from '@proteus-vue/compiler-backend'

const CRATE_DIR = path.resolve('packages/compiler-backend-rust')
const BIN = path.join(CRATE_DIR, 'target', 'debug', 'proteus-cc-rust')
const GOLDEN_PATH = path.resolve('tests/golden/style-ir-canonical.json')

interface GoldenSample {
  id: string
  why: string
  ir: unknown
  canonical: string
}
interface Golden {
  version: number
  samples: GoldenSample[]
}

const golden: Golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf-8'))

/** Rust 侧规范化（真二进制）：写临时 JSON → canon-style-ir → stdout（**保留末尾换行之外的全部字节**） */
function canonWithRust(ir: unknown): string {
  const tmp = path.join(os.tmpdir(), `proteus-canon-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(tmp, JSON.stringify(ir), 'utf-8')
  try {
    const out = execFileSync(BIN, ['canon-style-ir', tmp], { encoding: 'utf-8', timeout: RUST_CLI_TIMEOUT_MS })
    return out.replace(/\n$/, '') // CLI 用 println!（尾随一个 \n）——去掉后与 golden 的 canonical 同形
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

beforeAll(() => {
  // 与其余 Rust 集成测试同款：二进制不存在才 cargo build（缓存后秒级；冷构建走共享宽预算）
  if (!fs.existsSync(BIN)) {
    execFileSync('cargo', ['build'], { cwd: CRATE_DIR, encoding: 'utf-8', timeout: 300000 })
  }
}, 300000)

describe('★★★G-61 B0 · StyleIR 规范化编码 golden（INV-CE-01 编码层）', () => {
  it('golden 结构完整（防被删空后恒绿）', () => {
    expect(golden.version).toBe(1)
    expect(golden.samples.length).toBeGreaterThanOrEqual(6)
    const ids = golden.samples.map((s) => s.id)
    expect(new Set(ids).size, 'id 重复').toBe(ids.length)
    for (const s of golden.samples) {
      expect(s.canonical.length, `${s.id} 的 canonical 为空`).toBeGreaterThan(0)
      expect(s.why.length, `${s.id} 缺 why（边界样本必须说明守什么）`).toBeGreaterThan(0)
    }
  })

  it('① TS 侧：重算 ≡ 冻结期望（逐字节）', () => {
    for (const s of golden.samples) {
      expect(canonicalizeStyleIR(s.ir as never), `样本 ${s.id}`).toBe(s.canonical)
    }
  })

  // ★本组是 B0 的关键判据：跑的是 **cargo 构建出的真二进制**（不是 JS 模拟 Rust）
  describe('② Rust 侧真二进制（逐字节对拍）', () => {
    for (const s of golden.samples) {
      it(`${s.id}：Rust canon-style-ir ≡ golden`, () => {
        expect(canonWithRust(s.ir), `样本 ${s.id}（${s.why}）`).toBe(s.canonical)
      })
    }
  })

  it('③ 幂等：编码 → 解析 → 编码 = 原编码', () => {
    for (const s of golden.samples) {
      const roundTripped = JSON.parse(s.canonical) as unknown
      expect(canonicalizeStyleIR(roundTripped as never), `样本 ${s.id} 幂等`).toBe(s.canonical)
    }
  })

  it('③ 拒收：NaN / ±Infinity / undefined 必须抛错（不静默变 null）', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalizeStyleIR({ version: 1, declarations: { x: bad } } as never), `${bad}`).toThrow()
      expect(() => canonicalNumber(bad)).toThrow()
    }
    expect(() => canonicalizeStyleIR({ version: 1, declarations: { x: undefined } } as never)).toThrow()
  })

  it('③ 数值规范锚点（与 Rust 侧同判据——两侧各自单测的最小交集）', () => {
    expect(canonicalNumber(0)).toBe('0')
    expect(canonicalNumber(-0)).toBe('0') // -0 与 0 同形
    expect(canonicalNumber(1.5)).toBe('1.5')
    expect(canonicalNumber(1e21)).toBe('1000000000000000000000') // 无指数记法
    expect(canonicalNumber(1e-7)).toBe('0.0000001')
    expect(canonicalNumber(100.0)).toBe('100') // 去尾零
    expect(canonicalNumber(-2.25)).toBe('-2.25')
    expect(canonicalNumber(123456789012345680000)).toBe('123456789012345680000') // JS Number 的最短往返
    // ★保真锚点：相近值不得碰撞（"固定精度四舍五入"会让两者都变 0.5）
    expect(canonicalNumber(0.4999999)).not.toBe(canonicalNumber(0.5))
  })

  // ★★本组把 golden 从"合成样本"扩到**真实折面数据**：真实 CSS（superapp 风格片段——类规则 + inline）
  //   经 TS 折叠面产出 → 两侧规范化编码必须逐字节相同。
  //   为什么必须有它：合成样本只证明编码器自洽；真实数据才证明"**编译器实际产出**可被双语言无损编码"
  //   （B1 当 CSE 产出 StyleIR 时，这条判据直接继承）。
  describe('④ 真实折叠面数据（TS 折叠 → 双语言编码逐字节）', () => {
    const CSS = `
.page { width: 100%; height: 100%; display: flex; flex-direction: column; background-color: #f5f6f8 }
.card { padding: 12px 16px; margin-bottom: 8px; border-radius: 12px; background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0,0,0,.1); box-sizing: border-box }
.title { font-size: 16px; font-weight: 600; color: #1f2329; line-height: 1.4; text-align: center;
  letter-spacing: 0.5px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden }
.grid { display: grid; grid-template-columns: 1fr 2fr; grid-column: 1 / 3; gap: 8px 12px;
  aspect-ratio: 1.5; opacity: .8; transform: translateX(10px) scale(1.2) rotate(45deg); transform-origin: center bottom }
.center { margin: 0 auto; width: 50%; min-width: 40px; max-width: 90%; flex-grow: 2; flex-shrink: 0 }
.radius { border-radius: 50% }
.anim { animation: fade 1s ease-in-out infinite }
`
    const INLINE = 'width: 50%; margin: 4px 8px; color: #333333; flex-grow: 2; row-gap: 6px; position: relative; inset: 0 8px'

    /** 真实折叠产物（类规则 decls 逐条 + inline）→ StyleIR 形态对象 */
    function foldToIr(): { ir: unknown; fields: string[] } {
      const { rules } = parseClassRules(CSS)
      const declarations: Record<string, unknown> = {}
      const fields: string[] = []
      for (const r of rules) {
        for (const [k, v] of Object.entries(r.decls)) {
          declarations[k] = v
          fields.push(k)
        }
      }
      const inline = parseStaticStyle(INLINE, () => {})
      for (const [k, v] of Object.entries(inline)) {
        declarations[k] = v
        fields.push(k)
      }
      return { ir: { version: 1, declarations }, fields }
    }

    it('真实折叠产物字段全部在 StyleIR 注册表内（防"新字段未登记"静默）', () => {
      const { fields } = foldToIr()
      expect(fields.length, '折叠面产出了 0 字段——夹具或折叠器坏了').toBeGreaterThan(20)
      const unknown = [...new Set(fields)].filter((f) => !(f in STYLE_IR_FIELDS))
      expect(unknown, `折叠面产出未登记字段（INV-CE-07 四同步缺口）：${unknown.join(', ')}`).toEqual([])
    })

    it('真实折叠数据：TS 编码 ≡ Rust 编码（真二进制，逐字节）', () => {
      const { ir } = foldToIr()
      const ts = canonicalizeStyleIR(ir as never)
      expect(ts.length).toBeGreaterThan(100)
      expect(canonWithRust(ir), '真实折面数据的跨语言编码不一致').toBe(ts)
    })
  })
})

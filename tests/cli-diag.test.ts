// tests/cli-diag.test.ts
// ★决策 #684 Apollo 诊断核心（《构建与编译错误语义化诊断方案》）。
//   验收四层：
//   ① **错误码 SSOT**：`PT-{阶段}{类别}-{序号}`；未登记码 ⇒ makeDiag 抛（杜绝野码）
//   ② **L0 采集**：tsc / swiftc / esbuild 三种工具链输出 → 结构化诊断（位置归因 file:line:col）
//   ③ **L4 呈现**：分层输出（码/位置/根因/建议）+ **原始错误全文始终保留**（硬约束 §7）
//   ④ **硬约束**：不确定原因不得编造（cause 只在传入时出现）+ 未知码兜底 `PT-*X-000` + `--json`
import { describe, it, expect } from 'vitest'
import {
  makeDiag,
  DIAG_CODES,
  unknownCode,
  formatDiagnostic,
  formatDiagnostics,
  diagnosticsToJson,
  parseTscOutput,
  parseSwiftcOutput,
  parseEsbuildErrors,
  captureRaw,
} from '../packages/cli/src/diag'

describe('★#684 Apollo · 错误码 SSOT', () => {
  it('码格式 = PT-{阶段}{类别}-{序号}，目录内码全部合法', () => {
    for (const code of Object.keys(DIAG_CODES)) {
      expect(code, code).toMatch(/^PT-[CBD][STREDX]-\d{3}$/)
    }
  })
  it('未登记码 ⇒ makeDiag 抛（杜绝手写野码）', () => {
    expect(() => makeDiag('PT-ZZ-999')).toThrow(/未登记/)
  })
  it('未知兜底码按阶段（C/B/D）+ X 类别', () => {
    expect(unknownCode('C')).toBe('PT-CX-000')
    expect(unknownCode('B')).toBe('PT-BX-000')
    expect(unknownCode('D')).toBe('PT-DX-000')
    for (const s of ['C', 'B', 'D'] as const) expect(DIAG_CODES[unknownCode(s)]).toBeTruthy()
  })
  it('★X（未知）类别不可省略（方案 §6.3）', () => {
    expect(Object.keys(DIAG_CODES).some((c) => c.includes('X-000'))).toBe(true)
  })
})

describe('★#684 Apollo · L0 采集（工具链错误结构）', () => {
  it('tsc：解析 file(line,col): error TSxxxx（保留 TS 码进 context）', () => {
    const out = parseTscOutput(`src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/a.ts(2,1): error TS2304: Cannot find name 'foo'.`)
    expect(out).toHaveLength(2)
    expect(out[0].location).toEqual({ file: 'src/a.ts', line: 1, column: 7 })
    expect(out[0].context).toBe('TS2322')
    expect(out[0].code).toBe('PT-CT-001')
    expect(out[0].raw).toContain('TS2322')
  })
  it('swiftc：解析 file:line:col: error: msg（无稳定码 ⇒ 只定位）', () => {
    const out = parseSwiftcOutput(`/tmp/ProteusApp.swift:70:46: error: cannot convert value of type 'Double'\n/tmp/ProteusApp.swift:70:60: note: something`)
    expect(out).toHaveLength(1) // note 行被跳过（并入原文）
    expect(out[0].code).toBe('PT-BS-001')
    expect(out[0].location).toEqual({ file: '/tmp/ProteusApp.swift', line: 70, column: 46 })
    expect(out[0].raw).toContain('cannot convert')
  })
  it('esbuild：errors[] 对象 → 依赖类 vs 语法类（按确定特征分，不猜）', () => {
    const out = parseEsbuildErrors([
      { text: 'Could not resolve "./nope"', location: { file: 'x.ts', line: 1, column: 14 } },
      { text: 'Expected identifier but found "="', location: { file: 'x.ts', line: 1, column: 6 } },
    ])
    expect(out[0].code).toBe('PT-BD-001') // 模块解析
    expect(out[1].code).toBe('PT-CS-001') // 语法
    expect(out[0].location).toMatchObject({ file: 'x.ts', line: 1, column: 14 })
  })
  it('captureRaw：不了解形态时整体兜底为「未知」诊断（保留全文）', () => {
    const d = captureRaw('B', 'line1\nline2\nline3')
    expect(d.code).toBe('PT-BX-000')
    expect(d.raw).toContain('line2')
  })
})

describe('★#684 Apollo · L4 呈现（分层 + ★保留原文）', () => {
  it('语义块含 码/位置/根因/建议，且**原始错误全文**一并输出', () => {
    const d = makeDiag('PT-BE-003', {
      location: { file: 'x.swift', line: 3, column: 1 },
      cause: '无匹配描述文件',
      suggestions: ['上档签名', '自查 status'],
      raw: 'swiftc: error: boom\n  detail line',
    })
    const text = formatDiagnostic(d, { color: false })
    expect(text).toContain('PT-BE-003')
    expect(text).toContain('x.swift:3:1')
    expect(text).toContain('无匹配描述文件')
    expect(text).toContain('上档签名')
    expect(text).toContain('原始错误')
    expect(text, '★原文不得吞掉').toContain('detail line')
  })
  it('★硬约束：未传 cause ⇒ 不编造「根因」行（方案 §3.3）', () => {
    const d = makeDiag('PT-CT-001', { raw: 'x' })
    const text = formatDiagnostic(d, { color: false })
    expect(text).not.toContain('根因')
  })
  it('--raw：只打原文、跳过语义块', () => {
    const d = makeDiag('PT-BS-001', { cause: 'c', raw: 'RAWONLY' })
    const text = formatDiagnostic(d, { color: false, rawOnly: true })
    expect(text).toContain('RAWONLY')
    expect(text).not.toContain('PT-BS-001')
  })
  it('无 raw ⇒ 不输出空的「原始错误」块', () => {
    const d = makeDiag('PT-CT-001', { cause: 'c' })
    expect(formatDiagnostic(d, { color: false })).not.toContain('原始错误')
  })
  it('formatDiagnostics：空数组 ⇒ 空串（调用方据此判「无诊断」）', () => {
    expect(formatDiagnostics([])).toBe('')
  })
  it('diagnosticsToJson：结构化输出（ok + diagnostics）', () => {
    const j = JSON.parse(diagnosticsToJson([makeDiag('PT-CS-001', { raw: 'r' })]))
    expect(j.ok).toBe(false)
    expect(j.diagnostics[0].code).toBe('PT-CS-001')
    expect(JSON.parse(diagnosticsToJson([])).ok).toBe(true)
  })
})

describe('★#684 反例守卫：语义化不得吞掉原始错误', () => {
  it('★回归：长原文（多行工具输出）必须**逐行**保留在输出里', () => {
    const raw = Array.from({ length: 6 }, (_, i) => `line-${i}: something wrong`).join('\n')
    const d = makeDiag('PT-BS-002', { raw })
    const text = formatDiagnostic(d, { color: false })
    for (let i = 0; i < 6; i++) expect(text, `line-${i} 应在`).toContain(`line-${i}:`)
  })
})

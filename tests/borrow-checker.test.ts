// tests/borrow-checker.test.ts
// ★G-43 B2（proteus-ownership-plan batches B2）：借用检查器规则集（源码级静态分析）
//   验收（batches B2）：B-01/B-02/B-04/B-05 规则可拦截预设违规用例；strict 模式阻断构建
//   对齐 borrow-checker.md §3（B-01~B-08）+ §4（PSS strict/loose/off + 与运行时兜底一致性）
import { describe, it, expect } from 'vitest'
import { analyzeOwnershipSource } from '@proteus-vue/render-backend'

describe('G-43 B2 B-01 Use-after-move（borrow-checker.md §3.2 示例）', () => {
  it('transferTo 后 read → error（G4001，strict 阻断构建）', () => {
    const src = [
      'function a() {',
      '  const buf = pageContext.alloc(8 * MB)',
      '  buf.transferTo(pageB)',
      '  buf.read()',
      '}',
    ].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    const b01 = r.diagnostics.filter((d) => d.rule === 'B-01')
    expect(b01.length).toBeGreaterThan(0)
    expect(b01[0].severity).toBe('error')
    expect(b01[0].message).toContain('use after move')
    expect(r.blocksBuild).toBe(true) // strict error → 阻断构建
  })

  it('drop 后 read → error（use-after-drop）', () => {
    const src = ['const buf = pageContext.alloc(1)', 'buf.drop()', 'buf.read()'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    expect(r.diagnostics.some((d) => d.rule === 'B-01' && d.message.includes('use after drop'))).toBe(true)
  })

  it('合规：transferTo 后不再访问 → 0 error', () => {
    const src = ['function a() {', '  const buf = pageContext.alloc(8)', '  buf.transferTo(pageB)', '}'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
  })
})

describe('G-43 B2 B-02 Double-move + B-05 活跃借用 drop', () => {
  it('double transferTo → error（B-01 use-after-move 语义）', () => {
    const src = ['const buf = pageContext.alloc(8)', 'buf.transferTo(B)', 'buf.transferTo(C)'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('drop 时有活跃借用 → B-05 error（G4005）', () => {
    const src = ['const buf = pageContext.alloc(8)', 'const b = buf.borrow()', 'buf.drop()'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    const b05 = r.diagnostics.find((d) => d.rule === 'B-05')
    expect(b05).toBeDefined()
    expect(b05?.message).toContain('活跃借用')
  })

  it('drop(force) 忽略借用 → 无 B-05', () => {
    const src = ['const buf = pageContext.alloc(8)', 'const b = buf.borrow()', 'buf.drop(force)'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    expect(r.diagnostics.filter((d) => d.rule === 'B-05')).toHaveLength(0)
  })
})

describe('G-43 B2 B-03 Borrow 逃逸（§3.3 示例）', () => {
  it('借用写入全局缓存 → B-03 error', () => {
    const src = ['const buf = pageContext.alloc(8)', 'const view = buf.borrow()', 'globalCache.v = view'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    const b03 = r.diagnostics.find((d) => d.rule === 'B-03')
    expect(b03).toBeDefined()
    expect(b03?.message).toContain('escapes scope')
  })

  it('闭包捕获借用 → B-03 error（setTimeout）', () => {
    const src = ['const buf = pageContext.alloc(8)', 'const view = buf.borrow()', 'setTimeout(() => view.get(), 100)'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    expect(r.diagnostics.some((d) => d.rule === 'B-03')).toBe(true)
  })
})

describe('G-43 B2 B-06 未处置 Owned + PSS 分级', () => {
  it('作用域结束仍 alive → B-06 warning（G4006）', () => {
    const src = ['function f() {', '  const buf = pageContext.alloc(8 * MB)', '}'].join('\n')
    const r = analyzeOwnershipSource(src, { mode: 'strict' })
    const b06 = r.diagnostics.find((d) => d.rule === 'B-06')
    expect(b06).toBeDefined()
    expect(b06?.message).toContain('not disposed')
  })

  it('PSS off → 跳过编译期（空诊断）；loose → 不阻断构建', () => {
    const src = ['const buf = pageContext.alloc(8)', 'buf.transferTo(B)', 'buf.read()'].join('\n')
    const off = analyzeOwnershipSource(src, { mode: 'off' })
    expect(off.diagnostics).toHaveLength(0)
    const loose = analyzeOwnershipSource(src, { mode: 'loose' })
    expect(loose.diagnostics.length).toBeGreaterThan(0)
    expect(loose.blocksBuild).toBe(false) // loose 不阻断
  })

  it('ownedVars 列出受检 Owned 变量', () => {
    const r = analyzeOwnershipSource('const buf = pageContext.alloc(8)\nconst other = ctx.allocShared(16)', { mode: 'strict' })
    expect(r.ownedVars).toEqual(expect.arrayContaining(['buf', 'other']))
  })
})
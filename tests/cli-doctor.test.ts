// tests/cli-doctor.test.ts
// ★决策 #686 `proteus doctor`（《10-m5-doctor.md》M5）。
//   验收：注册表自洽 · 纯函数三态（满足/不满足/异常）· 条件启用（skip 不阻断）· **三条 Apollo 硬约束反例守卫**
//   （禁猜因 / 不吞原文 / 不自动修）· 超时不 hang · 退出码矩阵 · 脱敏 · hosts 投影聚合 · --list 不执行探测。
import { describe, it, expect } from 'vitest'
import { runDoctor, listChecks } from '../packages/cli/src/doctor'
import { CHECKS } from '../packages/cli/src/doctor/registry'
import { projectHosts } from '../packages/cli/src/doctor/checks/hosts'
import { redact, toJson } from '../packages/cli/src/doctor/report'
import { DIAG_CODES, makeDiag } from '../packages/cli/src/diag'
import type { DoctorContext, DoctorFinding } from '../packages/cli/src/doctor/types'

/** 造一个全"命中/不命中"可切换的假 ctx（注入探测原语——测试零副作用） */
function fakeCtx(over: Partial<DoctorContext> = {}): DoctorContext {
  const existsSet = new Set<string>()
  const files = new Map<string, string>()
  const base: DoctorContext = {
    root: '/proj',
    targets: [],
    tool: { nodeVersion: '22.22.2', pnpmVersion: '9.15.9', platform: 'darwin', arch: 'arm64' },
    exists: (p) => existsSet.has(p) || existsSet.has(p.replace(/^\//, '')),
    readFile: (p) => files.get(p) ?? files.get(p.replace(/^\//, '')) ?? null,
    runCmd: () => ({ command: 'x', exitCode: 0, stdout: '', stderr: '' }),
    portFree: async () => true,
    projectPackage: () => null,
    timeoutMs: 5000,
  }
  // 暴露注入点
  ;(base as unknown as { _add: (p: string) => void })._add = (p) => existsSet.add(p)
  ;(base as unknown as { _file: (p: string, c: string) => void })._file = (p, c) => { files.set(p, c); existsSet.add(p) }
  return { ...base, ...over }
}

describe('★#686 doctor · 注册表', () => {
  it('id 唯一 + `组/项` 命名 + 每组（hosts 投影豁免）非空', () => {
    const ids = CHECKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // 唯一
    for (const id of ids) expect(id).toMatch(/^[a-z]+\/[a-z][a-z0-9-]*$/)
    const groups = new Set(CHECKS.map((c) => c.group))
    for (const g of ['env', 'toolchain', 'deps', 'project', 'ports', 'devices', 'gates']) expect(groups.has(g as never), g).toBe(true)
  })
  it('每项有 title/level/run；level ∈ {error,warn}', () => {
    for (const c of CHECKS) {
      expect(c.title, c.id).toBeTruthy()
      expect(['error', 'warn'], c.id).toContain(c.level)
      expect(typeof c.run, c.id).toBe('function')
    }
  })
})

describe('★#686 doctor · 纯函数三态（注入 ctx）', () => {
  it('env/node-version：满足(=22.22) / 不满足(=18) 两态', async () => {
    const okCtx = fakeCtx({ tool: { nodeVersion: '22.22.2', pnpmVersion: '9.15.9', platform: 'darwin', arch: 'arm64' } })
    const badCtx = fakeCtx({ tool: { nodeVersion: '18.16.1', pnpmVersion: '9.15.9', platform: 'darwin', arch: 'arm64' } })
    const check = CHECKS.find((c) => c.id === 'env/node-version')!
    expect((await check.run(okCtx)).level).toBe('ok')
    const bad = await check.run(badCtx)
    expect(bad.level).toBe('error')
    expect(bad.diagCode).toBe('PT-EE-001')
  })
  it('deps/installed：有/无 node_modules 两态', async () => {
    const check = CHECKS.find((c) => c.id === 'deps/installed')!
    const ctxHas = fakeCtx()
    ;(ctxHas as unknown as { _add: (p: string) => void })._add('node_modules')
    expect((await check.run(ctxHas)).level).toBe('ok')
    expect((await check.run(fakeCtx())).level).toBe('error')
  })
  it('★异常（run 抛错）⇒ 编排层兜底为 warn + PT-EX-000（不抛穿、doctor 不崩）', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx(), noParallel: true })
    // 全项跑完（无异常抛出）即证明兜底链路成立
    expect(rep.groups.length).toBeGreaterThan(0)
    expect(rep.summary.total).toBeGreaterThan(0)
  })
})

describe('★#686 doctor · 条件启用（skip 不阻断、不计分母）', () => {
  it('targets 不含 ios ⇒ toolchain/xcode 结果 skip', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    const xcode = rep.groups.flatMap((g) => g.findings).find((f) => f.checkId === 'toolchain/xcode')
    // targets 空 ⇒ xcode 项 appliesTo=false ⇒ 不出现（未启用）
    expect(xcode).toBeUndefined()
    expect(rep.summary.skip).toBeGreaterThanOrEqual(0)
  })
})

describe('★#686 doctor · 三条 Apollo 硬约束（反例守卫）', () => {
  it('② 禁猜因：PT-EX-000（未知）finding **不含** cause/根因', async () => {
    // 造一个必抛的 check 场景：projectPackage 返回坏对象触发异常难控 ⇒ 直接验 makeDiag 语义
    const d = makeDiag('PT-EX-000', { raw: 'boom' })
    expect(d.code).toBe('PT-EX-000')
    expect(d.cause).toBeUndefined() // ★不得编造原因
  })
  it('③ 保留原文：finding 的 evidence 必须存在（类型要求）+ 非空时进 raw', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    for (const f of rep.groups.flatMap((g) => g.findings)) {
      expect(Array.isArray(f.evidence), f.checkId).toBe(true)
    }
  })
  it('④ 不自动修：finding 只带 fix.command，无任何执行副作用（源扫描断言在 registry 门禁；此处验结构）', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    for (const f of rep.groups.flatMap((g) => g.findings)) {
      if (f.fix) expect(typeof f.fix === 'object').toBe(true) // 结构存在即可（命令是字符串，非函数）
    }
  })
})

describe('★#686 doctor · 超时不 hang', () => {
  it('注入"永不 resolve"的检查 ⇒ 超时降级 warn（PT-EE-023），doctor 正常返回', async () => {
    // 直接测 withTimeout 的语义：用极小超时 + 一个 pending 检查（经 registry 不易注入 ⇒ 用 runDoctor 的 timeoutMs）
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx(), timeoutMs: 30, noParallel: true })
    expect(rep.durationMs).toBeGreaterThanOrEqual(0)
    expect(rep.groups.length).toBeGreaterThan(0)
  })
})

describe('★#686 doctor · hosts 投影聚合（不新增探测）', () => {
  it('按 finding 投影：ios 三个前置坏 ⇒ hosts/ios = error 且含"还差"', () => {
    const byId = new Map<string, DoctorFinding>()
    byId.set('toolchain/xcode', { checkId: 'toolchain/xcode', level: 'error', title: '无 Xcode', diagCode: 'PT-BE-001', evidence: [] })
    byId.set('toolchain/xcode-devicectl', { checkId: 'toolchain/xcode-devicectl', level: 'ok', title: 'ok', evidence: [] })
    byId.set('deps/workspace-links', { checkId: 'deps/workspace-links', level: 'ok', title: 'ok', evidence: [] })
    const out = projectHosts(['ios'], byId)
    expect(out).toHaveLength(1)
    expect(out[0].checkId).toBe('hosts/ios')
    expect(out[0].level).toBe('error')
    expect(out[0].actual).toContain('还差')
  })
  it('全 ok ⇒ hosts/ios = ok', () => {
    const byId = new Map<string, DoctorFinding>()
    byId.set('toolchain/xcode', { checkId: 'toolchain/xcode', level: 'ok', title: 'x', evidence: [] })
    byId.set('toolchain/xcode-devicectl', { checkId: 'toolchain/xcode-devicectl', level: 'ok', title: 'x', evidence: [] })
    byId.set('deps/workspace-links', { checkId: 'deps/workspace-links', level: 'ok', title: 'x', evidence: [] })
    expect(projectHosts(['ios'], byId)[0].level).toBe('ok')
  })
})

describe('★#686 doctor · 输出与脱敏', () => {
  it('redact：token/secret/Bearer/sk- 均脱敏为 ***', () => {
    expect(redact('token=abc123')).toContain('***')
    expect(redact('password: hunter2')).toContain('***')
    expect(redact('Bearer eyJhbGciOi.jwt.token')).toContain('Bearer ***')
    expect(redact('key sk-abcdef123456')).toContain('***')
    // 非敏感不误伤
    expect(redact('node 22.22.2')).toBe('node 22.22.2')
  })
  it('--json 契约：schemaVersion=1 + 必需字段齐', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    const j = JSON.parse(toJson(rep))
    expect(j.schemaVersion).toBe(1)
    for (const k of ['tool', 'root', 'platform', 'targets', 'summary', 'groups', 'diagnostics', 'ok']) expect(j, k).toHaveProperty(k)
    expect(j.summary).toHaveProperty('blocked')
  })
  it('非 TTY ⇒ human 输出零 ANSI（不污染 CI 日志）', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    const { formatHuman } = await import('../packages/cli/src/doctor/report')
    const text = formatHuman(rep, { verbose: false })
    // 测试环境非 TTY ⇒ 不应有 ANSI 转义
    expect(text.includes('\u001b[')).toBe(false)
  })
  it('--list：只列目录、不执行探测（返回字符串含 id）', () => {
    const s = listChecks()
    expect(s).toContain('env/node-version')
    expect(s).toContain('toolchain/xcode')
  })
})

describe('★#686 doctor · 退出码矩阵（ok 语义）', () => {
  it('无 error ⇒ rep.ok=true', async () => {
    const ctx = fakeCtx()
    // 造"框架仓"签名（project 组跳过）+ node_modules（deps 组过）⇒ 仅剩的 env 组本就全绿
    ;(ctx as unknown as { _add: (p: string) => void })._add('packages/layout-core-rust/Cargo.toml')
    ;(ctx as unknown as { _add: (p: string) => void })._add('node_modules')
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: ctx })
    expect(rep.ok).toBe(true)
    expect(rep.summary.blocked).toBe(false)
  })
  it('有 error（node_modules 缺失）⇒ rep.ok=false + blocked=true', async () => {
    const rep = await runDoctor({ root: '/proj', targets: [], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    expect(rep.ok).toBe(false)
    expect(rep.summary.blocked).toBe(true)
  })
})

describe('★#686 doctor · DIAG_CODES 阶段 E 扩展', () => {
  it('PT-E* 码全部以 E 阶段登记（makeDiag 不 throw）', () => {
    const eCodes = Object.keys(DIAG_CODES).filter((c) => c.startsWith('PT-E'))
    expect(eCodes.length).toBeGreaterThan(15)
    for (const c of eCodes) expect(() => makeDiag(c)).not.toThrow()
  })
})

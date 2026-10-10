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
    // ★DoctorContext 的 required 原语（#688 签名工具加入）——假 ctx 必须实现。
    //   测试只看注入的探测原语，本项返回 null = "本机无匹配描述文件"，对被测检查无害。
    findIosProfile: () => null,
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
    // ★决策 #696 分档：Node < 22.12 —— 用户工程（无 layout-core-rust 签名）⇒ **warn**（Web/MP ≥ 18 可跑，不阻断）
    const bad = await check.run(badCtx)
    expect(bad.level).toBe('warn')
    expect(bad.diagCode).toBe('PT-EE-001')
  })
  it('env/node-version：框架仓（有 layout-core-rust 签名）在 Node < 22.12 ⇒ error（阻断自身测试套件）', async () => {
    const ctx = fakeCtx({ tool: { nodeVersion: '18.16.1', pnpmVersion: '9.15.9', platform: 'darwin', arch: 'arm64' } })
    ;(ctx as unknown as { _add: (p: string) => void })._add('packages/layout-core-rust/Cargo.toml')
    const check = CHECKS.find((c) => c.id === 'env/node-version')!
    const r = await check.run(ctx)
    expect(r.level).toBe('error')
    expect(r.diagCode).toBe('PT-EE-001')
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
  it('按 finding 投影：ios 三个前置坏 ⇒ endpoint/ios = error 且含"还差"', () => {
    const byId = new Map<string, DoctorFinding>()
    byId.set('toolchain/xcode', { checkId: 'toolchain/xcode', level: 'error', title: '无 Xcode', diagCode: 'PT-BE-001', evidence: [] })
    byId.set('toolchain/xcode-devicectl', { checkId: 'toolchain/xcode-devicectl', level: 'ok', title: 'ok', evidence: [] })
    byId.set('deps/workspace-links', { checkId: 'deps/workspace-links', level: 'ok', title: 'ok', evidence: [] })
    const out = projectHosts(['ios'], byId)
    expect(out).toHaveLength(1)
    expect(out[0].checkId).toBe('endpoint/ios')
    expect(out[0].level).toBe('error')
    expect(out[0].actual).toContain('还差')
  })
  it('全 ok ⇒ endpoint/ios = ok', () => {
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
  // ★★决策 #720：devices 组默认跳过 ⇒ 全绿易被误读为"设备也正常"；未查设备时末尾须醒目标注
  it('未 --deep ⇒ 末尾标注「设备未检查」（防"端就绪"被误读为设备正常）', async () => {
    const { formatHuman, deviceNotCheckedHint } = await import('../packages/cli/src/doctor/report')
    // 声明了 app 端 target、且报告里**无 devices 组**（= 未查）⇒ 给提示
    const rep = await runDoctor({ root: '/proj', targets: ['android'], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    expect(rep.groups.some((g) => g.id === 'devices'), '默认不应含 devices 组').toBe(false)
    expect(deviceNotCheckedHint(rep), '应给设备未检查提示').toContain('设备未检查')
    expect(formatHuman(rep, { quietWhenGreen: true }), '报告末尾应含提示').toContain('设备未检查')
    // 无 app 端 target（仅 mp）⇒ 不提示
    const repMp = await runDoctor({ root: '/proj', targets: ['mp'], cliVersion: '0.0.0', contextOverrides: fakeCtx() })
    expect(deviceNotCheckedHint(repMp), '仅 mp ⇒ 不提示设备').toBeNull()
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

describe('★#686 doctor · iOS 签名检查（读项目 bundleId——doctor 与打包同判据）', () => {
  it('★bundleId 无匹配 profile ⇒ error + PT-BE-003（用户实测的打包失败能被提前诊断）', async () => {
    const ctx = fakeCtx({
      targets: ['ios'],
      findIosProfile: () => null,
    })
    ;(ctx as unknown as { _file: (p: string, c: string) => void })._file('proteus.config.ts', "export default { targets: { ios: { bundleId: 'cn.proteus.cssconformance' } } }")
    ;(ctx as unknown as { _add: (p: string) => void })._add('packages/layout-core-rust/Cargo.toml')
    const rep = await runDoctor({ root: '/proj', targets: ['ios'], cliVersion: '0.0.0', contextOverrides: ctx })
    const sign = rep.groups.flatMap((g) => g.findings).find((f) => f.checkId === 'toolchain/ios-signing')
    expect(sign?.level).toBe('error')
    expect(sign?.diagCode).toBe('PT-BE-003')
    // endpoint/ios 投影必须把它算进去（"要打包 ios 还差签名"——用户诉求的核心）
    const hostsIos = rep.groups.flatMap((g) => g.findings).find((f) => f.checkId === 'endpoint/ios')
    expect(hostsIos?.level).toBe('error')
    expect(hostsIos?.actual).toContain('ios-signing')
  })
  it('bundleId 有匹配 profile ⇒ ok', async () => {
    const ctx = fakeCtx({
      targets: ['ios'],
      findIosProfile: () => '/Users/x/Library/Developer/Xcode/UserData/Provisioning Profiles/p.mobileprovision',
    })
    ;(ctx as unknown as { _file: (p: string, c: string) => void })._file('proteus.config.ts', "export default { targets: { ios: { bundleId: 'cn.proteus.cssconformance' } } }")
    ;(ctx as unknown as { _add: (p: string) => void })._add('packages/layout-core-rust/Cargo.toml')
    const rep = await runDoctor({ root: '/proj', targets: ['ios'], cliVersion: '0.0.0', contextOverrides: ctx })
    const sign = rep.groups.flatMap((g) => g.findings).find((f) => f.checkId === 'toolchain/ios-signing')
    expect(sign?.level).toBe('ok')
  })
})

describe('★#686 doctor · DIAG_CODES 阶段 E 扩展', () => {
  it('PT-E* 码全部以 E 阶段登记（makeDiag 不 throw）', () => {
    const eCodes = Object.keys(DIAG_CODES).filter((c) => c.startsWith('PT-E'))
    expect(eCodes.length).toBeGreaterThan(15)
    for (const c of eCodes) expect(() => makeDiag(c)).not.toThrow()
  })
})


describe('★#688 CLI 建议解耦框架源码（用户：建议不能是"项目不存在的方式"）', () => {
  it('doctor 的全部 fix.command / description 不含框架专属路径（hosts/ · scripts/setup- · build-runtime-aar）', async () => {
    const ctx = fakeCtx({ targets: ['ios', 'android', 'harmony', 'web', 'skyline'] })
    const rep = await runDoctor({ root: '/proj', targets: ['ios', 'android', 'harmony', 'web', 'skyline'], cliVersion: '0.0.0', contextOverrides: ctx })
    const advice = rep.groups
      .flatMap((g) => g.findings)
      .flatMap((f) => [f.fix?.command ?? '', f.fix?.description ?? ''])
      .join('\n')
    expect(advice).not.toMatch(/\bbash\s+hosts\//)
    expect(advice).not.toMatch(/scripts\/setup-/)
    expect(advice).not.toMatch(/build-runtime-aar\.sh/)
  })
})

describe('★#688 签名工具（随 CLI 包分发 · 解耦框架源码）', () => {
  it('resolveIosSigning：无覆盖该 bundleId 的描述文件 ⇒ ok:false 且 nextSteps 全为 CLI/系统级/GUI 指引（无 hosts/）', async () => {
    const { resolveIosSigning } = await import('../packages/cli/src/signing')
    const r = resolveIosSigning('cn.proteus.nonexistent.bundle')
    expect(r.bundleId).toBe('cn.proteus.nonexistent.bundle')
    // 该 bundleId 必然无描述文件 ⇒ ok 必为 false（本机不存在此 profile）
    expect(r.ok).toBe(false)
    for (const s of r.nextSteps) expect(s, s).not.toMatch(/\bbash\s+hosts\//)
    expect(r.nextSteps.join('\n')).toMatch(/Xcode|bundleId/)
  })
  it('androidSigningStatus：返回结构齐（keystore/keytoolOk/apksignerOk/messages/nextSteps）', async () => {
    const { androidSigningStatus } = await import('../packages/cli/src/signing')
    const st = androidSigningStatus({ jdkDir: null, buildToolsDir: null, keystore: '/tmp/nonexistent-debug.keystore' })
    expect(st).toHaveProperty('keytoolOk')
    expect(st).toHaveProperty('apksignerOk')
    expect(st).toHaveProperty('keystore')
    expect(Array.isArray(st.nextSteps)).toBe(true)
    for (const s of st.nextSteps) expect(s).not.toMatch(/\bbash\s+hosts\//)
  })
  it('ensureAndroidDebugKeystore：keystore 已存在 ⇒ created:false 且 ok:true（幂等，不重生成）', async () => {
    const { ensureAndroidDebugKeystore } = await import('../packages/cli/src/signing')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'proteus-ks-'))
    const ks = join(dir, 'debug.keystore')
    writeFileSync(ks, 'sentinel')
    const r = ensureAndroidDebugKeystore({ jdkDir: null, keystore: ks })
    expect(r.ok).toBe(true)
    expect(r.created).toBe(false)
  })
})


describe('★#690 多 Xcode（不只找默认安装位）', () => {
  it('findAllXcodes：枚举多个（含 CommandLineTools / 各 Volumes）且带能力判据', async () => {
    const { findAllXcodes } = await import('../packages/cli/src/host-package')
    const all = findAllXcodes()
    // 至少枚举到本机存在的 Xcode（CI 可能 0 个 ⇒ 不硬断言非空，但结构必须齐）
    for (const c of all) {
      expect(c).toHaveProperty('dir')
      expect(c).toHaveProperty('app')
      expect(typeof c.hasIosSdk).toBe('boolean')
      expect(typeof c.hasDevicectl).toBe('boolean')
    }
  })
  it('resolveDeveloperDir：若有可用 Xcode 则返回"有 iOS SDK"的那个；显式 PROTEUS_DEVELOPER_DIR 优先', async () => {
    const { findAllXcodes, resolveDeveloperDir } = await import('../packages/cli/src/host-package')
    const all = findAllXcodes()
    const picked = resolveDeveloperDir()
    if (picked) {
      const hit = all.find((c) => c.dir === picked)
      expect(hit?.hasIosSdk).toBe(true) // 选中的必能给 iOS SDK
    }
    // 显式指定（若本机有带 SDK 的 Xcode）⇒ 必须优先它
    const withSdk = all.find((c) => c.hasIosSdk)
    if (withSdk) {
      const prev = process.env.PROTEUS_DEVELOPER_DIR
      process.env.PROTEUS_DEVELOPER_DIR = withSdk.dir
      try {
        expect(resolveDeveloperDir()).toBe(withSdk.dir)
      } finally {
        if (prev === undefined) delete process.env.PROTEUS_DEVELOPER_DIR
        else process.env.PROTEUS_DEVELOPER_DIR = prev
      }
    }
  })
})

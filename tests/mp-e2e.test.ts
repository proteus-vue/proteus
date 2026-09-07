// tests/mp-e2e.test.ts
// ★test-framework B5：小程序 E2E 链路（IDE 路径可配置：PROTEUS_IDE_CLI / --ide / 平台默认探测）
// resolveMpIdeCli 四态 + planMpE2E（无 IDE 指引 / 计划 / 产物缺失）+ waitForAutomatorPort 超时
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveMpIdeCli, planMpE2E, waitForAutomatorPort, diagnoseMpE2EEnv, formatMpE2EDiagnosis, isValidAppid, prepareMpE2EProject } from '../packages/cli/src/mp-e2e'

describe('resolveMpIdeCli（IDE 路径探测）', () => {
  const exists = (p: string): boolean => p.includes('real')

  it('环境变量 PROTEUS_IDE_CLI 指定且存在 → 优先使用', () => {
    expect(resolveMpIdeCli({ env: { PROTEUS_IDE_CLI: '/real/cli' }, exists })).toBe('/real/cli')
  })

  it('环境变量指定但不存在 → 落平台默认路径', () => {
    expect(resolveMpIdeCli({ env: { PROTEUS_IDE_CLI: '/fake/cli' }, exists, platform: 'darwin', defaultPaths: ['/Applications/real/cli'] })).toBe('/Applications/real/cli')
  })

  it('默认路径命中（注入 defaultPaths + exists）', () => {
    const defaultPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
    expect(resolveMpIdeCli({ env: {}, exists: (p) => p === defaultPath, platform: 'darwin', defaultPaths: [defaultPath] })).toBe(defaultPath)
  })

  it('全部缺失 → null（CLI 报错含配置指引）', () => {
    expect(resolveMpIdeCli({ env: {}, exists: () => false, platform: 'darwin', defaultPaths: ['/none/cli'] })).toBeNull()
  })
})

describe('planMpE2E（执行计划）', () => {
  it('无 IDE → throw 含配置指引（PROTEUS_IDE_CLI / --ide / 默认路径）', () => {
    expect(() => planMpE2E({ ideCli: null })).toThrow(/PROTEUS_IDE_CLI/)
    expect(() => planMpE2E({ ideCli: null })).toThrow(/--ide/)
    expect(() => planMpE2E({ ideCli: null })).toThrow(/wechatwebdevtools/)
  })

  it('有 IDE → 计划含步骤/端口/产物；产物缺失 → needBuild', () => {
    const plan = planMpE2E({ ideCli: '/real/cli', projectDir: '/p/dist/mp-weixin', port: 9527, exists: (p) => p !== '/p/dist/mp-weixin' })
    expect(plan.ideCli).toBe('/real/cli')
    expect(plan.port).toBe(9527)
    expect(plan.needBuild).toBe(true)
    expect(plan.steps.some((s) => s.includes('9527'))).toBe(true)
    expect(plan.steps.some((s) => s.includes('launch'))).toBe(true)
  })

  it('产物存在 → needBuild false；步骤说明 automator launch 链路', () => {
    const plan = planMpE2E({ ideCli: '/real/cli', projectDir: '/p/dist/mp-weixin', port: 9420, exists: () => true })
    expect(plan.needBuild).toBe(false)
    expect(plan.steps.some((s) => s.includes('trust-project'))).toBe(true)
    expect(plan.steps.some((s) => s.includes('reLaunch'))).toBe(true)
  })
})

describe('waitForAutomatorPort（端口就绪轮询）', () => {
  it('无服务端口 → 超时返回 false（注入短超时）', async () => {
    // 59999 端口无服务 → 轮询直到 150ms 超时 → false
    const ready = await waitForAutomatorPort(59999, 150)
    expect(ready).toBe(false)
  })
})

describe('isValidAppid（真实 appid 校验，实测坑内化）', () => {
  it('真实 wx appid（wx + 16 位十六进制）→ true', () => {
    expect(isValidAppid('wx33bc04a52024def7')).toBe(true)
  })

  it('占位/游客/空/长度不符 → false（automator 必挂）', () => {
    expect(isValidAppid('wx0000000000')).toBe(false)
    expect(isValidAppid('touristappid')).toBe(false)
    expect(isValidAppid('')).toBe(false)
    expect(isValidAppid(undefined)).toBe(false)
    expect(isValidAppid('wx123')).toBe(false)
  })
})

describe('diagnoseMpE2EEnv（环境体检，一次性报告）', () => {
  const mkProject = (dir: string, appid: string | undefined): string => {
    const mp = path.join(dir, 'dist/mp-weixin')
    fs.mkdirSync(mp, { recursive: true })
    if (appid !== undefined) {
      fs.writeFileSync(path.join(mp, 'project.config.json'), JSON.stringify({ appid, compileType: 'miniprogram' }))
    }
    return mp
  }

  it('全就绪：IDE + 产物 + 真实 appid → ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-diag-'))
    try {
      mkProject(dir, 'wx33bc04a52024def7')
      const d = diagnoseMpE2EEnv({ root: dir, ideCli: '/real/cli', exists: (p) => p.includes(dir) })
      expect(d.ok).toBe(true)
      expect(d.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['ide-cli', 'build-output', 'appid']))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('占位 appid → error（含修复指引：proteus.config.ts 配置后重新 build:mp）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-diag-'))
    try {
      mkProject(dir, 'wx0000000000')
      const d = diagnoseMpE2EEnv({ root: dir, ideCli: '/real/cli', exists: (p) => p.includes(dir) })
      expect(d.ok).toBe(false)
      const appid = d.checks.find((c) => c.name === 'appid')
      expect(appid?.level).toBe('error')
      expect(appid?.message).toContain('真实小程序 appid')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('project.config.json 缺失 → error；端口被占 → warn（不阻断）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-diag-'))
    try {
      mkProject(dir, undefined) // 产物在但无 project.config.json（真实 fs 检查）
      const d = diagnoseMpE2EEnv({ root: dir, ideCli: '/real/cli', isPortBusy: () => true })
      expect(d.checks.find((c) => c.name === 'appid')?.level).toBe('error')
      expect(d.checks.find((c) => c.name === 'appid')?.message).toContain('project.config.json')
      expect(d.checks.find((c) => c.name === 'automator-port')?.level).toBe('warn')
      expect(d.ok).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('formatMpE2EDiagnosis：报告含 ok/warn/error 图标与汇总', () => {
    const text = formatMpE2EDiagnosis({
      checks: [
        { name: 'ide-cli', level: 'ok', message: 'OK' },
        { name: 'appid', level: 'error', message: 'BAD' },
      ],
      ok: false,
    })
    expect(text).toContain('✅')
    expect(text).toContain('✗')
    expect(text).toContain('存在硬错误')
  })
})

describe('prepareMpE2EProject（产物独立副本，避 IDE 路径缓存）', () => {
  it('复制 dist/mp-weixin → .proteus/e2e-mp；每次重建', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-prep-'))
    try {
      const mp = path.join(dir, 'dist/mp-weixin')
      fs.mkdirSync(mp, { recursive: true })
      fs.writeFileSync(path.join(mp, 'app.json'), '{}')
      fs.writeFileSync(path.join(mp, 'marker.txt'), 'v1')
      const p1 = prepareMpE2EProject(dir)
      expect(p1?.projectDir).toBe(path.join(dir, '.proteus/e2e-mp'))
      expect(fs.existsSync(path.join(p1!.projectDir, 'marker.txt'))).toBe(true)
      // 更新源产物 → 重建副本（marker 变化）
      fs.writeFileSync(path.join(mp, 'marker.txt'), 'v2')
      prepareMpE2EProject(dir)
      expect(fs.readFileSync(path.join(p1!.projectDir, 'marker.txt'), 'utf-8')).toBe('v2')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('产物缺失 → null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-prep-'))
    try {
      expect(prepareMpE2EProject(dir)).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

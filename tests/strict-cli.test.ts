// tests/strict-cli.test.ts
// ★cli-plus G-33 M1：--strict-cli 规则（01-cli.md §6 CLI001-004）+ dev 命令骨架
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkRequiredTargets,
  checkFeatureConflicts,
  checkProteusDirConsistency,
  registerGeneratedFile,
  FEATURE_PLATFORM_MATRIX,
} from '../packages/cli/src/strict-cli'
import { parseDevArgs, runDev } from '../packages/cli/src/dev'

describe('CLI002 缺失必要 target 配置（error）', () => {
  it('合法 defineProteus 配置 → 零违规', () => {
    expect(checkRequiredTargets({ entry: 'src/main.ts', targets: { web: { output: 'dist' } } })).toHaveLength(0)
  })

  it('缺 entry / 缺 targets → error', () => {
    const v = checkRequiredTargets({ targets: { web: {} } })
    expect(v.map((x) => x.code)).toContain('CLI002')
    expect(v[0].severity).toBe('error')
    expect(checkRequiredTargets({ entry: 'src/main.ts' })).toHaveLength(1)
  })

  it('旧形态 ProteusConfig（无 entry/targets）→ 不误报（CLI002 仅针对 defineProteus 新形态）', () => {
    expect(checkRequiredTargets({ platform: 'mp-weixin', skyline: true })).toHaveLength(0)
  })
})

describe('CLI003 能力开关冲突（warn）', () => {
  it('feature 开启但 target 不支持 → warn（memorial 仅 web/skyline）', () => {
    const v = checkFeatureConflicts({
      entry: 'x',
      targets: { ios: { bundleId: 'a' }, web: { output: 'dist' } },
      features: { memorial: true, styleSafety: true },
    })
    const memorial = v.find((x) => x.code === 'CLI003' && x.message.includes('memorial'))
    expect(memorial?.severity).toBe('warn')
    expect(memorial?.message).toContain('ios')
    expect(v.some((x) => x.message.includes('styleSafety'))).toBe(false) // 支持 ios
  })

  it('未知能力开关 → warn', () => {
    const v = checkFeatureConflicts({ targets: { web: {} }, features: { unknownFeature: true } })
    expect(v[0].message).toContain('未知能力开关')
  })

  it('FEATURE_PLATFORM_MATRIX 注册表完整（防漂移）', () => {
    expect(Object.keys(FEATURE_PLATFORM_MATRIX).sort()).toEqual(['glass', 'memorial', 'safeArea', 'skeleton', 'strictRouter', 'styleSafety'])
  })
})

describe('CLI004 .proteus/ 生成文件一致性（warn）', () => {
  it('无 .proteus/ → 跳过（未生成）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-cli004-'))
    try {
      expect(checkProteusDirConsistency(path.join(dir, '.proteus'))).toHaveLength(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('基线一致 → 零违规；篡改文件 → warn（hash 对比）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-cli004-'))
    const proteus = path.join(dir, '.proteus')
    fs.mkdirSync(proteus, { recursive: true })
    const okFile = path.join(proteus, 'ok.json')
    fs.writeFileSync(okFile, '{ "x": 1 }')
    registerGeneratedFile(okFile) // 生成 + 登记指纹
    expect(checkProteusDirConsistency(proteus)).toHaveLength(0)
    // 手动篡改
    fs.writeFileSync(okFile, '{ "x": 2 }')
    const v = checkProteusDirConsistency(proteus)
    expect(v.filter((x) => x.code === 'CLI004')).toHaveLength(1)
    expect(v[0].message).toContain('ok.json')
    expect(v[0].message).toContain('手动修改')
    // 重新生成后恢复零违规
    registerGeneratedFile(okFile)
    expect(checkProteusDirConsistency(proteus)).toHaveLength(0)
  })

  it('生成文件缺失 → warn（可重建）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-cli004-'))
    const proteus = path.join(dir, '.proteus')
    fs.mkdirSync(proteus, { recursive: true })
    const f = path.join(proteus, 'gone.json')
    fs.writeFileSync(f, '{}')
    registerGeneratedFile(f)
    fs.rmSync(f) // 手动删除
    const v = checkProteusDirConsistency(proteus)
    expect(v[0].message).toContain('缺失')
  })
})

describe('proteus dev 骨架（G-33 M1）', () => {
  it('parseDevArgs：默认 web / --target 切换 / 非法 target 报错', () => {
    expect(parseDevArgs([])).toEqual({ target: 'web' })
    expect(parseDevArgs(['--target', 'skyline'])).toEqual({ target: 'skyline' })
    expect(() => parseDevArgs(['--target', 'wasm'])).toThrow()
  })

  it('runDev：web → vite；skyline → dev-mp；app 端待 M3', () => {
    expect(runDev({ target: 'web' })).toEqual({ command: 'vite', args: ['--mode', 'web'] })
    expect(runDev({ target: 'skyline' }).command).toBe('npx')
    expect(() => runDev({ target: 'ios' })).toThrow(/M3/)
  })
})

// tests/strict-cli.test.ts
// ★cli-plus G-33 M1：--strict-cli 规则（01-cli.md §6 CLI001-004）+ dev 命令骨架
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkRequiredTargets,
  checkProteusDirConsistency,
  registerGeneratedFile,
} from '../packages/cli/src/strict-cli'
import { parseDevArgs, runDev } from '../packages/cli/src/dev'

describe('CLI002 缺失必要 target 配置（error · v4 按端分区）', () => {
  it('合法 v4 配置（targets 至少一端）→ 零违规', () => {
    expect(checkRequiredTargets({ targets: { web: { output: 'dist' } } })).toHaveLength(0)
    expect(checkRequiredTargets({ targets: { mp: { appid: 'wx1' } } })).toHaveLength(0)
  })

  it('缺 targets / targets 为空 → error', () => {
    const v = checkRequiredTargets({ pagesDir: 'src/pages' })
    expect(v.map((x) => x.code)).toContain('CLI002')
    expect(v[0].severity).toBe('error')
    expect(checkRequiredTargets({ targets: {} })).toHaveLength(1)
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

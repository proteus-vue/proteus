// tests/build-target.test.ts
// ★cli-plus G-33 M2：proteus build --target 工程构建（复用项目 Vite 管线）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planTargetedBuild, TARGET_BUILD_SCRIPTS } from '../packages/cli/src/build'
import { parseBuildArgs } from '../packages/cli/src/args'

function makeTmp(scripts?: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-build-target-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: scripts ?? {} }))
  return dir
}

describe('proteus build --target（G-33 M2 工程构建）', () => {
  it('TARGET_BUILD_SCRIPTS：web → build:web / skyline → build:mp（模板约定）', () => {
    expect(TARGET_BUILD_SCRIPTS).toEqual({ web: 'build:web', skyline: 'build:mp' })
  })

  it('planTargetedBuild：单 target → 对应脚本 spawn 计划', () => {
    const dir = makeTmp({ 'build:web': 'vite build --mode web', 'build:mp': 'vite build --mode mp-weixin' })
    expect(planTargetedBuild(dir, 'web')).toEqual([{ command: 'npm', args: ['run', 'build:web'], script: 'build:web' }])
    expect(planTargetedBuild(dir, 'skyline')[0].script).toBe('build:mp')
  })

  it('all → web + skyline 两个计划（顺序）', () => {
    const dir = makeTmp({ 'build:web': 'a', 'build:mp': 'b' })
    const plans = planTargetedBuild(dir, 'all')
    expect(plans.map((p) => p.script)).toEqual(['build:web', 'build:mp'])
  })

  it('缺脚本 → 报错（工程未按模板生成）', () => {
    const dir = makeTmp({})
    expect(() => planTargetedBuild(dir, 'web')).toThrow(/build:web/)
    expect(() => planTargetedBuild(dir, 'skyline')).toThrow(/build:mp/)
    const webOnly = makeTmp({ 'build:web': 'a' })
    expect(() => planTargetedBuild(webOnly, 'all')).toThrow(/build:mp/) // web 有、mp 缺
  })

  it('parseBuildArgs：--target 解析 / 非法 target 报错 / 缺省独立编译', () => {
    expect(parseBuildArgs(['--target', 'web']).target).toBe('web')
    expect(parseBuildArgs(['--target', 'all']).target).toBe('all')
    expect(parseBuildArgs([]).target).toBeUndefined() // 缺省 = 独立编译
    expect(() => parseBuildArgs(['--target', 'wasm'])).toThrow()
    expect(() => parseBuildArgs(['--target'])).toThrow()
  })
})

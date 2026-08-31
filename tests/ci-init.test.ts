// tests/ci-init.test.ts
// ★cli-plus G-33 M4：proteus ci:init —— CI/CD 模板生成（02-build-pipeline.md §3）
// 纯函数：generateCiWorkflow（三平台 YAML）+ parseCiArgs + planCiInit（落盘）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateCiWorkflow, parseCiArgs, planCiInit, CI_FILE_PATHS } from '../packages/cli/src/ci'

describe('generateCiWorkflow（GitHub Actions）', () => {
  it('默认：check 门禁 + web/skyline 构建 + test（L1-L3 + Web E2E）+ 产物归档', () => {
    const yml = generateCiWorkflow({ platform: 'github', targets: ['web', 'skyline'] })
    expect(yml).toContain('name: Proteus CI')
    expect(yml).toContain('npx proteus check')
    expect(yml).toContain('npx proteus build --target web')
    expect(yml).toContain('npx proteus build --target skyline')
    expect(yml).toContain('actions/upload-artifact@v4')
    expect(yml).toContain('dist/mp-weixin/')
    // check 是 build 的前置（needs）；§08 test job 在 build 后（L1-L3 + Web E2E）
    expect(yml).toContain('needs: check')
    expect(yml).toContain('needs: build')
    expect(yml).toContain('npx proteus test')
    expect(yml).toContain('npx proteus test e2e:web')
  })

  it('targets 定制：仅 skyline → build job 只生成对应构建步骤（test job 的 Web E2E 构建不受 targets 影响）', () => {
    const yml = generateCiWorkflow({ platform: 'github', targets: ['skyline'] })
    expect(yml).toContain('- run: npx proteus build --target skyline')
    expect(yml).not.toContain('- run: npx proteus build --target web')
    // test job 仍要 Web 产物（e2e:web 依赖 build --target web）
    expect(yml).toContain('npx proteus build --target web && npx proteus test e2e:web')
  })
})

describe('generateCiWorkflow（GitLab / CircleCI）', () => {
  it('GitLab：stages（check/build/test）+ artifacts', () => {
    const yml = generateCiWorkflow({ platform: 'gitlab', targets: ['web'] })
    expect(yml).toContain('stages:')
    expect(yml).toContain('npx proteus check')
    expect(yml).toContain('npx proteus build --target web')
    expect(yml).toContain('artifacts:')
    expect(yml).toContain('npx proteus test e2e:web')
  })

  it('CircleCI：jobs + workflows requires（含 test）', () => {
    const yml = generateCiWorkflow({ platform: 'circleci', targets: ['web', 'skyline'] })
    expect(yml).toContain('version: 2.1')
    expect(yml).toContain('jobs:')
    expect(yml).toContain('store_artifacts:')
    expect(yml).toContain('requires: [check]')
    expect(yml).toContain('npx proteus test')
  })
})

describe('parseCiArgs', () => {
  it('缺省：github + web,skyline + 当前目录', () => {
    expect(parseCiArgs([])).toEqual({ options: { platform: 'github', targets: ['web', 'skyline'] }, dir: '.' })
  })

  it('--platform gitlab + --targets skyline + 位置目录', () => {
    expect(parseCiArgs(['--platform', 'gitlab', '--targets', 'skyline', 'src'])).toEqual({
      options: { platform: 'gitlab', targets: ['skyline'] },
      dir: 'src',
    })
  })

  it('非法 platform / 未知参数 / 多余位置参数 → 报错', () => {
    expect(() => parseCiArgs(['--platform', 'travis'])).toThrow(/platform 非法/)
    expect(() => parseCiArgs(['--wat'])).toThrow(/未知参数/)
    expect(() => parseCiArgs(['a', 'b'])).toThrow(/多余位置参数/)
  })
})

describe('planCiInit（落盘）', () => {
  it('github → .github/workflows/proteus.yml 写入', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-ci-'))
    try {
      const { file, content } = planCiInit(dir, { platform: 'github', targets: ['web'] })
      expect(file).toBe('.github/workflows/proteus.yml')
      const written = fs.readFileSync(path.join(dir, file), 'utf-8')
      expect(written).toBe(content)
      expect(content).toContain('npx proteus check')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('三平台路径映射', () => {
    expect(CI_FILE_PATHS).toEqual({
      github: '.github/workflows/proteus.yml',
      gitlab: '.gitlab-ci.yml',
      circleci: '.circleci/config.yml',
    })
  })

  it('gitlab → .gitlab-ci.yml 写入 + 目录自动创建', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-ci-'))
    try {
      const { file } = planCiInit(dir, { platform: 'gitlab', targets: ['web'] })
      expect(fs.existsSync(path.join(dir, file))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

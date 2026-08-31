// tests/app-config-gen.test.ts
// ★app-config G-35 M5：proteus gen config —— 骨架生成（06-cli-integration.md §1）
// 闭环：生成的 app.config.ts → checkAppConfigFile 校验通过（proteus gen config → app-config:check 全链路）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateAppConfigSkeleton } from '../packages/cli/src/app-config-gen'
import { checkAppConfigFile } from '../packages/cli/src/app-config-check'

describe('proteus gen config（骨架生成）', () => {
  it('生成骨架：defineAppConfig 形态 + 必要字段齐全', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-gen-'))
    try {
      const file = path.join(dir, 'app.config.ts')
      const out = generateAppConfigSkeleton(file)
      expect(out).toBe(file)
      const src = fs.readFileSync(file, 'utf-8')
      expect(src).toContain("import { defineAppConfig } from '@proteus-vue/app-config'")
      expect(src).toContain('export default defineAppConfig({')
      expect(src).toContain("env: 'dev'")
      expect(src).toContain('baseUrl')
      expect(src).toContain('glassEffect')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('已存在 → 抛错不覆盖', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-gen-'))
    try {
      const file = path.join(dir, 'app.config.ts')
      fs.writeFileSync(file, '// 用户已有配置')
      expect(() => generateAppConfigSkeleton(file)).toThrow(/已存在/)
      expect(fs.readFileSync(file, 'utf-8')).toBe('// 用户已有配置')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('★闭环：生成骨架 → app-config:check 校验通过（gen → check 全链路）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-gen-'))
    try {
      const file = path.join(dir, 'app.config.ts')
      generateAppConfigSkeleton(file)
      const result = await checkAppConfigFile(file)
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

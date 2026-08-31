// tests/generate-types.test.ts
// ★types-plan B3：@proteus-vue/types 独立包（Platform 共享类型 + ProteusConfig JSON Schema）+ proteus generate types（落盘 / --check 防漂移）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateTypes, formatGenerateTypes } from '../packages/cli/src/generate-types'
import { proteusConfigSchema, proteusConfigSchemaJson } from '@proteus-vue/types'
import type { Platform, PlatformTarget } from '@proteus-vue/types'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-generate-types-'))
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('JSON Schema 单一来源（config-schema.ts）', () => {
  it('必填字段与 ProteusConfig 对齐（platform/skyline/appid/pagesDir/routesOutput/customRoute/setDataBridge/style）', () => {
    expect(proteusConfigSchema.required).toEqual([
      'platform',
      'skyline',
      'appid',
      'pagesDir',
      'routesOutput',
      'customRoute',
      'setDataBridge',
      'style',
    ])
  })

  it('platform 枚举 + subPackages items 结构', () => {
    expect(proteusConfigSchema.properties.platform.enum).toEqual(['mp-weixin', 'web'])
    const items = proteusConfigSchema.properties.subPackages.items
    expect(items.required).toEqual(['root'])
  })

  it('序列化 JSON 可解析且与 schema 一致', () => {
    const parsed = JSON.parse(proteusConfigSchemaJson()) as { title: string; required: string[] }
    expect(parsed.title).toBe('ProteusConfig')
    expect(parsed.required).toEqual(proteusConfigSchema.required)
  })
})

describe('proteus generate types（落盘 + --check 防漂移）', () => {
  it('生成到指定路径 → 文件内容 = 序列化 schema', () => {
    const out = path.join(TMP, 'schema', 'proteus.config.schema.json')
    const r = generateTypes({ out })
    expect(r.ok).toBe(true)
    expect(r.written).toBe(true)
    expect(fs.readFileSync(out, 'utf-8')).toBe(proteusConfigSchemaJson())
  })

  it('--check 一致 → ok；文件被手动改 → 漂移检测 exit 1', () => {
    const out = path.join(TMP, 'check', 'proteus.config.schema.json')
    generateTypes({ out })
    const ok = generateTypes({ out, check: true })
    expect(ok.ok).toBe(true)
    expect(ok.drifted).toBe(false)
    // 手动改 generated（铁律 #5：勿手动改）
    fs.writeFileSync(out, '{"hacked": true}')
    const drifted = generateTypes({ out, check: true })
    expect(drifted.ok).toBe(false)
    expect(drifted.drifted).toBe(true)
    expect(formatGenerateTypes(drifted)).toContain('不一致')
  })

  it('默认输出 .proteus/proteus.config.schema.json（cwd 下）', () => {
    const r = generateTypes()
    expect(fs.existsSync(r.outFile)).toBe(true)
    expect(r.outFile.endsWith(path.join('.proteus', 'proteus.config.schema.json'))).toBe(true)
  })
})

describe('Platform 共享类型（types-plan B1 独立包）', () => {
  it('Platform 联合成员（类型层断言）', () => {
    const p: Platform = 'skyline'
    expect(['web', 'skyline', 'app']).toContain(p)
  })
  it('PlatformTarget 成员', () => {
    const t: PlatformTarget = 'mp-weixin'
    expect(['mp-weixin', 'web']).toContain(t)
  })
})

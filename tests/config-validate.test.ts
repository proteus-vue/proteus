// tests/config-validate.test.ts
// ★types-plan B5：validateConfig（错误码/路径定位）+ config:check CLI（TS 配置加载 + 校验）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateConfig } from '../packages/cli/src/config-validate'
import { checkConfigFile } from '../packages/cli/src/config-check'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-config-check-'))
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

const VALID = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000',
  pagesDir: 'pages',
  routesOutput: 'router/auto-routes.ts',
  subPackages: [{ root: 'subpackages/order', name: 'order' }],
  customRoute: { registerPresets: true, builders: {} },
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
  budget: { mainPackageKB: 1200, strict: false },
  router: { meta: { user: { requiresAuth: true } } },
}

describe('validateConfig（types-plan B5）', () => {
  it('合法配置 → ok', () => {
    expect(validateConfig(VALID)).toEqual({ ok: true })
  })

  it('缺必填字段 → CONFIG_MISSING_REQUIRED + path', () => {
    const r = validateConfig({ ...VALID, pagesDir: undefined })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const e = r.errors.find((x) => x.code === 'CONFIG_MISSING_REQUIRED')
      expect(e?.path).toBe('pagesDir')
    }
  })

  it('类型错误 → CONFIG_INVALID_TYPE；非法枚举 → CONFIG_INVALID_ENUM', () => {
    const t = validateConfig({ ...VALID, skyline: 'yes' })
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.errors.some((e) => e.code === 'CONFIG_INVALID_TYPE' && e.path === 'skyline')).toBe(true)
    const en = validateConfig({ ...VALID, platform: 'h5' })
    if (!en.ok) expect(en.errors.some((e) => e.code === 'CONFIG_INVALID_ENUM' && e.path === 'platform')).toBe(true)
  })

  it('未知字段（拼写错误）→ CONFIG_UNKNOWN_FIELD', () => {
    const r = validateConfig({ ...VALID, pagsDir: 'pages' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.code === 'CONFIG_UNKNOWN_FIELD' && e.path === 'pagsDir')).toBe(true)
  })

  it('subPackages 非法项 → CONFIG_INVALID_TYPE 定位下标', () => {
    const r = validateConfig({ ...VALID, subPackages: [{ root: 123 }] })
    if (!r.ok) expect(r.errors.some((e) => e.path === 'subPackages[0].root')).toBe(true)
  })

  it('非对象根 → CONFIG_INVALID_ROOT', () => {
    const r = validateConfig('config')
    if (!r.ok) expect(r.errors[0].code).toBe('CONFIG_INVALID_ROOT')
  })
})

describe('config:check CLI（TS 配置加载 + 校验报告）', () => {
  it('examples/proteus.config.ts 加载校验通过（真实配置）', async () => {
    const { result, text } = await checkConfigFile(path.resolve('examples/proteus.config.ts'))
    expect(result.ok, text).toBe(true)
  })

  it('非法配置文件 → 错误报告（缺字段 + 未知字段）', async () => {
    const bad = path.join(TMP, 'bad.config.ts')
    fs.writeFileSync(bad, `export default { platform: 'mp-weixin', pagesDir: 'pages', unknownField: 1 }\n`)
    const { result, text } = await checkConfigFile(bad)
    expect(result.ok).toBe(false)
    expect(text).toContain('[CONFIG_MISSING_REQUIRED]')
    expect(text).toContain('unknownField')
  })

  it('配置文件不存在 → 明确报错', async () => {
    await expect(checkConfigFile(path.join(TMP, 'nope.ts'))).rejects.toThrow(/不存在/)
  })
})

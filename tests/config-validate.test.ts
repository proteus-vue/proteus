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

  it('router 下声明 pinia 语义键 → CONFIG_LAYER_VIOLATION（B5 §3 跨层检测集成）', () => {
    const r = validateConfig({ ...VALID, router: { stores: { user: {} } } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const e = r.errors.find((x) => x.code === 'CONFIG_LAYER_VIOLATION')
      expect(e?.path).toBe('router.stores')
    }
  })

  it('未知字段只报 CONFIG_UNKNOWN_FIELD（不重复报漏标）', () => {
    const r = validateConfig({ ...VALID, typoField: 1 })
    if (!r.ok) {
      expect(r.errors.filter((e) => e.path === 'typoField')).toHaveLength(1)
      expect(r.errors.find((e) => e.path === 'typoField')?.code).toBe('CONFIG_UNKNOWN_FIELD')
    }
  })
})

describe('validateConfig：audit 字段（★#447 D-2 门禁规则）', () => {
  it('合法 audit（四规则 severity + dir）→ ok', () => {
    const r = validateConfig({
      ...VALID,
      audit: {
        dir: 'src',
        rules: { 'no-third-party-ui': 'off', 'no-media-query': 'warn', 'no-platform-api': 'error', 'no-web-platform-api': 'error' },
      },
    })
    expect(r).toEqual({ ok: true })
  })

  it('audit 空对象（全默认 error）→ ok', () => {
    expect(validateConfig({ ...VALID, audit: {} })).toEqual({ ok: true })
  })

  it('未知规则 id → CONFIG_UNKNOWN_FIELD（path=audit.rules.xxx）', () => {
    const r = validateConfig({ ...VALID, audit: { rules: { 'no-jquery': 'off' } } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const e = r.errors.find((x) => x.code === 'CONFIG_UNKNOWN_FIELD')
      expect(e?.path).toBe('audit.rules.no-jquery')
    }
  })

  it('非法 severity → CONFIG_INVALID_ENUM；dir 非字符串 → CONFIG_INVALID_TYPE', () => {
    const en = validateConfig({ ...VALID, audit: { rules: { 'no-media-query': 'silent' } } })
    expect(en.ok).toBe(false)
    if (!en.ok) expect(en.errors.some((e) => e.code === 'CONFIG_INVALID_ENUM' && e.path === 'audit.rules.no-media-query')).toBe(true)
    const tp = validateConfig({ ...VALID, audit: { dir: 42 } })
    expect(tp.ok).toBe(false)
    if (!tp.ok) expect(tp.errors.some((e) => e.code === 'CONFIG_INVALID_TYPE' && e.path === 'audit.dir')).toBe(true)
  })
})

describe('validateConfig：gates 字段（★#456 统一门禁开关）', () => {
  it('合法 gates.disabled 字符串数组 → ok', () => {
    expect(validateConfig({ ...VALID, gates: { disabled: ['capabilities', 'd2'] } })).toEqual({ ok: true })
    expect(validateConfig({ ...VALID, gates: {} })).toEqual({ ok: true })
  })

  it('gates 非对象 / disabled 非字符串数组 → CONFIG_INVALID_TYPE', () => {
    const g1 = validateConfig({ ...VALID, gates: 'all' })
    expect(g1.ok).toBe(false)
    if (!g1.ok) expect(g1.errors.some((e) => e.path === 'gates')).toBe(true)
    const g2 = validateConfig({ ...VALID, gates: { disabled: ['d2', 42] } })
    expect(g2.ok).toBe(false)
    if (!g2.ok) expect(g2.errors.some((e) => e.path === 'gates.disabled')).toBe(true)
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

// tests/app-config.test.ts
// ★app-config G-35 M1：合并引擎 + 校验器（09-batches M1 验收：深合并/平台覆盖/数组替换 + 校验规则）
import { describe, expect, it } from 'vitest'
import { mergeAppConfig, deepMerge, extractPlatformOverride, validateAppConfig, validateAndApply } from '../packages/app-config/src/index'
import type { AppConfig, DeepPartial } from '../packages/app-config/src/index'

const DEFAULTS: AppConfig = {
  app: { id: 'demo', name: 'Demo', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: { baseUrl: 'https://dev.example.com', timeout: 10000, retry: 2, cache: { defaultTTL: 300, enabledEndpoints: ['/a', '/b'] } },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
}

describe('mergeAppConfig（§2.1 四层合并）', () => {
  it('深合并保留未覆盖字段', () => {
    const merged = mergeAppConfig({
      defaults: DEFAULTS,
      env: { api: { baseUrl: 'https://staging.example.com' } },
    })
    expect(merged.api.baseUrl).toBe('https://staging.example.com')
    expect(merged.api.timeout).toBe(10000) // 未覆盖保留
    expect(merged.app.id).toBe('demo')
  })

  it('平台覆盖优先级正确（env < platform）', () => {
    const merged = mergeAppConfig({
      defaults: DEFAULTS,
      env: { api: { baseUrl: 'https://staging.example.com' } },
      platform: { api: { baseUrl: 'https://ios.example.com', timeout: 15000 } },
    })
    expect(merged.api.baseUrl).toBe('https://ios.example.com') // platform 覆盖 env
    expect(merged.api.timeout).toBe(15000)
  })

  it('数组替换不拼接', () => {
    const merged = mergeAppConfig({
      defaults: DEFAULTS,
      remote: { api: { cache: { enabledEndpoints: ['/x'] } } },
    })
    expect(merged.api.cache.enabledEndpoints).toEqual(['/x']) // 替换而非拼接
  })

  it('远端最高优先级（remote 覆盖 platform）', () => {
    const merged = mergeAppConfig({
      defaults: DEFAULTS,
      platform: { features: { glassEffect: true } },
      remote: { features: { glassEffect: false } },
    })
    expect(merged.features.glassEffect).toBe(false)
  })

  it('deepMerge 不突变入参', () => {
    const base = { a: { b: 1 } }
    const out = deepMerge(base, { a: { c: 2 } })
    expect(base).toEqual({ a: { b: 1 } })
    expect(out).toEqual({ a: { b: 1, c: 2 } })
  })

  it('extractPlatformOverride：平台覆盖提取', () => {
    const withPlatform = { ...DEFAULTS, platform: { ios: { api: { timeout: 20000 } } } }
    expect(extractPlatformOverride(withPlatform, 'ios')).toEqual({ api: { timeout: 20000 } })
    expect(extractPlatformOverride(withPlatform, 'android')).toBeUndefined()
  })
})

describe('validateAppConfig（§5 校验规则）', () => {
  it('合法配置 → ok', () => {
    expect(validateAppConfig(DEFAULTS).ok).toBe(true)
  })

  it('拒绝非法 semver', () => {
    const r = validateAppConfig({ ...DEFAULTS, app: { ...DEFAULTS.app, version: 'abc' } })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.path === 'app.version')).toBe(true)
  })

  it('拒绝超时超范围 / retry 越界', () => {
    expect(validateAppConfig({ ...DEFAULTS, api: { ...DEFAULTS.api, timeout: 999999 } }).ok).toBe(false)
    expect(validateAppConfig({ ...DEFAULTS, api: { ...DEFAULTS.api, retry: 9 } }).ok).toBe(false)
    expect(validateAppConfig({ ...DEFAULTS, api: { ...DEFAULTS.api, retry: 3 } }).ok).toBe(true)
  })

  it('必填缺失 → error 列表', () => {
    const r = validateAppConfig({ env: 'dev' } as DeepPartial<AppConfig>)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.path === 'app.id')).toBe(true)
    expect(r.errors.some((e) => e.path === 'api.baseUrl')).toBe(true)
  })

  it('非法 env / theme / fontScale 枚举', () => {
    expect(validateAppConfig({ ...DEFAULTS, env: 'prod2' } as unknown as AppConfig).ok).toBe(false)
    expect(validateAppConfig({ ...DEFAULTS, theme: { ...DEFAULTS.theme, default: 'blue' } } as unknown as AppConfig).ok).toBe(false)
    expect(validateAppConfig({ ...DEFAULTS, font: { ...DEFAULTS.font, defaultScale: 3 } }).ok).toBe(false)
  })
})

describe('validateAndApply（§5.2 非法降级不抛错）', () => {
  it('非法值降级为默认值 + 告警收集', () => {
    const { config, invalidFields } = validateAndApply(
      { ...DEFAULTS, app: { ...DEFAULTS.app, version: 'bad' }, api: { ...DEFAULTS.api, timeout: -5 } },
      DEFAULTS,
    )
    expect(config.app.version).toBe('1.0.0') // 降级默认
    expect(config.api.timeout).toBe(10000)
    expect(invalidFields.length).toBe(2)
    expect(invalidFields.some((e) => e.path === 'app.version')).toBe(true)
  })

  it('缺省层缺字段 → 默认值兜底（不抛错）', () => {
    const { config, invalidFields } = validateAndApply({ env: 'dev' }, DEFAULTS)
    expect(invalidFields.length).toBeGreaterThan(0)
    expect(config.app.id).toBe('demo') // 默认兜底
  })
})

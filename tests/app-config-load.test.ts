// tests/app-config-load.test.ts
// ★app-config G-35 M3：多环境加载 + 平台覆盖（§2.1 层级落地）+ CLI app-config:check
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadAppConfig, resolveEnvConfig } from '../packages/app-config/src/index'
import type { AppConfig } from '../packages/app-config/src/index'
import { checkAppConfigFile, formatAppConfigCheck } from '../packages/cli/src/app-config-check'

const DEFAULTS: AppConfig = {
  app: { id: 'demo', name: 'Demo', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: { baseUrl: 'https://dev.example.com', timeout: 10000, retry: 2, cache: { defaultTTL: 300, enabledEndpoints: ['/a'] } },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
}

describe('loadAppConfig（§2.1 多环境 + 平台覆盖）', () => {
  it('环境选择：envConfigs[env] 覆盖默认', () => {
    const config = loadAppConfig({
      defaults: DEFAULTS,
      env: 'prod',
      envConfigs: {
        prod: { api: { baseUrl: 'https://api.example.com', timeout: 30000 } },
      },
    })
    expect(config.api.baseUrl).toBe('https://api.example.com')
    expect(config.api.timeout).toBe(30000)
    expect(config.api.retry).toBe(2) // 未覆盖保留
  })

  it('平台覆盖：defaults.platform[platform] 提取应用', () => {
    const withPlatform = {
      ...DEFAULTS,
      platform: { ios: { features: { glassEffect: true }, api: { timeout: 20000 } } },
    }
    const config = loadAppConfig({ defaults: withPlatform, env: 'dev', platform: 'ios' })
    expect(config.features.glassEffect).toBe(true)
    expect(config.api.timeout).toBe(20000)
    const harmony = loadAppConfig({ defaults: withPlatform, env: 'dev', platform: 'harmony' })
    expect(harmony.features.glassEffect).toBe(false) // 无 harmony 覆盖 → 默认
  })

  it('remote 最高优先级（覆盖 platform）', () => {
    const withPlatform = { ...DEFAULTS, platform: { ios: { features: { glassEffect: true } } } }
    const config = loadAppConfig({
      defaults: withPlatform,
      env: 'dev',
      platform: 'ios',
      remote: { features: { glassEffect: false } },
    })
    expect(config.features.glassEffect).toBe(false)
  })

  it('resolveEnvConfig：缺失环境 → undefined（不覆盖）', () => {
    expect(resolveEnvConfig({ prod: { api: { timeout: 1 } } }, 'staging')).toBeUndefined()
    expect(resolveEnvConfig(undefined, 'dev')).toBeUndefined()
  })
})

describe('CLI app-config:check（06-cli-integration §1）', () => {
  it('合法配置 → ok + 报告格式', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-check-'))
    const file = path.join(dir, 'app.config.ts')
    fs.writeFileSync(file, `export default { app: { id: 'x', name: 'X', version: '1.0.0', buildNumber: 1 }, env: 'dev', api: { baseUrl: 'https://x.com', timeout: 10000, retry: 2, cache: { defaultTTL: 1, enabledEndpoints: [] } }, features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' }, theme: { default: 'system', allowUserToggle: true }, font: { defaultScale: 1, allowUserAdjust: true }, safeArea: { islandGlass: false } }`)
    try {
      const result = await checkAppConfigFile(file)
      expect(result.ok).toBe(true)
      expect(formatAppConfigCheck(result)).toContain('✅ 通过')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('非法配置（semver/超时）→ error + 定位', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-check-'))
    const file = path.join(dir, 'app.config.ts')
    fs.writeFileSync(file, `export default { app: { id: 'x', name: 'X', version: 'v1', buildNumber: 1 }, env: 'dev', api: { baseUrl: 'https://x.com', timeout: 999999, retry: 2, cache: { defaultTTL: 1, enabledEndpoints: [] } }, features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' }, theme: { default: 'system', allowUserToggle: true }, font: { defaultScale: 1, allowUserAdjust: true }, safeArea: { islandGlass: false } }`)
    try {
      const result = await checkAppConfigFile(file)
      expect(result.ok).toBe(false)
      expect(result.errors.some((e) => e.path === 'app.version')).toBe(true)
      expect(result.errors.some((e) => e.path === 'api.timeout')).toBe(true)
      expect(formatAppConfigCheck(result)).toContain('2 处错误')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺文件 → error（gen config 提示）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-check-'))
    try {
      const result = await checkAppConfigFile(path.join(dir, 'app.config.ts'))
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toContain('proteus gen config')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

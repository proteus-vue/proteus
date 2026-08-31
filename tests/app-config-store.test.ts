// tests/app-config-store.test.ts
// ★app-config G-35 M2：运行时 API（02-runtime-api.md §1-§4：defineAppConfig/setConfig/useAppConfig/getFeatureFlag）
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref, watch } from 'vue'
import {
  initAppConfig,
  getConfig,
  setConfig,
  useAppConfig,
  getFeatureFlag,
  defineAppConfig,
  APP_CONFIG_MARK,
} from '../packages/app-config/src/index'
import type { AppConfig } from '../packages/app-config/src/index'

const DEFAULTS: AppConfig = {
  app: { id: 'demo', name: 'Demo', version: '1.0.0', buildNumber: 1 },
  env: 'dev',
  api: { baseUrl: 'https://dev.example.com', timeout: 10000, retry: 2, cache: { defaultTTL: 300, enabledEndpoints: ['/a'] } },
  features: { glassEffect: false, skeletonScreen: false, memorialGray: false, newHomePage: 'control' },
  theme: { default: 'system', allowUserToggle: true },
  font: { defaultScale: 1, allowUserAdjust: true },
  safeArea: { islandGlass: false },
}

describe('defineAppConfig（02 §1）', () => {
  it('identity + __isAppConfig 标记', () => {
    const config = defineAppConfig(DEFAULTS)
    expect(config.app.id).toBe('demo')
    expect((config as AppConfig & { __isAppConfig?: boolean }).__isAppConfig).toBe(true)
    expect(APP_CONFIG_MARK).toBe('__isAppConfig')
  })
})

describe('init/get/setConfig（02 §3 命令式）', () => {
  beforeEach(() => initAppConfig(DEFAULTS))

  it('getConfig 读当前配置', () => {
    expect(getConfig().api.baseUrl).toBe('https://dev.example.com')
  })

  it('setConfig 深合并更新 + 触发响应式（flush: sync）', () => {
    const watched = ref<unknown>(null)
    watch(
      () => getConfig().features.newHomePage,
      (v) => {
        watched.value = v
      },
      { flush: 'sync' },
    )
    const r = setConfig({ features: { newHomePage: 'variant-b' } })
    expect(r.ok).toBe(true)
    expect(getConfig().features.newHomePage).toBe('variant-b')
    expect(getConfig().api.baseUrl).toBe('https://dev.example.com') // 未覆盖保留
    expect(watched.value).toBe('variant-b') // watch 同步触发
  })

  it('setConfig updater 函数形态', () => {
    setConfig((c) => ({ api: { ...c.api, timeout: 5000 } }))
    expect(getConfig().api.timeout).toBe(5000)
  })

  it('setConfig 非法值 → 拒绝 + 告警（不抛错）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = setConfig({ api: { timeout: -5 } })
    expect(r.ok).toBe(false)
    expect(getConfig().api.timeout).toBe(10000) // 拒绝更新
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('useAppConfig / getFeatureFlag（02 §2/§4）', () => {
  beforeEach(() => initAppConfig(DEFAULTS))

  it('useAppConfig setup 外调用报错（同 useRoute 语义）', () => {
    expect(() => useAppConfig()).toThrow(/setup/)
  })

  it('getFeatureFlag：布尔开关 + 实验分组变体（纯函数）', () => {
    expect(getFeatureFlag(getConfig(), 'glassEffect')).toEqual({ enabled: false, variant: false })
    expect(getFeatureFlag(getConfig(), 'newHomePage')).toEqual({ enabled: true, variant: 'control' })
    expect(getFeatureFlag(getConfig(), 'unknownFlag')).toEqual({ enabled: false, variant: undefined })
  })
})

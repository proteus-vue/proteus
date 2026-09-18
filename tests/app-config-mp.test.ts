// tests/app-config-mp.test.ts
// ★#494 config-demo MP 白屏回归（三层根因修复）：
//   ① useAppConfig()/useFeatureFlag() 原样发射进 onLoad → 撞 getCurrentInstance() 守卫（MP 页面 setup 体在 onLoad 执行，无 Vue 实例）
//   ② 顶层副作用语句（initAppConfig/registerCapability）被静默丢弃 → initAppConfig 不执行 → getConfig 必炸
//   ③ runtimeInit 实例属性进不了 data → 模板 {{ appConf.app.name }} 落空
//   修复：编译器桥（命令式改写 + 快照 setData + onAppConfigChange 订阅 + onUnload 退订 + require 行补 named imports）
import { describe, it, expect, beforeEach } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'
import { initAppConfig, getConfig, setConfig, onAppConfigChange } from '@proteus-vue/app-config'

const PAGE_SRC = [
  '<script setup lang="ts">',
  "import { initAppConfig, useAppConfig, useFeatureFlag, setConfig } from '@proteus-vue/app-config'",
  "import appConfig from '../app.config'",
  'initAppConfig(appConfig)',
  'const appConf = useAppConfig()',
  "const glassFlag = useFeatureFlag('glassEffect')",
  'function toggleGlass() {',
  '  setConfig({ features: { glassEffect: !appConf.features.glassEffect } })',
  '}',
  '</script>',
  '<template>',
  '  <p>{{ appConf.app.name }} · {{ glassFlag.enabled }}</p>',
  '</template>',
].join('\n')

describe('#494 app-config MP 绑定桥（config-demo 白屏回归）', () => {
  let js = ''
  beforeEach(() => {
    const r = compileVueSfc(PAGE_SRC, { filename: 'pages/config-demo.vue', moduleImports: [{ source: '@proteus-vue/app-config', requirePath: '../_proteus/app-config.js' }, { source: '../app.config', requirePath: '../app.config.js' }] })
    js = r.js
  })

  it('顶层副作用语句保留：initAppConfig 注入 onLoad 最前（此前被静默丢弃）', () => {
    const onLoad = js.slice(js.indexOf('onLoad(options)'), js.indexOf('this.appConf'))
    expect(onLoad).toContain('initAppConfig(appConfig)')
  })

  it('useAppConfig() 改写为 getConfig()（不撞 getCurrentInstance 守卫）', () => {
    expect(js).not.toContain('useAppConfig()')
    expect(js).toContain('this.appConf = getConfig()')
  })

  it('useFeatureFlag(k) 改写为 getFeatureFlag(getConfig(), k)', () => {
    expect(js).not.toContain("useFeatureFlag('glassEffect')")
    expect(js).toContain("getFeatureFlag(getConfig(), 'glassEffect')")
  })

  it('快照 setData + onAppConfigChange 订阅（模板 {{ appConf.x }} 读 data）', () => {
    expect(js).toContain('this.setData({ appConf: getConfig(), glassFlag: getFeatureFlag(getConfig(), \'glassEffect\') })')
    expect(js).toContain('onAppConfigChange(')
  })

  it('require 行补 named imports（getConfig/getFeatureFlag/onAppConfigChange）', () => {
    expect(js).toMatch(/const \{ [^}]*getConfig[^}]*\} = require\('\.\.\/_proteus\/app-config\.js'\)/)
    expect(js).toMatch(/onAppConfigChange/)
  })

  it('onUnload 生成退订（无显式 onUnload 时由 needsPageCleanup 承载）', () => {
    expect(js).toContain('this.__appConfigUnsub')
    expect(js).toContain('this.__appConfigUnsub()')
  })

  it('script/top-level-calls 禁用 → 顶层语句不注入（规则可关）', () => {
    const r = compileVueSfc(PAGE_SRC, {
      filename: 'pages/config-demo.vue',
      rules: { disabled: ['script/top-level-calls'] },
      moduleImports: [{ source: '@proteus-vue/app-config', requirePath: '../_proteus/app-config.js' }],
    })
    const onLoadBody = r.js.slice(r.js.indexOf('onLoad(options)'), r.js.indexOf('this.appConf'))
    expect(onLoadBody).not.toContain('initAppConfig')
  })
})

describe('#494 onAppConfigChange 订阅 API（MP 桥数据源）', () => {
  beforeEach(() => {
    initAppConfig({
      app: { id: 't', name: 'T', version: '1.0.0', buildNumber: 1 },
      env: 'dev',
      api: { baseUrl: 'https://t', timeout: 1, retry: 0, cache: { defaultTTL: 1, enabledEndpoints: [] } },
      features: { glassEffect: false, skeletonScreen: true, memorialGray: false, newHomePage: 'control' },
      theme: { default: 'system', allowUserToggle: false },
      font: { defaultScale: 1, allowUserAdjust: false },
      safeArea: { islandGlass: false },
    } as never)
  })

  it('setConfig 更新触发订阅回调（携带最新 config）；取消订阅后不再触发', () => {
    const seen: string[] = []
    const unsub = onAppConfigChange((c) => seen.push(c.features.glassEffect ? 'on' : 'off'))
    setConfig({ features: { glassEffect: true } })
    expect(getConfig().features.glassEffect).toBe(true)
    unsub()
    setConfig({ features: { glassEffect: false } })
    expect(seen).toEqual(['on']) // 取消订阅后不再收到 'off'
  })
})

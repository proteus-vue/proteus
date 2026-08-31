// tests/define-proteus.test.ts
// ★cli-plus G-33 M1：defineProteus 配置入口（01-cli.md §3，Vite defineConfig 模式）
import { describe, expect, it } from 'vitest'
import { defineProteus } from '@proteus-vue/types'
import type { DefineProteusConfig } from '@proteus-vue/types'

describe('defineProteus（cli-plus G-33 M1 配置入口）', () => {
  it('identity：原样返回入参（零运行时逻辑，Vite 模式）', () => {
    const config: DefineProteusConfig = {
      entry: 'src/main.ts',
      targets: {
        web: { output: 'dist' },
        skyline: { appid: 'wx-xxx' },
        ios: { bundleId: 'vue.proteus.demo', teamId: 'ABC' },
        android: { package: 'vue.proteus.demo' },
        harmony: { bundleName: 'vue.proteus.demo' },
      },
    }
    expect(defineProteus(config)).toBe(config)
  })

  it('能力开关 + 主题/字体/缓存 + 路由（01-cli.md §3 全字段）', () => {
    const config = defineProteus({
      entry: 'src/main.ts',
      targets: { web: { output: 'dist' } },
      features: { glass: true, safeArea: true, styleSafety: true, strictRouter: true },
      theme: { default: 'light', tokens: './theme.tokens' },
      fontScale: { enabled: true, min: 0.8, max: 2.0 },
      cache: { budget: '50mb' },
      router: { deepLink: { scheme: 'proteusdemo' } },
    })
    expect(config.features?.styleSafety).toBe(true)
    expect(config.router?.deepLink?.scheme).toBe('proteusdemo')
    expect(config.theme?.default).toBe('light')
  })

  it('必填字段类型约束（entry/targets 缺失 → TS 编译错误）', () => {
    // @ts-expect-error entry 缺失
    defineProteus({ targets: { web: { output: 'dist' } } })
    // @ts-expect-error targets 缺失
    defineProteus({ entry: 'src/main.ts' })
    // @ts-expect-error web.output 必填
    defineProteus({ entry: 'src/main.ts', targets: { web: {} } })
  })
})

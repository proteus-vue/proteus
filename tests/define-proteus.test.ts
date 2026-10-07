// tests/define-proteus.test.ts
// ★cli-plus G-33 M1 → ★v4（决策 #641）：defineProteus 配置入口（Vite defineConfig 模式）
//   v4 重定向到 ProteusConfig（按端分区）——原 G-33 草图的 features/theme/fontScale/cache 属运行时 app.config，已移除。
import { describe, expect, it } from 'vitest'
import { defineProteus } from '@proteus-vue/types'
import type { ProteusConfig } from '@proteus-vue/types'

describe('defineProteus（v4 配置入口）', () => {
  it('identity：原样返回入参（零运行时逻辑，Vite 模式）+ 类型推导', () => {
    const config: ProteusConfig = {
      version: 4,
      targets: {
        web: { output: 'dist' },
        mp: { appid: 'wx-xxx' },
        ios: { bundleId: 'vue.proteus.demo' },
        android: { applicationId: 'vue.proteus.demo' },
        harmony: { bundleName: 'vue.proteus.demo' },
      },
      pagesDir: 'src/pages',
    }
    expect(defineProteus(config)).toBe(config)
  })

  it('路由 + 共享身份（v4 字段）', () => {
    const config = defineProteus({
      targets: { mp: { appid: 'wx-xxx' } },
      pagesDir: 'src/pages',
      app: { name: 'Demo', version: '1.0.0', buildNumber: 1 },
      router: { routesOutput: 'src/router/auto-routes.ts' },
    })
    expect(config.targets.mp?.appid).toBe('wx-xxx')
    expect(config.app?.name).toBe('Demo')
    expect(config.router?.routesOutput).toBe('src/router/auto-routes.ts')
  })

  it('必填字段类型约束（targets/pagesDir 缺失 → TS 编译错误）', () => {
    // @ts-expect-error targets 缺失
    defineProteus({ pagesDir: 'src/pages' })
    // @ts-expect-error pagesDir 缺失
    defineProteus({ targets: { web: {} } })
  })
})

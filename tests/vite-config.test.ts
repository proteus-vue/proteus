// tests/vite-config.test.ts
// ★#418 配置收敛：resolveProteusViteConfig —— 框架组装 vite 配置（开发者不写 vite.config.ts）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveProteusViteConfig } from '../packages/plugin-vite/src/vite-config'
import type { ProteusConfig } from '../packages/types/src/config'

const ROOT = path.resolve('.')

const BASE_CONFIG = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000',
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: { registerPresets: true, builders: {} },
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
} as ProteusConfig

describe('#418 框架组装 vite 配置（resolveProteusViteConfig）', () => {
  it('web 目标：vue + route-blocks 插件 / configFile false / 别名 @ / define 注入', async () => {
    const { config, needsGenRoutes, platform } = await resolveProteusViteConfig(
      { root: ROOT, command: 'build', mode: 'web' },
      { ...BASE_CONFIG, platform: 'web' },
    )
    expect(platform).toBe('web')
    expect(needsGenRoutes).toBe(false)
    expect(config.configFile).toBe(false)
    expect(config.root).toBe(ROOT)
    expect(config.plugins?.length).toBe(2) // vue + route-blocks
    expect(config.build?.outDir).toBe(path.join(ROOT, 'dist', 'web'))
    expect((config.define as Record<string, unknown>).__PROTEUS_DEBUG__).toBe(false)
  })

  it('mp-weixin 目标：mpTransform + 虚拟 mp 入口 / needsGenRoutes / skyline define', async () => {
    const { config, needsGenRoutes, platform } = await resolveProteusViteConfig(
      { root: ROOT, command: 'build', mode: 'mp-weixin' },
      BASE_CONFIG,
    )
    expect(platform).toBe('mp-weixin')
    expect(needsGenRoutes).toBe(true)
    expect(config.plugins?.length).toBe(2) // virtual mp-entry + mpTransform
    expect(config.build?.outDir).toBe(path.join(ROOT, 'dist', 'mp-weixin'))
    expect(config.build?.minify).toBe(false)
    expect((config.define as Record<string, unknown>).__PROTEUS_SKYLINE__).toBe(true)
    const rollup = config.build?.rollupOptions as { input?: string }
    expect(rollup.input).toBe('proteus:mp-entry')
  })

  it('vite 透传：对象形态（plugins 追加 + server 覆盖）', async () => {
    const { config } = await resolveProteusViteConfig(
      { root: ROOT, command: 'serve', mode: 'web' },
      {
        ...BASE_CONFIG,
        platform: 'web',
        vite: { server: { port: 5999 }, resolve: { alias: [{ find: 'x', replacement: 'y' }] } },
      },
    )
    expect((config.server as { port?: number }).port).toBe(5999)
    // 仍保留框架插件（vue + route-blocks）+ 别名 @ 追加（用户别名不被吞）
    expect(config.plugins?.length).toBe(2)
    const aliases = (config.resolve?.alias as Array<{ find: string }>) ?? []
    expect(aliases.some((a) => a.find === '@')).toBe(true)
  })

  it('vite 透传：函数形态按 command/mode 返回', async () => {
    const { config } = await resolveProteusViteConfig(
      { root: ROOT, command: 'serve', mode: 'web' },
      {
        ...BASE_CONFIG,
        platform: 'web',
        vite: (ctx) => ({ define: { __CUSTOM__: ctx.mode === 'web' } }),
      },
    )
    expect((config.define as Record<string, unknown>).__CUSTOM__).toBe(true)
  })

  it('legacy 兼容探测：hasLegacyViteConfig（#420：examples/website 已迁移——全仓零 vite.config.ts）', async () => {
    const { hasLegacyViteConfig } = await import('../packages/cli/src/dev')
    expect(hasLegacyViteConfig(ROOT)).toBe(false) // 仓库根
    expect(hasLegacyViteConfig(path.join(ROOT, 'website'))).toBe(false) // website 已迁移（#420）
    expect(hasLegacyViteConfig(path.join(ROOT, 'examples'))).toBe(false) // examples 已迁移（#420）
  })
})

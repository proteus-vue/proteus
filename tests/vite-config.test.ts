// tests/vite-config.test.ts
// ★#418 配置收敛：resolveProteusViteConfig —— 框架组装 vite 配置（开发者不写 vite.config.ts）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
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
    // variant + vue + platform-macros + public-assets + route-blocks + ★p-fluid 布局改写
    // （★2026-09-20：p-fluid 改写此前**未注册**于 Web 分支 → Web 端属性静默不生效，见实战报告第十一节第二条）
    expect(config.plugins?.length).toBe(6)
    const names = (config.plugins ?? []).map((p) => (p as { name?: string }).name)
    expect(names).toContain('proteus-p-fluid-layout')
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
    // 仍保留框架插件（variant + vue + macro + public-assets + route-blocks + p-fluid）+ 别名 @ 追加（用户别名不被吞）
    expect(config.plugins?.length).toBe(6)
    const aliases = (config.resolve?.alias as unknown as Array<{ find: string }>) ?? []
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

// ─────────────────────────────────────────────────────────────────────────────
// ★★2026-09-20 外部实战报告 F-33（major · 静默失败）回归锁：**用户 `vite.define` 必须在 MP 端同样生效**
//
// 此前用户 define 只经 vite 路径合并（vite-config.ts），而 MP 的共享模块走 **esbuild 直出**、
// `main.mp.ts` → app.js 走 **esbuildTransform + 字符串拼接** —— 两条 MP 路径都不合并用户 define
// → 宏**原样残留**（构建通过、零告警、产物"看起来"正常）。
// 外部工程实测后果：`__API_BASE__` 取空 → API 失败路径在 store 订阅链里反复触发 → 真机栈溢出。
//
// 本用例锁**两条 MP 通道**都必须替换用户宏（最小复现取自报告）。
// ─────────────────────────────────────────────────────────────────────────────
describe('★F-33：用户 vite.define 在 MP 端必须生效（两条通道）', () => {
  it('用户 vite.define 并入框架 define（MP 与 Web 同源——防单侧回归）', async () => {
    const userDefine = { __API_BASE__: JSON.stringify('http://127.0.0.1:8760') }
    // ① MP 目标
    const { config } = await resolveProteusViteConfig(
      { root: ROOT, command: 'build', mode: 'mp-weixin' },
      { ...BASE_CONFIG, vite: { define: userDefine } } as never,
    )
    expect((config.define as Record<string, string>).__API_BASE__, 'MP 通道须含用户宏').toBe('"http://127.0.0.1:8760"')
    // ② Web 目标同样并入（同源，防单侧回归）
    const { config: webConfig } = await resolveProteusViteConfig(
      { root: ROOT, command: 'build', mode: 'web' },
      { ...BASE_CONFIG, platform: 'web', vite: { define: userDefine } } as never,
    )
    expect((webConfig.define as Record<string, string>).__API_BASE__, 'Web 通道须含用户宏').toBe('"http://127.0.0.1:8760"')
  })

  it('MP 两条直出通道都合并用户宏（源码级断言：防「硬编码白名单」回归）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/plugin-vite/src/plugin.ts'), 'utf8')
    // ① 共享模块 esbuild 直出：define 必须展开 cfg.vite.define
    expect(src, 'MP esbuild define 必须合并用户 vite.define').toMatch(/\.\.\.\(\(cfg\.vite[\s\S]{0,80}?\.define \?\? \{\}\)/)
    // ② main.mp.ts → app.js（纯转译，需文本级替换）：必须有 userDefine 替换段
    expect(src, 'app.js 通道必须有用户宏的文本级替换').toMatch(/userDefine[\s\S]{0,300}?appJsSource/)
  })
})

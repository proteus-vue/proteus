// tests/config-loader.test.ts
// ★#418 配置收敛完整性：宽松配置加载器（dev/build 用）——proteus.config.ts 的 vite 透传字段
//   需承载真实 vite 插件（运行时 import），加载器必须允许运行时依赖（区别于 config:check 的纯数据沙箱）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadProjectConfig } from '../packages/cli/src/config-loader'

const FIXTURE = path.resolve('node_modules/.cache/config-loader-fixture')
const ROOT_PKG = path.resolve('package.json')

function writeFixture(file: string, content: string): string {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

function pkgJson(dir: string): string {
  const p = path.join(dir, 'package.json')
  fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({ name: 'fixture', private: true, type: 'commonjs' }))
  return p
}

describe('#418 宽松配置加载器（loadProjectConfig）', () => {
  const dir = path.join(FIXTURE, 'p1')
  pkgJson(dir)

  it('纯数据配置（类型引用 plugin-vite 被剥离）加载为对象', async () => {
    const f = writeFixture(
      path.join(dir, 'proteus.config.ts'),
      `import type { ProteusConfig } from '@proteus-vue/plugin-vite'
const config: ProteusConfig = { platform: 'mp-weixin', skyline: true, appid: 'x', pagesDir: 'src/pages', routesOutput: 'r.ts', customRoute: { registerPresets: true, builders: {} }, setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } }
export default config`,
    )
    const cfg = (await loadProjectConfig(f)) as Record<string, unknown>
    expect(cfg.platform).toBe('mp-weixin')
    expect(cfg.style).toEqual({ px2rpx: true, rpxRatio: 2 })
  })

  it('vite 透传字段可承载真实插件模块（运行时 import 允许——宽松语义）', async () => {
    // 插件以真实发布形态（CJS dist）存在——require 可直接加载
    const plugFile = writeFixture(
      path.join(dir, 'my-plugin.cjs'),
      `module.exports = function myPlugin() { return { name: 'my-plugin', enforce: 'pre' } }`,
    )
    void plugFile
    const f = writeFixture(
      path.join(dir, 'proteus-with-plugins.config.ts'),
      `import myPlugin from './my-plugin.cjs'
const base = { platform: 'web', skyline: false, appid: 'x', pagesDir: 'p', routesOutput: 'r', customRoute: { registerPresets: true, builders: {} }, setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } }
export default { ...base, vite: { server: { port: 5001 }, plugins: [myPlugin()] } }`,
    )
    const cfg = (await loadProjectConfig(f)) as { vite?: { server?: { port?: number }; plugins?: Array<{ name: string }> } }
    expect(cfg.vite?.server?.port).toBe(5001)
    expect(cfg.vite?.plugins?.[0]?.name).toBe('my-plugin')
  })

  it('剥离 plugin-vite 类型引用 require 行（config 运行时无框架依赖）', async () => {
    const f = writeFixture(
      path.join(dir, 'proteus-typeonly.config.ts'),
      `import type { ProteusConfig } from '@proteus-vue/plugin-vite'
declare const _x: ProteusConfig
const cfg: ProteusConfig = { platform: 'web', skyline: false, appid: 'a', pagesDir: 'p', routesOutput: 'r', customRoute: { registerPresets: true, builders: {} }, setDataBridge: { batchWindow: 1, perComponent: false }, style: { px2rpx: false, rpxRatio: 1 } }
export default cfg`,
    )
    const cfg = (await loadProjectConfig(f)) as { platform: string }
    expect(cfg.platform).toBe('web')
  })
})

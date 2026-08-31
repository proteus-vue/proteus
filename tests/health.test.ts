// tests/health.test.ts
// ★cli 健康检查：proteus health —— 工程/环境健康一次性诊断（纯函数可测：注入 exists/nodeVersion）
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { runHealthCheck, formatHealthReport } from '../packages/cli/src/health'

/** 注入式 exists：真实 fs 检查（tmp 目录 + 只存在指定文件） */
function makeExists(present: string[]): (p: string) => boolean {
  const set = new Set(present.map((p) => path.normalize(p)))
  return (p) => set.has(path.normalize(p))
}

describe('runHealthCheck（proteus health）', () => {
  it('健康工程：全 ok（Node 22 + 结构齐全 + 真实 appid + 产物）', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const tmp = mkdtempSync(path.join(tmpdir(), 'proteus-health-ok-'))
    try {
      // 真实文件（loadTsConfig 需要真实 config；exists 注入会跳过真实读取）
      writeFileSync(
        path.join(tmp, 'proteus.config.ts'),
        `import type { ProteusConfig } from '@proteus-vue/plugin-vite'\nconst config: ProteusConfig = { platform: 'mp-weixin', skyline: true, appid: 'wx33bc04a52024def7', pagesDir: 'pages', routesOutput: 'x.ts', customRoute: { registerPresets: true, builders: {} }, setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } }\nexport default config\n`,
      )
      writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({
          scripts: { 'build:web': 'x', 'build:mp': 'y', test: 'z' },
          dependencies: { '@proteus-vue/runtime': '^0.2.0' },
        }),
      )
      writeFileSync(path.join(tmp, 'app.config.ts'), 'export default {}')
      mkdirSync(path.join(tmp, 'pages'), { recursive: true })
      mkdirSync(path.join(tmp, 'dist', 'web'), { recursive: true })
      mkdirSync(path.join(tmp, 'dist', 'mp-weixin'), { recursive: true })
      mkdirSync(path.join(tmp, 'node_modules', '@proteus-vue', 'runtime', 'dist'), { recursive: true })
      writeFileSync(path.join(tmp, 'node_modules', '@proteus-vue', 'runtime', 'dist', 'index.js'), '// stub')
      const items = await runHealthCheck(tmp, { nodeVersion: '22.12.0' })
      const byName = new Map(items.map((i) => [i.name, i]))
      expect(byName.get('node-version')?.level).toBe('ok')
      expect(byName.get('project-root')?.level).toBe('ok')
      expect(byName.get('node_modules')?.level).toBe('ok')
      expect(byName.get('app-config')?.level).toBe('ok')
      expect(byName.get('appid')?.level).toBe('ok') // 真实 wx+16 hex
      expect(byName.get('pages-dir')?.level).toBe('ok')
      expect(byName.get('build-output')?.level).toBe('ok')
      expect(byName.get('workspace-links')?.level).toBe('ok')
      expect(byName.get('scripts')?.level).toBe('ok')
      expect(items.every((i) => i.level === 'ok' || i.level === 'warn')).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('异常工程：error 分级（缺 config/缺 pagesDir/占位 appid）', async () => {
    const root = '/broken'
    const present = ['/broken/node_modules', '/broken/package.json', '/broken/proteus.config.ts']
    // 注入 exists 用真实 fs 支持（config 加载走 loadTsConfig 需要真实文件）——此处用 tmp 目录
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const tmp = mkdtempSync(path.join(tmpdir(), 'proteus-health-'))
    try {
      writeFileSync(
        path.join(tmp, 'proteus.config.ts'),
        `import type { ProteusConfig } from '@proteus-vue/plugin-vite'\nconst config: ProteusConfig = { platform: 'mp-weixin', skyline: true, appid: 'wx0000000000', pagesDir: 'pages', routesOutput: 'x.ts', customRoute: { registerPresets: true, builders: {} }, setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } }\nexport default config\n`,
      )
      writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }))
      const items = await runHealthCheck(tmp, { nodeVersion: '18.20.0' })
      const byName = new Map(items.map((i) => [i.name, i]))
      expect(byName.get('node-version')?.level).toBe('warn') // Node 18
      expect(byName.get('project-root')?.level).toBe('ok') // config 存在
      expect(byName.get('pages-dir')?.level).toBe('error') // pages 目录缺失
      expect(byName.get('appid')?.level).toBe('error') // 占位 wx0000000000
      expect(byName.get('scripts')?.level).toBe('warn') // 缺 build:web/build:mp/test
      expect(byName.get('app-config')?.level).toBe('warn') // 缺 app.config.ts
      const { text, ok } = formatHealthReport(items)
      expect(ok).toBe(false)
      expect(text).toContain('✗ appid')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('非工程目录：project-root error（缺 proteus.config.ts）', async () => {
    const items = await runHealthCheck('/empty', {
      nodeVersion: '22.0.0',
      exists: makeExists(['/empty/node_modules']),
    })
    const byName = new Map(items.map((i) => [i.name, i]))
    expect(byName.get('project-root')?.level).toBe('error')
    expect(byName.get('node_modules')?.level).toBe('ok')
  })

  it('formatHealthReport：error 阻断 / 全 ok 不阻断', () => {
    const okReport = formatHealthReport([
      { name: 'a', level: 'ok', message: 'ok' },
      { name: 'b', level: 'warn', message: 'warn' },
    ])
    expect(okReport.ok).toBe(true)
    const badReport = formatHealthReport([
      { name: 'a', level: 'ok', message: 'ok' },
      { name: 'b', level: 'error', message: 'bad' },
    ])
    expect(badReport.ok).toBe(false)
    expect(badReport.text).toContain('✗ b')
  })
})

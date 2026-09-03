// tests/mp-transform-exclude.test.ts
// ★mpTransform 排除机制完善（官网 B2 尾）：
//   ① resolveSharedModule 扩展名白名单（.ts/.js/.mjs/.cjs——.md/.json 等非代码资源不再命中 base 裸文件，
//      修复 docs-engine-demo 引入 .md 时 MP esbuild 裸错 "No loader"）
//   ② 页面级 webOnly（<route> 块 webOnly: true → web auto-routes 收录；MP app.json 不收录）
import { describe, it, expect } from 'vitest'
import { resolveSharedModule } from '@proteus-vue/plugin-vite'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '@proteus-vue/plugin-vite'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

const appDir = '/fake/app'

describe('resolveSharedModule 扩展名白名单（MP 资源排除）', () => {
  it('.md import 不再命中共享模块（返回 null——B2 修复前裸文件被收录致 esbuild 裸错）', () => {
    const dir = path.join(tmpdir(), 'docs-mp-excl')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'guide.md'), '# md content')
    const from = path.join(tmpdir(), 'page.vue')
    expect(resolveSharedModule(appDir, from, './docs-mp-excl/guide.md', undefined)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('.ts/.js 候选仍命中；无扩展名非代码文件被白名单拦截', () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), 'mp-excl-'))
    try {
      const shared = path.join(tmp, 'helper.ts')
      fs.writeFileSync(shared, 'export const x = 1')
      const r = resolveSharedModule(appDir, path.join(tmp, 'page.vue'), './helper', undefined)
      expect(r?.file).toBe(shared)
      // 无扩展名裸文件（如 notes 文本）——不在 JS/TS 扩展名集合 → 拒绝
      const txt = path.join(tmp, 'notes')
      fs.writeFileSync(txt, 'plain text')
      const r2 = resolveSharedModule(appDir, path.join(tmp, 'page.vue'), './notes', undefined)
      expect(r2).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('G-42/官网 webOnly 页面（gen-routes 端到端）', () => {
  function makeConfig(extra: Partial<ProteusConfig> = {}): ProteusConfig {
    return {
      platform: 'mp-weixin',
      appid: 'wx0000000000',
      pagesDir: 'src/pages',
      routesOutput: 'src/router/auto-routes.ts',
      customRoute: { registerPresets: true, builders: {} },
      style: { px2rpx: true, rpxRatio: 2 },
      ...extra,
    } as ProteusConfig
  }

  function writeFixture(dir: string, rel: string, content: string): void {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  it('webOnly: true → web auto-routes 收录；MP app.json 不收录', () => {
    const root = path.join(tmpdir(), 'gen-webonly')
    writeFixture(root, 'src/pages/index.vue', '<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页", "isTab": true }\n}\n</route>\n')
    writeFixture(root, 'src/pages/docs-engine-demo.vue', '<template><view>文档引擎</view></template>\n<route>\n{\n  "webOnly": true\n}\n</route>\n')

    runGenRoutes({ config: makeConfig(), root })

    // web 路由表：webOnly 页收录（web 端可用）
    const auto = fs.readFileSync(path.join(root, 'src/router/auto-routes.ts'), 'utf-8')
    expect(auto).toContain('name: "docs-engine-demo"')
    // MP app.json：webOnly 页不收录
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toEqual(['pages/index'])
    expect(JSON.stringify(appJson)).not.toContain('docs-engine-demo')
  })

  it('无 webOnly 的普通页面照常收录（回归）', () => {
    const root = path.join(tmpdir(), 'gen-webonly-reg')
    writeFixture(root, 'src/pages/index.vue', '<template><view>首页</view></template>')
    writeFixture(root, 'src/pages/about.vue', '<template><view>关于</view></template>')

    runGenRoutes({ config: makeConfig(), root })

    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toEqual(['pages/index', 'pages/about'])
  })
})

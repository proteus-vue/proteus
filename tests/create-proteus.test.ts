// tests/create-proteus.test.ts
// 脚手架模板生成测试：copyTemplate 纯函数 —— 复制模板 + {{name}} 替换
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyTemplate } from '@proteus-vue/create-proteus'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-create-'))
const TEMPLATES = path.resolve('packages/create-proteus/templates')

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('create-proteus copyTemplate', () => {
  it('生成完整工程骨架（框架本体 + 编译管线 + 首页）', () => {
    const files = copyTemplate(path.join(TMP, 'my-app'), { name: 'my-app' }, TEMPLATES)
    const rel = new Set(files)
    // 入口与配置
    expect(rel.has('package.json')).toBe(true)
    expect(rel.has('proteus.config.ts')).toBe(true)
    expect(rel.has('vite.config.ts')).toBe(true)
    expect(rel.has('index.html')).toBe(true)
    expect(rel.has('tsconfig.json')).toBe(true)
    // 编译管线（gen-routes 走 @proteus-vue/plugin-vite npm 包）
    expect(rel.has('scripts/gen-routes.ts')).toBe(true)
    // 应用壳（拆包步骤 7：不再复制框架本体 src/，框架走 npm 包）
    expect(rel.has('src/router/RouterView.vue')).toBe(true)
    expect(rel.has('src/router/index.ts')).toBe(true)
    expect(rel.has('src/shims/mp.d.ts')).toBe(true)
    // 不再包含框架 vendored 副本（拆包步骤 7）
    expect(rel.has('src/platform/adapter.ts')).toBe(false)
    expect(rel.has('src/runtime/setDataBridge.ts')).toBe(false)
    expect(rel.has('vite-plugin-mp-transform.ts')).toBe(false)
    // 应用入口与首页
    expect(rel.has('src/main.ts')).toBe(true)
    expect(rel.has('src/main.mp.ts')).toBe(true)
    expect(rel.has('src/App.vue')).toBe(true)
    expect(rel.has('src/pages/index.vue')).toBe(true)
  })

  it('{{name}} 替换进 package.json（npm 包名规范）', () => {
    const dir = path.join(TMP, 'name-replace')
    copyTemplate(dir, { name: 'hello-world' }, TEMPLATES)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('hello-world')
    expect(JSON.stringify(pkg)).not.toContain('{{name}}')
  })

  it('插件与 gen-routes 走 @proteus-vue/* npm 包（拆包步骤 7）', () => {
    const dir = path.join(TMP, 'plugin-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const viteCfg = fs.readFileSync(path.join(dir, 'vite.config.ts'), 'utf-8')
    expect(viteCfg).toContain("from '@proteus-vue/plugin-vite'")
    expect(viteCfg).not.toContain('./packages/')
    const genRoutes = fs.readFileSync(path.join(dir, 'scripts/gen-routes.ts'), 'utf-8')
    expect(genRoutes).toContain("from '@proteus-vue/plugin-vite'")
    // 框架依赖在 package.json（不 vendored）
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@proteus-vue/router']).toBeDefined()
    expect(pkg.dependencies['@proteus-vue/runtime']).toBeDefined()
    expect(pkg.dependencies['@proteus-vue/shared']).toBeDefined()
    expect(pkg.devDependencies['@proteus-vue/plugin-vite']).toBeDefined()
  })

  it('首页是标准 Vue SFC（可编译的最小闭环）', () => {
    const dir = path.join(TMP, 'page-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const page = fs.readFileSync(path.join(dir, 'src/pages/index.vue'), 'utf-8')
    expect(page).toContain('<route>')
    expect(page).toContain('Hello Proteus')
  })
})

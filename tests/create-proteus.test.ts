// tests/create-proteus.test.ts
// 脚手架模板生成测试：copyTemplate 纯函数 —— 复制模板 + {{name}} 替换
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyTemplate } from '../packages/create-proteus/src/index'

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
    // 编译管线（插件 import npm 包）
    expect(rel.has('vite-plugin-mp-transform.ts')).toBe(true)
    expect(rel.has('scripts/gen-routes.ts')).toBe(true)
    // 框架本体运行时（快照）
    expect(rel.has('src/router/RouterView.vue')).toBe(true)
    expect(rel.has('src/platform/adapter.ts')).toBe(true)
    expect(rel.has('src/runtime/setDataBridge.ts')).toBe(true)
    expect(rel.has('src/shims/mp.d.ts')).toBe(true)
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

  it('插件 import @proteus/compiler（npm 包形态）', () => {
    const dir = path.join(TMP, 'plugin-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const plugin = fs.readFileSync(path.join(dir, 'vite-plugin-mp-transform.ts'), 'utf-8')
    expect(plugin).toContain("from '@proteus/compiler'")
    expect(plugin).not.toContain('./packages/compiler')
  })

  it('首页是标准 Vue SFC（可编译的最小闭环）', () => {
    const dir = path.join(TMP, 'page-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const page = fs.readFileSync(path.join(dir, 'src/pages/index.vue'), 'utf-8')
    expect(page).toContain('<route>')
    expect(page).toContain('Hello Proteus')
  })
})

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
  it('生成完整工程骨架（框架配置 + 双端入口 + 首页——无 vite.config/scripts，#418 配置收敛）', () => {
    const files = copyTemplate(path.join(TMP, 'my-app'), { name: 'my-app' }, TEMPLATES)
    const rel = new Set(files)
    // 入口与配置（★#418：唯一配置 proteus.config.ts——不再生成 vite.config.ts）
    expect(rel.has('package.json')).toBe(true)
    expect(rel.has('proteus.config.ts')).toBe(true)
    expect(rel.has('vite.config.ts')).toBe(false)
    expect(rel.has('scripts/gen-routes.ts')).toBe(false)
    expect(rel.has('index.html')).toBe(true)
    expect(rel.has('tsconfig.json')).toBe(true)
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

  it('配置收敛：proteus.config 引用框架包 + vite 透传注释（拆包步骤 7 + #418）', () => {
    const dir = path.join(TMP, 'plugin-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const cfg = fs.readFileSync(path.join(dir, 'proteus.config.ts'), 'utf-8')
    expect(cfg).toContain("from '@proteus-vue/plugin-vite'")
    expect(cfg).not.toContain('./packages/')
    expect(cfg).toContain('vite: {')
    // 框架依赖在 package.json（不 vendored）
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    expect(pkg.dependencies['@proteus-vue/router']).toBeDefined()
    expect(pkg.dependencies['@proteus-vue/runtime']).toBeDefined()
    expect(pkg.dependencies['@proteus-vue/shared']).toBeDefined()
    expect(pkg.devDependencies['@proteus-vue/plugin-vite']).toBeDefined()
    expect(pkg.devDependencies['@proteus-vue/cli']).toBeDefined()
    expect(pkg.scripts['build:mp']).toBe('proteus build --target skyline')
  })

  it('首页是标准 Vue SFC（可编译的最小闭环）', () => {
    const dir = path.join(TMP, 'page-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const page = fs.readFileSync(path.join(dir, 'src/pages/index.vue'), 'utf-8')
    expect(page).toContain('<route>')
    expect(page).toContain('Hello Proteus')
  })
})

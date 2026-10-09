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
    expect(rel.has('src/styles/global.css')).toBe(true)
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

  it('首页是标准 Vue SFC（可编译的最小闭环 + 跨端安全写法）', () => {
    const dir = path.join(TMP, 'page-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const page = fs.readFileSync(path.join(dir, 'src/pages/index.vue'), 'utf-8')
    expect(page).toContain('<route>')
    // 首页是新版展示页（不再是裸 'Hello Proteus'）
    expect(page).toContain('一次编写，多端运行')
    // ★用**原始标签**（不依赖内置组件——组件三端尚未对齐）
    expect(page).not.toMatch(/<p-[a-z]/)
    // ★跨端安全写法：静态 class + 令牌；无 :hover/伪类选择器
    expect(page).not.toMatch(/:hover\s*[,{]/)
    // ★事件用**内联动作**（App 事件编译只支持内联，不支持方法引用 @click="fn"——否则 App 端不产出事件，按钮点不动）
    expect(page).toMatch(/@click="count\+\+"/)
    expect(page).not.toMatch(/@click="handleTap"/)
  })

  it('★全局样式四端同源：global.css 存在 + config.globalStyle 指向 + main.ts import', () => {
    const dir = path.join(TMP, 'globalcss-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const gcss = path.join(dir, 'src/styles/global.css')
    expect(fs.existsSync(gcss)).toBe(true)
    // 小程序端：targets.mp.globalStyle 指向同一份
    const cfg = fs.readFileSync(path.join(dir, 'proteus.config.ts'), 'utf-8')
    expect(cfg).toContain("globalStyle: 'src/styles/global.css'")
    // Web 端：main.ts import 同一份
    const main = fs.readFileSync(path.join(dir, 'src/main.ts'), 'utf-8')
    expect(main).toContain("import './styles/global.css'")
    // 页面骨架类在 global.css 里（App 端靠这些 .class 规则折叠）
    expect(fs.readFileSync(gcss, 'utf-8')).toContain('.page')
  })

  it('★模板 scripts 覆盖 App 三端（dev/build/package）+ 严格等于 CLI 别名', () => {
    const dir = path.join(TMP, 'scripts-check')
    copyTemplate(dir, { name: 'x' }, TEMPLATES)
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).scripts as Record<string, string>
    for (const t of ['android', 'ios', 'harmony']) {
      // 「scripts = CLI 别名」原则：逐字相等（编译/带包两态）
      expect(s[`dev:${t}`], `dev:${t}`).toBe(`proteus dev --target ${t}`)
      expect(s[`build:${t}`], `build:${t}`).toBe(`proteus build --target ${t}`)
      expect(s[`package:${t}`], `package:${t}`).toBe(`proteus build --target ${t} --package`)
    }
    // Web/小程序入口不得因新增 App 端而改动
    expect(s['dev:web']).toBe('proteus dev --target web')
    expect(s['build:mp']).toBe('proteus build --target skyline')
  })
})

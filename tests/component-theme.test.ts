// tests/component-theme.test.ts
// ★编译器通道主题皮肤 POC 回归锁（2026-09-13）：
//   命题：组件主题必须在**组件自己的 scoped wxss 内**以**单类选择器**定义，并由编译期把
//   theme 值落成根节点单类变体——而不是靠页面级 CSS 从外往里推（会被微信样式隔离挡住）。
//
//   本测试锁三件事（均可破坏性验证）：
//     ① 注册表 SSOT 一致：packages/components/theme/registry.ts 的主题键/色值 ↔ 各组件变体 CSS；
//     ② 编译产物：p-button theme 变体在 wxml 是**字面量键**（编译期可后缀），在 wxss 是**单类选择器**；
//     ③ 反模式拦截：变体选择器不得出现复合类 `.a.b`（Skyline 真机不支持）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

function compileComponent(tag: string) {
  return compileVueSfc(read(`packages/components/${tag}/index.vue`), {
    isComponent: true,
    filename: `packages/components/${tag}/index.vue`,
  })
}

/** 从注册表源码解析出主题键 → 色值（避免依赖包导出解析，直读 SSOT 文件） */
function parseRegistry(): Record<string, { bg: string; color: string }> {
  const src = read('packages/components/theme/registry.ts')
  const out: Record<string, { bg: string; color: string }> = {}
  const re = /(\w+):\s*\{\s*key:\s*'(\w+)'[^}]*?bg:\s*'([^']+)'[^}]*?color:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out[m[2]] = { bg: m[3], color: m[4] }
  return out
}

describe('★编译器通道主题皮肤（p-button POC）', () => {
  const registry = parseRegistry()

  it('注册表含 ≥3 套皮肤（brand/success/danger 必备）', () => {
    expect(Object.keys(registry).length).toBeGreaterThanOrEqual(3)
    for (const k of ['brand', 'success', 'danger']) expect(registry[k], `缺皮肤 ${k}`).toBeTruthy()
  })

  it('★p-button wxml：theme 变体是字面量键（编译期可静态后缀，非动态拼接）', () => {
    const { wxml } = compileComponent('p-button')
    // 每个主题键都必须以字面量形式出现在 :class 对象里（编译产物 → 运行时变量三元）
    for (const key of Object.keys(registry)) {
      expect(wxml, `wxml 缺主题键 ${key} 的字面量判定`).toContain(`p-theme--${key}-`)
    }
    // 反模式：**模板区**出现动态拼接 'p-theme--' + theme → 动态类名无法后缀（MP 匹配不上）
    const src = read('packages/components/p-button/index.vue')
    const template = src.match(/<template>([\s\S]*?)<\/template>/)?.[1] ?? ''
    expect(template, '模板不得动态拼接主题类名').not.toMatch(/'p-theme--'\s*\+/)
  })

  it('★p-button wxss：每个主题变体是单类选择器 + 只重定义局部变量', () => {
    const { wxss } = compileComponent('p-button')
    for (const key of Object.keys(registry)) {
      // 单类选择器（scopeId 含短横线，如 data-v-88f4aa）→ .p-theme--brand-data-v-xxx { --p-button-bg: <色值>
      const re = new RegExp(`\\.p-theme--${key}-[\\w-]+\\s*\\{[^}]*--p-button-bg:\\s*${escapeRe(registry[key].bg)}`, 's')
      expect(re.test(wxss), `wxss 缺单类变体 .p-theme--${key}→${registry[key].bg}`).toBe(true)
    }
    // 变体块必须消费变量名（--p-button-color），保证与基类换肤路径一致
    expect(wxss).toContain('--p-button-color')
  })

  it('★反模式：主题变体不得用复合类选择器（Skyline 真机不支持 .a.b）', () => {
    const { wxss } = compileComponent('p-button')
    // 去注释后再查（注释里可能举例提到复合类写法）
    const code = wxss.replace(/\/\*[\s\S]*?\*\//g, ' ')
    // 复合 = 同一选择器内两个类名直接相连（无空格/逗号/组合符）——theme 类在前或在后都算
    const compound = code.match(/\.p-theme--[\w-]+\.[\w-]+|\.[\w-]+\.p-theme--[\w-]+/g) ?? []
    expect(compound, `发现复合类选择器：${compound.join(',')}`).toHaveLength(0)
  })

  it('注册表色值 ↔ 组件变体 CSS 一致（防漂移）', () => {
    const { wxss } = compileComponent('p-button')
    for (const [key, spec] of Object.entries(registry)) {
      expect(wxss, `${key} bg 与注册表不一致`).toContain(spec.bg)
      expect(wxss, `${key} color 与注册表不一致`).toContain(spec.color)
    }
  })

  it('Web 端：theme prop 参与组件契约（defineProps 声明）', () => {
    const src = read('packages/components/p-button/index.vue')
    expect(src).toMatch(/theme:\s*\{\s*type:\s*String/)
  })

  // ★2026-09-13 回归锁（用户实测「Web 镂空按钮居中，小程序居左」）：
  //   Web 模拟层 `.proteus-web-button { margin-left/right:auto }` 是为**裸 <button>** 模拟微信
  //   原生「居中 184px」而设；p-button 必须显式 margin:0 覆盖它（否则独自占行时被居中）。
  it('★p-button 显式 margin:0（覆盖 Web 模拟层的居中语义，与 MP 居左一致）', () => {
    const { wxss } = compileComponent('p-button')
    expect(wxss, 'scoped 基类应含 margin: 0').toMatch(/margin:\s*0/)
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

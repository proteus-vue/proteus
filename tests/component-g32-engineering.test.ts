// tests/component-g32-engineering.test.ts
// ★G-32 B5 续二（proteus-semantic-primitives-plus-plan §8 ③）：工程原语动画组件形态 E19 p-transition / E20 p-animate
//   验证点：① 组件目录 + index.vue + 聚合导出（components:audit 零违规）② MP 编译（compileVueSfc 全通过）
//   ③ IR 语义链接（TAG_SEMANTIC_MAP ↔ 标签 ↔ toComponentIR——engineering.transition / engineering.animate）
//   ④ 组件 SFC 声明语义（name/mode/keyframes/duration props）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { auditComponents } from '../packages/cli/src/component-audit'
import { TAG_SEMANTIC_MAP, toComponentIR, SEMANTIC_ENUM } from '@proteus-vue/component-ir'

const COMPONENTS_DIR = path.resolve('src/components')

const NEW_TAGS = ['p-transition', 'p-animate', 'p-router-link']

const TAG_TO_SEMANTIC: Record<string, string> = {
  'p-transition': 'engineering.transition',
  'p-animate': 'engineering.animate',
  'p-router-link': 'engineering.router-link',
}

describe('G-32 B5 续二/尾巴 工程原语组件形态落地（E19/E20 动画 + E18 声明式导航）', () => {
  it('组件目录齐全 + index.vue 存在 + 聚合导出注册（manifest 完备）', () => {
    for (const tag of NEW_TAGS) {
      expect(fs.existsSync(path.join(COMPONENTS_DIR, tag, 'index.vue')), `${tag}/index.vue 缺失`).toBe(true)
      const indexSrc = fs.readFileSync(path.join(COMPONENTS_DIR, 'index.ts'), 'utf-8')
      const pascal = tag.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
      expect(indexSrc, `${tag} 未在 index.ts 聚合导出 ${pascal}`).toContain(`import ${pascal} from './${tag}/index.vue'`)
      expect(indexSrc).toContain(pascal)
    }
  })

  it('★components:audit 全量零违规（no-platform-api / manifest-complete——纯 CSS 组件无平台直调）', () => {
    const result = auditComponents(COMPONENTS_DIR)
    expect(result.ok, result.violations.map((v) => `[${v.rule}] ${v.file}: ${v.message}`).join('\n')).toBe(true)
    for (const tag of NEW_TAGS) {
      expect(result.violations.some((v) => v.file.includes(tag)), `${tag} 有违规`).toBe(false)
    }
  })

  it('★IR 语义链接：新组件标签 → G-32 工程原语语义（TAG_SEMANTIC_MAP + toComponentIR + SEMANTIC_ENUM）', () => {
    for (const tag of NEW_TAGS) {
      expect(TAG_SEMANTIC_MAP[tag], `${tag} 未在 TAG_SEMANTIC_MAP 登记`).toBe(TAG_TO_SEMANTIC[tag])
      const ir = toComponentIR(tag, {})
      expect(ir?.semantic, `${tag} toComponentIR 语义`).toBe(TAG_TO_SEMANTIC[tag])
      expect((SEMANTIC_ENUM as readonly string[]).indexOf(TAG_TO_SEMANTIC[tag]), `${TAG_TO_SEMANTIC[tag]} 不在 SEMANTIC_ENUM`).toBeGreaterThanOrEqual(0)
    }
  })

  it('SFC 声明语义：p-transition 带 name/mode/duration/visible；p-animate 带 keyframes/duration/loop/delay；p-router-link 带 to/replace/switchTab', () => {
    const transition = fs.readFileSync(path.join(COMPONENTS_DIR, 'p-transition', 'index.vue'), 'utf-8')
    for (const prop of ['name', 'mode', 'duration', 'visible']) {
      expect(transition, `p-transition 缺 prop ${prop}`).toContain(prop + ':')
    }
    const animate = fs.readFileSync(path.join(COMPONENTS_DIR, 'p-animate', 'index.vue'), 'utf-8')
    for (const prop of ['keyframes', 'duration', 'loop', 'delay']) {
      expect(animate, `p-animate 缺 prop ${prop}`).toContain(prop + ':')
    }
    const link = fs.readFileSync(path.join(COMPONENTS_DIR, 'p-router-link', 'index.vue'), 'utf-8')
    for (const prop of ['to', 'replace', 'switchTab']) {
      expect(link, `p-router-link 缺 prop ${prop}`).toContain(prop + ':')
    }
    // E18 声明式导航：点击 emit('navigate') 载荷
    expect(link).toContain("defineEmits(['navigate'])")
    expect(link).toContain("emit('navigate'")
  })

  it('MP 编译：全部组件 compileVueSfc 产出（isComponent 模式——wxml/js/wxss 非空）', () => {
    for (const tag of NEW_TAGS) {
      const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
      const { wxml, js, wxss } = compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
      expect(wxml.length, `${tag} wxml 为空`).toBeGreaterThan(0)
      expect(js.length, `${tag} js 为空`).toBeGreaterThan(0)
      expect(wxss.length, `${tag} wxss 为空`).toBeGreaterThan(0)
    }
  })

  it('代表性产物：p-transition wxml 类绑定 + p-animate wxss 关键帧 @keyframes 保留', () => {
    const transition = compileVueSfc(fs.readFileSync(path.join(COMPONENTS_DIR, 'p-transition', 'index.vue'), 'utf-8'), {
      isComponent: true,
      filename: 'src/components/p-transition/index.vue',
    })
    expect(transition.wxml).toContain('p-transition')
    const animate = compileVueSfc(fs.readFileSync(path.join(COMPONENTS_DIR, 'p-animate', 'index.vue'), 'utf-8'), {
      isComponent: true,
      filename: 'src/components/p-animate/index.vue',
    })
    expect(animate.wxml).toContain('p-animate')
    // ★纯 CSS 动画声明语义：@keyframes 保留在 wxss（Skyline animation CSS）
    expect(animate.wxss).toContain('@keyframes')
  })
})
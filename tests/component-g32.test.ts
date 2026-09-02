// tests/component-g32.test.ts
// ★G-32 B2（proteus-semantic-primitives-plus-plan）：布局 12 + UI 18 Web 实现落地（Playground 可用）
//   验证点：① 新组件目录 + 聚合导出（components:audit 零违规）② MP 编译（compileVueSfc 全通过）
//   ③ IR 语义链接（TAG_SEMANTIC_MAP ↔ 新组件标签 ↔ toComponentIR）④ 既有语义不回归
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { auditComponents } from '../packages/cli/src/component-audit'
import { TAG_SEMANTIC_MAP, toComponentIR, SEMANTIC_ENUM } from '@proteus-vue/component-ir'

const COMPONENTS_DIR = path.resolve('src/components')

/** G-32 B2/B4 新落地组件（29 个——布局 6 + UI 基础 4 + Shell 7 + UI 视图 5 + UI 表单 5 + Gesture 2） */
const NEW_TAGS = [
  // 布局（6）
  'p-inline', 'p-spacer', 'p-divider', 'p-scroll', 'p-virtual-list', 'p-masonry',
  // UI 基础（4）
  'p-heading', 'p-icon', 'p-switch', 'p-slider',
  // Shell（3 + B4 4 = 7）
  'p-nav', 'p-tabbar', 'p-drawer',
  // UI 视图（5）
  'p-rich-text', 'p-avatar', 'p-media', 'p-canvas', 'p-svg',
  // UI 表单（5）
  'p-select', 'p-checkbox', 'p-radio', 'p-picker', 'p-form',
  // Shell B4（4）
  'p-page', 'p-segment', 'p-popover', 'p-action-sheet',
  // Gesture B4（2）
  'p-draggable', 'p-scrollable',
]

/** 各组件应映射到的 G-32 语义 */
const TAG_TO_SEMANTIC: Record<string, string> = {
  'p-inline': 'layout.inline',
  'p-spacer': 'layout.spacer',
  'p-divider': 'layout.divider',
  'p-scroll': 'layout.scroll',
  'p-virtual-list': 'layout.virtual-list',
  'p-masonry': 'layout.masonry',
  'p-heading': 'ui.heading',
  'p-icon': 'ui.icon',
  'p-switch': 'ui.switch',
  'p-slider': 'ui.slider',
  'p-nav': 'shell.nav',
  'p-tabbar': 'shell.tabbar',
  'p-drawer': 'shell.drawer',
  'p-rich-text': 'ui.rich-text',
  'p-avatar': 'ui.avatar',
  'p-media': 'ui.media',
  'p-canvas': 'ui.canvas',
  'p-svg': 'ui.svg',
  'p-select': 'ui.select',
  'p-checkbox': 'ui.checkbox',
  'p-radio': 'ui.radio',
  'p-picker': 'ui.picker',
  'p-form': 'ui.form',
  'p-page': 'shell.page',
  'p-segment': 'shell.segment',
  'p-popover': 'shell.popover',
  'p-action-sheet': 'shell.action-sheet',
  'p-draggable': 'gesture.draggable',
  'p-scrollable': 'gesture.scrollable',
}

describe('G-32 B2/B4 组件落地（29 新组件：布局 6 + UI 基础 4 + Shell 7 + UI 视图 5 + UI 表单 5 + Gesture 2）', () => {
  it('组件目录齐全 + index.vue 存在 + 聚合导出注册（manifest 完备）', () => {
    for (const tag of NEW_TAGS) {
      expect(fs.existsSync(path.join(COMPONENTS_DIR, tag, 'index.vue')), `${tag}/index.vue 缺失`).toBe(true)
      const indexSrc = fs.readFileSync(path.join(COMPONENTS_DIR, 'index.ts'), 'utf-8')
      const pascal = tag.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
      expect(indexSrc, `${tag} 未在 index.ts 聚合导出 ${pascal}`).toContain(`import ${pascal} from './${tag}/index.vue'`)
      expect(indexSrc).toContain(pascal)
    }
  })

  it('★components:audit 全量零违规（no-platform-api / manifest-complete）', () => {
    const result = auditComponents(COMPONENTS_DIR)
    expect(result.ok, format(result)).toBe(true)
    // 新组件全部计入组件数
    for (const tag of NEW_TAGS) {
      expect(result.violations.some((v) => v.file.includes(tag)), `${tag} 有违规`).toBe(false)
    }
    function format(r: typeof result): string {
      return r.violations.map((v) => `[${v.rule}] ${v.file}: ${v.message}`).join('\n')
    }
  })

  it('★IR 语义链接：新组件标签 → G-32 语义（TAG_SEMANTIC_MAP + toComponentIR）', () => {
    for (const tag of NEW_TAGS) {
      expect(TAG_SEMANTIC_MAP[tag], `${tag} 未在 TAG_SEMANTIC_MAP 登记`).toBe(TAG_TO_SEMANTIC[tag])
      const ir = toComponentIR(tag, {})
      expect(ir?.semantic, `${tag} toComponentIR 语义`).toBe(TAG_TO_SEMANTIC[tag])
      expect((SEMANTIC_ENUM as readonly string[]).indexOf(TAG_TO_SEMANTIC[tag]), `${TAG_TO_SEMANTIC[tag]} 不在 SEMANTIC_ENUM`).toBeGreaterThanOrEqual(0)
    }
  })

  it('MP 编译：29 组件 compileVueSfc 全部产出（isComponent 模式）', () => {
    for (const tag of NEW_TAGS) {
      const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
      const { wxml, js, wxss } = compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
      expect(wxml.length, `${tag} wxml 为空`).toBeGreaterThan(0)
      expect(js.length, `${tag} js 为空`).toBeGreaterThan(0)
      expect(wxss.length, `${tag} wxss 为空`).toBeGreaterThan(0)
    }
  })

  it('代表性组件 MP 产物形态（wxml 结构）', () => {
    const icon = compileVueSfc(fs.readFileSync(path.join(COMPONENTS_DIR, 'p-icon', 'index.vue'), 'utf-8'), {
      isComponent: true,
      filename: 'src/components/p-icon/index.vue',
    })
    expect(icon.wxml).toContain('p-icon')
    const sw = compileVueSfc(fs.readFileSync(path.join(COMPONENTS_DIR, 'p-switch', 'index.vue'), 'utf-8'), {
      isComponent: true,
      filename: 'src/components/p-switch/index.vue',
    })
    expect(sw.wxml).toContain('bindtap') // @click → bindtap（事件归一）
    expect(sw.wxml).toContain('p-switch-on')
    const tabbar = compileVueSfc(fs.readFileSync(path.join(COMPONENTS_DIR, 'p-tabbar', 'index.vue'), 'utf-8'), {
      isComponent: true,
      filename: 'src/components/p-tabbar/index.vue',
    })
    expect(tabbar.wxml).toContain('wx:for')
  })
})
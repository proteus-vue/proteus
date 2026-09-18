// tests/p-share-element.test.ts
// ★批次 8：p-share-element（共享元素转场 / 官方 <share-element>）契约回归锁。
//   锁定：语义登记闭环 + 官方 8 属性透传 + 两处改名决策（key→shuttleKey / transform→animate）
//         + 审计别名表登记（否则覆盖标尺会误报缺口）。
// 破坏性验证：删任一 prop / 模板绑定 / 别名登记 → 对应断言变红。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import {
  PRIMITIVE_CATALOG,
  TAG_SEMANTIC_MAP,
  SEMANTIC_BACKEND_MAP,
  SEMANTIC_ENUM,
  primitiveByTag,
  auditCatalogConsistency,
} from '@proteus-vue/component-ir'

const ROOT = path.resolve(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'packages/components/p-share-element/index.vue'), 'utf-8')
const compiled = compileVueSfc(SRC, { isComponent: true, filename: 'p-share-element.vue' })

/** 官方 <share-element> 的 8 个属性（worklet:onframe 属事件不计） */
const OFFICIAL_PROPS = [
  'shuttleKey', 'animate', 'duration', 'easingFunction',
  'transitionOnGesture', 'shuttleOnPush', 'shuttleOnPop', 'rectTweenType',
] as const

describe('★批次 8 · p-share-element 官方属性透传', () => {
  it('8 项官方属性全部声明', () => {
    for (const p of OFFICIAL_PROPS) {
      expect(SRC, `应声明 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
  })

  it('★模板以 kebab-case 绑定到原生 <share-element>（MP 透传宿主属性）', () => {
    const binds: Record<string, string> = {
      shuttleKey: 'shuttle-key', animate: 'animate', duration: 'duration',
      easingFunction: 'easing-function', transitionOnGesture: 'transition-on-gesture',
      shuttleOnPush: 'shuttle-on-push', shuttleOnPop: 'shuttle-on-pop', rectTweenType: 'rect-tween-type',
    }
    for (const [prop, kebab] of Object.entries(binds)) {
      expect(compiled.wxml, `${prop} → ${kebab}="{{${prop}}}"`).toContain(`${kebab}="{{${prop}}}"`)
    }
  })

  it('★两处改名决策：官方 key→shuttleKey、transform→animate（保留字/类型冲突）', () => {
    // 依据 02-ir-prop-binding「保留字冲突 → 加前缀或改写」
    expect(SRC).toContain('shuttleKey')
    expect(SRC).toContain('animate')
    // 官方原名不得直接作 prop（key 是 Vue vnode 保留属性；transform 与 CSS transform 类型冲突）
    expect(SRC).not.toMatch(/^\s{2}key:\s*\{\s*type:/m)
    expect(SRC).not.toMatch(/^\s{2}transform:\s*\{\s*type:/m)
    // 改名理由须在源码注明（反黑盒）
    expect(SRC).toContain('保留属性')
  })
})

describe('★批次 8 · 语义登记闭环', () => {
  it('catalog 有 E29 / semantic / tag，且 C1-C7 不变量全过', () => {
    const row = PRIMITIVE_CATALOG.find((p) => p.semantic === 'engineering.share-element')
    expect(row, 'catalog 应有 engineering.share-element').toBeTruthy()
    expect(row!.tag).toBe('p-share-element')
    expect(row!.status).toBe('implemented')
    expect(primitiveByTag('p-share-element')?.semantic).toBe('engineering.share-element')
    expect(auditCatalogConsistency()).toEqual([])
  })

  it('TAG_SEMANTIC_MAP + SEMANTIC_ENUM + 7 端渲染映射齐备（implemented 需 ≥3 端）', () => {
    expect(TAG_SEMANTIC_MAP['p-share-element']).toBe('engineering.share-element')
    expect(SEMANTIC_ENUM).toContain('engineering.share-element')
    const ends = Object.keys(SEMANTIC_BACKEND_MAP['engineering.share-element'] ?? {})
    expect(ends.length).toBeGreaterThanOrEqual(3)
    // 关键端语义正确性（非仅计数）
    expect(SEMANTIC_BACKEND_MAP['engineering.share-element'].skyline).toBe('share-element')
    expect(SEMANTIC_BACKEND_MAP['engineering.share-element'].flutter).toBe('Hero') // Flutter 原生等价
  })

  it('★审计别名表登记官方名 → 框架名（否则覆盖标尺误报 key/transform 为缺口）', () => {
    const audit = fs.readFileSync(path.join(ROOT, 'scripts/audit-component-attrs.mjs'), 'utf-8')
    expect(audit, "'share-element' 应映射到 p-share-element").toContain("'share-element': 'p-share-element'")
    expect(audit, 'key → shuttleKey 别名').toMatch(/key:\s*\['shuttleKey'\]/)
    expect(audit, 'transform → animate 别名').toMatch(/transform:\s*\['animate'\]/)
  })

  it('与 p-transition 语义区分（页内过渡 ≠ 页面间共享元素转场）', () => {
    expect(TAG_SEMANTIC_MAP['p-transition']).toBe('engineering.transition')
    expect(TAG_SEMANTIC_MAP['p-share-element']).toBe('engineering.share-element')
  })
})

describe('★批次 8 · Web 降级诚实性', () => {
  it('vue-dom 映射为普通容器（无宿主共享元素转场 —— 不假装能飞）', () => {
    expect(SEMANTIC_BACKEND_MAP['engineering.share-element']['vue-dom']).toBe('div.proteus-share-element')
  })

  it('组件源码须显式说明 Web 降级（反黑盒：不静默）', () => {
    expect(SRC).toContain('Web')
    expect(SRC).toMatch(/降级|普通容器/)
  })
})

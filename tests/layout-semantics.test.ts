// tests/layout-semantics.test.ts
// ★css-compat G-21 B2 数据层：Style IR → 五端 Renderer 映射表（04 + 05）
// LAYOUT_SEMANTICS_MAP / VISUAL_MAP / SEMANTIC_COMPONENTS / SKYLINE_CSS_SUPPORT + resolve 查询
import { describe, expect, it } from 'vitest'
import {
  CSS_PLATFORMS,
  SEMANTIC_COMPONENTS,
  LAYOUT_SEMANTICS,
  LAYOUT_SEMANTICS_MAP,
  VISUAL_PROPERTIES,
  VISUAL_MAP,
  SKYLINE_CSS_SUPPORT,
  resolveLayoutSemantic,
  resolveVisual,
  semanticComponentSpec,
  isSemanticComponent,
} from '@proteus-vue/css-compat/layout-semantics'

describe('LAYOUT_SEMANTICS_MAP（05 §二 布局容器映射）', () => {
  it('完整性：5 语义 × 3 端（Web / Skyline / App）全非空', () => {
    for (const sem of LAYOUT_SEMANTICS) {
      for (const p of CSS_PLATFORMS) {
        expect(LAYOUT_SEMANTICS_MAP[sem][p], `${sem}@${p}`).toBeTruthy()
      }
    }
  })

  it('★三端模型：CSS_PLATFORMS 收敛为 web/skyline/app（App = 自研引擎，不再分 iOS/Android/鸿蒙）', () => {
    expect(CSS_PLATFORMS).toEqual(['web', 'skyline', 'app'])
  })

  it('flex-row：App → 自研内核 taffy flex（不再按 iOS/Android 分列）', () => {
    expect(LAYOUT_SEMANTICS_MAP['flex-row'].app).toContain('taffy')
    expect(LAYOUT_SEMANTICS_MAP['flex-row'].app).toContain('flex')
  })

  it('scroll：Skyline → scroll-view（05 §五 裸 overflow 禁止）', () => {
    expect(LAYOUT_SEMANTICS_MAP.scroll.skyline).toContain('scroll-view')
  })
})

describe('VISUAL_MAP（05 §四 视觉映射）', () => {
  it('完整性：4 属性 × 3 端全非空', () => {
    for (const prop of VISUAL_PROPERTIES) {
      for (const p of CSS_PLATFORMS) {
        expect(VISUAL_MAP[prop][p], `${prop}@${p}`).toBeTruthy()
      }
    }
  })

  it('opacity：App → 引擎 opacity 通道；backdrop-filter 走语义组件', () => {
    expect(VISUAL_MAP.opacity.app).toContain('opacity')
    expect(VISUAL_MAP['backdrop-filter'].app).toContain('p-glass')
  })
})

describe('SEMANTIC_COMPONENTS（04 §一 语义样式组件清单）', () => {
  it('6 个组件：tag 唯一 + props 非空（设计语义命名）', () => {
    const tags = SEMANTIC_COMPONENTS.map((c) => c.tag)
    expect(new Set(tags).size).toBe(6)
    for (const c of SEMANTIC_COMPONENTS) {
      expect(c.props.length).toBeGreaterThan(0)
    }
  })

  it('props 用设计语义（blur/elevation/preset），非平台术语', () => {
    expect(SEMANTIC_COMPONENTS.find((c) => c.tag === 'p-shadow')?.props).toEqual(['elevation', 'color'])
    expect(SEMANTIC_COMPONENTS.find((c) => c.tag === 'p-glass')?.props).toEqual(['preset', 'blur'])
  })
})

describe('resolve 查询函数', () => {
  it('resolveLayoutSemantic：已知 → 端实现；未知语义 → undefined', () => {
    expect(resolveLayoutSemantic('grid', 'app')).toContain('taffy')
    expect(resolveLayoutSemantic('float', 'web')).toBeUndefined()
  })

  it('resolveVisual：已知 → 端属性；未知属性 → undefined', () => {
    expect(resolveVisual('color', 'app')).toContain('textColor')
    expect(resolveVisual('display', 'web')).toBeUndefined()
  })

  it('semanticComponentSpec / isSemanticComponent', () => {
    expect(semanticComponentSpec('p-glass')?.capability).toContain('背景模糊')
    expect(semanticComponentSpec('p-view')).toBeUndefined()
    expect(isSemanticComponent('p-sticky')).toBe(true)
    expect(isSemanticComponent('p-view')).toBe(false)
  })
})

describe('SKYLINE_CSS_SUPPORT（05 §五 Skyline 子集矩阵）', () => {
  it('float / 通用选择器 / 属性选择器在不支持清单（对齐 CSS002/004 规则）', () => {
    expect(SKYLINE_CSS_SUPPORT.unsupported).toContain('float')
    expect(SKYLINE_CSS_SUPPORT.unsupported.some((x) => x.includes('通用选择器'))).toBe(true)
    expect(SKYLINE_CSS_SUPPORT.unsupported.some((x) => x.includes('属性选择器'))).toBe(true)
  })

  it('backdrop-filter / linear-gradient 支持（04 §一 p-glass 可落地前提）', () => {
    expect(SKYLINE_CSS_SUPPORT.supported).toContain('backdrop-filter')
    expect(SKYLINE_CSS_SUPPORT.supported).toContain('linear-gradient')
  })
})

// tests/component-ir.test.ts
// ★G-31（component-semantics-plan B1）：C-IR schema + 属性约束校验 + semantic 映射
//   用例对齐 batches.md §3：grid-conflict / schema 合法非法 / CMP006 / semantic-mapping
import { describe, it, expect } from 'vitest'
import {
  validateComponentIR,
  validateGridConstraints,
  validateComponentTree,
  mapSemanticToBackend,
  SEMANTIC_BACKEND_MAP,
  TAG_SEMANTIC_MAP,
  SEMANTIC_ENUM,
  toComponentIR,
  toComponentTree,
} from '@proteus-vue/component-ir'

describe('G-31 validateComponentIR（B1 结构校验）', () => {
  it('合法 C-IR → 零诊断；非法 tag / semantic → 命中', () => {
    const ok = { tag: 'p-grid', semantic: 'layout.grid', props: { minColWidth: 160 }, children: [] }
    expect(validateComponentIR(ok)).toEqual([])
    const badTag = { tag: 'view', semantic: 'layout.grid', props: {}, children: [] }
    expect(validateComponentIR(badTag).map((d) => d.code)).toContain('CIR_INVALID_TAG') // G-31.1：view 属兼容层
    const badSemantic = { tag: 'p-grid', semantic: 'div.alias', props: {}, children: [] }
    expect(validateComponentIR(badSemantic).map((d) => d.code)).toContain('CIR_INVALID_SEMANTIC')
  })

  it('children 递归校验', () => {
    const tree = { tag: 'p-box', semantic: 'layout.box', props: {}, children: [{ tag: 'view', semantic: 'layout.box', props: {}, children: [] }] }
    expect(validateComponentIR(tree).map((d) => d.code)).toContain('CIR_INVALID_TAG')
  })

  it('★CMP006：capabilities 引用的属性缺 degradation 声明（G-31.2）', () => {
    const ir = {
      tag: 'p-scan-qr',
      semantic: 'capability.scan-qr',
      props: {},
      children: [],
      capabilities: [{ name: 'scanQR' }],
    }
    const codes = validateComponentIR(ir).map((d) => d.code)
    expect(codes).toContain('CMP006')
    // 声明 degradation 后 → 不报
    const declared = { ...ir, degradation: { scanQR: 'fallback' } }
    expect(validateComponentIR(declared).map((d) => d.code)).not.toContain('CMP006')
  })
})

describe('G-31 validateGridConstraints（B1 属性约束冲突）', () => {
  it('min-col-width × max-cols > 设计宽 → GRID_CONFLICT（max-cols 永不达，永远单列）', () => {
    const diags = validateGridConstraints({ minColWidth: 200, maxCols: 4 }, 375)
    expect(diags.map((d) => d.code)).toContain('GRID_CONFLICT') // 200×4=800 > 375
    expect(validateGridConstraints({ minColWidth: 80, maxCols: 4 }, 375)).toEqual([]) // 80×4=320 ≤ 375 ✓
    expect(validateGridConstraints({ minColWidth: 160, maxCols: 2 }, 375)).toEqual([]) // 边界 320 ≤ 375 ✓
  })

  it('validateComponentTree：递归 + 合并结构/约束诊断', () => {
    const tree = {
      tag: 'p-grid',
      semantic: 'layout.grid',
      props: { minColWidth: 200, maxCols: 4 },
      children: [{ tag: 'p-text', semantic: 'ui.text', props: {}, children: [] }],
    }
    const diags = validateComponentTree(tree, 375)
    expect(diags.map((d) => d.code)).toContain('GRID_CONFLICT')
  })
})

describe('G-31 semantic 映射（B1：Backend 消费 semantic 而非 tag）', () => {
  it('TAG_SEMANTIC_MAP：组件标签 → 语义类型', () => {
    expect(TAG_SEMANTIC_MAP['p-grid']).toBe('layout.grid')
    expect(TAG_SEMANTIC_MAP['p-stack']).toBe('layout.stack')
    expect(TAG_SEMANTIC_MAP['p-adaptive']).toBe('layout.adaptive')
    expect(TAG_SEMANTIC_MAP['p-scan-qr']).toBe('capability.scan-qr')
  })

  it('★G-31 B4：现有组件标签对齐 L1 语义（p-view/p-list-view/p-nav-bar/p-textarea/p-modal）', () => {
    expect(TAG_SEMANTIC_MAP['p-view']).toBe('layout.box')
    expect(TAG_SEMANTIC_MAP['p-list-view']).toBe('ui.list')
    expect(TAG_SEMANTIC_MAP['p-nav-bar']).toBe('ui.nav')
    expect(TAG_SEMANTIC_MAP['p-textarea']).toBe('ui.input')
    expect(TAG_SEMANTIC_MAP['p-modal']).toBe('layout.adaptive')
  })

  it('★G-31 B4：Fluid 扩展语义（p-split/p-safe/p-sidebar）→ layout.split/safe/sidebar 五端映射', () => {
    expect(TAG_SEMANTIC_MAP['p-split']).toBe('layout.split')
    expect(TAG_SEMANTIC_MAP['p-safe']).toBe('layout.safe')
    expect(TAG_SEMANTIC_MAP['p-sidebar']).toBe('layout.sidebar')
    // 五端映射
    expect(mapSemanticToBackend('layout.split', 'native-ios')).toBe('UISplitViewController')
    expect(mapSemanticToBackend('layout.split', 'native-android')).toBe('SlidingPaneLayout')
    expect(mapSemanticToBackend('layout.split', 'native-harmony')).toBe('SideBarContainer')
    expect(mapSemanticToBackend('layout.safe', 'native-android')).toBe('WindowInsets')
    expect(mapSemanticToBackend('layout.safe', 'native-harmony')).toBe('getAvoidArea')
    expect(mapSemanticToBackend('layout.sidebar', 'vue-dom')).toBe('div.sidebar')
  })

  it('mapSemanticToBackend：同一 semantic 在不同后端得到不同原生控件（语义收敛 + 后端实现）', () => {
    expect(mapSemanticToBackend('layout.grid', 'native-ios')).toBe('UICollectionView')
    expect(mapSemanticToBackend('layout.grid', 'native-android')).toBe('GridLayoutManager')
    expect(mapSemanticToBackend('layout.grid', 'native-harmony')).toBe('Grid')
    expect(mapSemanticToBackend('layout.grid', 'skyline')).toBe('grid') // 微信小程序原生 grid 组件
    expect(mapSemanticToBackend('layout.grid', 'flutter')).toBe('GridView')
    expect(mapSemanticToBackend('layout.grid', 'vue-dom')).toBe('div.grid')
    expect(mapSemanticToBackend('layout.adaptive', 'native-android')).toBe('BottomSheetDialog')
    expect(mapSemanticToBackend('ui.text', 'native-harmony')).toBe('Text')
    expect(mapSemanticToBackend('capability.scan-qr', 'skyline')).toBe('wx.scanCode')
    expect(mapSemanticToBackend('layout.grid', 'headless')).toBe('grid')
    expect(mapSemanticToBackend('unknown.semantic', 'vue-dom')).toBeNull()
  })

  it('SEMANTIC_BACKEND_MAP 覆盖 15 语义枚举（G-31 §3 组件清单）', () => {
    for (const s of SEMANTIC_ENUM) {
      expect(SEMANTIC_BACKEND_MAP[s], `缺 ${s} 映射`).toBeDefined()
    }
  })
})

describe('G-31 toComponentIR（B2：模板标签 → C-IR 转换器）', () => {
  it('p-* 语义组件 → C-IR（semantic 字段）；props 透传', () => {
    const ir = toComponentIR('p-grid', { minColWidth: 160, maxCols: 4 })
    expect(ir).toEqual({ tag: 'p-grid', semantic: 'layout.grid', props: { minColWidth: 160, maxCols: 4 }, children: [] })
    expect(toComponentIR('p-adaptive', {}, []))?.toMatchObject({ semantic: 'layout.adaptive' })
    expect(toComponentIR('p-button', {})).toMatchObject({ semantic: 'ui.button' })
  })

  it('非 p- 标签（view/text 等小程序标签）→ null（Layer 1 兼容层不产生 Layer 0 C-IR）', () => {
    expect(toComponentIR('view', {})).toBeNull()
    expect(toComponentIR('text', {})).toBeNull()
    expect(toComponentIR('scroll-view', {})).toBeNull()
    expect(toComponentIR('unknown-p-tag', {})).toBeNull() // 未知 p- 标签不臆造语义
  })

  it('toComponentTree：递归转换，兼容层子节点丢弃', () => {
    const tree = toComponentTree('p-grid', { minColWidth: 160 }, [
      { tag: 'p-text', props: { variant: 'h1' }, children: [] },
      { tag: 'view', props: {}, children: [] }, // 兼容层标签丢弃
    ])
    expect(tree).toMatchObject({ semantic: 'layout.grid' })
    expect(tree?.children).toHaveLength(1)
    expect(tree?.children[0]).toMatchObject({ tag: 'p-text', semantic: 'ui.text' })
  })
})

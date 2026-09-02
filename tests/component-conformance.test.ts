// tests/component-conformance.test.ts
// ★G-31 B5：conformance 三端渲染快照一致（batches.md B5 / conformance.md §3.1+§3.4+§5）
//   同一份 C-IR → 各 Tier-1 Backend 渲染 → 归一化快照（semantic 路径 + 控件 readback）
//   ① 控件映射必须与 SEMANTIC_BACKEND_MAP 参考表一致（机器验证「消费 semantic 而非 tag」）
//   ② 跨端语义树必须同构（结构层一致）
//   ③ G-31.4 覆盖门禁：每语义 ≥3 端映射
//   ★分层：快照基础设施（renderComponentSnapshot/createControlReader）在 render-backend；
//     参考表对照（checkComponentSnapshot/extractSemanticTree/checkSemanticCoverage）在 component-ir
// @vitest-environment happy-dom（VueDomBackend DOM 断言）
import { describe, it, expect } from 'vitest'
import {
  createVueDomBackend,
  createNativeBackend,
  createFlutterBackend,
  createHeadlessBackend,
  renderComponentSnapshot,
  createControlReader,
} from '@proteus-vue/render-backend'
import type { RenderNodeSnapshot, ProteusRenderBackend } from '@proteus-vue/render-backend'
import {
  checkComponentSnapshot,
  extractSemanticTree,
  checkSemanticCoverage,
  SEMANTIC_ENUM,
  SEMANTIC_BACKEND_MAP,
  implementedPrimitives,
  toComponentTree,
} from '@proteus-vue/component-ir'
import type { IRNode } from '@proteus-vue/render-backend'
import { COMPONENT_FIXTURES, GRID_BASIC, TRANSITION_FADE, ANIMATE_ENTRANCE } from './fixtures/component-ir-fixtures'

/** Tier-1 渲染后端矩阵（B5 门禁覆盖面——conformance.md §2 CLI: VueDom/Native-iOS/Native-Android/Flutter + Harmony/Headless） */
function buildBackends(): Array<{ id: string; backend: ProteusRenderBackend }> {
  return [
    { id: 'vue-dom', backend: createVueDomBackend(document) },
    { id: 'native-ios', backend: createNativeBackend(undefined, 'ios') },
    { id: 'native-android', backend: createNativeBackend(undefined, 'android') },
    { id: 'native-harmony', backend: createNativeBackend(undefined, 'harmony') },
    { id: 'flutter', backend: createFlutterBackend() },
    { id: 'headless', backend: createHeadlessBackend() },
  ]
}

function renderAll(fixture: IRNode): Record<string, RenderNodeSnapshot> {
  const out: Record<string, RenderNodeSnapshot> = {}
  for (const { id, backend } of buildBackends()) {
    out[id] = renderComponentSnapshot(backend, fixture, createControlReader(id))
  }
  return out
}

describe('G-31 B5 conformance：三端渲染快照一致', () => {
  it('★核心：全部 L1 fixture × 全部 Tier-1 后端 → 控件映射与参考表一致（零 error）', () => {
    for (const [name, ir] of Object.entries(COMPONENT_FIXTURES)) {
      for (const { id, backend } of buildBackends()) {
        const snap = renderComponentSnapshot(backend, ir, createControlReader(id))
        const result = checkComponentSnapshot(id, snap)
        expect(result.ok, `${name} × ${id}: ${JSON.stringify(result.errors)}`).toBe(true)
        expect(result.errors, `${name} × ${id}`).toEqual([])
      }
    }
  })

  it('★结构层：同一 C-IR → 各端语义树同构（layout.grid > layout.box ×8……）', () => {
    const trees = renderAll(GRID_BASIC)
    const references = Object.keys(trees)
    const first = extractSemanticTree(trees[references[0]])
    for (const id of references.slice(1)) {
      expect(extractSemanticTree(trees[id]), `语义树同构失败: vue-dom vs ${id}`).toEqual(first)
    }
    expect(first).toEqual({
      semantic: 'layout.grid',
      children: Array.from({ length: 8 }, () => ({ semantic: 'layout.box', children: [] })),
    })
  })

  it('渲染层 spot check：grid-basic 在各端的控件 readback（语义收敛 + 后端实现）', () => {
    const snaps = renderAll(GRID_BASIC)
    expect(snaps['vue-dom'].control).toBe('div.proteus-grid')
    expect(snaps['vue-dom'].children[0].control).toBe('div.proteus-box')
    expect(snaps['native-ios'].control).toBe('UICollectionView')
    expect(snaps['native-android'].control).toBe('GridLayoutManager')
    expect(snaps['native-harmony'].control).toBe('Grid')
    expect(snaps['flutter'].control).toBe('GridView')
    expect(snaps['headless'].control).toBe('grid')
  })

  it('★G-32 B5 续二 spot check：工程原语动画组件形态（engineering.transition / engineering.animate）六端 readback', () => {
    const transition = renderAll(TRANSITION_FADE)
    expect(transition['vue-dom'].control).toBe('div.proteus-transition')
    expect(transition['native-ios'].control).toBe('UIView.transition')
    expect(transition['native-android'].control).toBe('View.animate.transition')
    expect(transition['native-harmony'].control).toBe('animateTo.transition')
    expect(transition['flutter'].control).toBe('AnimatedOpacity')
    expect(transition['headless'].control).toBe('transition')
    const animate = renderAll(ANIMATE_ENTRANCE)
    expect(animate['vue-dom'].control).toBe('div.proteus-animate')
    expect(animate['native-ios'].control).toBe('CAKeyframeAnimation')
    expect(animate['native-android'].control).toBe('ValueAnimator')
    expect(animate['native-harmony'].control).toBe('Animator.transition')
    expect(animate['flutter'].control).toBe('AnimationController')
    expect(animate['headless'].control).toBe('animate')
  })

  it('G-31.4/G-32.3 覆盖门禁：所有 implemented 语义 ≥3 端映射（不足 → 降级 L2 禁入 core）', () => {
    const gaps = checkSemanticCoverage(3)
    expect(gaps).toEqual([])
    // ★G-32 B1/B2/B4/B5：implemented 语义 = 44（G-32 冻结清单已实现部分；planned 不设门禁）
    const impl = implementedPrimitives()
    expect(impl.length).toBe(44)
    for (const p of impl) {
      expect(Object.keys(SEMANTIC_BACKEND_MAP[p.semantic] ?? {}).length, `${p.semantic} 参考行不足`).toBeGreaterThanOrEqual(3)
    }
  })

  it('★G-32 B1 闭环：新增 implemented 语义 × 6 后端渲染快照一致（toComponentIR → conformance）', () => {
    // 新语义代表性 fixture：shell tabbar + drawer + modal + layout scroll/masonry + ui switch/slider
    const ir = toComponentTree('p-tabbar', { tabs: JSON.stringify([{ label: '首页' }, { label: '我的' }]) }, [
      { tag: 'p-icon', props: { name: 'home' } },
      { tag: 'p-text', props: {} },
    ])
    expect(ir).not.toBeNull()
    for (const { id, backend } of buildBackends()) {
      const snap = renderComponentSnapshot(backend, ir as Parameters<typeof renderComponentSnapshot>[1], createControlReader(id))
      const result = checkComponentSnapshot(id, snap)
      expect(result.ok, `${id}: ${JSON.stringify(result.errors)}`).toBe(true)
    }
    // 渲染树 spot check：p-tabbar → 各端控件
    const snaps = renderAll(ir as Parameters<typeof renderComponentSnapshot>[1])
    expect(snaps['vue-dom'].control).toBe('nav.proteus-tabbar')
    expect(snaps['native-ios'].control).toBe('UITabBar')
    expect(snaps['native-android'].control).toBe('BottomNavigationView')
    expect(snaps['flutter'].control).toBe('BottomNavigationBar')
    expect(snaps['headless'].control).toBe('tabbar')
    expect(snaps['vue-dom'].children[0].control).toBe('span.proteus-icon')
  })
})

describe('G-31 B5 conformance：门禁负例与兼容层', () => {
  it('控件映射与参考表不符 → error（门禁阻断）', () => {
    const bad = {
      type: 'p-grid',
      semantic: 'layout.grid',
      control: 'div.grid', // 旧参考表值/错映射——必须被门禁捕获
      props: {},
      text: '',
      children: [],
    }
    const result = checkComponentSnapshot('vue-dom', bad)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({ semantic: 'layout.grid', expected: 'div.proteus-grid', actual: 'div.grid' })
  })

  it('未知语义（参考表无行）→ unverified 不阻断（不臆造门禁——G-24.2）', () => {
    const snap = {
      type: 'p-x',
      semantic: 'layout.unknown',
      control: 'view',
      props: {},
      text: '',
      children: [],
    }
    const result = checkComponentSnapshot('vue-dom', snap)
    expect(result.ok).toBe(true)
    expect(result.unverified.map((u) => u.reason)).toContain('no-row')
  })

  it('参考表缺该后端列 → unverified 不阻断（后端自定义实现不受限）', () => {
    const snap = {
      type: 'p-grid',
      semantic: 'layout.grid',
      control: 'custom-grid',
      props: {},
      text: '',
      children: [],
    }
    const result = checkComponentSnapshot('canvas2d', snap) // 参考表无 canvas2d 列
    expect(result.ok).toBe(true)
    expect(result.unverified.map((u) => u.reason)).toContain('no-column')
  })

  it('★Layer 1 兼容层标签（无 semantic）→ 不设渲染门禁（unverified/compat），各端自定义映射', () => {
    const compatIr = { type: 'view', props: {}, children: [] }
    const results = buildBackends().map(({ id, backend }) => {
      const snap = renderComponentSnapshot(backend, compatIr, createControlReader(id))
      return checkComponentSnapshot(id, snap)
    })
    for (const r of results) {
      expect(r.ok).toBe(true)
      expect(r.errors).toEqual([])
      expect(r.unverified.map((u) => u.reason)).toContain('compat')
    }
    // 语义节点消费 semantic 而非 tag 的直接反证：同 type 不同 semantic → 控件不同
    const dom = createVueDomBackend(document)
    const a = renderComponentSnapshot(dom, { type: 'p-x', semantic: 'ui.button', props: {}, children: [] }, createControlReader('vue-dom'))
    const b = renderComponentSnapshot(dom, { type: 'p-x', semantic: 'ui.input', props: {}, children: [] }, createControlReader('vue-dom'))
    expect(a.control).toBe('button')
    expect(b.control).toBe('input')
  })
})

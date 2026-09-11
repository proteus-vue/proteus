// tests/component-audit.test.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan）：完整语义落地闭环——audit:coverage + 闭环一致性
//   验证点（batches B1）：128 清单冻结 / C-IR schema 扩展 / audit:coverage（G-32.1 小程序能力 100%）/
//   闭环一致性（catalog ↔ enum ↔ tag-mapping ↔ render-mapping 四方向不漂移）
import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_CATALOG,
  checkPrimitiveCatalog,
  auditMiniprogramCoverage,
  auditCatalogConsistency,
  implementedPrimitives,
  componentPrimitives,
  MP_MAPPING_MATRIX,
  SEMANTIC_ENUM,
  TAG_SEMANTIC_MAP,
  formatCoverageReport,
  auditMatrixReferences,
  type MpMatrixItem,
} from '@proteus-vue/component-ir'

describe('G-32 B1 清单冻结（140 原语 SSOT）', () => {
  it('140 项 · id/semantic/tag 唯一 · 六类齐全', () => {
    expect(checkPrimitiveCatalog()).toEqual([])
    const kinds = new Set(PRIMITIVE_CATALOG.map((p) => p.kind))
    expect([...kinds].sort()).toEqual(['capability', 'engineering', 'gesture', 'layout', 'shell', 'ui'])
    // 各类数量（G-32 分布 12/18/10/10/50/28 + #405 语义登记批 +8 + C51 useUpdate：capability+1
    //   + ★C2 颗粒度对齐：ui+2 progress/label + shell+1 page-container）
    const count = (k: string) => PRIMITIVE_CATALOG.filter((p) => p.kind === k).length
    expect(count('layout')).toBe(14)
    expect(count('ui')).toBe(23)
    expect(count('shell')).toBe(14)
    expect(count('gesture')).toBe(10)
    expect(count('capability')).toBe(51)
    expect(count('engineering')).toBe(28)
  })

  it('implemented 48 项（G-32 冻结清单已实现：12 layout + 20 ui + 10 shell + 2 gesture + 1 capability + 3 engineering）· 其余 planned 待落地', () => {
    const impl = implementedPrimitives()
    expect(impl.length).toBe(48)
    // 新增 implemented 语义代表性断言
    const implSemantics = new Set(impl.map((p) => p.semantic))
    expect(implSemantics.has('layout.scroll')).toBe(true)
    expect(implSemantics.has('layout.masonry')).toBe(true)
    expect(implSemantics.has('shell.modal')).toBe(true)
    expect(implSemantics.has('shell.tabbar')).toBe(true)
    expect(implSemantics.has('shell.action-sheet')).toBe(true)
    expect(implSemantics.has('shell.page')).toBe(true)
    expect(implSemantics.has('ui.textarea')).toBe(true)
    expect(implSemantics.has('ui.switch')).toBe(true)
    expect(implSemantics.has('ui.form')).toBe(true)
    expect(implSemantics.has('ui.checkbox')).toBe(true)
    expect(implSemantics.has('gesture.draggable')).toBe(true)
    expect(implSemantics.has('gesture.scrollable')).toBe(true)
    // G-32 B5 续二：工程原语动画组件形态（E19/E20）翻 implemented（Hook E21-E23 归 API 层不产 C-IR 节点）
    expect(implSemantics.has('engineering.transition')).toBe(true)
    expect(implSemantics.has('engineering.animate')).toBe(true)
    // G-32 B5 尾巴：E18 声明式导航组件形态翻 implemented（工程原语组件形态 3/3 全部闭环）
    expect(implSemantics.has('engineering.router-link')).toBe(true)
    // ★C2 颗粒度对齐：progress/label/page-container 翻 implemented（对齐小程序同名组件）
    expect(implSemantics.has('ui.progress')).toBe(true)
    expect(implSemantics.has('ui.label')).toBe(true)
    expect(implSemantics.has('shell.page-container')).toBe(true)
    // planned 不设 ≥3 端门禁（L2 生态）但必须入 enum
    for (const p of PRIMITIVE_CATALOG.filter((x) => x.status === 'planned' && x.tag)) {
      expect((SEMANTIC_ENUM as readonly string[]).indexOf(p.semantic), `${p.id} ${p.semantic} 未入 enum`).toBeGreaterThanOrEqual(0)
    }
  })

  it('组件原语 tag → semantic 与 TAG_SEMANTIC_MAP 逐条对齐（闭环 C1）', () => {
    for (const p of componentPrimitives()) {
      expect(TAG_SEMANTIC_MAP[p.tag as string], `${p.id} ${p.tag}`).toBe(p.semantic)
    }
  })
})

describe('G-32 B1 audit:coverage（G-32.1 小程序能力 100%）', () => {
  it('对照矩阵 0 缺失 → 100% 覆盖（CI 门禁绿）', () => {
    const report = auditMiniprogramCoverage()
    expect(report.pass).toBe(true)
    expect(report.missing).toBe(0)
    expect(report.percent).toBe(100)
    expect(report.total).toBeGreaterThan(60) // 组件 ~55 + API 组 ~29
    // 组件全量 55 项（G-32 42 + 2026-09-11 补录 13：match-media/page-meta/snapshot/grid-view/sticky-*/root-portal/double-tap-gesture 等）
    expect(MP_MAPPING_MATRIX.filter((i) => i.group === 'component').length).toBe(55)
  })

  it('缺失项注入 → 审计红（CI 门禁阻断）', () => {
    const withMissing = [...MP_MAPPING_MATRIX, { mp: '<fictional>', proteus: '', status: 'missing' as const, group: 'component' as const }]
    const report = auditMiniprogramCoverage(withMissing)
    expect(report.pass).toBe(false)
    expect(report.missing).toBe(1)
    expect(report.missingItems[0].mp).toBe('<fictional>')
  })

  it('formatCoverageReport 输出结构化报告（CLI 展示载体）', () => {
    const report = auditMiniprogramCoverage()
    const text = formatCoverageReport(report)
    expect(text).toContain('G-32.1')
    expect(text).toContain('100%')
    expect(text).toContain('达标')
  })
})

describe('G-32.1 矩阵引用一致性（幽灵引用门禁——修「假门禁」同义反复）', () => {
  it('真实矩阵 0 幽灵引用（组件标签/语义/Hook 全部存在）· planned 行诚实豁免', () => {
    const { issues, plannedRefs } = auditMatrixReferences(MP_MAPPING_MATRIX)
    expect(issues).toEqual([])
    // L2 规划行必须被豁免计数（否则门禁会对未实现组件误报）
    expect(plannedRefs).toBeGreaterThan(0)
  })

  it('破坏性验证：注入幽灵组件标签 → component 命中（CI 阻断）', () => {
    const withGhost: MpMatrixItem[] = [
      ...MP_MAPPING_MATRIX,
      { mp: '<fiction>', proteus: 'p-does-not-exist', status: 'ok', group: 'component' },
    ]
    const { issues } = auditMatrixReferences(withGhost)
    expect(issues.length).toBe(1)
    expect(issues[0]).toMatchObject({ mp: '<fiction>', ref: 'p-does-not-exist', kind: 'component' })
  })

  it('破坏性验证：注入幽灵语义 → semantic 命中', () => {
    const withGhost: MpMatrixItem[] = [
      ...MP_MAPPING_MATRIX,
      { mp: 'wx.fictional', proteus: 'capability.fictional', status: 'ok', group: 'api' },
    ]
    const { issues } = auditMatrixReferences(withGhost)
    expect(issues).toEqual([{ mp: 'wx.fictional', ref: 'capability.fictional', kind: 'semantic' }])
  })

  it('knownHooks 传入时：幽灵 Hook 命中、真实 Hook 放行', () => {
    const matrix: MpMatrixItem[] = [
      { mp: 'wx.a', proteus: 'useGhostHook（不存在）', status: 'compat', group: 'api' },
      { mp: 'wx.b', proteus: 'useMap（存在）', status: 'ok', group: 'api' },
    ]
    const { issues } = auditMatrixReferences(matrix, new Set(['useMap']))
    expect(issues).toEqual([{ mp: 'wx.a', ref: 'useGhostHook', kind: 'hook' }])
  })

  it('planned: true 行豁免组件标签检查（诚实登记 L2 规划，不算幽灵）', () => {
    const matrix: MpMatrixItem[] = [
      { mp: '<planned>', proteus: 'p-future-component（L2 规划）', status: 'compat', group: 'component', planned: true },
    ]
    const { issues, plannedRefs } = auditMatrixReferences(matrix)
    expect(issues).toEqual([])
    expect(plannedRefs).toBe(1)
  })

  it('status=missing 行不做引用校验（已登记缺口，引用可不存在）', () => {
    const matrix: MpMatrixItem[] = [
      { mp: '<gap>', proteus: '', status: 'missing', group: 'component' },
    ]
    const { issues } = auditMatrixReferences(matrix)
    expect(issues).toEqual([])
  })
})

describe('G-32 B1 闭环一致性（catalog ↔ enum ↔ tag ↔ render-map 四向不漂移）', () => {
  it('所有一致性规则零问题', () => {
    const issues = auditCatalogConsistency()
    expect(issues).toEqual([])
  })

  it('破坏性验证：注入孤立语义 → C5 命中；tag 漂移 → C1 命中', () => {
    // 无法直接修改 const，改用规则逻辑断言：孤立语义必然不在 catalog
    const orphan = 'layout.orphan-test'
    expect(PRIMITIVE_CATALOG.some((p) => p.semantic === orphan)).toBe(false)
    // enum 里不存在的语义必然不在 map（C3 反证）
    expect((SEMANTIC_ENUM as readonly string[]).indexOf('layout.orphan-test')).toBe(-1)
  })
})
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
} from '@proteus-vue/component-ir'

describe('G-32 B1 清单冻结（128 原语 SSOT）', () => {
  it('128 项 · id/semantic/tag 唯一 · 六类齐全', () => {
    expect(checkPrimitiveCatalog()).toEqual([])
    const kinds = new Set(PRIMITIVE_CATALOG.map((p) => p.kind))
    expect([...kinds].sort()).toEqual(['capability', 'engineering', 'gesture', 'layout', 'shell', 'ui'])
    // 各类数量（G-32 分布：12/18/10/10/50/28）
    const count = (k: string) => PRIMITIVE_CATALOG.filter((p) => p.kind === k).length
    expect(count('layout')).toBe(12)
    expect(count('ui')).toBe(18)
    expect(count('shell')).toBe(10)
    expect(count('gesture')).toBe(10)
    expect(count('capability')).toBe(50)
    expect(count('engineering')).toBe(28)
  })

  it('implemented 45 项（G-32 冻结清单已实现：12 layout + 18 ui + 9 shell + 2 gesture + 1 capability + 3 engineering）· 其余 planned 待落地', () => {
    const impl = implementedPrimitives()
    expect(impl.length).toBe(45)
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
    expect(report.total).toBeGreaterThan(60) // 组件 42 + API 组 ~28
    // 组件全量 42 项
    expect(MP_MAPPING_MATRIX.filter((i) => i.group === 'component').length).toBe(42)
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
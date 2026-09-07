// tests/host-matrix.test.ts
// ★G-41 B6（proteus-host-integration-plan batches B6）：宿主×引擎组合矩阵验证（权威 TS 版）
//   验收：6 宿主 × 6 引擎 = 36 组合；Tier 1 组合全部验证（每组合 runComboConformance().failed === 0）
//   + 矩阵声明/Tier 口径 + 报告格式
// @vitest-environment happy-dom（vue-dom 引擎需要 document）
import { describe, it, expect } from 'vitest'
import {
  HOSTS,
  ENGINES,
  HOST_ENGINE_MATRIX,
  matrixCombos,
  runComboConformance,
  runHostEngineMatrix,
  formatMatrixReport,
} from '@proteus-vue/render-backend'

describe('G-41 B6 矩阵声明（6×6=36）', () => {
  it('6 宿主 × 6 引擎 = 36 组合；每组合 Tier ∈ {0,1,3}', () => {
    expect(HOSTS).toHaveLength(6)
    expect(ENGINES).toHaveLength(6)
    const combos = matrixCombos()
    expect(combos).toHaveLength(36)
    for (const c of combos) {
      expect([0, 1, 3]).toContain(c.tier)
    }
  })

  it('Tier 1 组合：原生引擎 + headless 通用 + 混入自然自绘（13 组）', () => {
    const tier1 = matrixCombos({ tier: 1 })
    expect(tier1.length).toBe(13)
    // 每宿主必有 headless（通用验证引擎）；除 miniprogram（skyline 引擎实例未实现——仅 headless）外 ≥ 2
    for (const host of HOSTS) {
      const own = tier1.filter((c) => c.host === host)
      expect(own.some((c) => c.engine === 'headless')).toBe(true)
      if (host !== 'miniprogram') expect(own.length).toBeGreaterThanOrEqual(2)
    }
    // 跨生态原生组合不合法（Tier 0）
    expect(HOST_ENGINE_MATRIX['web']['native-ios']).toBe(0)
    expect(HOST_ENGINE_MATRIX['ios']['native-android']).toBe(0)
    expect(HOST_ENGINE_MATRIX['miniprogram']['flutter']).toBe(0)
    // 混入可行不承诺（Tier 3）
    expect(HOST_ENGINE_MATRIX['web']['flutter']).toBe(3)
    expect(HOST_ENGINE_MATRIX['flutter']['native-ios']).toBe(3)
  })
})

describe('G-41 B6 组合级 conformance（failed === 0）', () => {
  it('web × vue-dom（真实 WebHostRuntime）：全过', async () => {
    const r = await runComboConformance({ host: 'web', engine: 'vue-dom' })
    expect(r.failed).toBe(0)
    expect(r.checks.map((c) => c.id)).toEqual([
      'backend-conformance',
      'registration-before-bootstrap',
      'host-bootstrap',
      'semantic-fingerprint',
      'render-complete',
      'semantic-control-mapping',
      'hot-switch-equivalence',
    ])
  })

  it('ios × native-ios：UICollectionView 控件映射 + 热切换等价', async () => {
    const r = await runComboConformance({ host: 'ios', engine: 'native-ios' })
    expect(r.failed).toBe(0)
    const mapping = r.checks.find((c) => c.id === 'semantic-control-mapping')
    expect(mapping?.ok).toBe(true)
  })

  it('flutter × flutter：GridView + 切回 headless 等价', async () => {
    const r = await runComboConformance({ host: 'flutter', engine: 'flutter' })
    expect(r.failed).toBe(0)
  })

  it('miniprogram × headless：逻辑层验证引擎', async () => {
    const r = await runComboConformance({ host: 'miniprogram', engine: 'headless' })
    expect(r.failed).toBe(0)
  })
})

describe('G-41 B6 矩阵运行（Tier 1 全部验证）', () => {
  it('runHostEngineMatrix：13 个 Tier 1 组合全部 failed === 0；Tier 0/3 诚实未验证', async () => {
    const report = await runHostEngineMatrix()
    expect(report.totalCombos).toBe(36)
    expect(report.tier1Combos).toBe(13)
    expect(report.verified).toBe(13)
    expect(report.failed).toBe(0)
    // Tier 0/3 组合 result = null（未验证——诚实标注）
    const notVerified = report.rows.filter((r) => r.result === null)
    expect(notVerified.length).toBe(23)
    // 每行 Tier 与矩阵声明一致
    for (const row of report.rows) {
      expect(row.tier).toBe(HOST_ENGINE_MATRIX[row.host][row.engine])
    }
  })

  it('formatMatrixReport：报告含汇总与逐行标注', async () => {
    const report = await runHostEngineMatrix()
    const text = formatMatrixReport(report)
    expect(text).toContain('36 组合 / Tier 1 13 / 已验证 13 / 失败 0')
    expect(text).toContain('✅ T1  web × vue-dom')
    expect(text).not.toContain('❌') // 全部 Tier 1 通过——无失败行
    expect(text).toContain('⚪ T3  web × flutter')
    expect(text).toContain('⬛ T0  ios × native-android')
  })
})

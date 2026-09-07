// tests/host-conformance.test.ts
// ★G-41 B2（proteus-host-integration-plan batches B2）：Host Conformance 套件（H-01~H-08 共 32 项）权威 TS 版
//   验收：runHostConformance() → PASS=32 FAIL=0（CMP058：failed=0 才允许上线）
//   消费：B1 ProteusNodeOpsDispatcher + 仓库正式后端（Headless/Flutter）+ G-39/G-40 stub
import { describe, it, expect } from 'vitest'
import {
  runHostConformance,
  formatHostConformance,
  createHostRuntimeStub,
  createCarrierStub,
} from '@proteus-vue/render-backend'

describe('G-41 B2 Host Conformance（H-01~H-08，32 项）', () => {
  it('缺省配置全绿：PASS=32 FAIL=0（CMP058 上线门禁）', () => {
    const s = runHostConformance()
    expect(s.total).toBe(32)
    expect(s.fail).toBe(0)
    expect(s.pass).toBe(32)
    expect(s.skip).toBe(0)
  })

  it('各组齐全：H-01~H-08 每组的 ID 都出现且 PASS', () => {
    const s = runHostConformance()
    const ids = s.results.map((r) => r.id)
    for (const g of ['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'H-07', 'H-08']) {
      const group = ids.filter((id) => id.startsWith(g))
      expect(group.length).toBeGreaterThan(0)
      for (const id of group) {
        const r = s.results.find((x) => x.id === id)
        expect(r?.status).toBe('PASS')
      }
    }
  })

  it('H-03 引擎可切换组是验收核心（跨层组合正确性）', () => {
    const s = runHostConformance({ only: 'H-03' })
    expect(s.total).toBe(4)
    expect(s.fail).toBe(0)
    // H-03-04（IR 快照一致机器证据）
    const h0304 = s.results.find((r) => r.id === 'H-03-04')
    expect(h0304?.status).toBe('PASS')
  })

  it('only 过滤只跑指定组', () => {
    const s = runHostConformance({ only: 'H-07' })
    expect(s.total).toBe(4)
    expect(s.results.every((r) => r.id.startsWith('H-07'))).toBe(true)
  })

  it('注入自定义 host/carrier 仍正确（真实宿主接入路径）', () => {
    const host = createHostRuntimeStub()
    const carrier = createCarrierStub('aot')
    // 注入自定义 AOT 载体 + 自定义 host —— 验证注入路径被消费（H-01/H-07 组读注入对象）
    const s = runHostConformance({ host, carrier, only: 'H-07' })
    expect(s.total).toBe(4)
    expect(s.fail).toBe(0)
    // H-07-02：AOT 载体注入后 trueConcurrency=true（读注入的 carrier 而非缺省 JSI）
    const h0702 = s.results.find((r) => r.id === 'H-07-02')
    expect(h0702?.status).toBe('PASS')
  })

  it('formatHostConformance 输出可读报告（含 CMP058 门禁注记）', () => {
    const s = runHostConformance()
    const text = formatHostConformance(s)
    expect(text).toContain('PASS=32 FAIL=0')
    expect(text).toContain('H-03-04')
    expect(text).toContain('CMP058')
  })
})
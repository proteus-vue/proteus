// packages/test-ir/src/conformance-runner.ts
// ★G-44 B1：ConformanceRunner（统一汇总——七套 conformance 首次可由一个 runner 产出一份报告）
import type { ProteusTestBackend, SuiteReport, TestIR, TestReport } from './types'

export class ConformanceRunner {
  private readonly backends: ProteusTestBackend[]

  constructor(backends: ProteusTestBackend[]) {
    this.backends = backends
  }

  /** 逐后端筛选兼容用例执行（ir.backend 指定优先；supports 能力门控） */
  async runSuite(suite: TestIR[]): Promise<SuiteReport> {
    const reports: TestReport[] = []
    for (const b of this.backends) {
      const compatible = suite.filter((ir) => {
        if (ir.backend && ir.backend !== b.id) return false
        return b.supports(ir)
      })
      for (const ir of compatible) {
        reports.push(await b.run(ir, {}))
      }
    }
    return this.merge(reports)
  }

  /** 跨后端汇总（byBackend 分布——G-44.4 多后端覆盖统计） */
  merge(reports: TestReport[]): SuiteReport {
    const byBackend: Record<string, number> = {}
    let pass = 0
    let fail = 0
    for (const r of reports) {
      byBackend[r.backend] = (byBackend[r.backend] ?? 0) + (r.status === 'pass' ? 1 : 0)
      if (r.status === 'pass') pass++
      else fail++
    }
    return { total: reports.length, pass, fail, byBackend, reports }
  }
}

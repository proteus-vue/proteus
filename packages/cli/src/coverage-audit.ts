// packages/cli/src/coverage-audit.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan §12 B1 + miniprogram-mapping §5）：audit:coverage 工具
//   proteus audit coverage —— G-32.1 门禁：小程序官方能力 100% 覆盖 + 闭环一致性
import { auditMiniprogramCoverage, auditCatalogConsistency, formatCoverageReport, checkPrimitiveCatalog } from '@proteus-vue/component-ir'

export function runCoverageAudit(): { ok: boolean; text: string } {
  const lines: string[] = []
  let ok = true

  // ① 清单冻结自检（128 项 / 唯一性）
  const catalogIssues = checkPrimitiveCatalog()
  if (catalogIssues.length) {
    ok = false
    lines.push('清单自检 ❌')
    for (const i of catalogIssues) lines.push(`  ✗ ${i}`)
  } else {
    lines.push('清单自检 ✅ 128 项 · id/semantic/tag 唯一')
  }

  // ② 小程序能力覆盖（G-32.1：缺失 > 0 → CI 红）
  const report = auditMiniprogramCoverage()
  lines.push(formatCoverageReport(report))
  if (!report.pass) ok = false

  // ③ 闭环一致性（catalog ↔ enum ↔ tag ↔ render-map）
  const issues = auditCatalogConsistency()
  if (issues.length) {
    ok = false
    lines.push('闭环一致性 ❌')
    for (const i of issues) lines.push(`  ✗ ${i.rule}: ${i.detail}`)
  } else {
    lines.push('闭环一致性 ✅ catalog ↔ SEMANTIC_ENUM ↔ TAG_SEMANTIC_MAP ↔ SEMANTIC_BACKEND_MAP 四向一致')
  }

  lines.push(ok ? '★ G-32.1 audit:coverage 通过（100% 覆盖 + 闭环一致，可进入 CI 门禁）' : '✗ audit:coverage 未通过（G-32.1 CI 红）')
  return { ok, text: lines.join('\n') }
}
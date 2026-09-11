// packages/cli/src/coverage-audit.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan §12 B1 + miniprogram-mapping §5）：audit:coverage 工具
//   proteus audit coverage —— G-32.1 门禁：小程序官方能力 100% 覆盖 + 闭环一致性
import { auditMiniprogramCoverage, auditMatrixReferences, auditCatalogConsistency, formatCoverageReport, checkPrimitiveCatalog, PRIMITIVE_CATALOG, MP_MAPPING_MATRIX } from '@proteus-vue/component-ir'

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
    lines.push(`清单自检 ✅ ${PRIMITIVE_CATALOG.length} 项 · id/semantic/tag 唯一`)
  }

  // ② 小程序能力覆盖（G-32.1：缺失 > 0 → CI 红）
  const report = auditMiniprogramCoverage()
  lines.push(formatCoverageReport(report))
  if (!report.pass) ok = false

  // ②-b ★矩阵引用一致性（2026-09-11 修「假门禁」）：proteus 列引用的 token 必须真实存在，
  //   否则「幽灵引用」（旧矩阵把未实现的 p-overlay/p-progress、不存在的 capability.fetch 标为 ok/compat →
  //   覆盖率自证同义反复）。planned / missing 行豁免（诚实登记 L2 规划与已知缺口）。
  // Hook 级引用检查需 @proteus-vue/api 的 hook 名集（cli 不依赖 api 包）——此处传空集跳过；hook 幽灵由 tests/coverage-refs 覆盖
  const { issues: refIssues, plannedRefs } = auditMatrixReferences(MP_MAPPING_MATRIX)
  if (refIssues.length) {
    ok = false
    lines.push(`矩阵引用一致性 ❌ ${refIssues.length} 处幽灵引用（引用的组件/语义/Hook 不存在）：`)
    for (const i of refIssues.slice(0, 20)) lines.push(`  ✗ [${i.kind}] ${i.mp} → ${i.ref}`)
  } else {
    lines.push(`矩阵引用一致性 ✅ 全部引用真实存在（planned 豁免 ${plannedRefs} 处 L2 规划）`)
  }

  // ③ 闭环一致性（catalog ↔ enum ↔ tag ↔ render-map）
  const issues = auditCatalogConsistency()
  if (issues.length) {
    ok = false
    lines.push('闭环一致性 ❌')
    for (const i of issues) lines.push(`  ✗ ${i.rule}: ${i.detail}`)
  } else {
    lines.push('闭环一致性 ✅ catalog ↔ SEMANTIC_ENUM ↔ TAG_SEMANTIC_MAP ↔ SEMANTIC_BACKEND_MAP 四向一致')
  }

  lines.push(ok ? '★ G-32.1 audit:coverage 通过（覆盖达标 + 引用一致 + 闭环一致，可进入 CI 门禁）' : '✗ audit:coverage 未通过（G-32.1 CI 红）')
  return { ok, text: lines.join('\n') }
}
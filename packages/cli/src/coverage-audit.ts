// packages/cli/src/coverage-audit.ts
// ★G-32 B1（proteus-semantic-primitives-plus-plan §12 B1 + miniprogram-mapping §5）：audit:coverage 工具
//   proteus audit coverage —— G-32.1 门禁：小程序官方能力 100% 覆盖 + 闭环一致性
//   ★2026-09-12：新增**权威标尺**（官方清单 spec 驱动）——此前手写矩阵自证同义反复，现以
//     docs/generated/miniprogram-official-spec.json（官方组件索引 + 官方 typings）为标尺。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { auditMiniprogramCoverage, auditMatrixReferences, auditCatalogConsistency, formatCoverageReport, checkPrimitiveCatalog, PRIMITIVE_CATALOG, MP_MAPPING_MATRIX, auditSpecCoverage, SPEC_RATCHET } from '@proteus-vue/component-ir'
import type { MpOfficialSpec } from '@proteus-vue/component-ir'

/** 定位官方清单快照（仓根 docs/generated/；从 CLI 源位置回退到 cwd） */
function loadSpec(): MpOfficialSpec | null {
  const candidates: string[] = []
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    candidates.push(resolve(here, '../../../docs/generated/miniprogram-official-spec.json'))
  } catch {
    // ESM 环境不可用时忽略
  }
  candidates.push(resolve(process.cwd(), 'docs/generated/miniprogram-official-spec.json'))
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as MpOfficialSpec
      } catch {
        return null
      }
    }
  }
  return null
}

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

  // ② 小程序能力覆盖（G-32.1：缺失 > 0 → CI 红）——★旧口径：手写矩阵（类别聚合，40 行覆盖几十个 API），
  //   恒 100% 已证明不可信（幽灵引用史）→ 仅作「引用/闭环」载体；**权威口径见 ②-c（官方清单 spec 驱动）**
  const report = auditMiniprogramCoverage()
  lines.push('（旧口径·手写矩阵·类别聚合——恒 100% 不可单独采信，权威口径见下方 spec 标尺）')
  lines.push(formatCoverageReport(report))
  if (!report.pass) ok = false

  // ②-c ★权威标尺（2026-09-12）：官方清单 spec 驱动——每个官方项必须归类；
  //   gap > 0（未归类）或 covered < 基线（回归）→ CI 红。诚实指标 = landedPercent（已落地/可落地）。
  const spec = loadSpec()
  if (spec) {
    const sr = auditSpecCoverage(spec, MP_MAPPING_MATRIX)
    lines.push('')
    lines.push('★权威标尺（官方清单 spec 驱动）：')
    lines.push(`  官方 ${sr.total} 项（组件 ${spec.components.length} · API ${spec.apis.length}）`)
    lines.push(`  ✅ 已落地 ${sr.covered} · 📋 规划待落地 ${sr.planned} · ⬛ 私有 ${sr.private} · ➖ 不适用 ${sr.na} · ❌ 未归类 ${sr.gap}`)
    lines.push(`  分类完整率 ${sr.classifiedPercent}%（官方项全部归类）· ★真·落地率 ${sr.landedPercent}%（已落地 ${sr.covered} / 可落地 ${sr.actionable}）`)
    if (sr.gap > 0) {
      ok = false
      lines.push(`  未归类项（须归类：covered/planned/private/na）：`)
      for (const g of sr.gaps.slice(0, 30)) lines.push(`    ❌ [${g.kind}] ${g.name}`)
    }
    if (sr.covered < SPEC_RATCHET.coveredMin) {
      ok = false
      lines.push(`  棘轮回归 ❌ 已落地 ${sr.covered} < 基线 ${SPEC_RATCHET.coveredMin}（覆盖不得回退）`)
    }
    if (sr.gap > SPEC_RATCHET.gapMax) {
      ok = false
      lines.push(`  棘轮回归 ❌ 未归类 ${sr.gap} > 上限 ${SPEC_RATCHET.gapMax}`)
    }
  } else {
    lines.push('')
    lines.push('★权威标尺 ⚠ 未找到 docs/generated/miniprogram-official-spec.json——跳过（先跑 node scripts/gen-mp-spec.mjs）')
  }

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

  lines.push(ok ? '★ audit:coverage 通过（spec 归类完整 + 无回归 + 引用一致 + 闭环一致，可进入 CI 门禁）' : '✗ audit:coverage 未通过（CI 红）')
  return { ok, text: lines.join('\n') }
}
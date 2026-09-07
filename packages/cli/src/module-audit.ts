// packages/cli/src/module-audit.ts
// ★module-plan B8（M8.6 CI 审计门禁）：proteus audit module —— 综合审计（契约 + 图谱 + 产物）
//   全部硬卡（任一违规 → 退出码 1）；module-graph.json 落盘（M8.1 产物可审计铁律）
import fs from 'node:fs'
import path from 'node:path'
import { auditModule } from '@proteus-vue/module'
import type { ModuleAuditResult } from '@proteus-vue/module'
import { formatDuplicateReport } from './module-duplicates'
import { AUTO_GENERATED_MARK, registerGeneratedFile } from './strict-cli'

/** 渲染审计报告（纯函数） */
export function formatAuditReport(audit: ModuleAuditResult, distDir?: string): string {
  const lines: string[] = []
  const contractOk = audit.modules.every((m) => m.ok)
  lines.push(`[proteus-audit] 模块契约：${audit.modules.filter((m) => m.ok).length}/${audit.modules.length} 通过${contractOk ? ' ✅' : ' ❌'}`)
  if (!contractOk) {
    for (const m of audit.modules.filter((x) => !x.ok)) {
      lines.push(`  ✗ ${m.file}`)
      for (const e of m.errors) lines.push(`    ${e.field}: ${e.message}`)
    }
  }
  if (audit.duplicateNames.length) lines.push(`✗ ★重名模块：${audit.duplicateNames.map((d) => `${d.name}（${d.files.join('/')}）`).join('，')}`)
  if (audit.cycles.length) {
    for (const c of audit.cycles) lines.push(`✗ ★循环依赖：${c.join(' → ')} → ${c[0]}`)
  }
  for (const cf of audit.conflicts) {
    lines.push(`✗ 版本冲突：${cf.module}（${cf.ranges.map((r) => `${r.from}@${r.range}`).join(' / ')}）`)
  }
  if (distDir) {
    if (audit.sizeIssues.length) {
      for (const s of audit.sizeIssues) lines.push(`✗ ${s}`)
    } else {
      lines.push('分包体积：✅ 未超阈值')
    }
    if (audit.duplicateFiles.length) {
      lines.push(formatDuplicateReport(audit.duplicateFiles))
    }
  }
  lines.push(`[proteus-audit] 综合审计：${audit.ok ? '✅ 全部通过（可发布）' : '❌ 存在违规（CI 阻断）'}`)
  return lines.join('\n')
}

/** audit 主流程（CLI 与测试共用）：扫描 + 审计 + module-graph.json 落盘 */
export async function runAuditModule(options: { root: string; distDir?: string; graphJson?: boolean; graphJsonPath?: string }): Promise<{ text: string; audit: ModuleAuditResult }> {
  const audit = await auditModule(options.root, options.distDir)
  const text = formatAuditReport(audit, options.distDir)
  if (options.graphJson !== false) {
    const outPath = path.resolve(options.root, options.graphJsonPath ?? '.proteus/module-graph.json')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    // ★CLI004 配套：纯 JSON 落盘 + 指纹登记
    fs.writeFileSync(outPath, JSON.stringify(audit.graphManifest, null, 2) + '\n')
    registerGeneratedFile(outPath)
    return { text: text + `\n[proteus-audit] module-graph.json 已落盘：${path.relative(options.root, outPath)}`, audit }
  }
  return { text, audit }
}

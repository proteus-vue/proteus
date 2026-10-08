// packages/cli/src/doctor/report.ts —— 呈现层（human / json）+ 凭证脱敏
//
// 【三条 Apollo 约束落点】③ 原始错误全文（evidence）默认折叠为一行、`--verbose` 展开、`--json` **恒含**；
//   ⑧ 隐私脱敏（匹配 token|secret|password|Bearer|sk- 的行 → ***，对齐 check-secret-scan 纪律）。
import { dim, bold, cyan, green, yellow, red, gray } from '../ui'
import type { DoctorReport, DoctorFinding, DoctorGroupResult, DoctorLevel } from './types'
import { GROUP_TITLES } from './types'

const isTTY = (() => {
  try {
    return process.stdout.isTTY === true && !process.env.NO_COLOR
  } catch {
    return false
  }
})()

/** 凭证脱敏（用于 evidence 的 stdout/stderr/note；`--json` 与 human 都过这一层） */
export function redact(s: string): string {
  return s
    .replace(/((?:token|secret|password|passwd|Bearer|sk-)[\w-]*\s*[:=]?\s*)[\w.-]+/gi, '$1***')
    .replace(/sk-[A-Za-z0-9]{8,}/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
}

function redactFinding(f: DoctorFinding): DoctorFinding {
  return {
    ...f,
    evidence: f.evidence.map((e) => ({
      ...e,
      stdout: e.stdout ? redact(e.stdout) : e.stdout,
      stderr: e.stderr ? redact(e.stderr) : e.stderr,
      note: e.note ? redact(e.note) : e.note,
    })),
  }
}

const icon = (l: DoctorLevel): string => (l === 'ok' ? '✓' : l === 'warn' ? '⚠' : l === 'error' ? '✗' : '-')
const paint = (l: DoctorLevel, s: string): string => {
  if (!isTTY) return s
  return l === 'ok' ? green(s) : l === 'warn' ? yellow(s) : l === 'error' ? red(s) : dim(s)
}

export interface FormatOptions {
  verbose?: boolean
  /** 全绿时是否省略逐项罗列（附录 A：绿就安静） */
  quietWhenGreen?: boolean
}

/** 人类可读报告（§8.1） */
export function formatHuman(rep: DoctorReport, opts: FormatOptions = {}): string {
  const out: string[] = []
  const version = rep.tool.version
  out.push('')
  out.push(`${bold('◆ Proteus doctor')}  ${dim(`${rep.tool.name}`)}  ·  ${dim(`v${version}`)}  ·  targets: ${rep.targets.join(', ') || '(未声明)'}`)
  out.push('')
  const allGreen = rep.summary.error === 0 && rep.summary.warn === 0
  if (allGreen && opts.quietWhenGreen) {
    const groups = rep.groups.map((g) => `${GROUP_TITLES[g.id]} ${green(`✓ ${g.findings.length}/${g.findings.length}`)}`).join('   ')
    out.push(`  ${groups}`)
    out.push(dim('─'.repeat(72)))
    out.push(`  ${rep.summary.total} 项检查全部通过 · ${(rep.durationMs / 1000).toFixed(2)}s    ${dim('★ proteus doctor --verbose 查看逐项取证')}`)
    return out.join('\n')
  }
  for (const g of rep.groups) {
    const bad = g.findings.filter((f) => f.level === 'error' || f.level === 'warn')
    // 默认只显示异常项；全绿组一行汇总
    if (bad.length === 0) {
      out.push(`  ${GROUP_TITLES[g.id]} ${green(`✓ ${g.findings.length}/${g.findings.length}`)}`)
      continue
    }
    out.push(`  ${bold(GROUP_TITLES[g.id])}`)
    for (const f of g.findings) {
      if (f.level === 'skip') {
        if (opts.verbose) out.push(`    ${dim(`${icon(f.level)} ${f.checkId}`)}  ${dim(f.actual ?? '')}`)
        continue
      }
      const name = f.checkId.includes('/') ? f.checkId.split('/')[1] : f.checkId
      if (f.level === 'ok') {
        out.push(`    ${green(icon(f.level))} ${name.padEnd(16)} ${dim(f.actual ?? '')}`)
        continue
      }
      out.push(`    ${paint(f.level, icon(f.level))} ${name.padEnd(16)} ${paint(f.level, f.title)}`)
      if (f.actual) out.push(`        ${dim('实测  ' + f.actual)}`)
      if (f.expected) out.push(`        ${dim('期望  ' + f.expected)}`)
      if (opts.verbose) {
        for (const e of f.evidence) out.push(`        ${gray('取证  ' + (e.command ?? e.note ?? ''))}`)
      }
      if (f.fix) out.push(`        ${cyan('修复  ' + (f.fix.command ?? f.fix.description ?? ''))}`)
      if (f.docs) out.push(`        ${dim('文档  ' + f.docs)}`)
    }
  }
  out.push('')
  out.push(dim('─'.repeat(72)))
  out.push(`  ${rep.summary.total} 项检查 · ${rep.summary.ok} ${green('✓')} · ${rep.summary.warn} ${yellow('⚠')} · ${rep.summary.error} ${red('✗')} · ${(rep.durationMs / 1000).toFixed(2)}s${rep.summary.skip ? dim(`    （${rep.summary.skip} 项 skip）`) : ''}`)
  const errs = rep.diagnostics.filter((d) => d.severity === 'error')
  const warns = rep.diagnostics.filter((d) => d.severity === 'warn')
  if (errs.length) {
    out.push('')
    out.push(`  ${red(`${errs.length} 项 error（阻断）`)}`)
    for (const d of errs) out.push(`    ${d.code}  ${d.context ?? ''}  ${d.suggestions?.[0] ?? ''}`)
  }
  if (warns.length) {
    out.push(`  ${warnTotal(warns.length)}`)
    for (const d of warns) out.push(`    ${d.code}  ${d.context ?? ''}  ${d.suggestions?.[0] ?? ''}`)
  }
  out.push('')
  out.push(dim('  ★ 完整报告：proteus doctor --json --report doctor-report.json'))
  out.push(dim('  ★ 逐项取证：proteus doctor --verbose'))
  return out.join('\n')
}

function warnTotal(n: number): string {
  const s = `${n} 项 warn`
  return isTTY ? yellow(s) : s
}

/** 脱敏后的报告（用于 --json / --report / human） */
export function sanitizeReport(rep: DoctorReport): DoctorReport {
  return {
    ...rep,
    groups: rep.groups.map((g) => ({ ...g, findings: g.findings.map(redactFinding) })),
    diagnostics: rep.diagnostics.map((d) => ({ ...d, raw: redact(d.raw) })),
  }
}

/** 机器可读 JSON（§8.2） */
export function toJson(rep: DoctorReport): string {
  return JSON.stringify(sanitizeReport(rep), null, 2)
}

export type { DoctorReport, DoctorGroupResult }

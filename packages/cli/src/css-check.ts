// packages/cli/src/css-check.ts
// G-21 css-compat B1：proteus css:check —— 扫描目录/文件（.vue/.css）→ --strict-css 校验 + 编译期重写 + 报告
import fs from 'node:fs'
import path from 'node:path'
import { buildCssCompatReport, extractStyleBlocks, rewriteStyleCss } from '@proteus-vue/css-compat'
import type { CssCompatReport, CssFileResult, CssViolation, StrictCssOptions } from '@proteus-vue/css-compat'

export interface CssCheckOptions {
  strict: boolean
  fix: boolean
}

export interface CssCheckResult {
  files: CssFileResult[]
  total: {
    errorCount: number
    warnCount: number
    fixableCount: number
    rewritten: CssCompatReport['rewritten']
  }
  ok: boolean
}

function walkCssTarget(target: string, acc: string[] = []): string[] {
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.vue') || target.endsWith('.css')) acc.push(target)
    return acc
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) walkCssTarget(full, acc)
    else if (entry.name.endsWith('.vue') || entry.name.endsWith('.css')) acc.push(full)
  }
  return acc
}

/** 单文件校验：.vue 提取 <style> 块，.css 整体当作一块 */
function checkFile(file: string, opts: CssCheckOptions): CssFileResult {
  const source = fs.readFileSync(file, 'utf8')
  const isVue = file.endsWith('.vue')
  const blocks = isVue
    ? extractStyleBlocks(source).map((b) => b.content)
    : [source]

  const options: StrictCssOptions = { strict: opts.strict }
  const violations: CssViolation[] = []
  const rewritten: CssCompatReport['rewritten'] = { calc: 0, vh: 0, 'rgba-to-argb': 0 }
  const semanticComponents: Record<string, number> = {}
  const forbidden = { float: 0, universalSelector: 0 }
  let bundleCssBytes = 0

  for (const css of blocks) {
    const report = buildCssCompatReport(css, options)
    violations.push(...report.violations)
    rewritten.calc += report.rewritten.calc
    rewritten.vh += report.rewritten.vh
    rewritten['rgba-to-argb'] += report.rewritten['rgba-to-argb']
    for (const [k, v] of Object.entries(report.semanticComponents)) semanticComponents[k] = (semanticComponents[k] ?? 0) + v
    forbidden.float += report.forbidden.float
    forbidden.universalSelector += report.forbidden.universalSelector
    bundleCssBytes += report.bundleCssBytes
  }

  return {
    file: path.relative(process.cwd(), file),
    report: { rewritten, semanticComponents, forbidden, bundleCssBytes, violations },
  }
}

/** 校验目标路径（目录或单文件），--fix 时对可重写违规给出重写统计（重写仅报告，不改文件——B1 原型） */
export function runCssCheck(target: string, opts: CssCheckOptions): CssCheckResult {
  const files = walkCssTarget(target)
  if (!files.length) throw new Error(`未找到 .vue/.css 文件：${target}`)
  const results = files.map((f) => checkFile(f, opts))
  const total = results.reduce<CssCheckResult['total']>(
    (acc, r) => {
      acc.errorCount += r.report.violations.filter((v) => v.severity === 'error').length
      acc.warnCount += r.report.violations.filter((v) => v.severity === 'warn').length
      acc.fixableCount += r.report.violations.filter((v) => v.fixable).length
      acc.rewritten.calc += r.report.rewritten.calc
      acc.rewritten.vh += r.report.rewritten.vh
      acc.rewritten['rgba-to-argb'] += r.report.rewritten['rgba-to-argb']
      return acc
    },
    { errorCount: 0, warnCount: 0, fixableCount: 0, rewritten: { calc: 0, vh: 0, 'rgba-to-argb': 0 } },
  )
  // --fix 时：重写统计已含在 rewritten（B1 原型不落盘改写，防误改业务文件；格式修复见 02 §三）
  return { files: results, total, ok: total.errorCount === 0 }
}

/** 文本报告（对齐 03 §三 报告 + 09 CLI 集成） */
export function formatCssCheck(result: CssCheckResult): string {
  const lines: string[] = []
  lines.push(`[proteus-css] --strict-css 校验 ${result.files.length} 个文件：error ${result.total.errorCount} / warn ${result.total.warnCount}`)
  for (const f of result.files) {
    if (!f.report.violations.length) {
      lines.push(`  ✅ ${f.file}（${f.report.bundleCssBytes} bytes）`)
      continue
    }
    lines.push(`  ⚠️  ${f.file}`)
    for (const v of f.report.violations) {
      const loc = v.loc && v.loc.line ? `:${v.loc.line}` : ''
      lines.push(`    ${v.severity === 'error' ? '✗' : '△'} ${v.code} ${v.message}${loc}${v.fixable ? ' [--fix 可重写]' : ''}`)
    }
  }
  const rw = result.total.rewritten
  lines.push(
    `[proteus-css] 重写统计（编译期）：calc ${rw.calc} / vh ${rw.vh} / rgba→ARGB ${rw['rgba-to-argb']}；可自动修复 ${result.total.fixableCount} 项`,
  )
  return lines.join('\n')
}

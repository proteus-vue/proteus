// packages/cli/src/style-check.ts
// G-31 style-safety B1+B3：proteus style:check —— 扫描 .vue → compiler analyzeStyleBindings
// （模板 :style 静态分析 + 常量折叠 + 覆盖率；B3 逻辑归 compiler/style-safety，本文件只做扫描与格式化）
import fs from 'node:fs'
import path from 'node:path'
import { analyzeStyleBindings, extractScriptConstants } from '@proteus-vue/compiler/style-safety'
import type { StylePlatform } from '@proteus-vue/compiler/style-safety'

export interface StyleCheckOptions {
  platform: StylePlatform
}

export interface StyleCheckResult {
  violations: Array<{ code: string; prop: string; value: string; file: string; line: number; message: string }>
  stats: { staticChecked: number; dynamic: number }
  ok: boolean
}

// <script...> 块内容提取（常量表数据源；setup/非 setup 均提取）
const SCRIPT_BLOCK_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g

/** 单文件 :style 绑定校验（B3 分析 + B1 报错码） */
function checkVueFile(file: string, opts: StyleCheckOptions): StyleCheckResult {
  const source = fs.readFileSync(file, 'utf8')
  const rel = path.relative(process.cwd(), file)

  // 常量表（05 §5 常量折叠）：<script> 顶层 const 字面量
  const constants: Record<string, unknown> = {}
  let sm: RegExpExecArray | null
  while ((sm = SCRIPT_BLOCK_RE.exec(source)) !== null) {
    Object.assign(constants, extractScriptConstants(sm[1]))
  }

  const analysis = analyzeStyleBindings(source, constants)
  const violations = analysis.violations.map((v) => ({ ...v, file: rel }))
  return {
    violations,
    stats: analysis.stats,
    ok: violations.filter((v) => v.code !== 'STS006').length === 0,
  }
}

/** 扫描目录/文件（.vue） */
export function runStyleCheck(target: string, opts: StyleCheckOptions = { platform: 'web' }): StyleCheckResult {
  const files = collectVueFiles(target)
  if (!files.length) throw new Error(`未找到 .vue 文件：${target}`)
  const violations: StyleCheckResult['violations'] = []
  const stats = { staticChecked: 0, dynamic: 0 }
  for (const f of files) {
    const r = checkVueFile(f, opts)
    violations.push(...r.violations)
    stats.staticChecked += r.stats.staticChecked
    stats.dynamic += r.stats.dynamic
  }
  return { violations, stats, ok: violations.filter((v) => v.code !== 'STS006').length === 0 }
}

function collectVueFiles(target: string, acc: string[] = []): string[] {
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.vue')) acc.push(target)
    return acc
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) collectVueFiles(full, acc)
    else if (entry.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

/** 文本报告（08 §3 报告 + 门禁） */
export function formatStyleCheck(result: StyleCheckResult): string {
  const lines: string[] = []
  lines.push(`[proteus-style] --strict-style 校验：违规 ${result.violations.filter((v) => v.code !== 'STS006').length} / 动态源提示 ${result.violations.filter((v) => v.code === 'STS006').length}`)
  for (const v of result.violations) {
    lines.push(`  ${v.code === 'STS006' ? '△' : '✗'} ${v.code} ${v.message}（${v.file}:${v.line}）`)
  }
  const total = result.stats.staticChecked + result.stats.dynamic
  const coverage = total > 0 ? (result.stats.staticChecked / total).toFixed(2) : '1.00'
  lines.push(`[proteus-style] 静态推导覆盖率 ${coverage}（static ${result.stats.staticChecked} / dynamic ${result.stats.dynamic}）`)
  return lines.join('\n')
}

// packages/cli/src/check.ts
// G-33 cli-plus M1：proteus check —— 聚合一键全量门禁（03-strict-cli.md §1）
// --strict-css + --strict-style + --strict-router + --strict-cli（默认全开，可 --no-* 关闭）
import fs from 'node:fs'
import path from 'node:path'
import { runCssCheck, formatCssCheck } from './css-check'
import { runStyleCheck, formatStyleCheck } from './style-check'
import { checkRoutes, formatRouterCheck } from './router-check'
import { checkConfigFile, loadTsConfig } from './config-check'
import { checkRequiredTargets, checkFeatureConflicts, checkProteusDirConsistency } from './strict-cli'
import { appConfigCheckSummary } from './app-config-check'

export interface CheckOptions {
  strictCss: boolean
  strictStyle: boolean
  strictRouter: boolean
  strictCli: boolean
}

export interface CheckDomainResult {
  name: string
  ok: boolean
  detail: string
}

export interface CheckSummary {
  domains: CheckDomainResult[]
  ok: boolean
}

/** 聚合四域检查（CLI001-004 语义：CLI 配置/目标/开关/产物一致性） */
export async function runCheck(root: string, opts: CheckOptions): Promise<CheckSummary> {
  const domains: CheckDomainResult[] = []

  // --strict-css（G-21）：样式兼容校验 + 预算门禁
  if (opts.strictCss) {
    try {
      const result = runCssCheck(root, { strict: true, fix: false })
      domains.push({ name: 'css', ok: result.ok, detail: formatCssCheck(result) })
    } catch (e) {
      domains.push({ name: 'css', ok: false, detail: `[proteus-css] ${(e as Error).message}` })
    }
  }

  // --strict-style（G-31）：:style 白名单 + 覆盖率
  if (opts.strictStyle) {
    try {
      const result = runStyleCheck(root, { platform: 'web' })
      domains.push({ name: 'style', ok: result.ok, detail: formatStyleCheck(result) })
    } catch (e) {
      domains.push({ name: 'style', ok: false, detail: `[proteus-style] ${(e as Error).message}` })
    }
  }

  // --strict-router（CLI002 语义：路由目标配置完整）：router:check
  if (opts.strictRouter) {
    const result = checkRoutes(root)
    domains.push({ name: 'router', ok: result.ok, detail: formatRouterCheck(result) })
  }

  // --strict-cli（CLI001-004）：配置校验 + 能力冲突 + .proteus/ 一致性
  if (opts.strictCli) {
    const configFile = path.join(root, 'proteus.config.ts')
    const lines: string[] = []
    let ok = true
    if (fs.existsSync(configFile)) {
      try {
        const { result, text } = await checkConfigFile(configFile)
        ok = result.ok
        lines.push(text)
      } catch (e) {
        ok = false
        lines.push(`[proteus-config] ${(e as Error).message}`)
      }
      // ★cli-plus G-33：defineProteus 新形态规则（CLI002 targets 完整 + CLI003 能力冲突）
      const config = await loadTsConfig(configFile)
      const strictViolations = [...checkRequiredTargets(config), ...checkFeatureConflicts(config)]
      const strictErrors = strictViolations.filter((v) => v.severity === 'error')
      if (strictErrors.length) ok = false
      for (const v of strictViolations) {
        lines.push(`  [${v.code}] ${v.severity === 'error' ? '✗' : '△'} ${v.message}`)
      }
    } else {
      lines.push(`[proteus-config] ${configFile} 不存在——跳过（独立编译模式无配置文件）`)
    }
    // CLI004：.proteus/ 生成文件一致性（warn 不阻断）
    const proteusViolations = checkProteusDirConsistency(path.join(root, '.proteus'))
    for (const v of proteusViolations) lines.push(`  [${v.code}] △ ${v.message}`)
    domains.push({ name: 'cli', ok, detail: lines.join('\n') })
  }

  // ★app-config（G-35 M3）：应用全局配置校验（06-cli-integration.md §1，并入 check 全量门禁）
  if (opts.strictCli) {
    try {
      const { ok, text } = await appConfigCheckSummary(root)
      domains.push({ name: 'app-config', ok, detail: text })
    } catch (e) {
      domains.push({ name: 'app-config', ok: false, detail: `[proteus-app-config] ${(e as Error).message}` })
    }
  }

  return { domains, ok: domains.every((d) => d.ok) }
}

/** 聚合文本报告 */
export function formatCheck(summary: CheckSummary): string {
  const lines: string[] = []
  lines.push('[proteus] check —— 一键全量门禁（G-33 cli-plus M1）：')
  for (const d of summary.domains) {
    lines.push(`\n── ${d.name}（${d.ok ? '✅' : '✗'}）${d.ok ? '' : '存在违规'}`)
    lines.push(d.detail)
  }
  const failed = summary.domains.filter((d) => !d.ok)
  lines.push(`\n[proteus] check 汇总：${summary.domains.length} 域 / ${failed.length} 失败 → ${summary.ok ? '✅ 全部通过' : '✗ 请修复后重试（exit 1）'}`)
  return lines.join('\n')
}

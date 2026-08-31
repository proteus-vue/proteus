// packages/cli/src/check.ts
// G-33 cli-plus M1：proteus check —— 聚合一键全量门禁（03-strict-cli.md §1）
// --strict-css + --strict-style + --strict-router + --strict-cli（默认全开，可 --no-* 关闭）
import fs from 'node:fs'
import path from 'node:path'
import { runCssCheck, formatCssCheck } from './css-check'
import { runStyleCheck, formatStyleCheck } from './style-check'
import { checkRoutes, formatRouterCheck } from './router-check'
import { checkConfigFile } from './config-check'

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

  // --strict-cli（CLI001 语义：proteus.config.ts 校验）：config:check
  if (opts.strictCli) {
    const configFile = path.join(root, 'proteus.config.ts')
    if (fs.existsSync(configFile)) {
      try {
        const { result, text } = await checkConfigFile(configFile)
        domains.push({ name: 'cli', ok: result.ok, detail: text })
      } catch (e) {
        domains.push({ name: 'cli', ok: false, detail: `[proteus-config] ${(e as Error).message}` })
      }
    } else {
      // CLI002：缺失必要 target 配置 → warn 不阻断（项目可能用 CLI 独立编译模式）
      domains.push({ name: 'cli', ok: true, detail: `[proteus-config] ${configFile} 不存在——跳过（独立编译模式无配置文件）` })
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

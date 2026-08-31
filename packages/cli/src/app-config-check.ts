// packages/cli/src/app-config-check.ts
// ★app-config G-35 M3：proteus app-config:check —— 应用全局配置校验（06-cli-integration.md §1）
// 加载 app.config.ts → validateAppConfig → 结构化错误输出（fail-fast 语义，CLI001 同族）
import fs from 'node:fs'
import path from 'node:path'
import { validateAppConfig } from '@proteus-vue/app-config'
import type { AppConfig, ConfigError, DeepPartial } from '@proteus-vue/app-config'
import { loadTsConfig } from './config-check'

export interface AppConfigCheckResult {
  ok: boolean
  file: string
  errors: ConfigError[]
}

/** 校验应用配置文件（app.config.ts；缺文件 → error 提示） */
export async function checkAppConfigFile(file: string): Promise<AppConfigCheckResult> {
  if (!fs.existsSync(file)) {
    return { ok: false, file, errors: [{ path: '(file)', message: `应用配置文件不存在：${file}（proteus gen config 生成骨架）` }] }
  }
  const config = await loadTsConfig(file)
  const { ok, errors } = validateAppConfig(config as DeepPartial<AppConfig> | undefined)
  return { ok, file, errors }
}

/** 文本报告（06 §1 输出形态：✔/✘ + path + 消息） */
export function formatAppConfigCheck(result: AppConfigCheckResult): string {
  const lines: string[] = []
  lines.push(`[proteus-app-config] 校验 ${result.file}：${result.ok ? '✅ 通过' : `❌ ${result.errors.length} 处错误`}`)
  for (const e of result.errors) {
    lines.push(`  ✘ ${e.path}: ${e.message}`)
  }
  return lines.join('\n')
}

/** 聚合到 check 的 app-config 域（06 §1：check 全量门禁含应用配置）
 * 与 cli 域缺 proteus.config.ts 的跳过语义一致：缺文件 → 跳过不阻断（独立命令 app-config:check 仍报错） */
export async function appConfigCheckSummary(root: string): Promise<{ ok: boolean; text: string }> {
  const file = path.join(root, 'app.config.ts')
  if (!fs.existsSync(file)) {
    return { ok: true, text: `[proteus-app-config] ${file} 不存在——跳过（未使用应用级配置）` }
  }
  const result = await checkAppConfigFile(file)
  return { ok: result.ok, text: formatAppConfigCheck(result) }
}

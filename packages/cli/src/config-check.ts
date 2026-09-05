// packages/cli/src/config-check.ts
// ★types-plan B5：proteus config:check —— 加载 proteus.config.ts → validateConfig → 报告
// ★#420 配置收敛：配置可携带 vite 插件（运行时 import 是合法形态）——加载委托 loadProjectConfig（宽松加载器）
import fs from 'node:fs'
import path from 'node:path'
import { validateConfig } from './config-validate'
import type { ConfigValidationResult } from './config-validate'
import { configNeedsMigration, CONFIG_VERSION } from '@proteus-vue/types'
import { loadProjectConfig } from './config-loader'

/** 加载 TS 配置（宽松——兼容 vite 插件字段；同名保留供 health/app-config-check 消费） */
export async function loadTsConfig(file: string): Promise<unknown> {
  return loadProjectConfig(path.resolve(file))
}

/** config:check 纯函数入口：加载 + 校验 + 版本迁移提示 + 报告 */
export async function checkConfigFile(file: string): Promise<{ result: ConfigValidationResult; text: string }> {
  if (!fs.existsSync(file)) throw new Error(`配置文件不存在：${file}`)
  const config = await loadTsConfig(file)
  const result = validateConfig(config)
  const lines = [`[proteus-config] 校验 ${file}：${result.ok ? '✅ 通过' : `❌ ${result.errors.length} 处错误`}`]
  if (!result.ok) {
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.path || '(root)'}: ${e.message}`)
  }
  // ★B6：配置版本迁移提示（version 缺省视为 1；低于 CONFIG_VERSION 提示，不阻断）
  const cfg = (config ?? {}) as { version?: number }
  if (configNeedsMigration(cfg)) {
    lines.push(`  ⚠ 配置版本 ${cfg.version ?? 1} < 最新 ${CONFIG_VERSION}——建议升级并运行迁移（docs/proteus-types-plan/06-m6-super-app.md §3）`)
  }
  return { result, text: lines.join('\n') }
}

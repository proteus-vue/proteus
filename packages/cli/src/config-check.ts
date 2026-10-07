// packages/cli/src/config-check.ts
// ★types-plan B5：proteus config:check —— 加载 proteus.config.ts → 归一到 v4 → validateConfig → 报告
// ★#420 配置收敛：配置可携带 vite 插件（运行时 import 是合法形态）——加载委托 loadProjectConfig（宽松加载器）
// ★★★2026-10-08 配置模型 v4（决策 #641）：校验前先经 resolveProteusConfig 归一（v3 旧文件自动迁移通过并提示）。
import fs from 'node:fs'
import path from 'node:path'
import { validateConfig } from './config-validate'
import type { ConfigValidationResult } from './config-validate'
import { configNeedsMigration, CONFIG_VERSION, resolveProteusConfig } from '@proteus-vue/types'
import { loadProjectConfig } from './config-loader'

/** 加载 TS 配置（宽松——兼容 vite 插件字段；同名保留供 health/app-config-check 消费） */
export async function loadTsConfig(file: string): Promise<unknown> {
  return loadProjectConfig(path.resolve(file))
}

/** config:check 纯函数入口：加载 + 归一(v4) + 校验 + 迁移提示 + 报告 */
export async function checkConfigFile(file: string): Promise<{ result: ConfigValidationResult; text: string }> {
  if (!fs.existsSync(file)) throw new Error(`配置文件不存在：${file}`)
  const raw = await loadTsConfig(file)
  // ★v4：归一到按端分区形态后再校验（旧平铺文件经此自动迁移，不因旧字段被误判未知）
  const { config, warnings } = resolveProteusConfig(raw)
  const result = validateConfig(config)
  const lines = [`[proteus-config] 校验 ${file}：${result.ok ? '✅ 通过' : `❌ ${result.errors.length} 处错误`}`]
  if (!result.ok) {
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.path || '(root)'}: ${e.message}`)
  }
  for (const w of warnings) lines.push(`  ${w}`)
  // ★B6：配置版本迁移提示（version 缺省视为当前形态；低于 CONFIG_VERSION 提示，不阻断）
  const cfg = (raw ?? {}) as { version?: number }
  if (configNeedsMigration(cfg)) {
    lines.push(`  ⚠ 配置版本 ${cfg.version ?? 1} < 最新 ${CONFIG_VERSION}——建议升级到 v4（按端分区：targets.{web,mp,ios,android,harmony}）`)
  }
  return { result, text: lines.join('\n') }
}

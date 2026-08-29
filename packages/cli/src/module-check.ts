// packages/cli/src/module-check.ts
// ★module-plan B1：proteus module:check —— 模块契约校验（扫描 proteus-module.config.ts + 校验 + 汇总）
import { scanModuleConfigs, formatModuleCheck } from '@proteus/module'
import type { ModuleScanResult } from '@proteus/module'

/** 校验指定根目录下的模块契约（纯 async 函数，CLI 与测试共用） */
export async function checkModuleConfigs(root: string): Promise<{ text: string; result: ModuleScanResult }> {
  const result = await scanModuleConfigs(root)
  return { text: formatModuleCheck(result), result }
}

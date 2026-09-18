// packages/cli/src/gate-config.ts
// ★#456：统一门禁开关的配置读取（proteus.config `gates.disabled`）——check / audit all / gate run 三方共用（零循环依赖）
//   语义：缺省全部启用；disabled 值域 = `proteus gate ls` 门禁/preset id + 聚合域 id（route/module/config/i18n/
//   capabilities/components/d2/devtools-budget · css/style/router/cli/app-config）；配置缺失/加载失败 → 空集（fail-open 于配置层，域级 skip 语义各自兜底）
import fs from 'node:fs'
import path from 'node:path'
import { loadProjectConfig } from './config-loader'

/** 读取工程根 proteus.config.ts 的 gates.disabled（无配置/加载失败 → 空集） */
export async function readDisabledGates(root: string): Promise<Set<string>> {
  const file = path.resolve(root, 'proteus.config.ts')
  if (!fs.existsSync(file)) return new Set()
  try {
    const cfg = (await loadProjectConfig(file)) as { gates?: { disabled?: unknown } } | undefined
    const disabled = cfg?.gates?.disabled
    if (!Array.isArray(disabled)) return new Set()
    return new Set(disabled.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

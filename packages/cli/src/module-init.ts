// packages/cli/src/module-init.ts
// ★module-plan B9（整合）：proteus init module —— 生成 proteus-module.config.ts 骨架（新工程零门槛接入模块化）
import fs from 'node:fs'
import path from 'node:path'

export const MODULE_CONFIG_SKELETON = `// proteus-module.config.ts —— 模块契约（module-plan B1）
// 每个业务域用本文件声明元信息：name/version/dependencies/exports/chunk...
// 校验：proteus module:check；综合审计（CI 门禁）：proteus audit module；依赖图：proteus module:check --graph
import { defineModule } from '@proteus/module'

export default defineModule({
  // 模块标识（全局唯一，kebab-case）
  name: 'app',
  // 版本（semver，用于版本协商）
  version: '1.0.0',
  // 依赖的其他模块（key = 模块名，value = semver range；★禁止自环）
  dependencies: {},
  // 对外导出的公共契约（仅 types/interfaces/events/configSchema——业务逻辑禁止进 exports）
  exports: {
    types: ['./types'],
    interfaces: [],
    events: ['./events'],
  },
  // 分包策略（与 config.subPackages 的 name/root 匹配时生成分包依赖/preloadRule）
  chunk: 'app',
  // 预加载规则（Skyline preloadRule 的 packages；仅对已声明依赖生效）
  preload: [],
  // 所需平台能力（Platform 层 Capability）
  capabilities: [],
})
`

/** 生成模块契约骨架（已存在 → 不覆盖抛错）——返回生成的文件路径 */
export function writeModuleConfigSkeleton(root: string): string {
  const out = path.join(root, 'proteus-module.config.ts')
  if (fs.existsSync(out)) throw new Error(`已存在 ${out}（不覆盖——请手动编辑）`)
  fs.writeFileSync(out, MODULE_CONFIG_SKELETON)
  return out
}

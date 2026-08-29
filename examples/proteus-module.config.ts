// examples/proteus-module.config.ts —— 模块契约示例（module-plan B1）
// 业务域用 proteus-module.config.ts 声明自身元信息（name/version/dependencies/exports...），
// 编译期据此构建依赖图谱（B3）与分包（B5）；校验：proteus module:check
// ★铁律：公共契约（types/interfaces/events/configSchema）是唯一允许跨模块 import 的东西
import { defineModule } from '@proteus/module'

export default defineModule({
  // 模块标识（全局唯一，kebab-case）
  name: 'app',
  // 版本（semver，用于版本协商）
  version: '1.0.0',
  // 依赖的其他模块（key = 模块名，value = semver range）
  dependencies: {},
  // 对外导出的公共契约（仅 types/interfaces/events/configSchema——业务逻辑禁止）
  exports: {
    types: ['./types'],
    events: ['./events'],
  },
  // 分包策略（对齐 Router M7.1 chunk）
  chunk: 'app',
  // 预加载规则（Skyline preloadRule 的 packages；仅对已声明依赖生效）
  preload: [],
  // 所需平台能力（Capability，Platform 层）
  capabilities: [],
})

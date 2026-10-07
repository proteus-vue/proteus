// packages/types/src/define-proteus.ts
// ★配置入口：`defineProteus(config)` —— 完整 TS 类型推导 + 原样返回（借鉴 Vite defineConfig）
// ★★★2026-10-08（决策 #641）：重定向到 **v4 ProteusConfig**（按端分区）。
//   原 G-33 草图（entry/targets/features/theme/fontScale/cache）废弃——其中 features/theme/fontScale/cache
//   属**运行时** app.config（G-35.1 职责边界），不该出现在构建期配置里。
import type { ProteusConfig } from './config'

/**
 * 配置入口：完整 TS 类型推导 + 原样返回（运行时零逻辑）。
 * 配置错误在 IDE 即时报错；深度校验走 CLI `proteus config:check`。
 */
export function defineProteus(config: ProteusConfig): ProteusConfig {
  return config
}

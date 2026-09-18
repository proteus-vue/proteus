// packages/app-config/src/define.ts
// ★app-config G-35 M2：defineAppConfig——配置定义入口（02-runtime-api.md §1，Vite defineConfig 模式）
// 返回原对象 + __isAppConfig 标记；TS 泛型推导（IDE 补全 features.xxx）；构建期校验走 Compiler
import type { AppConfig } from './types'

/** defineAppConfig：类型安全配置入口（identity + 标记；运行时零逻辑） */
export function defineAppConfig(config: AppConfig): AppConfig {
  const marked = config as AppConfig & { __isAppConfig?: boolean }
  marked.__isAppConfig = true
  return marked
}

// packages/types/src/migration.ts
// ★types-plan B6：配置版本迁移（对齐 Pinia M7.4 migrations 数组）——proteus.config.ts 声明 version，
// 加载时 version < CONFIG_VERSION 自动跑迁移链（纯函数可测；升级/回滚友好）
export interface Migration {
  from: number
  to: number
  /** 迁移函数：输入旧版本配置，输出新版本配置 */
  up: (config: Record<string, unknown>) => Record<string, unknown>
}

/** 当前配置 schema 版本（config 未声明 version 时视为 1） */
export const CONFIG_VERSION = 2

/**
 * 配置迁移注册表：from → to 链式执行。
 * 新增字段/结构调整时追加迁移（如 v1→v2 补默认字段），禁止修改历史迁移。
 */
export const configMigrations: Migration[] = [
  // v1 → v2：补默认字段（示例——真实 v2 变更在此登记）
  { from: 1, to: 2, up: (c) => ({ ...c, setDataBridge: c.setDataBridge ?? { batchWindow: 16, perComponent: true } }) },
]

/** 从指定版本链式迁移到最新（返回最终版本 + 配置；无匹配迁移则原样返回） */
export function migrateConfig(config: Record<string, unknown>, fromVersion: number): { version: number; config: Record<string, unknown> } {
  let current = config
  let v = fromVersion
  let guard = 0
  while (guard < configMigrations.length + 1) {
    guard++
    const m = configMigrations.find((x) => x.from === v)
    if (!m) break
    current = m.up(current)
    v = m.to
  }
  return { version: v, config: current }
}

/** 检测配置是否需要迁移：显式声明 version 且低于最新（version 字段渐进式引入——未声明视为当前形态，不提示） */
export function configNeedsMigration(config: { version?: number }): boolean {
  return config.version !== undefined && config.version < CONFIG_VERSION
}

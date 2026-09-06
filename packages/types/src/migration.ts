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
export const CONFIG_VERSION = 3

/**
 * 配置迁移注册表：from → to 链式执行。
 * 新增字段/结构调整时追加迁移（如 v1→v2 补默认字段），禁止修改历史迁移。
 */
export const configMigrations: Migration[] = [
  // v1 → v2：补默认字段（示例——真实 v2 变更在此登记）
  { from: 1, to: 2, up: (c) => ({ ...c, setDataBridge: c.setDataBridge ?? { batchWindow: 16, perComponent: true } }) },
  // v2 → v3（★#492 项目级路由管理）：顶层路由三字段收编 router 段（router.* 已声明的键不动——显式优先）
  {
    from: 2,
    to: 3,
    up: (c) => {
      const legacy: Record<string, unknown> = {}
      const keys = ['routesOutput', 'subPackages', 'customRoute']
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        if (c[k] !== undefined) legacy[k] = c[k]
        delete c[k]
      }
      const existing = (c.router && typeof c.router === 'object' ? c.router : {}) as Record<string, unknown>
      const merged: Record<string, unknown> = {}
      const lk = Object.keys(legacy)
      for (let i = 0; i < lk.length; i++) {
        const k = lk[i]
        if (existing[k] === undefined) merged[k] = legacy[k]
      }
      if (Object.keys(merged).length === 0) return c
      return Object.assign({}, c, { router: Object.assign({}, existing, merged) })
    },
  },
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

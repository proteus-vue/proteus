// tests/types-b6.test.ts
// ★types-plan B6：品牌类型防混淆 + 配置版本迁移 + Schema Registry 扩展
import { describe, it, expect } from 'vitest'
import {
  Brand,
  asStoreId,
  asModuleDomain,
  CONFIG_VERSION,
  configMigrations,
  migrateConfig,
  configNeedsMigration,
  extendConfigSchema,
  getConfigSchema,
  proteusConfigSchemaJson,
} from '../packages/types/src'

describe('品牌类型（B6 §2：防混淆）', () => {
  it('asStoreId/asModuleDomain 构造（运行时为原字符串，品牌为类型层标记）', () => {
    expect(asStoreId('user')).toBe('user')
    expect(asModuleDomain('trade')).toBe('trade')
  })

  it('类型层防混淆（tsc 断言）：StoreId 与 ModuleDomain 互不赋值', () => {
    const sid = asStoreId('user')
    // @ts-expect-error —— 品牌类型防混淆：ModuleDomain 不能赋给 StoreId
    const bad: Brand<string, 'StoreId'> = asModuleDomain('user')
    expect(bad).toBeTruthy()
  })
})

describe('配置版本迁移（B6 §3）', () => {
  it('CONFIG_VERSION = 2；迁移注册表 v1→v2 链', () => {
    expect(CONFIG_VERSION).toBe(2)
    expect(configMigrations[0]).toMatchObject({ from: 1, to: 2 })
  })

  it('migrateConfig：v1 → v2 补默认字段；v2 原样返回', () => {
    const r = migrateConfig({ platform: 'mp-weixin' }, 1)
    expect(r.version).toBe(2)
    expect(r.config.setDataBridge).toEqual({ batchWindow: 16, perComponent: true })
    const r2 = migrateConfig({ platform: 'mp-weixin', setDataBridge: { batchWindow: 8, perComponent: false } }, 2)
    expect(r2.version).toBe(2)
    expect(r2.config.setDataBridge).toEqual({ batchWindow: 8, perComponent: false })
  })

  it('configNeedsMigration：显式 version < 最新 → true；无 version / 最新 → false', () => {
    expect(configNeedsMigration({ version: 1 })).toBe(true)
    expect(configNeedsMigration({ version: 2 })).toBe(false)
    expect(configNeedsMigration({})).toBe(false) // 未声明 version → 当前形态
  })
})

describe('Schema Registry 扩展（B6 §4，零 zod）', () => {
  it('extendConfigSchema 注册字段 → getConfigSchema/序列化包含扩展', () => {
    extendConfigSchema('myPlugin', { type: 'object', properties: { token: { type: 'string' } } })
    const schema = getConfigSchema()
    const props = schema.properties as Record<string, unknown>
    expect(props.myPlugin).toEqual({ type: 'object', properties: { token: { type: 'string' } } })
    const json = JSON.parse(proteusConfigSchemaJson()) as { properties: Record<string, unknown> }
    expect(json.properties.myPlugin).toBeDefined()
    // 核心字段不受影响
    expect(json.properties.platform).toBeDefined()
  })
})

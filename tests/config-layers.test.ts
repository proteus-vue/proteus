// tests/config-layers.test.ts
// ★types-plus-plan B2 §4 / B5 §3：CONFIG_FIELD_LAYERS 归属表 + checkConfigLayerViolations 跨层检测
import { describe, expect, it } from 'vitest'
import {
  CONFIG_FIELD_LAYERS,
  CROSS_LAYER_PATTERNS,
  checkConfigLayerViolations,
  getFieldLayer,
} from '../packages/types/src/config-layers'

describe('CONFIG_FIELD_LAYERS（02 §4 字段归属表）', () => {
  it('归属表覆盖全部顶层字段（防漂移：validateConfig 集成后漏标即报错）', () => {
    const KNOWN = ['platform', 'skyline', 'appid', 'pagesDir', 'routesOutput', 'subPackages', 'customRoute', 'rules', 'setDataBridge', 'style', 'budget', 'router']
    for (const field of KNOWN) {
      expect(CONFIG_FIELD_LAYERS[field], `归属表缺 ${field}`).toBeDefined()
    }
  })

  it('getFieldLayer：查询已知字段 / 未知返回 undefined', () => {
    expect(getFieldLayer('router')).toBe('router')
    expect(getFieldLayer('rules')).toBe('compiler')
    expect(getFieldLayer('not-a-field' as never)).toBeUndefined()
  })

  it('跨层反模式清单每项字段有归属', () => {
    for (const p of CROSS_LAYER_PATTERNS) {
      expect(CONFIG_FIELD_LAYERS[p.field]).toBeDefined()
    }
  })
})

describe('checkConfigLayerViolations（B5 §3：CONFIG_LAYER_VIOLATION）', () => {
  it('合法配置（无跨层语义键）→ 零违规', () => {
    const ok = {
      platform: 'mp-weixin',
      router: { meta: { user: { requiresAuth: true } } },
      customRoute: { registerPresets: true, builders: {} },
      rules: { disabled: ['event/click-to-tap'] },
    }
    expect(checkConfigLayerViolations(ok)).toEqual([])
  })

  it('router 下声明 pinia 语义键 → 越层（router 不得影响 pinia 行为）', () => {
    const r = checkConfigLayerViolations({ router: { stores: { user: {} } } })
    expect(r[0]?.code).toBe('CONFIG_LAYER_VIOLATION')
    expect(r[0]?.path).toBe('router.stores')
    expect(r[0]?.message).toMatch(/pinia/)
  })

  it('customRoute 下声明 compiler 语义键 → 越层', () => {
    const r = checkConfigLayerViolations({ customRoute: { mapping: {} } })
    expect(r[0]?.code).toBe('CONFIG_LAYER_VIOLATION')
    expect(r[0]?.path).toBe('customRoute.mapping')
  })

  it('未标注归属层的字段 → 漏标违规', () => {
    const r = checkConfigLayerViolations({ someNewField: 1 })
    expect(r[0]?.code).toBe('CONFIG_LAYER_VIOLATION')
    expect(r[0]?.path).toBe('someNewField')
    expect(r[0]?.message).toMatch(/漏标/)
  })
})

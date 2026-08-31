// packages/types/src/config-layers.ts
// ★types-plus-plan B2 §4 / B5 §3：配置字段归属表 + 跨层隐式依赖检测（CONFIG_LAYER_VIOLATION）
// 定位：字段归属表是 Audit 规则引用的契约（02 §4：「router 字段不得影响 pinia 行为」）；
//       检测函数纯函数零依赖（CLI config-validate 集成消费；MP 产物安全无 ?./??）
import type { ProteusConfig } from './config'

/** 配置字段归属层（02 §4 字段归属表） */
export type ConfigLayer = 'compiler' | 'router' | 'pinia' | 'api' | 'platform' | 'module' | 'component' | 'lifecycle' | 'build'

/**
 * 顶层字段 → 归属层（单一来源；新增顶层字段必须补录——完整性守卫：validateConfig 检测漏标）
 * 与 proteus.config.ts 顶层键一一对应（02 §4 表 + 现有 schema/validateConfig KNOWN_FIELDS）
 */
export const CONFIG_FIELD_LAYERS: Record<string, ConfigLayer> = {
  platform: 'compiler',
  skyline: 'compiler',
  appid: 'build',
  pagesDir: 'compiler',
  routesOutput: 'router',
  subPackages: 'router',
  customRoute: 'router',
  rules: 'compiler',
  setDataBridge: 'build',
  style: 'compiler',
  budget: 'build',
  router: 'router',
}

/**
 * 跨层反模式（05 §3 检测实例）：父字段下出现「归属其它层」的语义键 → CONFIG_LAYER_VIOLATION
 * 每项 = 父字段 + 禁用子键 + 实际归属层 + 说明（诚实清单，新增反模式补录）
 */
export interface CrossLayerPattern {
  /** 父字段（如 'router'） */
  field: string
  /** 出现在该字段子键中即越层（如 pinia 语义键） */
  forbiddenKeys: string[]
  /** 这些键实际归属层 */
  layer: ConfigLayer
  message: string
}

export const CROSS_LAYER_PATTERNS: CrossLayerPattern[] = [
  {
    field: 'router',
    forbiddenKeys: ['stores', 'storeKey', 'hydrate', 'persist'],
    layer: 'pinia',
    message: 'router 字段不得声明 pinia 语义（stores/storeKey/hydrate/persist 归属 pinia 层，跨层隐式依赖）',
  },
  {
    field: 'customRoute',
    forbiddenKeys: ['mapping', 'customTags'],
    layer: 'compiler',
    message: 'customRoute（router 层）不得声明 compiler 语义（mapping/customTags 归属 compiler 层）',
  },
  {
    field: 'rules',
    forbiddenKeys: ['navigateTo', 'switchTab', 'reLaunch'],
    layer: 'router',
    message: 'rules（compiler 层）不得声明路由语义（navigateTo/switchTab/reLaunch 归属 router 层）',
  },
]

export interface ConfigLayerViolation {
  code: 'CONFIG_LAYER_VIOLATION'
  path: string
  message: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * 跨层隐式依赖检测（05 §3）：
 * ① 归属表完整性——顶层字段无归属层 → 漏标（新增字段防漂移）
 * ② 跨层反模式——父字段子键撞 forbiddenKeys → 越层
 */
export function checkConfigLayerViolations(config: unknown): ConfigLayerViolation[] {
  const errors: ConfigLayerViolation[] = []
  if (!isRecord(config)) return errors

  for (const field of Object.keys(config)) {
    if (!(field in CONFIG_FIELD_LAYERS)) {
      errors.push({
        code: 'CONFIG_LAYER_VIOLATION',
        path: field,
        message: `字段 "${field}" 未标注归属层（CONFIG_FIELD_LAYERS 漏标——新增配置字段必须补录，铁律 #5）`,
      })
      continue
    }
    for (const pattern of CROSS_LAYER_PATTERNS) {
      if (pattern.field !== field) continue
      const value = config[field]
      if (!isRecord(value)) continue
      for (const key of Object.keys(value)) {
        if (pattern.forbiddenKeys.includes(key)) {
          errors.push({
            code: 'CONFIG_LAYER_VIOLATION',
            path: `${field}.${key}`,
            message: `${pattern.message}（字段 ${field}.${key} 归属 ${pattern.layer} 层）`,
          })
        }
      }
    }
  }
  return errors
}

/** 兼容：ProteusConfig 类型字段级归属查询（IDE/文档用） */
export function getFieldLayer(field: keyof ProteusConfig): ConfigLayer | undefined {
  return CONFIG_FIELD_LAYERS[field as string]
}

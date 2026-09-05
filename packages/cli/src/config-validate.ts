// packages/cli/src/config-validate.ts
// ★types-plan B5：配置校验器（validateConfig）——手写校验（铁律 #1：不引入 zod 等运行时依赖）
// 放 CLI 侧（对齐 component-audit/i18n-check 治理工具模式）；ProteusConfig 类型在 @proteus-vue/plugin-vite
// 错误码：CONFIG_INVALID_ROOT / CONFIG_MISSING_REQUIRED / CONFIG_INVALID_TYPE / CONFIG_INVALID_ENUM / CONFIG_UNKNOWN_FIELD
// ★source map 行列定位为后续批次（需配置源文件解析；当前 path 已可定位）

import { checkConfigLayerViolations, AUDIT_RULE_IDS, AUDIT_SEVERITIES } from '@proteus-vue/types'

export interface ConfigValidationError {
  code: string
  path: string
  message: string
}

export type ConfigValidationResult = { ok: true } | { ok: false; errors: ConfigValidationError[] }

/** 顶层必填字段：字段名 → 期望类型（'object' 需非 null 对象） */
const REQUIRED_FIELDS: Array<[string, string]> = [
  ['platform', 'string'],
  ['skyline', 'boolean'],
  ['appid', 'string'],
  ['pagesDir', 'string'],
  ['routesOutput', 'string'],
  ['customRoute', 'object'],
  ['setDataBridge', 'object'],
  ['style', 'object'],
]

/** 顶层已知字段白名单（未知字段 = 拼写错误，阻断） */
const KNOWN_FIELDS = new Set([
  'platform',
  'skyline',
  'appid',
  'pagesDir',
  'routesOutput',
  'subPackages',
  'customRoute',
  'rules',
  'compiler', // ★G-29 编译器后端插拔（compiler-backend-1-plan §5）：backend 'node' | 'rust'
  'setDataBridge',
  'style',
  'budget',
  'router',
  'vite', // ★#418 配置收敛：vite 透传扩展字段（resolveProteusViteConfig 消费）
  'frameworkComponentsDir', // 决策 #115：框架内置组件目录（组件库拆包前过渡字段）
  'audit', // ★#447 D-2 dogfooding 门禁（audit-d2 消费——规则级可配）
  'gates', // ★#456 统一门禁开关（gates.disabled——check/audit all 消费）
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** 校验 ProteusConfig（纯函数；返回错误码 + 字段路径，供 CLI/CI 门禁消费） */
export function validateConfig(config: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = []
  if (!isPlainObject(config)) {
    return { ok: false, errors: [{ code: 'CONFIG_INVALID_ROOT', path: '', message: '配置必须是对象（proteus.config.ts 默认导出）' }] }
  }
  const cfg = config as Record<string, unknown>

  for (const [field, type] of REQUIRED_FIELDS) {
    const v = cfg[field]
    if (v === undefined) {
      errors.push({ code: 'CONFIG_MISSING_REQUIRED', path: field, message: `缺少必填字段 ${field}` })
    } else if (type === 'object' ? !isPlainObject(v) : typeof v !== type) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: field, message: `${field} 应为 ${type}，实际 ${Array.isArray(v) ? 'array' : typeof v}` })
    }
  }

  if (cfg.platform !== undefined && cfg.platform !== 'mp-weixin' && cfg.platform !== 'web') {
    errors.push({ code: 'CONFIG_INVALID_ENUM', path: 'platform', message: `platform 仅支持 "mp-weixin" / "web"，实际 ${JSON.stringify(cfg.platform)}` })
  }

  if (cfg.subPackages !== undefined) {
    if (!Array.isArray(cfg.subPackages)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'subPackages', message: 'subPackages 应为数组' })
    } else {
      for (let i = 0; i < cfg.subPackages.length; i++) {
        const sp = cfg.subPackages[i]
        if (!isPlainObject(sp) || typeof sp.root !== 'string') {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: `subPackages[${i}].root`, message: `分包 ${i} 的 root 必须为字符串（如 "src/subpackages/order"）` })
        }
      }
    }
  }

  // ★#447 audit（D-2 dogfooding 门禁）：dir 字符串 + rules 子键合法 id × severity 枚举
  if (cfg.audit !== undefined) {
    const audit = cfg.audit as Record<string, unknown>
    if (!isPlainObject(audit)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit', message: 'audit 应为对象（{ dir?, rules? }）' })
    } else {
      if (audit.dir !== undefined && typeof audit.dir !== 'string') {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit.dir', message: 'audit.dir 应为字符串（被审计页面目录）' })
      }
      if (audit.rules !== undefined) {
        const rules = audit.rules as Record<string, unknown>
        if (!isPlainObject(rules)) {
          errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'audit.rules', message: 'audit.rules 应为对象（规则 id → severity）' })
        } else {
          for (const [ruleId, sev] of Object.entries(rules)) {
            if (!AUDIT_RULE_IDS.includes(ruleId as never)) {
              errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: `audit.rules.${ruleId}`, message: `未知 D-2 规则 "${ruleId}"（合法规则：${AUDIT_RULE_IDS.join(' / ')}）` })
            } else if (!AUDIT_SEVERITIES.includes(sev as never)) {
              errors.push({ code: 'CONFIG_INVALID_ENUM', path: `audit.rules.${ruleId}`, message: `规则 ${ruleId} 级别仅支持 ${AUDIT_SEVERITIES.join(' / ')}，实际 ${JSON.stringify(sev)}` })
            }
          }
        }
      }
    }
  }

  // ★#456 gates（统一门禁开关）：disabled 须为字符串数组
  if (cfg.gates !== undefined) {
    const gates = cfg.gates as Record<string, unknown>
    if (!isPlainObject(gates)) {
      errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'gates', message: 'gates 应为对象（{ disabled?: string[] }）' })
    } else if (gates.disabled !== undefined) {
      if (!Array.isArray(gates.disabled) || !gates.disabled.every((x) => typeof x === 'string')) {
        errors.push({ code: 'CONFIG_INVALID_TYPE', path: 'gates.disabled', message: 'gates.disabled 应为门禁/聚合域 id 字符串数组' })
      }
    }
  }

  for (const k of Object.keys(cfg)) {
    if (!KNOWN_FIELDS.has(k)) {
      errors.push({ code: 'CONFIG_UNKNOWN_FIELD', path: k, message: `未知字段 "${k}"（可能拼写错误；合法字段：${[...KNOWN_FIELDS].join(' / ')}）` })
    }
  }

  // ★B5 §3：跨层隐式依赖检测（CONFIG_LAYER_VIOLATION：字段归属表漏标 / 跨层反模式）
  // 未知字段的「未标注归属」已由 CONFIG_UNKNOWN_FIELD 报，此处跳过避免重复
  for (const e of checkConfigLayerViolations(cfg)) {
    const topField = e.path.split('.')[0]
    if (!KNOWN_FIELDS.has(topField)) continue
    errors.push(e)
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}

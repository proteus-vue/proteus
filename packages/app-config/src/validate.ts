// packages/app-config/src/validate.ts
// ★app-config G-35 M1：自研轻量校验器（01-app-config.md §5）
// 合法→生效，非法→降级 + 告警（不抛错，宁可降级也不崩溃——与 Style Safety G-31 同哲学）
// ★零依赖（不强制 zod，~2KB 自研）；ES5 安全（运行时进 MP 产物：禁 ?. ?? 展开 解构）
import type { AppConfig, DeepPartial } from './types'

export interface ConfigError {
  path: string
  message: string
}

export interface ValidateResult {
  ok: boolean
  errors: ConfigError[]
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 字段校验规则表（path → 校验函数；M1 覆盖 schema 必填 + 范围） */
interface Rule {
  required: boolean
  check: (v: unknown) => string | null // 返回错误消息；null = 合法
}

const STRING_RULE = (msg: string): Rule => ({ required: true, check: (v) => (typeof v === 'string' && v.length > 0 ? null : msg) })
const NUMBER_POSITIVE = (msg: string): Rule => ({ required: true, check: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : msg) })
const BOOLEAN_RULE = (msg: string): Rule => ({ required: true, check: (v) => (typeof v === 'boolean' ? null : msg) })

const RULES: Record<string, Rule> = {
  'app.id': STRING_RULE('app.id 必填（应用标识）'),
  'app.name': STRING_RULE('app.name 必填（应用名称）'),
  'app.version': { required: true, check: (v) => (typeof v === 'string' && SEMVER_RE.test(v) ? null : 'app.version 非法 semver（如 1.0.0）') },
  'app.buildNumber': NUMBER_POSITIVE('app.buildNumber 必填（非负整数）'),
  'env': { required: true, check: (v) => (v === 'dev' || v === 'staging' || v === 'prod' ? null : 'env 非法（dev/staging/prod）') },
  'api.baseUrl': STRING_RULE('api.baseUrl 必填（接口域名）'),
  'api.timeout': { required: true, check: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 120000 ? null : 'api.timeout 需在 (0, 120000]ms') },
  'api.retry': { required: true, check: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5 ? null : 'api.retry 需 0-5 次') },
  'features.glassEffect': BOOLEAN_RULE('features.glassEffect 需布尔'),
  'features.skeletonScreen': BOOLEAN_RULE('features.skeletonScreen 需布尔'),
  'features.memorialGray': BOOLEAN_RULE('features.memorialGray 需布尔'),
  'theme.default': { required: true, check: (v) => (v === 'light' || v === 'dark' || v === 'system' ? null : 'theme.default 非法（light/dark/system）') },
  'font.defaultScale': { required: true, check: (v) => (typeof v === 'number' && v >= 0.5 && v <= 2 ? null : 'font.defaultScale 需 0.5-2.0') },
  'safeArea.islandGlass': BOOLEAN_RULE('safeArea.islandGlass 需布尔'),
}

function getByPath(config: Record<string, unknown>, path: string): unknown {
  const segs = path.split('.')
  let cur: unknown = config
  for (const seg of segs) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * 校验配置：返回 { ok, errors }——errors 非空 = 非法（调用方选择降级或 fail-fast）
 * 规则表驱动：新增字段补录 RULES 即自动覆盖（铁律 #5 数据驱动）
 */
export function validateAppConfig(config: DeepPartial<AppConfig> | undefined): ValidateResult {
  const errors: ConfigError[] = []
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: [{ path: '(root)', message: '配置缺失或非对象' }] }
  }
  const root = config as Record<string, unknown>
  for (const [path, rule] of Object.entries(RULES)) {
    const value = getByPath(root, path)
    if (value === undefined) {
      if (rule.required) errors.push({ path, message: `${path} 缺失（必填）` })
      continue
    }
    const msg = rule.check(value)
    if (msg) errors.push({ path, message: msg })
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 校验并应用（§5.2 语义）：非法字段降级为默认值 + 收集告警，不抛错
 * invalidFields 记录被降级的字段路径（DevTools/日志消费）
 */
export function validateAndApply<T extends AppConfig>(config: DeepPartial<AppConfig>, defaults: T): { config: T; invalidFields: ConfigError[] } {
  const { errors } = validateAppConfig(config)
  // 非法字段用 defaults 对应值替换（降级），必填缺失也用默认值兜底
  const sanitized = { ...(config as object) } as Record<string, unknown>
  for (const e of errors) {
    const segs = e.path.split('.')
    let cur = sanitized
    for (let i = 0; i < segs.length - 1; i++) {
      if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) {
        cur[segs[i]] = {}
      }
      cur = cur[segs[i]] as Record<string, unknown>
    }
    cur[segs[segs.length - 1]] = getByPath(defaults as unknown as Record<string, unknown>, e.path)
  }
  return { config: sanitized as T, invalidFields: errors }
}

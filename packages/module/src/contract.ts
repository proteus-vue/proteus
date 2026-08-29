// packages/module/src/contract.ts
// ★module-plan B1（M1 模块契约）：业务域声明式边界——defineModule + 编译期校验
// 设计（docs/proteus-module-plan/01-m1-module-contract.md）：
//   业务只写标准 import；公共契约（types/interfaces/events/configSchema）是唯一允许跨模块 import 的东西；
//   本文件做契约定义 + 静态校验（缺失字段 / 非法值 / 自环依赖），为 B3 依赖图谱 / B5 分包提供输入
// 校验错误信息含模块名 + 字段 + 原因（AI 可读，透明化铁律）

/** 模块契约（proteus-module.config.ts 的 default export 类型） */
export interface ModuleConfig {
  /** 模块标识（全局唯一，kebab-case） */
  name: string
  /** 版本（semver，用于版本协商） */
  version: string
  /** 依赖的其他模块（key = 模块名，value = semver range） */
  dependencies?: Record<string, string>
  /** 对外导出的公共契约（仅 types/interfaces/events/configSchema——业务逻辑禁止） */
  exports?: {
    types?: string[]
    interfaces?: string[]
    events?: string[]
    configSchema?: string
  }
  /** 分包策略（对齐 Router M7.1 chunk） */
  chunk?: string
  /** 预加载规则（Skyline preloadRule 的 packages） */
  preload?: string[]
  /** 所需平台能力（Capability，Platform 层） */
  capabilities?: string[]
  /** 生命周期钩子路径 */
  lifecycle?: {
    onInit?: string
    onDestroy?: string
  }
}

export interface ModuleValidationIssue {
  field: string
  message: string
}

export type ModuleValidationResult =
  | { ok: true; value: ModuleConfig; warnings: ModuleValidationIssue[] }
  | { ok: false; errors: ModuleValidationIssue[]; warnings: ModuleValidationIssue[] }

/** 模块名：kebab-case（小写字母/数字/连字符，字母开头） */
export function isValidModuleName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z][a-z0-9-]*$/.test(name)
}

/** semver：x.y.z */
export function isValidSemver(v: unknown): v is string {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)
}

/** semver range：^x.y.z / ~x.y.z / x.y.z / x.y.z - y.y.y（MVP 简化） */
export function isValidSemverRange(v: unknown): v is string {
  return typeof v === 'string' && /^[\^~]?\d+\.\d+\.\d+(?:\s*-\s*\d+\.\d+\.\d+)?$/.test(v)
}

/**
 * 静态校验模块契约（纯函数，可单测）
 * - 必填：name（kebab-case 标识符）/ version（semver）
 * - dependencies：key 合法模块名、value semver range、★自环（依赖自身）报错
 * - preload：引用未声明依赖 → 警告（透明化）
 * - exports/capabilities/lifecycle：结构 + 路径字符串校验
 */
export function validateModuleConfig(input: unknown): ModuleValidationResult {
  const errors: ModuleValidationIssue[] = []
  const warnings: ModuleValidationIssue[] = []
  const cfg = (input ?? {}) as Record<string, unknown>
  const name = cfg.name
  if (!isValidModuleName(name)) {
    errors.push({ field: 'name', message: '必填：模块标识（kebab-case，如 "trade"）' })
  }
  if (!isValidSemver(cfg.version)) {
    errors.push({ field: 'version', message: '必填：semver 版本（如 "1.2.0"）' })
  }
  // dependencies
  const deps = cfg.dependencies
  if (deps !== undefined) {
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
      errors.push({ field: 'dependencies', message: '应为对象：{ 模块名: semver range }' })
    } else {
      for (const [depName, range] of Object.entries(deps)) {
        if (!isValidModuleName(depName)) {
          errors.push({ field: `dependencies.${depName}`, message: '依赖名应为 kebab-case 模块名' })
        }
        if (!isValidSemverRange(range)) {
          errors.push({ field: `dependencies.${depName}`, message: `semver range 非法（"${String(range)}"）` })
        }
        if (name && depName === name) {
          errors.push({ field: `dependencies.${depName}`, message: '★自环依赖：模块不能依赖自身' })
        }
      }
    }
  }
  // exports
  const exportsField = cfg.exports
  if (exportsField !== undefined) {
    if (typeof exportsField !== 'object' || exportsField === null || Array.isArray(exportsField)) {
      errors.push({ field: 'exports', message: '应为对象：{ types?, interfaces?, events?, configSchema? }' })
    } else {
      for (const key of ['types', 'interfaces', 'events'] as const) {
        const list = (exportsField as Record<string, unknown>)[key]
        if (list !== undefined) {
          if (!Array.isArray(list) || list.some((p) => typeof p !== 'string' || !p.startsWith('./'))) {
            errors.push({ field: `exports.${key}`, message: '应为相对路径字符串数组（"./xxx"）' })
          }
        }
      }
      const cs = (exportsField as Record<string, unknown>).configSchema
      if (cs !== undefined && (typeof cs !== 'string' || !cs.startsWith('./'))) {
        errors.push({ field: 'exports.configSchema', message: '应为相对路径字符串（"./xxx.schema.json"）' })
      }
    }
  }
  // preload：引用未声明依赖 → 警告
  const preload = cfg.preload
  if (preload !== undefined) {
    if (!Array.isArray(preload) || preload.some((p) => typeof p !== 'string')) {
      errors.push({ field: 'preload', message: '应为字符串数组（依赖模块名）' })
    } else {
      for (const p of preload) {
        const declared = typeof deps === 'object' && deps !== null && p in (deps as Record<string, unknown>)
        if (!declared) {
          warnings.push({ field: `preload.${p}`, message: `引用了未声明的依赖（dependencies 无 "${p}"）——预加载仅对已声明依赖生效` })
        }
      }
    }
  }
  // capabilities
  if (cfg.capabilities !== undefined && (!Array.isArray(cfg.capabilities) || cfg.capabilities.some((c) => typeof c !== 'string'))) {
    errors.push({ field: 'capabilities', message: '应为字符串数组' })
  }
  // lifecycle
  if (cfg.lifecycle !== undefined) {
    const lc = cfg.lifecycle as Record<string, unknown>
    for (const key of ['onInit', 'onDestroy'] as const) {
      const v = lc[key]
      if (v !== undefined && (typeof v !== 'string' || !v.startsWith('./'))) {
        errors.push({ field: `lifecycle.${key}`, message: '应为相对路径字符串（"./xxx"）' })
      }
    }
  }
  if (errors.length) return { ok: false, errors, warnings }
  return { ok: true, value: input as ModuleConfig, warnings }
}

/**
 * 声明模块契约（编译期校验：不合法当场抛错，透明化铁律）
 * 用法：export default defineModule({ name: 'trade', version: '1.0.0', ... })
 */
export function defineModule(config: ModuleConfig): ModuleConfig {
  const result = validateModuleConfig(config)
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
    throw new Error(`[proteus-module] 模块契约校验失败（${config?.name ?? '(未命名)'}）：\n${detail}`)
  }
  return config
}

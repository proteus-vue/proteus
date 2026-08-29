// packages/capabilities/src/index.ts
// ★platform-plan B1/B2：Capability 契约（defineCapability + 描述文件校验）+ Adapter Registry（注册中心 + 选择策略）
//   业务代码只使用 capability / useCapability()，无任何平台判断（铁律 1）
//   B2 升级：注册中心以 adapter 为单位（CapabilityRegistry，多实例隔离工厂）；B1 描述文件的 adapters 展开为 adapter 注册
import type { Capability, CapabilityAPI, CapabilityDefinition, CapabilityPlatform } from './types'
import { CapabilityError } from './types'
import { CapabilityRegistry, defineAdapter, validateAdapter, detectPlatform } from './adapter'
import type { CapabilityAdapter } from './adapter'

export * from './types'
export { CapabilityRegistry, defineAdapter, validateAdapter, detectPlatform } from './adapter'
export type { CapabilityAdapter } from './adapter'

// ★scan/check 为 node 工具（esbuild/fs），仅经子路径 '@proteus/capabilities/scan' / 'check' 导入——不进运行时入口（浏览器/MP 产物）

/** 校验能力描述文件（纯函数；id kebab-case 必填 / tier 1-4 / adapters 非空 / fallback 引用合法） */
export function validateCapabilityDefinition(input: unknown): { ok: true; value: CapabilityDefinition } | { ok: false; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = []
  const def = (input ?? {}) as CapabilityDefinition
  if (typeof def.meta?.id !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(def.meta.id)) {
    errors.push({ field: 'meta.id', message: '必填：kebab-case 能力标识（如 "clipboard" / "login.wechat"）' })
  }
  if (![1, 2, 3, 4].includes(def.meta?.tier as number)) {
    errors.push({ field: 'meta.tier', message: '必填：能力等级 1-4（L1 通用 / L2 映射 / L3 平台独占 / L4 实验）' })
  }
  const adapters = def.adapters
  if (!adapters || typeof adapters !== 'object' || Object.keys(adapters).length === 0) {
    errors.push({ field: 'adapters', message: '必填：至少一个平台 adapter（{ web | skyline | app }）' })
  } else {
    for (const [p, factory] of Object.entries(adapters)) {
      if (!['web', 'skyline', 'app'].includes(p)) errors.push({ field: `adapters.${p}`, message: `未知平台 "${p}"（web / skyline / app）` })
      if (typeof factory !== 'function') errors.push({ field: `adapters.${p}`, message: '应为 adapter 工厂函数（() => CapabilityAdapter）' })
    }
  }
  if (def.fallback !== undefined && (typeof def.fallback !== 'string' || !def.fallback)) {
    errors.push({ field: 'fallback', message: '应为降级能力 id（字符串）' })
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: def }
}

/** ★B4 UnsupportedAPI（§2）：能力缺失的显式包装——isSupported false + 任意方法调用抛 CapabilityError（防 await 误用 thenable） */
export function unsupported(capability: string, platform: CapabilityPlatform, reason?: string): CapabilityAPI {
  const api = {
    isSupported: () => false,
  } as CapabilityAPI & { then: () => never }
  api.then = () => {
    throw new CapabilityError('UNSUPPORTED', capability, platform, reason)
  }
  return api
}

/** ★B4：构造降级 Capability（isSupported false + unsupported api）——缺失但不 required */
export function unsupportedCapability(id: string, platform: CapabilityPlatform, reason?: string): Capability {
  return {
    meta: { id, tier: 3, name: id },
    api: unsupported(id, platform, reason),
    isSupported: () => false,
  }
}

/** 声明能力描述文件（编译期校验：不合法当场抛错，透明化铁律） */
export function defineCapability<C extends CapabilityAPI>(def: CapabilityDefinition<C>): CapabilityDefinition<C> {
  const result = validateCapabilityDefinition(def)
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
    throw new Error(`[proteus-capabilities] 能力描述文件校验失败（${def.meta?.id ?? '(未命名)'}）：\n${detail}`)
  }
  return def
}

// ==================== 全局注册中心（B1 兼容 + B2 adapter 级） ====================

/** 全局默认 registry（业务入口用；SSR/Worker 用 createCapabilityRegistry 独立实例） */
export const globalRegistry = new CapabilityRegistry()

/** 注册能力描述文件（B1）：adapters 展开为 adapter 注册 + fallback 关系；重复注册 → 报错 */
export function registerCapability(def: CapabilityDefinition): void {
  const existing = globalRegistry.has(def.meta.id)
  if (existing) throw new Error(`[proteus-capabilities] 重复注册能力 "${def.meta.id}"（能力标识全局唯一）`)
  for (const [platform, factory] of Object.entries(def.adapters)) {
    globalRegistry.register({
      capability: def.meta.id,
      platform: platform as CapabilityPlatform,
      priority: 0,
      // 探测延迟（§6：adapter 不得在模块顶层执行平台 API；isSupported 延后调用）
      isSupported: () => factory().create().isSupported(),
      create: () => factory().create(),
    })
  }
  globalRegistry.registerRequired(def.meta.id, def.meta.required ?? false)
  globalRegistry.registerFallback(def.meta.id, def.fallback)
}

/** 注册能力集合（脚手架/入口批量注册） */
export function registerCapabilities(defs: CapabilityDefinition[]): void {
  for (const d of defs) registerCapability(d)
}

/** 注册独立 adapter（B2：capabilities/*.adapter.ts；幂等——同 id+platform 跳过） */
export function registerAdapter<C extends CapabilityAPI>(adapter: CapabilityAdapter<C>): void {
  globalRegistry.registerIdempotent(adapter as CapabilityAdapter)
}

/** 清空注册表（测试隔离） */
export function clearCapabilities(): void {
  globalRegistry.clear()
}

/** 能力是否已注册 */
export function hasCapability(id: string): boolean {
  return globalRegistry.has(id)
}

/** 解析能力（同步：仅同步 isSupported 的 adapter 命中；异步探测请用 resolveCapability） */
export function getCapability<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Capability<C> | undefined {
  return globalRegistry.resolveSync<C>(id, platform)
}

/** 组合式 API（推荐）：业务用 useCapability('share') —— 无平台判断
 * ★B4 降级：无命中时——required 能力抛 CapabilityError（阻断流程 §4）；非 required 返回 unsupported 包装（isSupported false，不崩溃 §7） */
export function useCapability<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Capability<C> {
  const cap = getCapability<C>(id, platform)
  if (cap) return cap
  if (globalRegistry.isRequired(id)) {
    throw new CapabilityError('UNSUPPORTED', id, platform, 'required 能力缺失（阻断流程）')
  }
  return unsupportedCapability(id, platform) as Capability<C>
}

/** 异步完整解析（B2 选择策略：异步 isSupported 探测 + fallback 递归） */
export async function resolveCapability<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Promise<Capability<C> | undefined> {
  return globalRegistry.resolve<C>(id, platform)
}

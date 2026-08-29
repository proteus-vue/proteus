// packages/capabilities/src/index.ts
// ★platform-plan B1（M1 Capability 契约）：defineCapability（描述文件声明 + 校验）+ 注册中心 + useCapability/getCapability
//   业务代码只使用 capability / useCapability()，无任何平台判断（铁律 1）
import type { Capability, CapabilityAPI, CapabilityDefinition, CapabilityPlatform } from './types'

// ★scan 为 node 工具（esbuild/fs），仅经子路径 '@proteus/capabilities/scan' 导入——不进运行时入口（浏览器/MP 产物）
export * from './types'

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

/** 声明能力描述文件（编译期校验：不合法当场抛错，透明化铁律） */
export function defineCapability<C extends CapabilityAPI>(def: CapabilityDefinition<C>): CapabilityDefinition<C> {
  const result = validateCapabilityDefinition(def)
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
    throw new Error(`[proteus-capabilities] 能力描述文件校验失败（${def.meta?.id ?? '(未命名)'}）：\n${detail}`)
  }
  return def
}

// ==================== 注册中心（B2 Adapter Registry 的地基，B1 最小版） ====================

const registry = new Map<string, CapabilityDefinition>()

/** 注册能力（重复 → 报错；全局唯一铁律） */
export function registerCapability(def: CapabilityDefinition): void {
  if (registry.has(def.meta.id)) throw new Error(`[proteus-capabilities] 重复注册能力 "${def.meta.id}"（能力标识全局唯一）`)
  registry.set(def.meta.id, def)
}

/** 能力是否已注册（scan 幂等判断用） */
export function hasCapability(id: string): boolean {
  return registry.has(id)
}

/** 注册能力集合（脚手架/入口批量注册） */
export function registerCapabilities(defs: CapabilityDefinition[]): void {
  for (const d of defs) registerCapability(d)
}

/** 清空注册表（测试隔离） */
export function clearCapabilities(): void {
  registry.clear()
}

/** 当前平台探测（feature detection 优先于平台判断）：skyline（wx）/ web（window） */
export function detectPlatform(): CapabilityPlatform {
  const wxGlobal = (globalThis as { wx?: unknown }).wx
  if (typeof wxGlobal !== 'undefined') return 'skyline'
  return 'web'
}

/** 解析能力（命令式）：平台 adapter 探测 → 实例化；无 adapter → undefined */
export function getCapability<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Capability<C> | undefined {
  const def = registry.get(id)
  if (!def) return undefined
  const factory = def.adapters[platform]
  if (!factory) return undefined
  const adapter = factory()
  const api = adapter.create()
  const cap: Capability<C> = {
    meta: def.meta,
    api: api as C,
    isSupported: () => api.isSupported(),
  }
  if (def.fallback) {
    const fb = getCapability<C>(def.fallback, platform)
    if (fb) cap.fallback = fb
  }
  return cap
}

/** 组合式 API（推荐）：业务用 useCapability('share') —— 无平台判断 */
export function useCapability<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Capability<C> {
  const cap = getCapability<C>(id, platform)
  if (!cap) {
    // 未注册或当前平台无 adapter：显式失败（铁律 4：缺失必须可降级或显式失败）
    throw new Error(`[proteus-capabilities] 能力 "${id}" 在当前平台（${platform}）不可用：未注册或缺少 adapter${platform === 'skyline' ? '（Skyline 限制见 platform-plan 01 §5）' : ''}`)
  }
  return cap
}

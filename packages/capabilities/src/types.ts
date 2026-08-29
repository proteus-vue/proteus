// packages/capabilities/src/types.ts
// ★platform-plan B1（M1 Capability 契约）：业务依赖"能力"不依赖"平台"
// 设计（docs/proteus-platform-plan/01-m1-capability-contract.md）：
//   能力 = 明确接口 + 元数据（tier 1-4）+ 平台 adapter 映射（集中在此文件，不在业务代码）
//   铁律：能力必须可探测（isSupported）、缺失必须可降级或显式失败

export type CapabilityPlatform = 'web' | 'skyline' | 'app'

/** 能力等级：L1 通用（三端都有）/ L2 映射（行为近似需适配）/ L3 平台独占 / L4 实验（显式 opt-in） */
export type CapabilityTier = 1 | 2 | 3 | 4

export interface CapabilityMeta {
  /** 能力标识（kebab-case，如 'clipboard' / 'login.wechat'） */
  id: string
  /** 人类可读名（DevTools/报告） */
  name?: string
  tier: CapabilityTier
  /** 支持的最低基础库/版本 */
  since?: string
  /** 需要的权限（平台权限声明） */
  permissions?: string[]
}

/** 能力 API 基类：所有能力必须可探测（feature detection > platform detection） */
export interface CapabilityAPI {
  isSupported(): boolean | Promise<boolean>
}

/** 平台 adapter：capability 在某平台的实现 + 探测 */
export interface CapabilityAdapter<C extends CapabilityAPI = CapabilityAPI> {
  platform: CapabilityPlatform
  /** 创建能力 API 实例（懒加载） */
  create(): C
}

/** 能力描述文件内容（capabilities/*.capability.ts 的 default export） */
export interface CapabilityDefinition<C extends CapabilityAPI = CapabilityAPI> {
  meta: CapabilityMeta
  /** 平台 → adapter 工厂（静态可扫描；运行时惰性 create） */
  adapters: Partial<Record<CapabilityPlatform, () => CapabilityAdapter<C>>>
  /** 可选降级能力 id（isSupported false / 无 adapter 时的替代） */
  fallback?: string
}

/** 已解析的能力实例（useCapability 返回） */
export interface Capability<C extends CapabilityAPI = CapabilityAPI> {
  meta: CapabilityMeta
  api: C
  /** 当前平台是否可用（adapter 探测；无 adapter → false） */
  isSupported(): boolean | Promise<boolean>
  /** 降级能力实例（fallback 声明且可解析时） */
  fallback?: Capability
}

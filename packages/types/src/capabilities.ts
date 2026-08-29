// packages/types/src/capabilities.ts
// ★类型收口（10-type-consolidation）：能力体系公共类型（原 @proteus/capabilities/types.ts）
// runtime 值（CapabilityError class）留 @proteus/capabilities（types 包保持纯类型）

/** 运行时平台（跨层契约：guard.ts / capabilities / app 渲染器共用） */
export type CapabilityPlatform = 'web' | 'skyline' | 'app'

/** 能力等级：L1 通用 / L2 映射需适配 / L3 平台独占 / L4 实验 */
export type CapabilityTier = 1 | 2 | 3 | 4

export interface CapabilityMeta {
  /** 能力标识（kebab-case，如 'clipboard' / 'login.wechat'） */
  id: string
  /** 人类可读名 */
  name?: string
  tier: CapabilityTier
  since?: string
  /** 需要的权限（平台权限声明） */
  permissions?: string[]
  /** ★B4：required——缺失时阻断流程（抛 CapabilityError）而非降级 */
  required?: boolean
}

/** 能力 API 基类：所有能力必须可探测 */
export interface CapabilityAPI {
  isSupported(): boolean | Promise<boolean>
}

/** ★B4 错误模型：缺失/权限/不可用的显式错误——不静默 */
export type CapabilityErrorCode = 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'UNAVAILABLE'

/** 平台 adapter：capability 在某平台的实现 + 探测 */
export interface CapabilityAdapter<C extends CapabilityAPI = CapabilityAPI> {
  platform: CapabilityPlatform
  create(): C
}

/** 能力描述文件内容（capabilities/*.capability.ts 的 default export） */
export interface CapabilityDefinition<C extends CapabilityAPI = CapabilityAPI> {
  meta: CapabilityMeta
  adapters: Partial<Record<CapabilityPlatform, () => CapabilityAdapter<C>>>
  /** 可选降级能力 id */
  fallback?: string
}

/** 已解析的能力实例（useCapability 返回） */
export interface Capability<C extends CapabilityAPI = CapabilityAPI> {
  meta: CapabilityMeta
  api: C
  isSupported(): boolean | Promise<boolean>
  fallback?: Capability
}

// packages/capabilities/src/types.ts
// ★类型收口（10-type-consolidation）：公共类型定义已统一收口到 @proteus/types/capabilities
// 本文件保留为 re-export 兼容层（包内 import './types' 与包外消费方路径不变）
// runtime 值（CapabilityError class）留本包（types 包保持纯类型）
import type { CapabilityErrorCode } from '@proteus/types/capabilities'

export type {
  CapabilityPlatform,
  CapabilityTier,
  CapabilityMeta,
  CapabilityAPI,
  CapabilityErrorCode,
  CapabilityAdapter,
  CapabilityDefinition,
  Capability,
} from '@proteus/types/capabilities'

/** ★B4 错误模型：缺失/权限/不可用的显式错误——不静默（runtime class，留实现包） */
export class CapabilityError extends Error {
  constructor(
    public readonly code: CapabilityErrorCode,
    public readonly capability: string,
    public readonly platform: string,
    public readonly reason?: string,
  ) {
    super(`[proteus-capabilities] ${code}: ${capability}@${platform}${reason ? `（${reason}）` : ''}`)
    this.name = 'CapabilityError'
  }
}

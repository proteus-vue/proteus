// website/scripts/lib/capability-docs.d.mts
// 类型声明（配套 capability-docs.mjs）——供生成器与契约测试以 TS 导入时拿到类型。

/** 一条能力的人话说明（中英各一份） */
export interface CapabilityGuideText { what: string; use: string }
export interface CapabilityGuide { zh: CapabilityGuideText; en: CapabilityGuideText }

/** 端实现边界（中英各一份；必须说清原因与替代路径） */
export interface CapabilityEndNote { zh: string; en: string }

/** 能力人话说明（键 = `capability.<slug>`，与 PRIMITIVE_CATALOG 的 semantic 一一对应） */
export const CAPABILITY_GUIDE: Record<string, CapabilityGuide>

/** 端实现边界（只登记"某端不可用/有语义差异"的能力） */
export const CAPABILITY_END_NOTE: Record<string, CapabilityEndNote>

/**
 * 生成能力页开头的"人话说明"块（人话在前、技术标识后移）。
 * 缺人话说明 ⇒ 抛错（不静默退回机器标识）。
 */
export function capabilityIntro(
  c: { semantic: string; id: string; props?: string[] },
  opts?: { en?: boolean },
): string[]

/** 覆盖门禁：给定能力列表必须全部有人话说明（缺一个就抛）。 */
export function assertGuideCoverage(
  capabilities: Array<{ semantic: string }>,
): void

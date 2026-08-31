// packages/contracts/src/capability.ts
// ★types-plan §07 / 架构规约 L0：能力域跨层共享 DTO（CapabilityDescriptor）
// 定位：跨层能力描述契约（capabilities:manifest 产物 / 平台能力矩阵 / 审计）——
//       对齐 packages/capabilities scan 的 ManifestCapabilityEntry 形状（id/tier/platforms/source）

/** 跨层能力描述 DTO（capability-manifest.json 条目契约） */
export interface CapabilityDescriptor {
  /** 能力 id（kebab-case，如 'clipboard'） */
  id: string
  /** 能力等级（1-4：L1 通用 / L2 映射 / L3 独占 / L4 实验） */
  tier: number
  /** 覆盖平台（'web' | 'skyline' | 'app' …） */
  platforms: string[]
  /** 描述文件相对路径（产物可追溯铁律） */
  source?: string
}

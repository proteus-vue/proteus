// src/compiler/transforms/types.ts
// 编译规则 AI 说明书 —— 透明定位的核心数据结构
// 每条编译规则 = 一份结构化自描述（人可读 + 机器可读）：
// AI 可枚举全部规则（能力清单）、查询单条规则（what/why/when/how-verify）、
// 由 source 字段直接跳读实现源码。未来（阶段二）每条规则增加 apply() 后，
// 本注册表即升级为分派层，可输出 explainTransform(source) 决策 trace。

export type TransformPhase = 'template' | 'script' | 'style' | 'validate'

export type RuleStatus = 'implemented' | 'planned' | 'limitation'

/** 一条编译规则的完整 AI 说明书 */
export interface TransformRule {
  /** 稳定 ID：`<phase>/<name>`，如 'tag/div-to-view'（API / trace / 文档引用此 ID） */
  id: string
  /** 所属编译阶段 */
  phase: TransformPhase
  /** 人类可读标题 */
  title: string
  /** what：输入 → 输出 */
  description: string
  /** why：平台约束 / 设计决策（关联 PROJECT_MEMORY.md 决策号） */
  why: string
  /** when：触发条件 */
  when: string
  /** 前后对照示例（真实源码 / 真实产物） */
  example: { before: string; after: string }
  /** 如何验证：对应单测 / golden fixture */
  verify: string
  /** 状态：implemented（已实现）/ planned（规划中）/ limitation（明确不支持的 MVP 限制） */
  status: RuleStatus
  /** 实现位置（文件:函数/行），AI 跳读源码用 */
  source: string
  /** 相关决策号（PROJECT_MEMORY.md 中的 #N） */
  decision?: string
  /** 表驱动的映射（与 tags.ts 常量同源引用，防漂移；registry 测试校验覆盖完整性） */
  mapping?: Record<string, string>
}

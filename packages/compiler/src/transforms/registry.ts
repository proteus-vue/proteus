// src/compiler/transforms/registry.ts
// 编译规则注册表 —— 编译器能力清单的单一事实来源
// AI 消费入口：
//   listTransformRules(phase?)   枚举全部规则（能力清单）
//   getTransformRule(id)         查单条规则（what/why/when/how-verify）
//   formatTransformRule(rule)    渲染单条规则的 AI 说明书（人可读文本）
//   formatTransformCatalog()     渲染全量规则目录（可直出文档 / README 章节）
import type { TransformPhase, TransformRule, RuleContext } from './types'
import { TEMPLATE_RULES } from './template'
import { SCRIPT_RULES } from './script'
import { STYLE_RULES } from './style'
import { VALIDATE_RULES } from './validate'

export type { TransformPhase, TransformRule, RuleStatus, RuleContext, RuleApplier } from './types'

/** 全量规则（聚合各阶段，ID 唯一性由 tests/transforms.test.ts 校验） */
export const TRANSFORM_RULES: readonly TransformRule[] = [
  ...TEMPLATE_RULES,
  ...SCRIPT_RULES,
  ...STYLE_RULES,
  ...VALIDATE_RULES,
]

const byId = new Map<string, TransformRule>(TRANSFORM_RULES.map((r) => [r.id, r]))

/** 按阶段枚举规则（省略 phase 返回全部） */
export function listTransformRules(phase?: TransformPhase): TransformRule[] {
  return phase ? TRANSFORM_RULES.filter((r) => r.phase === phase) : [...TRANSFORM_RULES]
}

/** 按稳定 ID 查单条规则 */
export function getTransformRule(id: string): TransformRule | undefined {
  return byId.get(id)
}

/** 渲染单条规则的 AI 说明书（人可读文本，可直接喂给 AI / 写入文档） */
export function formatTransformRule(rule: TransformRule): string {
  const lines = [
    `## ${rule.id}（${rule.phase}）`,
    `**${rule.title}** \`[${rule.status}]\``,
    `- 输入 → 输出：${rule.description}`,
    `- 为什么：${rule.why}`,
    `- 触发条件：${rule.when}`,
    `- 示例：`,
    `  - 源码：\`${rule.example.before}\``,
    `  - 产物：\`${rule.example.after}\``,
    `- 如何验证：${rule.verify}`,
    `- 实现位置：${rule.source}`,
  ]
  if (rule.decision) lines.push(`- 决策：${rule.decision}`)
  return lines.join('\n')
}

/** 渲染全量规则目录（按阶段分组） */
export function formatTransformCatalog(): string {
  const phases: TransformPhase[] = ['template', 'script', 'style', 'validate']
  const blocks = phases.map((phase) => {
    const rules = listTransformRules(phase)
    const items = rules.map((r) => `- \`${r.id}\` \`[${r.status}]\` ${r.title}${r.apply ? '（已分派 apply）' : ''}`).join('\n')
    return `### ${phase} 阶段（${rules.length} 条规则）\n\n${items}`
  })
  return blocks.join('\n\n')
}

/**
 * ★阶段三分派层：按规则 ID 执行（AI 覆盖 apply 即获得新能力，底线循环 ① 完全形态）
 * - 规则未登记 apply → 抛错（提示跳读 source 实现，注册表仍可作描述层）
 * - 未知规则 ID → 抛错（防笔误，对齐 rules.disabled 的编译期警告）
 */
export function executeRule(id: string, ctx: RuleContext): void {
  const rule = byId.get(id)
  if (!rule) {
    throw new Error(`[proteus] executeRule 未知规则 ID: ${id}`)
  }
  if (!rule.apply) {
    throw new Error(`[proteus] 规则 ${id} 未登记 apply()（描述层规则；实现见 ${rule.source}——AI 可登记 apply 后经分派层生效）`)
  }
  rule.apply(ctx)
}

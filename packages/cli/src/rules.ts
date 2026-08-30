// packages/cli/src/rules.ts
// proteus rules —— 编译器能力清单（AI 说明书目录）
import { formatTransformCatalog, listTransformRules } from '@proteus-vue/compiler'
import type { TransformPhase } from '@proteus-vue/compiler'

export function listRules(phase?: string): string {
  if (phase) {
    const rules = listTransformRules(phase as TransformPhase)
    return rules.map((r) => `- \`${r.id}\` \`[${r.status}]\` ${r.title}`).join('\n')
  }
  return formatTransformCatalog()
}

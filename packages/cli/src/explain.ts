// packages/cli/src/explain.ts
// proteus explain —— 底线循环 ② 的命令行化：
//   <vue 文件> → 决策 trace（该文件实际触发的全部转换规则）
//   <规则 ID>  → 该规则的 AI 说明书（what/why/when/example/verify/source）
import fs from 'node:fs'
import { explainTransform, formatTransformTrace, getTransformRule, formatTransformRule } from '@proteus-vue/compiler'

/** 智能识别目标：文件存在 → vue 决策 trace；否则 → 规则 ID 的 AI 说明书（纯函数，可单测） */
export function explainTarget(target: string): string {
  if (fs.existsSync(target)) {
    const source = fs.readFileSync(target, 'utf-8')
    const result = explainTransform(source, { filename: target })
    return formatTransformTrace(result)
  }
  const rule = getTransformRule(target)
  if (rule) return formatTransformRule(rule)
  throw new Error(`无法识别目标「${target}」：既不是存在的 .vue 文件，也不是注册的规则 ID（用 proteus rules 查看全部规则）`)
}

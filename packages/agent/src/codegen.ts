// packages/agent/src/codegen.ts
// ★G-36 B2（proteus-ai-agent-plan 04-agent-kit §3）：generateCode——IR → 代码（规则引擎，无需 LLM）
//   sfc：Vue SFC 模板（p-* 原语 + props 序列化）/ ts：类型化 ComponentIR 模块
//   G-36 降级策略的代码产出端：LLM 不可用时 Agent 直接消费规则引擎产物
import type { BuiltPage } from './ir-builder'
import type { ComponentIR } from '@proteus-vue/component-ir'

export type CodeFormat = 'sfc' | 'ts'

interface CodegenInput {
  name?: string
  ir: ComponentIR
}

function normalizeInput(input: BuiltPage | ComponentIR): CodegenInput {
  if ('ir' in input && (input as BuiltPage).ir) {
    const page = input as BuiltPage
    return { name: page.name, ir: page.ir }
  }
  return { ir: input as ComponentIR }
}

/** prop 值序列化：{{expr}} 绑定保持原样；字符串加引号；布尔/数字字面量；对象 JSON */
function serializeProp(value: unknown): string {
  if (typeof value === 'string') {
    // {{name}} 模板绑定 → Vue 插值绑定 :prop="'...'"——B2 保持字面量（绑定消费由业务接线）
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function selfClosing(node: ComponentIR): boolean {
  return node.children.length === 0
}

function emitNode(node: ComponentIR, indent: string, lines: string[]): void {
  const attrs = Object.entries(node.props)
    .map(([k, v]) => `${k}=${serializeProp(v)}`)
    .join(' ')
  const open = attrs ? `<${node.tag} ${attrs}` : `<${node.tag}`
  if (selfClosing(node)) {
    lines.push(`${indent}${open} />`)
    return
  }
  lines.push(`${indent}${open}>`)
  for (const child of node.children) emitNode(child, indent + '  ', lines)
  lines.push(`${indent}</${node.tag}>`)
}

/** ★G-36 B2：generateCode——IR → 代码（规则引擎，无需 LLM） */
export function generateCode(input: BuiltPage | ComponentIR, format: CodeFormat): string {
  const { name, ir } = normalizeInput(input)
  if (format === 'ts') {
    return [
      `// 由 @proteus-vue/agent generateCode 生成（G-32 原语 ComponentIR${name ? `：${name}` : ''}）`,
      `export const component = ${JSON.stringify(ir, null, 2)} as const`,
      '',
      '// 消费：renderComponentSnapshot(backend, component) → 多端渲染；禁止手改生成物（G-36 铁律）',
    ].join('\n')
  }
  const lines: string[] = ['<template>']
  emitNode(ir, '  ', lines)
  lines.push('</template>')
  return lines.join('\n')
}

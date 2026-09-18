// packages/compiler/src/style-safety/constants.ts
// G-31 style-safety B3：从 <script setup> 提取顶层 const 字面量常量表（05 §5 常量折叠数据源）
// 与 compiler/script.ts 的 evalLiteral 同信任域（构建期求值开发者自身源码字面量）
// ★零依赖纯函数；仅提取顶层 const 字面量/简单表达式，非顶层或不可求值返回 undefined

/** 构建期求值字面量表达式（Function 构造，信任域 = 开发者自身源码，与 script.ts 同） */
function evalLiteral(expr: string): unknown {
  try {
    return Function(`"use strict"; return (${expr})`)()
  } catch {
    return undefined
  }
}

const TOP_LEVEL_CONST_RE = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/gm

/** 判断匹配起点是否在行首（零缩进顶层） */
function isLineStart(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf('\n', index) + 1
  return source.slice(lineStart, index).trim() === ''
}

/** 排除运行时值形态（ref/computed/inject/defineProps 等——编译期不可求值） */
const RUNTIME_VALUE_RE = /^(ref|reactive|computed|inject|defineProps|defineEmits|withDefaults|watch|onMounted|use[A-Z]|import|require)\s*\(/

/**
 * 提取顶层 const 字面量常量表：`const baseWidth = 100` → { baseWidth: 100 }
 * 支持：字面量（数字/字符串/布尔/null）、数组/对象字面量、简单二元（100*2）
 * 跳过：ref(100)/函数调用/import/非顶层缩进
 */
export function extractScriptConstants(scriptSource: string): Record<string, unknown> {
  const constants: Record<string, unknown> = {}
  let m: RegExpExecArray | null
  while ((m = TOP_LEVEL_CONST_RE.exec(scriptSource)) !== null) {
    if (!isLineStart(scriptSource, m.index)) continue
    const expr = m[2].trim()
    if (RUNTIME_VALUE_RE.test(expr)) continue
    const value = evalLiteral(expr)
    // 排除函数值（箭头函数/普通函数是运行时形态）与 undefined
    if (value !== undefined && typeof value !== 'function') constants[m[1]] = value
  }
  return constants
}

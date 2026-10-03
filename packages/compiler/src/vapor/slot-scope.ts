// packages/compiler/src/vapor/slot-scope.ts —— ★★★**作用域插槽变量形态解析**（2026-10-03）
//
// 【这一层解决什么（扫描出的真实缺口）】`<template #default="{ errors }">` —— **解构形态**
//   此前被拒（"只支持简单标识符"）⇒ 内容里的 `errors` 读不到出口 props（静默空值）。
//   它在组件库页面里很常见（语义原语组件的错误提示就是这么写的）。
//
// 【Vue 语义】`#x="sp"` ⇒ `sp` 绑定到**插槽 props 对象**；`#x="{ a, b: c }"` ⇒ 把该对象
//   **解构**进内容作用域（`a` = props.a；`c` = props.b）。本模块把这两种形态解析成
//   "名字 → props 的哪个键"的映射（求值端只做查表，不重解析）。
//
// 【★唯一入口（三处共用）】template.ts（打标记/诊断）、deps.ts（作用域变量集——防幽灵源）、
//   instantiate.ts（分发时求值）都用本函数 ⇒ 形态判据不会漂移。
//
// 【诚实边界】① 嵌套解构（`{ a: { b } }`）不支持——需递归绑定（独立批次，诊断说明）；
//   ② 默认值（`{ a = 1 }`）不支持——**注意**：Vue 里默认值是"props 该键为 undefined 时用默认"，
//     本批不支持 ⇒ 诊断（不静默当"无默认值"处理）；③ 剩余项（`...rest`）不支持——同上。
import { parse as babelParse } from '@babel/parser'

export type SlotScopeParse =
  | { kind: 'none' }
  /** `#x="sp"` —— 整个 props 对象绑到一个名字 */
  | { kind: 'simple'; name: string }
  /** `#x="{ errors }"` / `#x="{ errors: e }"` —— 解构：局部名 → props 键 */
  | { kind: 'destructure'; entries: Array<{ local: string; key: string }> }
  | { kind: 'unsupported'; reason: string }

/**
 * 解析 v-slot 的作用域表达式（`exp.content`）。
 * @param scopeCode 作用域源码（无 ⇒ 空串/undefined ⇒ `kind:'none'`）
 */
export function parseSlotScope(scopeCode: string | undefined): SlotScopeParse {
  const src = (scopeCode ?? '').trim()
  if (!src) return { kind: 'none' }
  // 简单标识符（最常见形态——零解析开销的快路径）
  if (/^[A-Za-z_$][\w$]*$/.test(src)) return { kind: 'simple', name: src }
  if (!src.startsWith('{')) {
    return { kind: 'unsupported', reason: `不认识的变量形态（只支持单名如 \`sp\` 或对象解构如 \`{ errors }\`）` }
  }
  // ★**必须当成"变量声明"解析**（本仓实测的坑）：`({ a } )` 会被解析成
  //   `ParenthesizedExpression(ObjectExpression)`（对象**字面量**），而不是 `ObjectPattern`
  //   （解构模式）——两者 AST 类型不同，按前者判会一律落进"不支持"分支。
  //   ⇒ 用 `const { a } = __slot` 的**声明形态**解析，取 declarator 的 id（就是 ObjectPattern）。
  let ast: unknown
  try {
    ast = babelParse(`const ${src} = __slot_props__`, { sourceType: 'module', plugins: ['typescript'] })
  } catch {
    return { kind: 'unsupported', reason: '解构形态解析失败（语法无法识别）' }
  }
  const decl = (ast as { program?: { body?: Array<{ declarations?: Array<{ id?: Record<string, unknown> }> }> } })
    ?.program?.body?.[0]?.declarations?.[0]
  const stmt = decl?.id
  if (!stmt || stmt.type !== 'ObjectPattern') {
    return { kind: 'unsupported', reason: '只支持对象解构（如 `{ a, b: c }`）' }
  }
  const entries: Array<{ local: string; key: string }> = []
  for (const raw of (stmt.properties as Array<Record<string, unknown>>) ?? []) {
    const p = raw as {
      type?: string
      computed?: boolean
      key?: { type?: string; name?: string; value?: unknown }
      value?: { type?: string; name?: string }
      // 默认值 / 剩余项
      left?: { type?: string; name?: string }
      right?: unknown
      argument?: { type?: string; name?: string }
    }
    if (p.type === 'RestElement') {
      return { kind: 'unsupported', reason: '剩余项（`...rest`）不支持——请显式列出需要的键' }
    }
    if (p.type === 'ObjectProperty') {
      const key = p.key?.type === 'Identifier' ? String(p.key.name) : p.key?.type === 'StringLiteral' ? String(p.key.value) : undefined
      if (!key || p.computed) {
        return { kind: 'unsupported', reason: '计算键不支持的解构形态——请用静态键' }
      }
      // 默认值（`{ a = 1 }`）：Vue 语义是"props.a 为 undefined 时用 1"——本批不支持（不静默）
      if (p.value?.type === 'AssignmentPattern' || p.right !== undefined) {
        return {
          kind: 'unsupported',
          reason: `默认值（\`${key} = …\`）不支持——请改用 \`sp.${key} ?? fallback\` 写法或保留 Vue 渲染路径`,
        }
      }
      const local = p.value?.type === 'Identifier' ? String(p.value.name) : undefined
      if (!local) {
        return { kind: 'unsupported', reason: `键 \`${key}\` 的值不是简单标识符（嵌套解构不支持）` }
      }
      entries.push({ local, key })
      continue
    }
    return { kind: 'unsupported', reason: '解构里含不支持的成员形态' }
  }
  if (entries.length === 0) return { kind: 'unsupported', reason: '空解构（`{}`）无意义' }
  return { kind: 'destructure', entries }
}

/** 该解析结果的**局部变量名集**（deps.ts 的 scopes 屏蔽用——防"解构名被当顶层源"） */
export function localNamesOf(parsed: SlotScopeParse): string[] {
  switch (parsed.kind) {
    case 'simple': return [parsed.name]
    case 'destructure': return parsed.entries.map((e) => e.local)
    default: return []
  }
}

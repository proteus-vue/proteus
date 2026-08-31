// packages/test-core/src/snapshot/assert.ts
// ★test-framework B2：JS 关键导出存在性 + JSON 键序稳定化（02-snapshot-compile.md §快照对象 .js/.json）
// checkJsExports：Page/Component/App/module.exports 配置对象顶层键存在性（"关键导出存在性"）
// normalizeJson：键排序稳定序列化（结构化 deep-equal 的快照友好形态）
// 纯 TS 零依赖（手写平衡扫描提取对象字面量顶层键，产物 JS 为编译器生成、形态可控）
/** 从对象字面量 `{` 起始位置提取顶层键（按顶层逗号切分 + key 识别） */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let inStr: string | null = null
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (inStr !== null) {
      if (c === inStr && body[i - 1] !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** 键识别：`key: value` / `key(args) {...}`（方法简写）/ `key`（属性简写） */
function keyOf(part: string): string | null {
  const colon = part.match(/^([A-Za-z_$][\w$]*)\s*(?::|=)/)
  if (colon) return colon[1] as string
  const method = part.match(/^([A-Za-z_$][\w$]*)\s*\(/)
  if (method) return method[1] as string
  const shorthand = part.match(/^([A-Za-z_$][\w$]*)$/)
  if (shorthand) return shorthand[1] as string
  return null
}

/** 提取配置对象（Page/Component/App/module.exports）顶层键集合 */
export function topLevelConfigKeys(js: string): string[] {
  const found = new Set<string>()
  for (const loc of ['Page', 'Component', 'App', 'module.exports']) {
    let idx = 0
    for (;;) {
      const at = js.indexOf(loc, idx)
      if (at === -1) break
      const open = js.indexOf('{', at + loc.length)
      if (open !== -1) {
        // 平衡扫描到匹配的 `}`（对象字面量体）
        let depth = 0
        let inStr: string | null = null
        let end = -1
        for (let i = open; i < js.length; i++) {
          const c = js[i]
          if (inStr !== null) {
            if (c === inStr && js[i - 1] !== '\\') inStr = null
            continue
          }
          if (c === '"' || c === "'" || c === '`') {
            inStr = c
            continue
          }
          if (c === '{') depth++
          else if (c === '}') {
            depth--
            if (depth === 0) {
              end = i
              break
            }
          }
        }
        if (end !== -1) {
          for (const part of splitTopLevel(js.slice(open + 1, end))) {
            const k = keyOf(part)
            if (k) found.add(k)
          }
        }
      }
      idx = at + loc.length
    }
  }
  return [...found]
}

/** JS 关键导出存在性：返回缺失键列表（空数组 = 全部存在） */
export function checkJsExports(js: string, expected: string[]): string[] {
  const found = new Set(topLevelConfigKeys(js))
  return expected.filter((k) => !found.has(k))
}

/** 键排序稳定 JSON（嵌套对象键排序；数组保持顺序）——结构化 deep-equal 的快照友好形态 */
export function normalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2)
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, val]) => [k, sortKeys(val)] as [string, unknown])
    return Object.fromEntries(entries)
  }
  return v
}

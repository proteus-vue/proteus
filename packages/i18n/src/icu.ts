// packages/i18n/src/icu.ts
// ICU MessageFormat 子集解析器（i18n-plan B1）
// 支持：{name} 插值 / {count, plural, one{..} other{..} =N{..}} / {gender, select, male{..} female{..} other{..}} / # 数量占位
// 简化边界（落地评估 v2 §1）：完整 ICU（few/many 复数规则、date/number 格式）标后续批次
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

export type FormatParams = Record<string, unknown>

export interface ParsedCase {
  cases: Record<string, string>
  keys: string[]
}

interface ParsedArg {
  name: string
  format: string
  cases: ParsedCase | null
  end: number
}

/** 提取花括号块（嵌套安全）：content[idx] 必须是 '{'，返回 { body, end } */
function extractBraced(content: string, idx: number): { body: string; end: number } | null {
  if (content[idx] !== '{') return null
  let depth = 0
  let i = idx
  while (i < content.length) {
    const ch = content[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { body: content.slice(idx + 1, i), end: i + 1 }
    }
    i++
  }
  return null
}

/** 读取参数块（idx 指向 '{' 之后）：'name' / 'name, format' / 'name, format, spec' */
function readArgBlock(msg: string, idx: number): ParsedArg {
  let i = idx
  let name = ''
  while (i < msg.length && msg[i] !== ',' && msg[i] !== '}') {
    name += msg[i]
    i++
  }
  name = name.trim()
  if (msg[i] === '}') return { name, format: '', cases: null, end: i + 1 }
  i++ // 跳过 ','
  let format = ''
  while (i < msg.length && msg[i] !== ',' && msg[i] !== '}') {
    format += msg[i]
    i++
  }
  format = format.trim()
  let cases: ParsedCase | null = null
  if (msg[i] === ',') {
    i++ // 跳过 ','
    cases = { cases: {}, keys: [] }
    // 解析 spec：caseName{...} 序列直到闭合 '}'
    while (i < msg.length && msg[i] !== '}') {
      let cn = ''
      while (i < msg.length && msg[i] !== '{' && msg[i] !== '}') {
        cn += msg[i]
        i++
      }
      cn = cn.trim()
      if (msg[i] !== '{') break
      const block = extractBraced(msg, i)
      if (!block) break
      cases.cases[cn] = block.body
      cases.keys.push(cn)
      i = block.end
    }
  }
  const end = msg[i] === '}' ? i + 1 : i
  return { name, format, cases, end }
}

/** 渲染单个参数块 */
function renderArg(parsed: ParsedArg, params: FormatParams, hashValue?: string): string {
  if (parsed.format === '') {
    const v = params[parsed.name]
    return v === undefined || v === null ? '' : String(v)
  }
  if (!parsed.cases) return '' // 未支持格式（date/number 等）→ 空串（后续批次）
  if (parsed.format === 'plural') {
    const count = Number(params[parsed.name])
    // 精确值 =N 优先
    for (let k = 0; k < parsed.cases.keys.length; k++) {
      const key = parsed.cases.keys[k]
      if (key.charAt(0) === '=' && Number(key.slice(1)) === count) {
        return renderMessage(parsed.cases.cases[key], params, String(count))
      }
    }
    const key = count === 1 ? 'one' : 'other'
    const body = parsed.cases.cases[key] ?? parsed.cases.cases.other ?? ''
    return renderMessage(body, params, String(count))
  }
  if (parsed.format === 'select') {
    const v = params[parsed.name]
    const key = v === undefined || v === null ? '' : String(v)
    const body = parsed.cases.cases[key] ?? parsed.cases.cases.other ?? ''
    return renderMessage(body, params, hashValue)
  }
  return ''
}

/**
 * 渲染消息模板：{name} 插值 / plural / select / # 数量占位（hashValue 仅在 plural 分支传入）
 * 孤儿 '}' 跳过防崩溃；未知参数渲染为空串（审计可见）
 */
export function renderMessage(message: string, params: FormatParams, hashValue?: string): string {
  let out = ''
  let i = 0
  while (i < message.length) {
    const ch = message[i]
    if (ch === '}') {
      i++
      continue
    }
    if (ch === '{') {
      const parsed = readArgBlock(message, i + 1)
      out += renderArg(parsed, params, hashValue)
      i = parsed.end
    } else {
      if (ch === '#' && hashValue !== undefined) out += hashValue
      else out += ch
      i++
    }
  }
  return out
}

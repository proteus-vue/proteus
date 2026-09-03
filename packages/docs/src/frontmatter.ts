// packages/docs/src/frontmatter.ts
// ★YAML-lite frontmatter 解析（docs 子集：key: value / key: 数组 / 布尔数字归一 / 去引号）

export interface FrontmatterSplit {
  readonly data: Record<string, string | number | boolean | string[]>
  readonly body: string
}

function coerceValue(raw: string): string | number | boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
  return v
}

/** 解析 frontmatter（YAML-lite；无 frontmatter → 空 data + 原文） */
export function parseFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---\n')) return { data: {}, body: source }
  const end = source.indexOf('\n---', 4)
  if (end < 0) return { data: {}, body: source }
  const yamlBlock = source.slice(4, end)
  const body = source.slice(end + 4).replace(/^\n/, '')
  const data: Record<string, string | number | boolean | string[]> = {}
  let currentKey: string | null = null

  for (const rawLine of yamlBlock.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    // 数组项（"- item"，两空格缩进）
    if (/^\s+-\s+/.test(line) && currentKey) {
      const arr = data[currentKey]
      if (Array.isArray(arr)) arr.push(line.trim().slice(2).trim())
      continue
    }
    const m = line.match(/^([A-Za-z_$][\w$-]*)\s*:\s*(.*)$/)
    if (!m) continue
    currentKey = m[1]
    if (m[2] === '') {
      data[currentKey] = [] // 等待数组项；无项则为空数组
    } else if (m[2].startsWith('[') && m[2].endsWith(']')) {
      data[currentKey] = m[2].slice(1, -1).split(',').map((s) => coerceValue(s)) as string[]
      currentKey = null
    } else {
      data[currentKey] = coerceValue(m[2])
      currentKey = null
    }
  }
  return { data, body }
}

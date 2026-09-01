// packages/devtools/src/views/inspector.ts
// 共享 key-value inspector 树渲染（state 视图 store 详情 / components 视图组件详情复用）
// 纯函数：data → DOM；可折叠（object/array 行点击展开/收起，子层惰性构建）

type ValueKind = 'number' | 'string' | 'boolean' | 'null' | 'object' | 'array'

function kindOf(value: unknown): ValueKind {
  if (value === null || value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return 'number'
  if (t === 'string') return 'string'
  if (t === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

/** 单行摘要（object/array 折叠态显示） */
export function summarize(value: unknown): string {
  const k = kindOf(value)
  if (k === 'array') return 'Array(' + (value as unknown[]).length + ')'
  if (k === 'object') {
    const keys = Object.keys(value as object)
    return 'Object {' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') + '}'
  }
  return formatPrimitive(value, k)
}

function formatPrimitive(value: unknown, kind: ValueKind): string {
  if (kind === 'string') return JSON.stringify(value)
  if (kind === 'null') return value === undefined ? 'undefined' : 'null'
  return String(value)
}

/** 递归渲染 key-value 树（可折叠：object/array 行点击展开/收起） */
export function renderKeyValue(container: HTMLElement, key: string, value: unknown, depth: number, initiallyOpen = false): void {
  const kind = kindOf(value)
  const row = document.createElement('div')
  row.className = 'pd-kv'
  row.style.paddingLeft = 10 + depth * 14 + 'px'
  const toggle = document.createElement('span')
  toggle.className = 'pd-kv-toggle'
  const keyEl = document.createElement('span')
  keyEl.className = 'pd-kv-key'
  keyEl.textContent = key
  const valEl = document.createElement('span')
  valEl.className = 'pd-kv-value pd-t-' + kind
  const collapsible = kind === 'object' || kind === 'array'
  toggle.textContent = collapsible ? '▸' : ''
  if (collapsible) {
    valEl.textContent = summarize(value)
    const childBox = document.createElement('div')
    // ★根节点默认展开（inspector 首层可见）；子层惰性构建
    childBox.style.display = initiallyOpen ? 'block' : 'none'
    if (initiallyOpen) toggle.textContent = '▾'
    let built = false
    const build = (): void => {
      if (built) return
      built = true
      const entries: Array<[string, unknown]> =
        kind === 'array' ? (value as unknown[]).map((v, i) => [String(i), v]) : Object.entries(value as Record<string, unknown>)
      for (const [k, v] of entries) renderKeyValue(childBox, k, v, depth + 1)
    }
    if (initiallyOpen) build()
    const expand = (): void => {
      const open = childBox.style.display !== 'none'
      childBox.style.display = open ? 'none' : 'block'
      toggle.textContent = open ? '▸' : '▾'
      if (!open) build()
    }
    row.addEventListener('click', expand)
    row.appendChild(toggle)
    row.appendChild(keyEl)
    row.appendChild(valEl)
    container.appendChild(row)
    container.appendChild(childBox)
    return
  }
  valEl.textContent = formatPrimitive(value, kind)
  row.appendChild(toggle)
  row.appendChild(keyEl)
  row.appendChild(valEl)
  container.appendChild(row)
}

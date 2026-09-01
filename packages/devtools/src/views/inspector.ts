// packages/devtools/src/views/inspector.ts
// 共享 key-value inspector 树渲染（state 视图 store 详情 / components 视图组件详情复用）
// 纯函数：data → DOM；可折叠（object/array 行点击展开/收起，子层惰性构建）

type ValueKind = 'number' | 'string' | 'boolean' | 'null' | 'object' | 'array'

/** 值编辑钩子（state 视图双向调试；components 视图不传则只读） */
export interface InspectorEditHooks {
  /** 原始值编辑提交（path 相对渲染根；非法输入不回调） */
  onEdit?: (path: Array<string | number>, value: unknown) => void
}

/** 编辑输入框初始值（string 去引号——展示是 JSON.stringify，编辑用原始文本） */
function editInitial(value: unknown, kind: ValueKind): string {
  if (kind === 'string') return String(value)
  if (kind === 'null') return value === undefined ? 'undefined' : 'null'
  return String(value)
}

/** 解析编辑文本（按原始 kind 严格解析：number→NaN 还原 / boolean→非 true|false 还原 / string→原样 / null→灵活） */
function parseEdit(text: string, kind: ValueKind): { ok: true; value: unknown } | { ok: false } {
  if (kind === 'number') {
    const n = Number(text.trim())
    if (!Number.isFinite(n)) return { ok: false }
    return { ok: true, value: n }
  }
  if (kind === 'boolean') {
    if (text.trim() === 'true') return { ok: true, value: true }
    if (text.trim() === 'false') return { ok: true, value: false }
    return { ok: false }
  }
  if (kind === 'string') return { ok: true, value: text }
  // null/undefined：'' 或 null → null；undefined → undefined；true/false → 布尔；数字 → number；否则 string
  const t = text.trim()
  if (t === '' || t === 'null') return { ok: true, value: null }
  if (t === 'undefined') return { ok: true, value: undefined }
  if (t === 'true') return { ok: true, value: true }
  if (t === 'false') return { ok: true, value: false }
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: Number(t) }
  return { ok: true, value: text }
}

/** ★值编辑：点击原始值 → 输入框（Enter 提交 / Esc 取消 / blur 提交）；非法输入还原 */
function startEdit(valEl: HTMLElement, value: unknown, kind: ValueKind, path: Array<string | number>, hooks: InspectorEditHooks): void {
  const input = document.createElement('input')
  input.className = 'pd-kv-edit'
  input.value = editInitial(value, kind)
  valEl.replaceWith(input)
  input.focus()
  let done = false
  const finish = (commit: boolean): void => {
    if (done) return
    done = true
    if (commit) {
      const parsed = parseEdit(input.value, kind)
      if (parsed.ok) {
        // 成功：更新值展示（类型/文本随新值变化）后还原为只读元素
        const nk = kindOf(parsed.value)
        valEl.textContent = formatPrimitive(parsed.value, nk)
        valEl.className = 'pd-kv-value pd-t-' + nk
        input.replaceWith(valEl)
        hooks.onEdit?.(path, parsed.value)
      } else {
        input.replaceWith(valEl) // 非法输入 → 还原原值
      }
      return
    }
    input.replaceWith(valEl)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    else if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

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

/** 递归渲染 key-value 树（可折叠：object/array 行点击展开/收起；★path + hooks 支持原始值编辑双向调试） */
export function renderKeyValue(container: HTMLElement, key: string, value: unknown, depth: number, initiallyOpen = false, path: Array<string | number> = [], hooks: InspectorEditHooks = {}): void {
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
      for (const [k, v] of entries) renderKeyValue(childBox, k, v, depth + 1, false, path.concat(k), hooks)
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
  // ★双向调试：有 onEdit 钩子 → 点击值进入编辑（Enter/blur 提交、Esc 取消、非法还原）
  if (hooks.onEdit) {
    valEl.classList.add('pd-kv-editable')
    valEl.addEventListener('click', (e) => {
      e.stopPropagation()
      startEdit(valEl, value, kind, path, hooks)
    })
  }
  row.appendChild(toggle)
  row.appendChild(keyEl)
  row.appendChild(valEl)
  container.appendChild(row)
}

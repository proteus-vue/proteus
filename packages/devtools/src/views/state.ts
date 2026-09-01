// packages/devtools/src/views/state.ts
// DevTools 状态视图：Vue DevTools inspector 风格 —— key-value 树（可折叠嵌套 + 类型着色）+ 时间旅行滑块
import type { StateSnapshot, PatchStep } from '@proteus-vue/devtools-runtime'

export interface StateViewHooks {
  /** 时间旅行回放到第 index 步（index = -1 表示初始快照） */
  onTimeTravel?: (index: number) => void
  /** 导出快照 */
  onExport?: () => void
}

export interface StateViewData {
  snapshot: StateSnapshot
  steps: PatchStep[]
}

type ValueKind = 'number' | 'string' | 'boolean' | 'null' | 'object' | 'array'

function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null'
  if (value === undefined) return 'null'
  const t = typeof value
  if (t === 'number') return 'number'
  if (t === 'string') return 'string'
  if (t === 'boolean') return 'boolean'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

/** 单行摘要（object/array 折叠态显示） */
function summarize(value: unknown): string {
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
function renderValue(container: HTMLElement, key: string, value: unknown, depth: number, initiallyOpen = false): void {
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
      for (const [k, v] of entries) renderValue(childBox, k, v, depth + 1)
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

export function renderState(container: HTMLElement, data: StateViewData, hooks: StateViewHooks = {}): void {
  container.replaceChildren()
  // 工具栏：导出 + 步骤计数
  const toolbar = document.createElement('div')
  toolbar.className = 'pd-toolbar'
  const exportBtn = document.createElement('button')
  exportBtn.className = 'pd-btn'
  exportBtn.textContent = '导出快照 JSON'
  exportBtn.addEventListener('click', () => hooks.onExport?.())
  toolbar.appendChild(exportBtn)
  const stepInfo = document.createElement('span')
  stepInfo.textContent = '步骤 ' + data.steps.length + ' · stores ' + data.snapshot.stores.length
  toolbar.appendChild(stepInfo)
  container.appendChild(toolbar)

  // 时间旅行滑块
  if (data.steps.length > 0) {
    const sliderRow = document.createElement('div')
    sliderRow.className = 'pd-toolbar'
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = String(data.steps.length - 1)
    input.value = String(data.steps.length - 1)
    input.className = 'pd-range'
    const hint = document.createElement('span')
    hint.textContent = '回放 1/' + data.steps.length
    input.addEventListener('input', () => {
      const i = Number(input.value)
      hint.textContent = '回放 ' + (i + 1) + '/' + data.steps.length
      hooks.onTimeTravel?.(i)
    })
    sliderRow.appendChild(input)
    sliderRow.appendChild(hint)
    container.appendChild(sliderRow)
  }

  // store 列表（inspector 树）
  for (const store of data.snapshot.stores) {
    const card = document.createElement('details')
    card.className = 'pd-store'
    card.open = true
    const summary = document.createElement('summary')
    summary.textContent = store.id
    card.appendChild(summary)
    const inspector = document.createElement('div')
    inspector.className = 'pd-inspector'
    renderValue(inspector, '(root)', store.state, 0, true)
    card.appendChild(inspector)
    container.appendChild(card)
  }
  if (data.snapshot.stores.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无 store（TraceBus store 事件未上报）'
    container.appendChild(empty)
  }
}

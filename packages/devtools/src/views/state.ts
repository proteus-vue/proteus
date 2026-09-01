// packages/devtools/src/views/state.ts
// DevTools 状态视图（★对标 Vue DevTools Pinia 面板）：store 选择器 + 详情（state inspector 树 + actions/patches 时间线）+ 时间旅行滑块
// 纯函数：data → DOM（selectedStore/onSelectStore 由调用方持有状态）
import type { StateSnapshot, PatchStep } from '@proteus-vue/devtools-runtime'

export interface StateViewHooks {
  /** 时间旅行回放到第 index 步（index = -1 表示初始快照） */
  onTimeTravel?: (index: number) => void
  /** 选中 store（Pinia 面板布局：单选详情） */
  onSelectStore?: (id: string) => void
  /** 导出快照 */
  onExport?: () => void
}

export interface StateViewData {
  snapshot: StateSnapshot
  steps: PatchStep[]
  /** 当前选中 store（缺省第一个有快照的 store） */
  selectedStore?: string
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
  const stores = data.snapshot.stores
  // 选中 store：显式 selected 优先，缺省第一个
  const selected = data.selectedStore !== undefined && stores.some((s) => s.id === data.selectedStore) ? data.selectedStore : (stores[0]?.id ?? '')

  // 工具栏：导出 + 计数
  const toolbar = document.createElement('div')
  toolbar.className = 'pd-toolbar'
  const exportBtn = document.createElement('button')
  exportBtn.className = 'pd-btn'
  exportBtn.textContent = '导出快照 JSON'
  exportBtn.addEventListener('click', () => hooks.onExport?.())
  toolbar.appendChild(exportBtn)
  const stepInfo = document.createElement('span')
  stepInfo.textContent = '步骤 ' + data.steps.length + ' · stores ' + stores.length
  toolbar.appendChild(stepInfo)
  container.appendChild(toolbar)

  // ★Pinia 面板布局：store 选择器（chips 单选）
  if (stores.length) {
    const picker = document.createElement('div')
    picker.className = 'pd-store-picker'
    for (const s of stores) {
      const chip = document.createElement('button')
      chip.className = 'pd-store-chip' + (s.id === selected ? ' pd-store-chip-active' : '')
      chip.textContent = s.id
      chip.addEventListener('click', () => hooks.onSelectStore?.(s.id))
      picker.appendChild(chip)
    }
    container.appendChild(picker)
  }

  // 详情：选中 store 的 state 树 + actions/patches 时间线
  const sel = stores.find((s) => s.id === selected)
  if (sel) {
    const card = document.createElement('div')
    card.className = 'pd-store'
    const head = document.createElement('div')
    head.className = 'pd-store-head'
    head.textContent = selected + ' · state'
    card.appendChild(head)
    const inspector = document.createElement('div')
    inspector.className = 'pd-inspector'
    renderValue(inspector, '(root)', sel.state, 0, true)
    card.appendChild(inspector)
    container.appendChild(card)

    // ★actions / patches 时间线（该 store 的步骤，点击 → 时间旅行）
    const mine = data.steps.filter((st) => st.storeId === selected)
    const tl = document.createElement('div')
    tl.className = 'pd-store-timeline'
    const tlHead = document.createElement('div')
    tlHead.className = 'pd-section-head'
    tlHead.textContent = 'actions / patches（' + mine.length + '）'
    tl.appendChild(tlHead)
    if (mine.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'pd-empty'
      empty.textContent = '暂无变更'
      tl.appendChild(empty)
    }
    // 倒序（最新在上）
    for (let i = mine.length - 1; i >= 0; i--) {
      const st = mine[i]
      const row = document.createElement('div')
      row.className = 'pd-tl-row'
      const badge = document.createElement('span')
      const isAction = st.type === 'action'
      badge.className = 'pd-tl-badge ' + (isAction ? 'pd-tl-action' : 'pd-tl-patch')
      badge.textContent = isAction ? 'action' : 'patch'
      const name = document.createElement('span')
      name.className = 'pd-tl-name'
      name.textContent = String((st.payload as { name?: string } | undefined)?.name ?? '?')
      const meta = document.createElement('span')
      meta.className = 'pd-tl-meta'
      meta.textContent = '#' + st.index + ' · ' + st.timestamp + 'ms'
      row.appendChild(badge)
      row.appendChild(name)
      row.appendChild(meta)
      row.addEventListener('click', () => hooks.onTimeTravel?.(st.index))
      tl.appendChild(row)
    }
    container.appendChild(tl)
  }

  // 时间旅行滑块（全局步骤）
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

  if (stores.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无 store（TraceBus store 事件未上报）'
    container.appendChild(empty)
  }
}

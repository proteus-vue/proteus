// packages/devtools/src/views/state.ts
// DevTools 状态视图（★对标 Vue DevTools Pinia 面板）：store 选择器 + 详情（state inspector 树 + actions/patches 时间线）+ 时间旅行滑块
// 纯函数：data → DOM（selectedStore/onSelectStore 由调用方持有状态）
import type { StateSnapshot, PatchStep } from '@proteus-vue/devtools-runtime'
import { attachTip } from '../tooltip'
import { renderKeyValue, summarize } from './inspector'

export interface StateViewHooks {
  /** 时间旅行回放到第 index 步（index = -1 表示初始快照） */
  onTimeTravel?: (index: number) => void
  /** 选中 store（Pinia 面板布局：单选详情） */
  onSelectStore?: (id: string) => void
  /** 导出快照（面板侧 Blob 下载） */
  onExport?: () => void
  /** 导入快照 JSON（view 读文件 → 面板解析校验 + 数据重建 + 应用） */
  onImport?: (json: string) => void
}

export interface StateViewData {
  snapshot: StateSnapshot
  steps: PatchStep[]
  /** 当前选中 store（缺省第一个有快照的 store） */
  selectedStore?: string
}

/** 步骤 before/after 差异行（时间旅行 diff 提示；JSON 相等跳过） */
function diffLines(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const lines: string[] = []
  for (const k of keys) {
    const b = before[k]
    const a = after[k]
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    lines.push(k + ': ' + summarize(b) + ' → ' + summarize(a))
  }
  return lines
}

export function renderState(container: HTMLElement, data: StateViewData, hooks: StateViewHooks = {}): void {
  container.replaceChildren()
  const stores = data.snapshot.stores
  // 选中 store：显式 selected 优先，缺省第一个
  const selected = data.selectedStore !== undefined && stores.some((s) => s.id === data.selectedStore) ? data.selectedStore : (stores[0]?.id ?? '')

  // 工具栏：导出 + 导入 + 计数
  const toolbar = document.createElement('div')
  toolbar.className = 'pd-toolbar'
  const exportBtn = document.createElement('button')
  exportBtn.className = 'pd-btn'
  exportBtn.textContent = '导出快照 JSON'
  exportBtn.addEventListener('click', () => hooks.onExport?.())
  toolbar.appendChild(exportBtn)
  // ★P0：导入快照（隐藏 file input → FileReader 读文本 → onImport 交给面板解析/重建/应用）
  const importBtn = document.createElement('button')
  importBtn.className = 'pd-btn'
  importBtn.textContent = '导入快照 JSON'
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.json,application/json'
  fileInput.style.display = 'none'
  importBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    fileInput.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => hooks.onImport?.(String(reader.result ?? ''))
    reader.readAsText(f)
  })
  toolbar.appendChild(importBtn)
  toolbar.appendChild(fileInput)
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
    renderKeyValue(inspector, '(root)', sel.state, 0, true)
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
      // ★P0：真实 before/after diff（hover 提示变更键 + 新旧值）
      const diff = diffLines(st.before, st.after)
      if (diff.length > 0) {
        attachTip(row, { title: st.type + ' #' + st.index, lines: diff })
      }
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

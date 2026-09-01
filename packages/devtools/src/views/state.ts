// packages/devtools/src/views/state.ts
// DevTools 状态视图：store 列表 + JSON 预览 + 时间旅行滑块（回放步骤）
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
  stepInfo.className = 'pd-step-info'
  stepInfo.textContent = `步骤 ${data.steps.length}`
  toolbar.appendChild(stepInfo)
  container.appendChild(toolbar)

  // 时间旅行滑块
  if (data.steps.length > 0) {
    const sliderRow = document.createElement('div')
    sliderRow.className = 'pd-slider-row'
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = String(data.steps.length - 1)
    input.value = String(data.steps.length - 1)
    input.className = 'pd-range'
    const hint = document.createElement('span')
    hint.className = 'pd-slider-hint'
    hint.textContent = '回放'
    input.addEventListener('input', () => {
      hooks.onTimeTravel?.(Number(input.value))
      hint.textContent = '回放 ' + (Number(input.value) + 1) + '/' + data.steps.length
    })
    sliderRow.appendChild(hint)
    sliderRow.appendChild(input)
    container.appendChild(sliderRow)
  }

  // store 列表
  const list = document.createElement('div')
  list.className = 'pd-store-list'
  for (const store of data.snapshot.stores) {
    const card = document.createElement('details')
    card.className = 'pd-store'
    card.open = true
    const summary = document.createElement('summary')
    summary.textContent = store.id
    card.appendChild(summary)
    const pre = document.createElement('pre')
    pre.className = 'pd-json'
    try {
      pre.textContent = JSON.stringify(store.state, null, 2)
    } catch {
      pre.textContent = '(序列化失败)'
    }
    card.appendChild(pre)
    list.appendChild(card)
  }
  container.appendChild(list)
}

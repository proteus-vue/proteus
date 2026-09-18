// packages/devtools/src/tooltip.ts
// 自定义 hover tooltip（对标 Vue DevTools）：元素 hover 显示浮层（标题 + 详情行），跟随鼠标，防抖隐藏
// ★纯 DOM 逻辑（happy-dom 可单测）；浮层挂 document.body 避免容器 overflow 裁剪

export interface TooltipData {
  title: string
  /** 详情行（如 耗时 / 时间戳 / 阶段） */
  lines: string[]
}

/** 视图渲染时把 tooltip 数据挂到元素上（标记 data-tip + 存数据），panel resolve 时直接取 */
const TIP_DATA = Symbol('pdTip')

export function attachTip(el: HTMLElement, data: TooltipData): void {
  el.dataset.tip = ''
  ;(el as unknown as { [TIP_DATA]: TooltipData })[TIP_DATA] = data
}

export function resolveTipData(target: HTMLElement): TooltipData | null {
  return (target as unknown as { [TIP_DATA]?: TooltipData })[TIP_DATA] ?? null
}

export interface TooltipLayer {
  /** 显示浮层（position 相对 viewport） */
  show(data: TooltipData, x: number, y: number): void
  hide(): void
  /** 销毁：从 document.body 移除浮层元素（面板 destroy 时调用） */
  dispose(): void
  readonly visible: boolean
}

export function createTooltipLayer(): TooltipLayer {
  const tip = document.createElement('div')
  tip.className = 'pd-tooltip'
  tip.style.display = 'none'
  tip.style.position = 'fixed'
  tip.style.zIndex = '1000'
  tip.style.pointerEvents = 'none'
  document.body.appendChild(tip)
  let visible = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  return {
    show(data: TooltipData, x: number, y: number): void {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      tip.replaceChildren()
      const title = document.createElement('div')
      title.className = 'pd-tooltip-title'
      title.textContent = data.title
      tip.appendChild(title)
      for (const line of data.lines) {
        const row = document.createElement('div')
        row.className = 'pd-tooltip-line'
        row.textContent = line
        tip.appendChild(row)
      }
      tip.style.display = 'block'
      // 位置：跟随鼠标 + 视口边缘翻转
      const rect = tip.getBoundingClientRect()
      let left = x + 12
      let top = y + 12
      if (left + rect.width > window.innerWidth) left = x - rect.width - 12
      if (top + rect.height > window.innerHeight) top = y - rect.height - 12
      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
      visible = true
    },
    hide(): void {
      if (hideTimer) clearTimeout(hideTimer)
      tip.style.display = 'none'
      visible = false
    },
    dispose(): void {
      if (hideTimer) clearTimeout(hideTimer)
      tip.remove()
      visible = false
    },
    get visible() {
      return visible
    },
  }
}

/**
 * 给容器绑定 tooltip：元素带 `data-tip` 且 resolve 返回数据 → hover 显示。
 * 返回解绑函数。resolve 返回 null → 不显示（但隐藏当前）。
 */
export function bindTooltip(root: HTMLElement, layer: TooltipLayer, resolve: (target: HTMLElement) => TooltipData | null): () => void {
  let hoverTimer: ReturnType<typeof setTimeout> | null = null
  let current: HTMLElement | null = null

  function onOver(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null
    if (!target) {
      layer.hide()
      return
    }
    current = target
    if (hoverTimer) clearTimeout(hoverTimer)
    // 150ms 防抖：快速划过不闪烁
    hoverTimer = setTimeout(() => {
      if (current !== target) return
      const data = resolve(target)
      if (data) layer.show(data, e.clientX, e.clientY)
    }, 150)
  }

  function onMove(e: MouseEvent): void {
    if (!current || !layer.visible) return
    layer.show(resolve(current) ?? { title: '', lines: [] }, e.clientX, e.clientY)
  }

  function onOut(): void {
    current = null
    if (hoverTimer) clearTimeout(hoverTimer)
    layer.hide()
  }

  root.addEventListener('mouseover', onOver)
  root.addEventListener('mousemove', onMove)
  root.addEventListener('mouseout', onOut)
  return () => {
    root.removeEventListener('mouseover', onOver)
    root.removeEventListener('mousemove', onMove)
    root.removeEventListener('mouseout', onOut)
    layer.hide()
  }
}

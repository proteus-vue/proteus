// packages/devtools/src/views/flamegraph.ts
// DevTools 火焰图视图：按 depth 分行的堆叠块（宽度 ∝ durationMs，相对总窗口定位）
import type { FlameNode } from '@proteus-vue/devtools-runtime'
import { attachTip } from '../tooltip'

export interface FlamegraphViewData {
  nodes: FlameNode[]
}

const ROW_HEIGHT = 22

export function renderFlamegraph(container: HTMLElement, data: FlamegraphViewData): void {
  container.replaceChildren()
  const nodes = data.nodes
  if (nodes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无录制（面板右上角"开始录制"后产生）'
    container.appendChild(empty)
    return
  }
  // 窗口：根节点的 start ~ max end
  let winStart = Infinity
  let winEnd = -Infinity
  for (const n of nodes) {
    if (n.startMs < winStart) winStart = n.startMs
    const end = n.startMs + n.durationMs
    if (end > winEnd) winEnd = end
  }
  const total = Math.max(1, winEnd - winStart)
  let maxDepth = 0
  for (const n of nodes) if (n.depth > maxDepth) maxDepth = n.depth
  const board = document.createElement('div')
  board.className = 'pd-fg-board'
  board.style.height = (maxDepth + 1) * ROW_HEIGHT + 'px'
  for (const n of nodes) {
    const block = document.createElement('div')
    block.className = 'pd-fg-node' + (n.selfMs === 0 ? ' pd-fg-zero' : '')
    block.style.left = (((n.startMs - winStart) / total) * 100).toFixed(2) + '%'
    block.style.width = Math.max(0.5, (n.durationMs / total) * 100).toFixed(2) + '%'
    block.style.top = n.depth * ROW_HEIGHT + 'px'
    block.style.height = ROW_HEIGHT - 2 + 'px'
    // hover 浮层：来源 + inclusive / exclusive 耗时
    attachTip(block, {
      title: `${n.source}.${n.name}`,
      lines: [`inclusive ${n.durationMs}ms`, `exclusive ${n.selfMs}ms`],
    })
    const label = document.createElement('span')
    label.textContent = n.name + ' ' + n.selfMs + 'ms'
    block.appendChild(label)
    board.appendChild(block)
  }
  container.appendChild(board)
}

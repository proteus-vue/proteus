// packages/devtools/src/views/flamegraph.ts
// DevTools 火焰图视图：按 depth 分行的堆叠块（宽度 ∝ durationMs，相对总窗口定位）
// 对比模式：两录制叠加（compare 数据层就绪）——±10% regression 红 / improvement 绿 高亮 + delta 汇总列表
import type { FlameNode, FlameCompareEntry } from '@proteus-vue/devtools-runtime'
import { attachTip } from '../tooltip'

export interface FlamegraphViewData {
  nodes: FlameNode[]
  /** 对比数据（与 baseline 录制 diff；缺省单录制无高亮） */
  compare?: FlameCompareEntry[]
}

const ROW_HEIGHT = 22

/** source\0name → 对比条目（selfMs 聚合键，与数据层 compare 同构） */
function compareMap(compare: FlameCompareEntry[]): Map<string, FlameCompareEntry> {
  const m = new Map<string, FlameCompareEntry>()
  for (const c of compare) m.set(c.source + '\u0000' + c.name, c)
  return m
}

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
  const cmp = data.compare ? compareMap(data.compare) : null

  // 对比汇总列表（top：按 |deltaPct| 排序，回归/优化双色）
  const regs = data.compare ? data.compare.filter((c) => c.verdict === 'regression') : []
  const imps = data.compare ? data.compare.filter((c) => c.verdict === 'improvement') : []
  if (data.compare && data.compare.length > 0) {
    const summary = document.createElement('div')
    summary.className = 'pd-cmp'
    const head = document.createElement('div')
    head.className = 'pd-cmp-head'
    head.textContent = `对比上次录制：${regs.length} 处回归 · ${imps.length} 处优化`
    summary.appendChild(head)
    const sorted = data.compare.slice().sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 8)
    for (const c of sorted) {
      const row = document.createElement('div')
      row.className = 'pd-cmp-row pd-cmp-' + c.verdict
      const name = document.createElement('span')
      name.className = 'pd-cmp-name'
      name.textContent = c.source + '.' + c.name
      const delta = document.createElement('span')
      delta.className = 'pd-cmp-delta'
      delta.textContent = (c.deltaPct > 0 ? '+' : '') + c.deltaPct + '% (' + c.aMs + '→' + c.bMs + 'ms)'
      row.appendChild(name)
      row.appendChild(delta)
      attachTip(row, {
        title: `${c.source}.${c.name}`,
        lines: [`上次 ${c.aMs}ms → 本次 ${c.bMs}ms`, `变化 ${(c.deltaPct > 0 ? '+' : '') + c.deltaPct}%`],
      })
      summary.appendChild(row)
    }
    container.appendChild(summary)
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
    // 对比高亮：±10% 阈值（regression 红 / improvement 绿）
    const entry = cmp ? cmp.get(n.source + '\u0000' + n.name) : undefined
    if (entry && entry.verdict !== 'same') block.classList.add(entry.verdict === 'regression' ? 'pd-fg-reg' : 'pd-fg-imp')
    block.style.left = (((n.startMs - winStart) / total) * 100).toFixed(2) + '%'
    block.style.width = Math.max(0.5, (n.durationMs / total) * 100).toFixed(2) + '%'
    block.style.top = n.depth * ROW_HEIGHT + 'px'
    block.style.height = ROW_HEIGHT - 2 + 'px'
    // hover 浮层：来源 + inclusive / exclusive 耗时（对比时追加 delta）
    const tipLines = [`inclusive ${n.durationMs}ms`, `exclusive ${n.selfMs}ms`]
    if (entry && entry.verdict !== 'same') tipLines.push(`对比 ${(entry.deltaPct > 0 ? '+' : '') + entry.deltaPct}%`)
    attachTip(block, {
      title: `${n.source}.${n.name}`,
      lines: tipLines,
    })
    const label = document.createElement('span')
    label.textContent = n.name + ' ' + n.selfMs + 'ms'
    block.appendChild(label)
    board.appendChild(block)
  }
  container.appendChild(board)
}

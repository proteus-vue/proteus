// packages/devtools/src/views/flamegraph.ts
// DevTools 火焰图视图：★嵌套堆叠（经典火焰图）——子块画在父块内部（相对父定位，宽度 ∝ 耗时）
//   · source 配色区分来源（lifecycle/router/api/store/compiler/capability/component/hmr）
//   · 点击块 → 聚焦缩放（zoom 到该节点子树 + 面包屑 + 返回上级）
//   · 对比模式：两录制叠加（compare 数据层就绪）——±10% regression 红 / improvement 绿 高亮 + delta 汇总列表
import type { FlameNode, FlameCompareEntry } from '@proteus-vue/devtools-runtime'
import { attachTip } from '../tooltip'

export interface FlamegraphViewData {
  nodes: FlameNode[]
  /** 对比数据（与 baseline 录制 diff；缺省单录制无高亮） */
  compare?: FlameCompareEntry[]
  /** ★聚焦（zoom）：渲染该节点子树；缺省渲染全部根 */
  focus?: FlameNode
  /** 面包屑（焦点祖先链，含焦点自身） */
  breadcrumb?: Array<{ id: string; name: string }>
}

export interface FlamegraphViewHooks {
  /** 点击块 → 聚焦该节点（zoom 到其子树） */
  onFocus?: (id: string) => void
  /** 返回上级（面包屑最后一项 / 退出 zoom 到根） */
  onFocusUp?: () => void
}

const ROW_HEIGHT = 22

/** source → 配色（火焰图按来源区分层级，视觉贴近 Chrome Performance） */
const SRC_COLORS: Record<string, string> = {
  lifecycle: '#3e5770',
  router: '#2e7d5b',
  api: '#1d6fb8',
  store: '#8a5a17',
  compiler: '#6a3d9a',
  capability: '#0e7c86',
  component: '#9a3d52',
  hmr: '#3d9a6a',
}
function srcColor(source: string): string {
  return SRC_COLORS[source] ?? '#555'
}

/** 百分比格式化（left：块起点可为 0，不做最小钳制） */
function pct(v: number): string {
  return Math.min(100, v).toFixed(2) + '%'
}

/** 宽度钳制：最小 0.4% 防超小块不可见（仅 width 用） */
function clampPct(v: number): string {
  return Math.max(0.4, Math.min(100, v)).toFixed(2) + '%'
}

/** source\0name → 对比条目（selfMs 聚合键，与数据层 compare 同构） */
function compareMap(compare: FlameCompareEntry[]): Map<string, FlameCompareEntry> {
  const m = new Map<string, FlameCompareEntry>()
  for (const c of compare) m.set(c.source + '\u0000' + c.name, c)
  return m
}

export function renderFlamegraph(container: HTMLElement, data: FlamegraphViewData, hooks: FlamegraphViewHooks = {}): void {
  container.replaceChildren()
  // ★聚焦：渲染焦点子树；缺省渲染全部根
  const roots = data.focus ? [data.focus] : data.nodes
  if (roots.length === 0) {
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

  // ★面包屑 + 返回上级（聚焦时）
  if (data.breadcrumb && data.breadcrumb.length > 0) {
    const crumb = document.createElement('div')
    crumb.className = 'pd-fg-crumb'
    for (const c of data.breadcrumb) {
      const item = document.createElement('button')
      item.className = 'pd-fg-crumb-item'
      item.textContent = c.name
      item.addEventListener('click', () => hooks.onFocus?.(c.id))
      crumb.appendChild(item)
    }
    const up = document.createElement('button')
    up.className = 'pd-btn pd-fg-up'
    up.textContent = '返回上级'
    up.addEventListener('click', () => hooks.onFocusUp?.())
    crumb.appendChild(up)
    container.appendChild(crumb)
  }

  // 窗口：根（或焦点）节点的 start ~ max end
  let winStart = Infinity
  let winEnd = -Infinity
  for (const n of roots) {
    if (n.startMs < winStart) winStart = n.startMs
    const end = n.startMs + n.durationMs
    if (end > winEnd) winEnd = end
  }
  const total = Math.max(1, winEnd - winStart)

  const board = document.createElement('div')
  board.className = 'pd-fg-board'
  let maxDepth = 0
  const depthOf = (n: FlameNode, d: number): number => {
    let m = d
    for (const c of n.children) m = Math.max(m, depthOf(c, d + 1))
    return m
  }
  for (const n of roots) maxDepth = Math.max(maxDepth, depthOf(n, 0))
  board.style.height = (maxDepth + 1) * ROW_HEIGHT + 'px'

  /**
   * ★嵌套渲染：根块按全局窗口定位；子块相对父块（left/width 百分比相对父）画在父块下方的子容器内
   * 返回该子树层数（子容器高度）
   */
  function renderNode(box: HTMLElement, node: FlameNode, depth: number, relStart: number, relDur: number, isRoot: boolean): number {
    const leftPct = isRoot ? ((node.startMs - winStart) / total) * 100 : ((node.startMs - relStart) / relDur) * 100
    const widthPct = isRoot ? (node.durationMs / total) * 100 : (node.durationMs / relDur) * 100
    const block = document.createElement('div')
    block.className = 'pd-fg-node' + (node.selfMs === 0 ? ' pd-fg-zero' : '')
    block.style.background = srcColor(node.source)
    const entry = cmp ? cmp.get(node.source + '\u0000' + node.name) : undefined
    if (entry && entry.verdict !== 'same') block.classList.add(entry.verdict === 'regression' ? 'pd-fg-reg' : 'pd-fg-imp')
    block.style.left = pct(leftPct)
    block.style.width = clampPct(widthPct)
    block.style.top = '0px'
    block.style.height = ROW_HEIGHT - 2 + 'px'
    const tipLines = [`inclusive ${node.durationMs}ms`, `exclusive ${node.selfMs}ms`]
    if (entry && entry.verdict !== 'same') tipLines.push(`对比 ${(entry.deltaPct > 0 ? '+' : '') + entry.deltaPct}%`)
    attachTip(block, {
      title: `${node.source}.${node.name}`,
      lines: tipLines,
    })
    const label = document.createElement('span')
    label.textContent = node.name + ' ' + node.selfMs + 'ms'
    block.appendChild(label)
    // ★点击块 → 聚焦缩放（zoom 到该节点子树）
    block.addEventListener('click', () => hooks.onFocus?.(node.id))
    box.appendChild(block)
    // 子容器：与块同左/宽、下一行；子块相对父定位 → 经典火焰图嵌套堆叠
    let subDepth = 0
    if (node.children.length) {
      const sub = document.createElement('div')
      sub.className = 'pd-fg-children'
      sub.style.left = pct(leftPct)
      sub.style.width = clampPct(widthPct)
      sub.style.top = ROW_HEIGHT + 'px'
      let maxChildDepth = 0
      for (const c of node.children) maxChildDepth = Math.max(maxChildDepth, renderNode(sub, c, depth + 1, node.startMs, node.durationMs, false))
      sub.style.height = maxChildDepth * ROW_HEIGHT + 'px'
      box.appendChild(sub)
      subDepth = maxChildDepth
    }
    return subDepth + 1
  }

  for (const r of roots) renderNode(board, r, 0, winStart, total, true)
  container.appendChild(board)
}

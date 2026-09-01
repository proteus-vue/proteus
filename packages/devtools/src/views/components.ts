// packages/devtools/src/views/components.ts
// DevTools 组件树视图（对标 Vue DevTools Components）：component.mount/unmount 事件聚合 → 树形展示（缩进 + 折叠）
// ★P1 升级：节点点击选中（高亮行 + 页面元素高亮回调）+ 选中组件 props/state 详情面板（inspector 树复用）
// 纯函数：data → DOM（happy-dom 可单测）；铁律 1：UI 只消费事件流
import { renderKeyValue } from './inspector'

export interface ComponentNodeData {
  id: number
  name: string
  parentId?: number
  /** 挂载时间戳 */
  ts: number
  /** 同 id 重复挂载计数（组件复用场景） */
  count: number
  /** mount 时刻 props 快照（serializeState 序列化，JSON-safe） */
  props?: unknown
  /** mount 时刻 state 快照（options data / setupState） */
  state?: unknown
}

export interface ComponentsViewData {
  nodes: ComponentNodeData[]
  /** 选中组件 id（详情面板展示；缺省不选中） */
  selectedId?: number
}

export interface ComponentsViewHooks {
  /** 选中组件 → 页面元素高亮（install 侧 scrollIntoView + flash；同 id 再点由调用方取消） */
  onSelect?: (id: number) => void
}

/** 构建父 → 子映射（parentId 缺失/失联 → 归为根） */
function buildChildren(nodes: ComponentNodeData[]): Map<number, ComponentNodeData[]> {
  const byParent = new Map<number, ComponentNodeData[]>()
  const alive = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    const key = n.parentId !== undefined && alive.has(n.parentId) ? n.parentId : -1
    const list = byParent.get(key)
    if (list) list.push(n)
    else byParent.set(key, [n])
  }
  return byParent
}

/** 详情面板：props / state 两段（inspector 树；空 → 「无」） */
function renderDetail(container: HTMLElement, node: ComponentNodeData): void {
  const detail = document.createElement('div')
  detail.className = 'pd-cmp-detail'
  const head = document.createElement('div')
  head.className = 'pd-section-head'
  head.textContent = '#' + node.id + ' ' + node.name + ' · 详情'
  detail.appendChild(head)
  const sections: Array<[string, unknown]> = [
    ['props', node.props],
    ['state', node.state],
  ]
  for (const [label, value] of sections) {
    const box = document.createElement('div')
    box.className = 'pd-cmp-detail-section'
    const labelEl = document.createElement('div')
    labelEl.className = 'pd-cmp-detail-label'
    labelEl.textContent = label
    box.appendChild(labelEl)
    if (value !== undefined && value !== null && (typeof value !== 'object' || Object.keys(value as object).length > 0)) {
      renderKeyValue(box, '(root)', value, 0, true)
    } else {
      const empty = document.createElement('div')
      empty.className = 'pd-empty'
      empty.textContent = '无 ' + label
      box.appendChild(empty)
    }
    detail.appendChild(box)
  }
  container.appendChild(detail)
}

export function renderComponents(container: HTMLElement, data: ComponentsViewData, hooks: ComponentsViewHooks = {}): void {
  container.replaceChildren()
  const nodes = data.nodes
  if (nodes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无组件（installComponentTrace 接入后出现）'
    container.appendChild(empty)
    return
  }
  const byParent = buildChildren(nodes)
  const selected = data.selectedId !== undefined && nodes.some((n) => n.id === data.selectedId) ? data.selectedId : undefined

  function buildRow(n: ComponentNodeData, depth: number, hasChildren: boolean): HTMLElement {
    const row = document.createElement('div')
    row.className = 'pd-cmp-row' + (n.id === selected ? ' pd-cmp-active' : '')
    row.style.paddingLeft = depth * 16 + 6 + 'px'
    const toggle = document.createElement('span')
    toggle.className = 'pd-kv-toggle'
    toggle.textContent = hasChildren ? '▾' : '·'
    const name = document.createElement('span')
    name.className = 'pd-cmp-name'
    name.textContent = n.name
    const meta = document.createElement('span')
    meta.className = 'pd-cmp-meta'
    meta.textContent = '#' + n.id + (n.count > 1 ? ' ×' + n.count : '')
    row.appendChild(toggle)
    row.appendChild(name)
    row.appendChild(meta)
    // ★P1：点击行选中（详情面板 + 页面高亮）
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.pd-cmp-row') !== row) return
      hooks.onSelect?.(n.id)
    })
    if (hasChildren) {
      // 折叠：点击 toggle 切换子层显隐（stopPropagation 不触发选中）；子行点击不冒泡折叠父行
      let collapsed = false
      let subtree: HTMLElement | null = null
      const sub = document.createElement('div')
      sub.className = 'pd-cmp-children'
      subtree = sub
      const kids = byParent.get(n.id) ?? []
      for (const k of kids) sub.appendChild(buildRow(k, depth + 1, (byParent.get(k.id)?.length ?? 0) > 0))
      row.appendChild(sub)
      toggle.addEventListener('click', (e) => {
        e.stopPropagation()
        collapsed = !collapsed
        toggle.textContent = collapsed ? '▸' : '▾'
        if (subtree) subtree.style.display = collapsed ? 'none' : 'block'
      })
    }
    return row
  }

  const roots = byParent.get(-1) ?? []
  for (const r of roots) {
    container.appendChild(buildRow(r, 0, (byParent.get(r.id)?.length ?? 0) > 0))
  }

  // ★P1：选中组件详情（props/state inspector 树）
  if (selected !== undefined) {
    const sel = nodes.find((n) => n.id === selected)
    if (sel) renderDetail(container, sel)
  }
}

// packages/devtools/src/views/components.ts
// DevTools 组件树视图（对标 Vue DevTools Components）：component.mount/unmount 事件聚合 → 树形展示（缩进 + 折叠）
// 纯函数：data → DOM（happy-dom 可单测）；铁律 1：UI 只消费事件流
export interface ComponentNodeData {
  id: number
  name: string
  parentId?: number
  /** 挂载时间戳 */
  ts: number
  /** 同 id 重复挂载计数（组件复用场景） */
  count: number
}

export interface ComponentsViewData {
  nodes: ComponentNodeData[]
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

export function renderComponents(container: HTMLElement, data: ComponentsViewData): void {
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

  function buildRow(n: ComponentNodeData, depth: number, hasChildren: boolean): HTMLElement {
    const row = document.createElement('div')
    row.className = 'pd-cmp-row'
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
    if (hasChildren) {
      // 折叠：点击行切换子层显隐（★子行点击不冒泡触发父折叠——closest 判定目标行）
      let collapsed = false
      let subtree: HTMLElement | null = null
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.pd-cmp-row') !== row) return
        collapsed = !collapsed
        toggle.textContent = collapsed ? '▸' : '▾'
        if (subtree) subtree.style.display = collapsed ? 'none' : 'block'
      })
      const sub = document.createElement('div')
      sub.className = 'pd-cmp-children'
      subtree = sub
      const kids = byParent.get(n.id) ?? []
      for (const k of kids) sub.appendChild(buildRow(k, depth + 1, (byParent.get(k.id)?.length ?? 0) > 0))
      row.appendChild(sub)
    }
    return row
  }

  const roots = byParent.get(-1) ?? []
  for (const r of roots) {
    container.appendChild(buildRow(r, 0, (byParent.get(r.id)?.length ?? 0) > 0))
  }
}

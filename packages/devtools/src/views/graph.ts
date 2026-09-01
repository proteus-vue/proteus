// packages/devtools/src/views/graph.ts
// DevTools 依赖图：路由父子树（parent 关联）+ 分包归属 —— 应用结构可视化（对标 Vue DevTools Graph 的轻量版）
// 纯函数：data → DOM；mono 字符树（├─ └─）展示层级
import type { PageRouteData } from './pages'

export interface GraphViewData {
  routes: PageRouteData[]
}

interface TreeNode {
  route: PageRouteData
  children: TreeNode[]
}

/** 构建路由树：parent 关联；parent 缺失/失联 → 根 */
function buildTree(routes: PageRouteData[]): TreeNode[] {
  const byName = new Map<string, PageRouteData>()
  for (const r of routes) byName.set(r.name, r)
  const roots: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()
  for (const r of routes) nodeMap.set(r.name, { route: r, children: [] })
  for (const r of routes) {
    const node = nodeMap.get(r.name) as TreeNode
    const parent = r.parent !== undefined && nodeMap.has(r.parent) ? nodeMap.get(r.parent) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 渲染树分支（字符前缀 + 连接线） */
function buildBranch(node: TreeNode, prefix: string, isLast: boolean, out: HTMLElement, depth: number): void {
  const row = document.createElement('div')
  row.className = 'pd-graph-node' + (depth === 0 ? ' pd-graph-root' : '')
  const line = document.createElement('span')
  line.className = 'pd-graph-line'
  line.textContent = prefix + (isLast ? '└─ ' : '├─ ')
  const name = document.createElement('span')
  name.className = 'pd-graph-name'
  name.textContent = node.route.name
  const meta = document.createElement('span')
  meta.className = 'pd-graph-meta'
  const parts: string[] = [node.route.path]
  if (node.route.meta?.isTab) parts.push('tab')
  if (node.route.subPackage) parts.push('分包 ' + node.route.subPackage)
  meta.textContent = parts.join(' · ')
  row.appendChild(line)
  row.appendChild(name)
  row.appendChild(meta)
  out.appendChild(row)
  const kids = node.children
  for (let i = 0; i < kids.length; i++) {
    buildBranch(kids[i], prefix + (isLast ? '  ' : '│ '), i === kids.length - 1, out, depth + 1)
  }
}

export function renderGraph(container: HTMLElement, data: GraphViewData): void {
  container.replaceChildren()
  const routes = data.routes
  if (routes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无路由表（Proteus.appInfo 注入后出现）'
    container.appendChild(empty)
    return
  }
  const roots = buildTree(routes)
  const box = document.createElement('div')
  box.className = 'pd-graph'
  const head = document.createElement('div')
  head.className = 'pd-section-head'
  const subCount = new Set(routes.map((r) => r.subPackage).filter((s): s is string => s !== undefined)).size
  head.textContent = '路由依赖树（' + routes.length + ' 页' + (subCount ? ' · ' + subCount + ' 分包' : '') + '）'
  box.appendChild(head)
  for (let i = 0; i < roots.length; i++) {
    buildBranch(roots[i], '', i === roots.length - 1, box, 0)
  }
  container.appendChild(box)
}

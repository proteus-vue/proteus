// packages/devtools/src/views/pages.ts
// DevTools 页面面板：当前页面栈（高亮）+ 全部路由页面清单（主包/分包分组 + tabBar 标记）
// 纯函数：data → DOM；数据注入（options.pages / Proteus.appInfo 路由表）
export interface PageRouteData {
  name: string
  path: string
  parent?: string
  meta?: { title?: string; isTab?: boolean }
  subPackage?: string
}

export interface PagesViewData {
  routes: PageRouteData[]
  /** 当前页面栈（MP 真实栈；Web 恒 1 项） */
  stack?: Array<{ route?: string }>
}

export function renderPages(container: HTMLElement, data: PagesViewData): void {
  container.replaceChildren()
  const routes = data.routes
  if (routes.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无路由表（Proteus.appInfo 注入后出现）'
    container.appendChild(empty)
    return
  }
  // 当前页面栈（栈顶 → 当前页）
  const stack = data.stack ?? []
  if (stack.length) {
    const stackBox = document.createElement('div')
    stackBox.className = 'pd-page-stack'
    const head = document.createElement('div')
    head.className = 'pd-section-head'
    head.textContent = '页面栈（' + stack.length + '）'
    stackBox.appendChild(head)
    for (let i = stack.length - 1; i >= 0; i--) {
      const route = stack[i]?.route ?? '?'
      const row = document.createElement('div')
      row.className = 'pd-page-row' + (i === stack.length - 1 ? ' pd-page-current' : '')
      const depth = document.createElement('span')
      depth.className = 'pd-page-depth'
      depth.textContent = String(stack.length - 1 - i)
      const name = document.createElement('span')
      name.className = 'pd-page-name'
      name.textContent = route
      row.appendChild(depth)
      row.appendChild(name)
      stackBox.appendChild(row)
    }
    container.appendChild(stackBox)
  }

  // 路由清单：主包 / 分包分组
  const main = routes.filter((r) => !r.subPackage)
  const subs: Array<{ name: string; routes: PageRouteData[] }> = []
  const subNames = new Set<string>()
  for (const r of routes) if (r.subPackage && !subNames.has(r.subPackage)) subNames.add(r.subPackage)
  for (const s of subNames) subs.push({ name: s, routes: routes.filter((r) => r.subPackage === s) })

  function renderGroup(title: string, list: PageRouteData[]): HTMLElement {
    const group = document.createElement('div')
    group.className = 'pd-page-group'
    const head = document.createElement('div')
    head.className = 'pd-section-head'
    head.textContent = title + '（' + list.length + '）'
    group.appendChild(head)
    for (const r of list) {
      const row = document.createElement('div')
      row.className = 'pd-page-row'
      const name = document.createElement('span')
      name.className = 'pd-page-name'
      name.textContent = r.name
      const meta = document.createElement('span')
      meta.className = 'pd-page-meta'
      meta.textContent = r.path + (r.meta?.isTab ? ' · tab' : '') + (r.meta?.title ? ' · ' + r.meta.title : '')
      row.appendChild(name)
      row.appendChild(meta)
      group.appendChild(row)
    }
    return group
  }

  container.appendChild(renderGroup('主包页面', main))
  for (const s of subs) container.appendChild(renderGroup('分包 ' + s.name, s.routes))
}

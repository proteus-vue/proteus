// packages/devtools/src/views/route.ts
// DevTools 路由回溯视图：导航链（from → to）+ 守卫徽章（next 绿 / redirect 橙 / cancel·error 红）+ 耗时
import type { NavRecord } from '@proteus-vue/devtools-runtime'

export interface RouteViewData {
  records: NavRecord[]
}

export function renderRoute(container: HTMLElement, data: RouteViewData): void {
  container.replaceChildren()
  const records = data.records
  if (records.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无导航记录'
    container.appendChild(empty)
    return
  }
  // 倒序展示（最新在上）
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    const row = document.createElement('div')
    row.className = 'pd-nav'
    const path = document.createElement('div')
    path.className = 'pd-nav-path'
    const from = document.createElement('span')
    from.className = 'pd-route'
    from.textContent = r.from.path
    const arrow = document.createElement('span')
    arrow.className = 'pd-arrow'
    arrow.textContent = ' → '
    const to = document.createElement('span')
    to.className = 'pd-route'
    to.textContent = r.to.path + (r.to.query ? '?' + JSON.stringify(r.to.query) : '')
    path.appendChild(from)
    path.appendChild(arrow)
    path.appendChild(to)
    const meta = document.createElement('span')
    meta.className = 'pd-nav-meta'
    meta.textContent = r.durationMs + 'ms' + (r.traceId ? ' #' + r.traceId : '')
    path.appendChild(meta)
    row.appendChild(path)
    // 守卫徽章
    const guards = document.createElement('div')
    guards.className = 'pd-guards'
    for (const g of r.guards) {
      const badge = document.createElement('span')
      badge.className = 'pd-guard pd-guard-' + g.result
      badge.textContent = g.name + ' ' + g.durationMs + 'ms (' + g.result + ')'
      badge.title = '守卫 ' + g.name + ' → ' + g.result
      guards.appendChild(badge)
    }
    row.appendChild(guards)
    container.appendChild(row)
  }
}

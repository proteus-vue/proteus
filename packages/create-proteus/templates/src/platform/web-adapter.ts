// src/platform/web-adapter.ts
// Web 端适配器（P3-5）：History API + popstate
// Web 端页面栈恒为 1（SPA 单页语义），onPageLoad 驱动 RouterView 渲染
import type { PlatformAdapter, PageInstance } from './adapter'

function parseQuery(url: string): Record<string, string> {
  const q = url.split('?')[1] || ''
  const out: Record<string, string> = {}
  for (const seg of q.split('&').filter(Boolean)) {
    const [k, v] = seg.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '')
  }
  return out
}

export function createWebAdapter(): PlatformAdapter {
  const listeners: Array<
    (
      route: string,
      query: Record<string, string>,
      routeType?: string,
      nav?: 'forward' | 'back' | 'replace' | 'reLaunch' | 'switchTab',
    ) => void
  > = []
  let current: PageInstance & { routeType?: string } = { route: location.pathname.replace(/^\//, '') }
  // 导航方向：history.state.proteusIndex 记录栈深，popstate 时判断前进/后退
  // ⚠ 刷新后 historyIndex 不能从 0 开始：浏览器 history 保留旧条目（state.proteusIndex），
  //   否则在转场页刷新后首次后退会被误判为 forward（stateIndex < 0 不成立）→ 无反向动画
  let historyIndex = (history.state as { proteusIndex?: number } | null)?.proteusIndex ?? 0

  const emit = (
    url: string,
    routeType?: string,
    nav: 'forward' | 'back' | 'replace' | 'reLaunch' | 'switchTab' = 'forward',
  ) => {
    current = { route: url.split('?')[0].replace(/^\//, ''), routeType }
    listeners.forEach((l) => l(current.route, parseQuery(url), routeType, nav))
  }

  // 浏览器前进/后退（state 无 proteusIndex 时视为前进，如外部跳入）
  window.addEventListener('popstate', (e) => {
    const stateIndex = (e.state as { proteusIndex?: number } | null)?.proteusIndex
    let nav: 'forward' | 'back' = 'forward'
    if (typeof stateIndex === 'number') {
      nav = stateIndex < historyIndex ? 'back' : 'forward'
      historyIndex = stateIndex
    }
    emit(location.pathname + location.search, undefined, nav)
  })

  // 站内 <a> 链接：拦截默认整页跳转 → SPA 导航（pushState，navigateTo 语义）
  // 外部链接 / _blank / 修饰键点击（新标签页）不拦截；route-type 属性驱动 CSS 转场
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.target as HTMLElement | null
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (anchor.target === '_blank' || !href.startsWith('/')) return
    e.preventDefault()
    const routeType = anchor.getAttribute('route-type') || undefined
    historyIndex += 1
    history.pushState({ proteusIndex: historyIndex }, '', href)
    emit(href, routeType, 'forward')
  })

  return {
    isMP: false,
    getCurrentPages: () => [current],
    navigateTo: async ({ url, routeType }) => {
      historyIndex += 1
      history.pushState({ proteusIndex: historyIndex }, '', url)
      emit(url, routeType, 'forward')
    },
    redirectTo: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', url)
      emit(url, undefined, 'replace')
    },
    reLaunch: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', url)
      emit(url, undefined, 'reLaunch')
    },
    switchTab: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', url)
      emit(url, undefined, 'switchTab')
    },
    navigateBack: ({ delta }) => {
      history.go(-delta)
    },
    onPageLoad: (cb) => {
      listeners.push(cb)
    },
  }
}

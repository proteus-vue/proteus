// src/platform/web-adapter.ts
// Web 端适配器（P3-5）：History API + popstate
// Web 端页面栈恒为 1（SPA 单页语义），onPageLoad 驱动 RouterView 渲染
import type { PlatformAdapter, PageInstance, Rect } from './adapter'

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
  // ★#491 环境守卫：adapter 是模块顶层单例——SSR/测试/预打包预求值场景无 location/history，
  //   裸引用会启动即崩（mp 白屏同源）；无浏览器环境时初始 route 置空（首个 onPageLoad 会重新赋值）
  const hasBrowserEnv = typeof location !== 'undefined' && typeof history !== 'undefined'
  // ★子路径部署（2026-09-26）：vite base 注入（如 PROTEUS_BASE=/showcase/ 官网 iframe 嵌演示）——
  //   pushState 的地址要带 base（刷新/归属正确），读路由要剥 base（route 表按根路径注册）。
  //   缺省 BASE_URL='/'（本地/根路径部署）时两者均为原样直通。
  const BASE = import.meta.env?.BASE_URL ?? '/'
  // ★尾斜杠归一：SPA 深链以真实目录部署（emit-spa-routes → GitHub Pages）时，
  //   /dir 必 301 到 /dir/ → pathname 恒带尾斜杠；route 表按无尾斜杠注册 → 读侧统一剥掉。
  const stripBase = (p: string): string => {
    const stripped = BASE !== '/' && p.startsWith(BASE) ? p.slice(BASE.length - 1) || '/' : p
    return stripped.length > 1 ? stripped.replace(/\/+$/, '') : stripped
  }
  const withBase = (p: string): string => {
    const path = p.startsWith('/') ? p : `/${p}`
    return BASE !== '/' ? `${BASE.replace(/\/$/, '')}${path}` : path
  }
  let current: PageInstance & { routeType?: string } = {
    route: hasBrowserEnv ? stripBase(location.pathname).replace(/^\//, '') : '',
  }
  // 导航方向：history.state.proteusIndex 记录栈深，popstate 时判断前进/后退
  // ⚠ 刷新后 historyIndex 不能从 0 开始：浏览器 history 保留旧条目（state.proteusIndex），
  //   否则在转场页刷新后首次后退会被误判为 forward（stateIndex < 0 不成立）→ 无反向动画
  let historyIndex = hasBrowserEnv ? ((history.state as { proteusIndex?: number } | null)?.proteusIndex ?? 0) : 0

  const emit = (
    url: string,
    routeType?: string,
    nav: 'forward' | 'back' | 'replace' | 'reLaunch' | 'switchTab' = 'forward',
  ) => {
    // ★保留 query 到当前页（2026-09-19）：此前只传给 listeners、当前页上不留 →
    //   页内无法读到路由参数（外部实战报告第 4 条）。与 MP 的 Page.options 语义对齐。
    current = { route: stripBase(url.split('?')[0]).replace(/^\//, ''), routeType, query: parseQuery(url) }
    listeners.forEach((l) => l(current.route, parseQuery(url), routeType, nav))
  }

  // 浏览器前进/后退（state 无 proteusIndex 时视为前进，如外部跳入）——无浏览器环境（SSR/测试）跳过事件接线
  if (hasBrowserEnv) {
  window.addEventListener('popstate', (e) => {
    const stateIndex = (e.state as { proteusIndex?: number } | null)?.proteusIndex
    let nav: 'forward' | 'back' = 'forward'
    if (typeof stateIndex === 'number') {
      nav = stateIndex < historyIndex ? 'back' : 'forward'
      historyIndex = stateIndex
    }
    emit(stripBase(location.pathname) + location.search, undefined, nav)
  })

  // 站内 <a> 链接：拦截默认整页跳转 → SPA 导航（pushState，navigateTo 语义）
  // 外部链接 / _blank / 修饰键点击（新标签页）不拦截；route-type 属性驱动 CSS 转场
  // ★★★2026-10-08 修复（用户实测「点页内超链 → 路由刷新但视图不刷新，手动刷新才对」）：
  //   本拦截器在 **adapter 单例构造时**（模块加载副作用）就挂上 `document`——而 `adapter` 被
  //   `@proteus-vue/shared/platform` 里任意消费者（components/api/desktop…）**间接 import** ⇒
  //   即使用 vue-router 的宿主（如官网自身）也会被装上这个拦截器。它 `preventDefault` + `pushState`
  //   + 自己的 emit，**绕过 vue-router** ⇒ URL 变了、宿主路由表没收到、视图不更新（无报错）。
  //   ⇒ **守卫：只有「确实有 Proteus 路由在驱动本页」时才拦截**——判据 = 已注册 onPageLoad 监听
  //     （`@proteus-vue/router` 的 createRouter 在 web 端会注册，见 router-core.ts）。没有监听者
  //     ⇒ 无人接管这次导航 ⇒ **不抢**，交还浏览器/宿主路由（vue-router 的 router-link 自带
  //     preventDefault，其默认跳转也照常工作）。
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.target as HTMLElement | null
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (anchor.target === '_blank' || !href.startsWith('/')) return
    // ★无人监听（无 Proteus 路由驱动本页）→ 不拦截（否则会吞掉宿主路由的导航）
    if (listeners.length === 0) return
    e.preventDefault()
    const routeType = anchor.getAttribute('route-type') || undefined
    historyIndex += 1
    history.pushState({ proteusIndex: historyIndex }, '', withBase(href))
    emit(href, routeType, 'forward')
  })
  }

  return {
    isMP: false,
    getCurrentPages: () => [current],
    navigateTo: async ({ url, routeType }) => {
      historyIndex += 1
      history.pushState({ proteusIndex: historyIndex }, '', withBase(url))
      emit(url, routeType, 'forward')
    },
    redirectTo: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', withBase(url))
      emit(url, undefined, 'replace')
    },
    reLaunch: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', withBase(url))
      emit(url, undefined, 'reLaunch')
    },
    switchTab: async ({ url }) => {
      history.replaceState({ proteusIndex: historyIndex }, '', withBase(url))
      emit(url, undefined, 'switchTab')
    },
    navigateBack: ({ delta }) => {
      history.go(-delta)
    },
    measureRect: (selector, scope) =>
      new Promise((resolve) => {
        // SSR/测试/node 无 document → 决定 resolve null（调用方降级，不抛）
        if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return resolve(null)
        // ★scope 提供 → 在 scope 内查（组件传入根 DOM/元素，避免跨实例）；否则 document
        const root =
          scope && typeof (scope as { querySelector?: unknown }).querySelector === 'function'
            ? (scope as { querySelector(s: string): Element | null })
            : document
        const el = root.querySelector(selector)
        if (!el || typeof el.getBoundingClientRect !== 'function') return resolve(null)
        const r = el.getBoundingClientRect()
        resolve({
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        })
      }),
    onPageLoad: (cb) => {
      listeners.push(cb)
    },
  }
}

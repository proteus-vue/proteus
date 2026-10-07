// tests/web-adapter-link-guard.test.ts
// @vitest-environment jsdom
// ★★★Web adapter：站内 <a> 点击拦截的守卫（决策 #647）
//
// 【背景（用户 2026-10-08 实测）】「点页内超链 → 路由刷新了，但视图没刷新，手动刷新后才变」。
//   根因：web-adapter 在**构造时**（模块加载副作用）就挂 `document` 级 click 拦截器——它
//   preventDefault + pushState + 自己的 emit。而 `@proteus-vue/shared/platform` 的 `adapter`
//   单例被 components/api/desktop 等**间接 import** ⇒ 即使用 **vue-router** 的宿主（如官网自身）
//   也被装上这个拦截器 ⇒ 站内 <a> 被它抢走、绕过 vue-router ⇒ **URL 变、视图不动**（无报错）。
//   守卫判据 = 已注册 `onPageLoad` 监听（`@proteus-vue/router` 的 createRouter 在 web 端会注册）：
//   无监听者 ⇒ 无人接管这次导航 ⇒ 不抢，交还宿主路由。
//
// 缓存（独立文件）：web-adapter 的拦截器是**持久化 document 监听**（跨用例累积），
//   故本守卫测试独占一个文件，避免其它用例注册的监听者污染「无监听者」用例。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createWebAdapter } from '../packages/shared/src/platform/web-adapter'

function clickAnchor(href: string): MouseEvent {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  document.body.appendChild(a)
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  a.dispatchEvent(ev)
  a.remove()
  return ev
}

describe('★★★Web adapter：<a> 点击拦截守卫（决策 #647）', () => {
  beforeEach(() => {
    vi.stubEnv('BASE_URL', '/')
    window.history.replaceState(null, '', '/start')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('无监听者（vue-router 宿主）→ 不拦截：defaultPrevented=false，adapter 不改 URL', () => {
    createWebAdapter() // 构造即挂 document click 拦截器；本用例**不注册 onPageLoad**
    const ev = clickAnchor('/docs/16-router')
    expect(ev.defaultPrevented, '★无 Proteus 路由驱动本页时不得抢导航（否则吞掉宿主 vue-router）').toBe(false)
    expect(window.location.pathname, 'adapter 不应 pushState 改地址').toBe('/start')
  })

  it('有监听者（Proteus 路由宿主）→ 拦截：defaultPrevented=true + pushState', () => {
    const adapter = createWebAdapter()
    adapter.onPageLoad?.(() => undefined) // createRouter 在 web 端同款注册
    const ev = clickAnchor('/pages/detail')
    expect(ev.defaultPrevented).toBe(true)
    expect(window.location.pathname).toBe('/pages/detail')
  })
})

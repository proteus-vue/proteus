// tests/router-nav-global.test.ts —— ★★★$nav 平台级导航全局（决策 #616）
//
// 【锁什么】`createRouter(routes)` 时登记 `globalThis.$nav`——模板事件 `@tap="$nav('routeName')"`
//   在 Web/MP 运行期解析到它（App 由编译器编成 nav 动作，不依赖此）。判据：
//   ① 创建后 `globalThis.$nav` 是函数；
//   ② `$nav('名')` / `$nav('path')` 触发导航（adapter.navigateTo 收到含目标的 url）；
//   ③ MP 编译产物含 `$nav(target)` 页方法（`this.$nav` 可解析）。
import { describe, it, expect } from 'vitest'
import { createRouter } from '../packages/router/src/index'
import { transformScriptToPage } from '../packages/compiler/src/script'

const ROUTES = [
  { name: 'index', path: 'pages/index', component: '../pages/index.vue' },
  { name: 'text', path: 'pages/text', component: '../pages/text.vue' },
  { name: 'grid-auto', path: 'pages/grid-auto', component: '../pages/grid-auto.vue' },
]

function mockAdapter(calls: string[]) {
  const rec = (kind: string) => async ({ url }: { url: string }) => {
    calls.push(`${kind}:${url}`)
  }
  return {
    navigateTo: rec('navigateTo'),
    redirectTo: rec('redirectTo'),
    switchTab: rec('switchTab'),
    reLaunch: rec('reLaunch'),
    navigateBack: () => {},
    getCurrentPages: () => [],
    onPageLoad: () => {},
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('★★★$nav 平台级导航全局（决策 #616）', () => {
  it('createRouter 登记 globalThis.$nav；$nav("名") 触发导航（名解析为 path）', async () => {
    const calls: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRouter(ROUTES as never, { adapter: mockAdapter(calls) as never })
    const nav = (globalThis as { $nav?: (t: string) => void }).$nav
    expect(typeof nav, 'createRouter 应登记 globalThis.$nav').toBe('function')
    nav!('text')
    await flush()
    expect(calls.length, `$nav 应触发一次导航，实际：${calls.join(' | ')}`).toBeGreaterThan(0)
    expect(calls.some((c) => c.includes('text')), `导航 url 应含 text：${calls.join(' | ')}`).toBe(true)
  })

  it('$nav 接受 path 形态（"pages/grid-auto"）', async () => {
    const calls: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRouter(ROUTES as never, { adapter: mockAdapter(calls) as never })
    ;(globalThis as { $nav?: (t: string) => void }).$nav!('pages/grid-auto')
    await flush()
    expect(calls.some((c) => c.includes('grid-auto')), `实际：${calls.join(' | ')}`).toBe(true)
  })

  it('MP 编译产物含 $nav(target) 页方法（bind:tap="proteusInline$navX" 的 this.$nav 可解析）', () => {
    const src = `<template><view @tap="$nav('text')">x</view></template>
<script setup lang="ts">
const a = 1
</script>`
    const r = transformScriptToPage(src, { px2rpx: true, rpxRatio: 2 }, { isComponent: false })
    const out = (r as { code?: string }).code ?? JSON.stringify(r)
    expect(out, '页面脚本应注入 $nav 页方法（this.$nav 可解析）').toMatch(/\$nav\(target\)/)
    expect(out, '$nav 应优先走 globalThis.$nav 且含原生回退').toMatch(/g\.\$nav/)
  })
})

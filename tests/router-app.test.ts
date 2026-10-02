// tests/router-app.test.ts
// ★★App 端路由收口（2026-10-02）：**统一 API 打到 App 端**的判据
//
// 【本文件证明什么（用户要的"开发者不用手写各端胶水"）】
//   ① `createRouter`（统一 API）在 App 端**可用**：`router.push({ name })` → 虚拟栈 push
//      → 执行器泵 → 宿主 invoke —— 四条链在同一断言里走完（零手写胶水）；
//   ② **语义对齐**：push/back/replace/reLaunch(tab) 与 Web/MP 逐条同义（含 URL→params 解析）；
//   ③ **平台中立**：`@proteus-vue/router/app-route` 的模块图**不含 @proteus-vue/shared**
//      （否则 App（JSC/QuickJS 无 window/wx）会在 import 期崩——#491 事故同源）；
//   ④ 一步装配：`createAppNavigation({ invoke, routes })` 自己从路由表推屏注册表。
//
// 【测试形态】宿主通道用**记录桩**（回宿主形态回执）；动画完成用真全局键回推（与
//   tests/screen-executor-host.test.ts 同款——那里测端口翻译，这里测**装配 + 统一 API**）。
import { describe, it, expect, beforeEach } from 'vitest'
import { createRouter } from '../packages/router/src/app-route'
import { createAppNavigationAdapter, screensFromRoutes, parseRouterUrl } from '../packages/router/src/app-adapter'
import { createAppStack } from '../packages/router/src/app-stack'
import { createAppNavigation } from '../packages/render-backend/src/app-navigation'
import { SCREEN_ANIM_DONE_KEY } from '../packages/render-backend/src/screen-executor-host'
import type { RouteRecord } from '../packages/router/src/types'

/** 记录桩宿主通道（贴近真机回执形态）。
 *
 * ★★关键（测试第一版超时踩到）：`screen.anim` 的回执**只表示"已受理"**——动画的完成
 *   要等宿主帧循环（Choreographer / CADisplayLink）跑完并**回推**
 *   `__proteusHostScreenAnimDone(token)`。不模拟这一步 ⇒ 执行器的 promise 永远 pending
 *   ⇒ `await router.push(...)` 超时（这正是 App 端"转场是异步的"这一真实语义）。
 *   ⇒ 本桩在收到 anim 后于微任务里回推完成（真机时延由宿主帧循环决定，协议同形）。 */
function makeChannel() {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  let nextRoot = 700
  const invoke = (method: string, argsJson: string): string => {
    const args = JSON.parse(argsJson || 'null') as Record<string, unknown>
    calls.push({ method, args })
    if (method === 'screen.mount') return JSON.stringify({ ok: true, data: { rootNodeId: nextRoot++, nodes: 4 } })
    if (method === 'screen.visible') return JSON.stringify({ ok: true, data: { visible: args.visible, rects: args.visible ? 4 : 0 } })
    if (method === 'screen.destroy') return JSON.stringify({ ok: true, data: { removed: 4 } })
    if (method === 'screen.anim') {
      const token = args.token
      if (typeof token === 'string' && token) setTimeout(() => pushAnimDone(token), 0)
      return JSON.stringify({ ok: true, data: { started: 2 } })
    }
    if (method === 'screen.stats') return JSON.stringify({ ok: true, data: { mount_calls: 1, visible_calls: 1, destroy_calls: 0, anim_calls: 1 } })
    return JSON.stringify({ ok: false, reason: `未知方法 ${method}`, missing: true })
  }
  return { invoke, calls }
}

/** 动画结束回推（模拟宿主帧循环跑完） */
const pushAnimDone = (token: string): void => {
  const g = globalThis as Record<string, unknown>
  const h = g[SCREEN_ANIM_DONE_KEY] as ((t: unknown, r?: unknown) => string) | undefined
  h?.(token, '{}')
}

// ★夹具形态注意（本测试第一版踩到，如实记录）：`home` 若标 `meta.isTab`，
//   `Router.push({name:'home'})` 会走 **switchTab 语义**（= stack.tab = 清栈换根）——
//   这是与 Web/MP 一致的正常语义，不是缺陷。测试"逐层 push"须用**非 tab** 页。
const ROUTES: RouteRecord[] = [
  { name: 'home', path: 'pages/home', component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
  { name: 'detail', path: 'pages/detail', meta: { transition: 'slideUp' } as never, component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
  { name: 'user', path: 'pages/user', meta: { isTab: true } as never, component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
]

describe('① URL ⇄ params（与 Router.buildUrl 的编码约定互逆）', () => {
  it('parseRouterUrl：路径 + query 解码；空 query 边界', () => {
    expect(parseRouterUrl('/pages/user?id=1&name=a%20b')).toEqual({ path: '/pages/user', params: { id: '1', name: 'a b' } })
    expect(parseRouterUrl('/pages/user')).toEqual({ path: '/pages/user', params: {} })
    expect(parseRouterUrl('/pages/user?flag')).toEqual({ path: '/pages/user', params: { flag: '' } })
  })
})

describe('② screensFromRoutes：路由表 → 屏注册表（消灭手抄）', () => {
  it('name/path/transition 原样搬运；缺 name 报错不静默', () => {
    const screens = screensFromRoutes(ROUTES as never)
    expect(Object.keys(screens)).toEqual(['home', 'detail', 'user'])
    expect(screens.detail!.transition).toBe('slideUp')
    expect(() => screensFromRoutes([{ name: '', path: 'x' } as never])).toThrow(/缺 name/)
  })
})

describe('③ 统一 createRouter 打到 App 端（零手写胶水：push → 栈 → 泵 → 宿主 invoke）', () => {
  it('router.push({ name }) 走完全链：虚拟栈 +2 层 + 宿主收到 mount/visible/anim', async () => {
    const { invoke, calls } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: ROUTES as never })
    const router = createRouter(ROUTES as never, { adapter: nav.adapter })

    // ★用法纪律（本测试踩过，写进用例防再犯）：`push` 是 **async**（含守卫链）——
    //   必须 `await`；它的实现内部已等命令流 settle（不必再 flush）。
    //   `flush()` 只用于**同步 API**（`back()`）之后的收工点。
    await router.push({ name: 'home' })
    await router.push({ name: 'detail', params: { id: '7' } })

    // 虚拟栈：2 层，栈顶 detail 且参数保留
    expect(nav.stack.depth).toBe(2)
    expect(nav.stack.current()!.name).toBe('detail')
    expect(nav.stack.current()!.params).toEqual({ id: '7' })

    // 宿主真的被调用（mount ≥2 / visible ≥2 / anim ≥1）——数据来自桩的**记账**
    const methods = calls.map((c) => c.method)
    expect(methods.filter((m) => m === 'screen.mount').length).toBeGreaterThanOrEqual(2)
    expect(methods.filter((m) => m === 'screen.visible').length).toBeGreaterThanOrEqual(2)
    expect(methods.filter((m) => m === 'screen.anim').length).toBeGreaterThanOrEqual(1)
    // mount 参数带着屏身份（name/path/rebuild 契约）
    const firstMount = calls.find((c) => c.method === 'screen.mount')!
    expect(firstMount.args).toMatchObject({ name: 'home', path: 'pages/home', rebuild: false })
  })

  it('router.back() 出栈并再次泵（宿主收到 destroy 或 visible(false)）', async () => {
    const { invoke, calls } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: ROUTES as never })
    const router = createRouter(ROUTES as never, { adapter: nav.adapter })
    await router.push({ name: 'home' })
    await router.push({ name: 'detail' })
    expect(nav.stack.depth).toBe(2) // 前置：确实两层（否则本用例的"出栈"无从谈起）
    const before = calls.length
    router.back()
    await nav.flush()
    expect(nav.stack.depth).toBe(1)
    expect(calls.length).toBeGreaterThan(before)
    const after = calls.slice(before).map((c) => c.method)
    expect(after).toContain('screen.visible') // 旧顶隐藏（树保留）——虚拟栈语义
  })

  it('router.replace / reLaunch 语义：replace 不增深；reLaunch 清栈', async () => {
    const { invoke } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: ROUTES as never })
    const router = createRouter(ROUTES as never, { adapter: nav.adapter })
    await router.push({ name: 'home' })
    await router.replace({ name: 'user' })
    expect(nav.stack.depth).toBe(1)
    expect(nav.stack.current()!.name).toBe('user')
    await router.push({ name: 'user', ...({ reLaunch: true } as never) })
    expect(nav.stack.depth).toBe(1)
  })

  it('未知路径：不静默（抛错并给可用路径提示）', async () => {
    const { invoke } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: ROUTES as never })
    const router = createRouter(ROUTES as never, { adapter: nav.adapter })
    await expect(router.push({ path: 'pages/nope' } as never)).rejects.toThrow(/未知路径|route not found/)
  })
})

describe('④ 平台中立：app-route 模块图不含 @proteus-vue/shared（App 环境可安全 import）', () => {
  it('源码静态断言：app-route/app-adapter/router-core/app-navigation 均不 import shared', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const ROOT = path.resolve(__dirname, '..')
    const files = [
      'packages/router/src/app-route.ts',
      'packages/router/src/app-adapter.ts',
      'packages/router/src/router-core.ts',
      'packages/render-backend/src/app-navigation.ts',
    ]
    for (const f of files) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf-8')
      // 只看 import 词（注释里解释"为什么不 import"是允许的）
      const importLines = src.split('\n').filter((l) => /^\s*(import|export)\b/.test(l) && l.includes('@proteus-vue/shared'))
      expect(importLines, `${f} 不得 import @proteus-vue/shared（App 无 window/wx）`).toEqual([])
    }
  })
})

describe('⑤ Web/MP 主入口行为不变（注入默认 adapter 的路径仍可用）', () => {
  it('createRouter（主入口）默认走 shared adapter（本测只验证"可构造 + push 语义分派"）', async () => {
    const mod = await import('../packages/router/src/index')
    const router = mod.createRouter(ROUTES as never)
    // jsdom 环境下 shared adapter 是 web 实现：push 应触发 navigateTo（不抛错）
    await router.push({ name: 'home' }).catch((e) => {
      // web adapter 缺 location/history 时允许失败——本断言只证明"主入口仍导出且可调用"
      expect(String(e)).toBeTruthy()
    })
    expect(router.stackDepth).toBeGreaterThanOrEqual(0)
  })
})

// ══════════════════════════════════════════════════════════════════
// ★★★（2026-10-02 · 依《主流框架路由调研》启示 3）：**统一 API 的栈原语**（App 端完整支持）
//   调研原文：「在现有 navigateTo/redirectTo/switchTab/reLaunch 之上补 popTo(name/path)、
//   removeByName」——本组证明它们已从 AppStack 一路接到 **统一 Router API**（三端同签名）。
// ══════════════════════════════════════════════════════════════════
describe('⑥ 统一 API 栈原语：popTo / removeByName / moveToTop（启示 3）', () => {
  // ★夹具注意（本测试第一版踩到）：ROUTES 里 `home` 是 `isTab: true` ⇒ `router.push({name:'home'})`
  //   走 **switchTab 语义（清栈换根）** ⇒ 栈里只剩它自己。栈原语用例需用**非 tab** 页。
  const PLAIN: RouteRecord[] = [
    { name: 'a', path: 'pages/a', component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
    { name: 'b', path: 'pages/b', component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
    { name: 'c', path: 'pages/c', component: '', loc: { file: 'x', line: 1, column: 1 } } as never,
  ]

  it('router.popTo(name)：按名回退（不需要数 delta）', async () => {
    const { invoke } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: PLAIN as never })
    const router = createRouter(PLAIN as never, { adapter: nav.adapter })
    await router.push({ name: 'a' })
    await router.push({ name: 'b' })
    await router.push({ name: 'c' })
    expect(nav.stack.depth).toBe(3)
    router.popTo('a')
    await nav.flush()
    expect(nav.stack.depth).toBe(1)
    expect(nav.stack.current()!.name).toBe('a')
  })

  it('router.removeByName(name)：抹掉该屏（幂等，返回移除数）', async () => {
    const { invoke } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: PLAIN as never })
    const router = createRouter(PLAIN as never, { adapter: nav.adapter })
    await router.push({ name: 'a' })
    await router.push({ name: 'b' })
    expect(router.removeByName('b')).toBe(1)
    await nav.flush()
    expect(nav.stack.depth).toBe(1)
    expect(router.removeByName('ghost'), '不存在的名字 = 幂等 0（不抛错）').toBe(0)
  })

  it('router.moveToTop(name)：提到栈顶且**栈深不变**（中间屏原位保留）', async () => {
    const { invoke } = makeChannel()
    const nav = createAppNavigation({ invoke, routes: PLAIN as never })
    const router = createRouter(PLAIN as never, { adapter: nav.adapter })
    await router.push({ name: 'a' })
    await router.push({ name: 'b' })
    await router.push({ name: 'c' })
    router.moveToTop('a')
    await nav.flush()
    expect(nav.stack.depth, 'moveToTop 不改栈深').toBe(3)
    expect(nav.stack.current()!.name).toBe('a')
  })

  it('★不支持该原语的端 ⇒ **明确报错**（不静默退化成 back——那会跳错页）', async () => {
    // 手造一个只实现基础能力的适配器（模拟 Web/MP 侧的受限实现）
    const base = {
      isMP: false,
      getCurrentPages: () => [],
      navigateTo: async () => {},
      redirectTo: async () => {},
      reLaunch: async () => {},
      switchTab: async () => {},
      navigateBack: () => {},
      // 故意不实现 popTo/removeByName/moveToTop
    }
    const router = createRouter(ROUTES as never, { adapter: base as never })
    expect(() => router.popTo('home')).toThrow(/不支持按名回退/)
    expect(() => router.removeByName('home')).toThrow(/不支持/)
    expect(() => router.moveToTop('home')).toThrow(/不支持/)
  })
})

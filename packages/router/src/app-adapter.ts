// packages/router/src/app-adapter.ts
// ★★App 端路由适配器（2026-10-02）—— 把**虚拟路由栈 + 执行器泵**适配成统一 Router 的 `RouterAdapter`
//
// 【它消除的正是"手动胶水"】此前 App 端要用 `createAppStack` 只能手写：
//   `push → drainCommands → executor.applyCommands → host ports`——每个 App 工程都要抄一遍
//   （`hosts/shared/bridge/entry-app-stack.ts` 的 E 组就是那坨胶水的测试形态）。
//   本文件把"栈操作怎么变成命令流并泵给执行器"收成**一个适配器**：
//   `createRouter(routes, { adapter: createAppNavigationAdapter({ stack, pump, screens }) })`
//   ⇒ 开发者写的 `router.push({ name })` 与 Web/MP 完全同形。
//
// 【平台中立】本文件不 import any 平台包（可在 iOS JSC / Android QuickJS 运行）——见 router-core 头注。
import type { AppScreenSpec, AppStack } from './app-stack'
import type { RouteParams } from './types'
import type { RouterAdapter } from './router-core'

/** 归一化路径（注册表 path 与 URL path 的前导斜杠差异不该成为故障点） */
function normPath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}

/** URL → `{ path, params }`（`/pages/user?id=1&name=x`；与 Router.buildUrl 的编码约定互逆） */
export function parseRouterUrl(url: string): { path: string; params: RouteParams } {
  const [rawPath, rawQuery = ''] = url.split('?')
  const params: RouteParams = {}
  if (rawQuery) {
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const k = eq < 0 ? pair : pair.slice(0, eq)
      const v = eq < 0 ? '' : pair.slice(eq + 1)
      params[decodeURIComponent(k)] = decodeURIComponent(v)
    }
  }
  return { path: rawPath ?? '', params }
}

export interface AppNavigationAdapterOptions {
  /** 虚拟路由栈（`createAppStack` 产物） */
  stack: AppStack
  /**
   * 执行器泵：消费 `stack.drainCommands()`（真机 = `executor.applyCommands`（内部经 host ports 往返）；
   * 单测 = 记录桩）。★本适配器**串行化**调用（后一次泵等前一次 settle——宿主往返天然异步）。
   */
  pump: () => Promise<unknown>
  /** 屏注册表（`name ↔ path` 反查；与 `createAppStack({ screens })` 必须同源——同一份事实） */
  screens: Record<string, AppScreenSpec>
}

/**
 * App 端 `RouterAdapter`（结构满足 `RouterAdapter`/`PlatformAdapter` 的导航面）。
 *
 * 语义对齐（与 Web/MP 逐条同义）：
 *   navigateTo → stack.push（虚拟栈无 10 层上限，**无降级分支**——这是相对 MP 的能力溢出）
 *   redirectTo → stack.replace
 *   reLaunch   → stack.reset（清栈换根）
 *   switchTab  → stack.tab（清栈换根，无转场）
 *   navigateBack → stack.pop(delta)（栈深保底 1 屏——`AppStack.pop` 自带夹取）
 * ★`routeType`（自定义路由）当前被忽略：App 端转场来自屏声明（`meta.transition`），
 *   由执行器经 Morpheus 播放——无需与 Skyline 的 routeType 同构（文档 §3.3「App 端可解除的硬限制」）。
 *
 * ★★使用纪律（**测试实测踩到，必须知道**）：`router.push/replace/reLaunch` 是 **async**——
 *   内部 await 转场完成（App 转场是异步的：命令流 → 执行器 → 宿主帧循环播完 → 回推）。
 *   ⇒ **必须 `await`**；不要写成 `router.push(...); await nav.flush()`（两段导航会竞争，
 *   栈序错乱且无报错——测试第一版正是这样挂掉的）。
 *   `flush()` 只用于**同步 API**（`back()`/`navigateBack` 在 Web/MP 是同步签名，三端保持）。
 */
export function createAppNavigationAdapter(
  opts: AppNavigationAdapterOptions,
): RouterAdapter & { flush(): Promise<void> } {
  const { stack, pump, screens } = opts
  /** path（归一化）→ name */
  const byPath = new Map<string, string>()
  for (const spec of Object.values(screens)) byPath.set(normPath(spec.path), spec.name)
  if (byPath.size === 0) {
    throw new Error('[app-adapter] 屏注册表为空——App 端导航需要 screens（与 createAppStack 同源）')
  }

  const resolveName = (urlPath: string): string => {
    const name = byPath.get(normPath(urlPath))
    if (!name) {
      // 不静默：死路径 = 路由表与屏注册表不同源（本仓纪律：报错并给出可行动信息）
      throw new Error(
        `[app-adapter] 未知路径 "${urlPath}"（屏注册表无此屏）——检查路由表与屏注册表同源：` +
          `可用路径 ${[...byPath.keys()].slice(0, 8).join(', ')}${byPath.size > 8 ? ' …' : ''}`,
      )
    }
    return name
  }

  // ★泵串行化：`back()` 等同步 API 触发的泵也进同一队列（后一次等前一次 settle）
  let chain: Promise<unknown> = Promise.resolve()
  const fire = (): Promise<void> => {
    chain = chain.then(() => pump()).catch((e) => {
      // 不吞：记录到 chain 上但保持链可继续（下一条命令仍能发出）——错误已由调用方/宿主读数暴露
      // ★不 re-throw（会卡死后续导航）；真机判据看宿主记账与执行器 stats.errors
      // eslint-disable-next-line no-console
      console.error('[app-adapter] 泵失败：', e)
    })
    return chain as Promise<void>
  }
  /** 等当前命令流全部 settle（真机场景/测试的收工点；`push` 等 await 内部已等） */
  const flush = (): Promise<void> => chain as Promise<void>

  const doUrl = (url: string): { name: string; params: RouteParams } => {
    const { path, params } = parseRouterUrl(url)
    return { name: resolveName(path), params }
  }

  return {
    isMP: false,
    getCurrentPages() {
      // 虚拟栈 → 页面栈投影（Router 核心据此算 depth 与 from；query 对齐 PageInstance.options 语义）
      return stack.stack.map((rec) => ({
        route: rec.path,
        query: Object.fromEntries(Object.entries(rec.params).map(([k, v]) => [k, String(v ?? '')])) as Record<string, string>,
      }))
    },
    async navigateTo({ url }) {
      const { name, params } = doUrl(url)
      stack.push(name, params)
      await fire()
    },
    async redirectTo({ url }) {
      const { name, params } = doUrl(url)
      stack.replace(name, params)
      await fire()
    },
    async reLaunch({ url }) {
      const { name, params } = doUrl(url)
      stack.reset(name, params)
      await fire()
    },
    async switchTab({ url }) {
      const { name, params } = doUrl(url)
      stack.tab(name, params)
      await fire()
    },
    navigateBack({ delta }) {
      stack.pop(delta)
      // Router.back() 是同步 API（三端同签名）——泵在微任务里推进，场景/测试用 flush() 收工
      void fire()
    },
    // ★★★（2026-10-02 · 启示 3）**App 专属栈原语**——Web/MP 受平台栈语义限制，App 虚拟栈完整支持
    //   （"App 端可解除 Skyline 硬限制"的又一兑现：按名回退/移除/提顶都不需要平台配合）
    popTo(name) {
      stack.popTo(name)
      void fire()
    },
    removeByName(name) {
      const n = stack.removeByName(name)
      void fire()
      return n
    },
    moveToTop(name) {
      stack.moveToTop(name)
      void fire()
    },
    flush,
  }
}

/**
 * 从**同一份路由表**（`RouteRecord[]`，即 auto-routes 的产物）推导 App 屏注册表。
 *
 * 【为什么必须有（消灭最后一段胶水）】`createAppStack` 需要 `screens`（name/path/transition/budget/keepAlive），
 *   而 App 工程手上只有路由表；若不提供本函数，每个工程要手抄一份屏注册表 —— 正是"手动胶水"。
 *   本函数与 `codegen/app.ts` 的 `generateAppScreens` **同一语义**（那边是代码产物形态，
 *   这边是运行时可调形态；两处的 name/path/transition 规则一致——见 generateAppScreens 头注）。
 */
export function screensFromRoutes(
  routes: Array<{
    name: string
    path: string
    meta?: { transition?: unknown; isTab?: unknown; budgetNodes?: unknown; branch?: unknown }
  }>,
): Record<string, AppScreenSpec> {
  const out: Record<string, AppScreenSpec> = {}
  for (const r of routes) {
    if (!r.name) {
      // 路由表契约要求 name（gen-routes 保证）；缺 name = 上游产物异常，不静默跳过
      throw new Error(`[app-adapter] 路由表条目缺 name（path="${r.path}"）——检查 gen-routes 产物`)
    }
    const spec: AppScreenSpec = { name: r.name, path: r.path }
    const t = r.meta?.transition
    if (typeof t === 'string') spec.transition = t as AppScreenSpec['transition']
    const b = r.meta?.budgetNodes
    if (typeof b === 'number' && b > 0) spec.budgetNodes = b
    // ★NB3：分支保活档（meta.branch.keepAlive——仅 tab 根有意义；与 codegen/app.ts 同源）
    const ka = (r.meta?.branch as { keepAlive?: unknown } | undefined)?.keepAlive
    if (ka === 'none' || ka === 'active' || ka === 'all') spec.keepAlive = ka
    out[r.name] = spec
  }
  return out
}

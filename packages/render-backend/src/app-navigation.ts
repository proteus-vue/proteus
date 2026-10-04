// packages/render-backend/src/app-navigation.ts
// ★★App 端**一站式导航装配**（2026-10-02）—— 消灭"手动胶水"的最终形态
//
// 【此前 App 工程要手写什么（胶水的准确清单，来自 `entry-app-stack.ts` 的真实形态）】
//   ① `createAppStack({ screens, policy })`
//   ② `createScreenExecutor({ host: ports.tree, anim: ports.anim, plan: routeTransitionBatches })`
//   ③ `createHostScreenPorts({ invoke })`（宿主通道）
//   ④ 每次栈操作后 `executor.applyCommands(stack.drainCommands())`（泵）
//   ⑤ 把栈包装成 RouterAdapter（URL 解析、path↔name、back→pop……）
//   —— 五段全由开发者手抄 ⇒ 跨 App 复制粘贴 ⇒ 一旦内核契约演进，各处版本漂移。
//
// 【本装配器做什么】把 ①②③⑤ 与 `@proteus-vue/router` 的适配器接起来，暴露**一个函数**：
//   `const nav = createAppNavigation({ invoke, screens, routes })`
//   `const router = createRouter(routes, { adapter: nav.adapter })`
//   `router.push({ name: 'detail', params: { id: 1 } })`   // ← 与 Web/MP 同形，零胶水
//
// 【平台中立】只依赖「宿主通道（字符串请求/响应）」与既有纯逻辑包——可在 JSC/QuickJS 运行。
//   宿主通道 = 各端既有 `proteusHost.invoke`（Android `QuickJsEngine` / iOS `JSContext` 注入，
//   两端实现已在 `screen-executor-host.ts` 的协议里固化）。
//
// 【诚实边界】本文件只做**装配与转发**；"宿主是否真建树/真播动画"由宿主记账（`screen.stats`）
//   与既有判据（`check-app-stack.py`）证明——本层不声称。
import type { AppScreenSpec, AppStack, AppStackPolicy } from '@proteus-vue/router/app-stack'
import { createAppStack } from '@proteus-vue/router/app-stack'
import { createAppNavigationAdapter, screensFromRoutes } from '@proteus-vue/router/app-route'
import type { RouteRecord } from '@proteus-vue/router/types'
import { createScreenExecutor, type ScreenExecutor, type ScreenContentProvider } from './screen-executor'
import { createHostScreenPorts, type HostInvokeChannel } from './screen-executor-host'
import { routeTransitionBatches } from '@proteus-vue/animation'

export interface AppNavigationOptions {
  /** 宿主通道（同步字符串往返；Android/iOS 壳已注入 `proteusHost.invoke`） */
  invoke: HostInvokeChannel
  /**
   * 屏注册表：与 `createAppStack` 同源。
   * ★二选一：直接给 `screens`，或给 `routes`（本函数用 `screensFromRoutes` 推导——推荐，
   *   消灭"手抄屏注册表"这段胶水）。
   */
  screens?: Record<string, AppScreenSpec>
  /** 路由表（`gen-routes` 产物；给了它就不必给 screens） */
  routes?: RouteRecord[]
  /** 内存治理策略（传给 `createAppStack`） */
  policy?: AppStackPolicy
  /** ★批次 43：**屏内容提供者**（页面真实内容；缺省 ⇒ 空壳）——真实应用入口据此装页面 */
  contentOf?: ScreenContentProvider
  /** 建屏完成通知（默认接 `stack.markRebuilt`——契约要求执行器建完调它） */
  onScreenMounted?: (screenId: string, rebuild: boolean) => void
  /** 诊断事件（端口调用序——判据/测试读它） */
  onEvent?: (e: { type: string; screenId?: string; detail?: unknown }) => void
  /**
   * 自动泵（默认 true）：栈操作产生的命令在**同一微任务**里交给执行器。
   * ★关掉它 = 回到手工 `drainCommands`（仅用于需要自己控拍的场景）。
   */
  autoPump?: boolean
}

export interface AppNavigation {
  /** 虚拟路由栈（诊断/深栈读数用；正常导航走 adapter） */
  stack: AppStack
  /** 命令流执行器（诊断/stats 用） */
  executor: ScreenExecutor
  /** RouterAdapter（直接喂给 `createRouter(routes, { adapter })`） */
  adapter: ReturnType<typeof createAppNavigationAdapter>
  /** 等当前命令流全部 settle（真机场景收工点；`router.push` 内部已 await） */
  flush(): Promise<void>
  /** 宿主记账（`screen.stats`；判据读它——证明"动作真发生"） */
  hostStats(): unknown
}

/**
 * 装配 App 端导航：栈 + 执行器 + 宿主端口 + Router 适配器。
 *
 * 用法（宿主 JS 入口，QuickJS/JSC 里）：
 * ```ts
 * const nav = createAppNavigation({ invoke: (m, a) => proteusHost.invoke(m, a), routes })
 * const router = createRouter(routes, { adapter: nav.adapter })
 * router.push({ name: 'detail', params: { id: 1 } })   // ← 零胶水
 * ```
 */
export function createAppNavigation(opts: AppNavigationOptions): AppNavigation {
  if (!opts.screens && !opts.routes) {
    throw new Error('[app-navigation] 需要 screens 或 routes 之一（屏注册表的来源——不猜）')
  }
  const screens: Record<string, AppScreenSpec> = opts.screens ?? screensFromRoutes(opts.routes as RouteRecord[])
  if (Object.keys(screens).length === 0) {
    throw new Error('[app-navigation] 屏注册表为空——检查 routes/screens 是否为空')
  }
  const stack = createAppStack({ screens, ...(opts.policy ? { policy: opts.policy } : {}) })

  const ports = createHostScreenPorts({ invoke: opts.invoke })
  const executor = createScreenExecutor({
    host: ports.tree,
    anim: ports.anim,
    ...(opts.contentOf ? { contentOf: opts.contentOf } : {}),
    plan: (t, targets, o) => routeTransitionBatches(t, targets, o ?? {}),
    onScreenMounted: opts.onScreenMounted ?? ((id) => stack.markRebuilt(id)),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  })

  const autoPump = opts.autoPump !== false
  const adapter = createAppNavigationAdapter({
    stack,
    screens,
    pump: autoPump
      ? () => executor.applyCommands(stack.drainCommands())
      : async () => {
          /* 手动泵模式：不消费（调用方自行 drainCommands + applyCommands） */
        },
  })

  return {
    stack,
    executor,
    adapter,
    flush: () => adapter.flush(),
    hostStats: () => {
      try {
        return JSON.parse(opts.invoke('screen.stats', 'null')) as unknown
      } catch (e) {
        return { error: String(e) }
      }
    },
  }
}

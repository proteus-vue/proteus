// hosts/shared/bridge/entry-app-project.ts
// ★★★（2026-10-02 · 项目驱动落地）**从项目路由配置跑 App 端导航** —— 消灭"夹具手写屏幕数组"
//
// 【为什么单独一个入口（本仓反复出现的形态）】
//   `entry-app-stack.ts` 的场景 A–D 需要"深栈/冻结"这类**可调规模**的压测输入，
//   它自己造了 `buildNodes(fans)`（合成屏池）——那是**压测装置**，不是产品路径。
//   本入口走**产品路径**：屏注册表直接来自项目的**统一导航产物** `router/auto-routes.ts`
//   （由 `gen-routes` 从 `pages/**/*.vue` + `proteus.config.ts` 的 `router.pages` 产出；
//    单一产物：同一文件携带 routes / screens / screenNames / tabNames / 类型表）。
//
// 【本入口证明什么（与压测装置的分界）】
//   ① **项目 → App 的链路是通的**：改一个页面/加一条 `router.meta` 里的 transition
//      ⇒ App 端导航注册表随构建自动更新（不需要任何人手写屏数组）；
//   ② **统一 API 消费项目产物**：`createRouter(routes, { adapter })` + `createAppStack({ screens })`
//      ——与 Web/MP 用**同一份 auto-routes**（同一棵路由树的两个投影）；
//   ③ **屏的转场来自项目声明**（`router.meta.transition`）而不是装置常量。
//
// 【与夹具的关系（诚实边界）】本入口**不压测**（不做 20000 层/冻结读数——那是 entry-app-stack 的职责）；
//   它只跑"真实导航操作"，用于证明**项目配置驱动**与**两端一致**。
import { createAppStack } from '@proteus-vue/router/app-stack'
import { createRouter } from '@proteus-vue/router/app-route'
import { createAppNavigation } from '@proteus-vue/render-backend/app-navigation'

// ★项目产物（gen-routes 生成）：**一个文件承载三份投影**（2026-10-02 统一后）
//   —— `routes`（Web/MP）· `screens`/`screenNames`/`tabNames`（App）· `RouteParamsByName` 类型表
//   全部来自 `auto-routes.ts`（同一棵路由树、同一次产出）——不再有第二份导航注册表。
import { routes as projectRoutes, screens as projectScreens, screenNames, tabNames } from '../../../examples/router/auto-routes'

// ★诚实边界：这两个产物由 `gen-routes` 生成（`proteus build` 时）。
//   若仓库是**干净克隆且未构建过 examples**，本文件不存在 ⇒ 构建期报错（**不静默**）——
//   提示：先跑 `cd examples && npx tsx ../packages/cli/src/index.ts build --target skyline`。

/** 入参（JSON 串；缺省用默认） */
interface ProjectArgs {
  /** 起始屏（缺省 = 第一个 tab 根屏，模拟冷启动落地） */
  entry?: string
  /** 依次 push 的屏数（缺省 3；从 screenNames 顺序取，跳过与入口同名） */
  steps?: number
}

/**
 * 从项目产物跑一次真实导航链路（同步返回读数；宿主侧无需泵 job——本函数**不自建执行器**，
 * 只驱动栈本身与统一 API，用于证明"项目配置 → 屏注册表 → 导航语义"这条链）。
 *
 * 判据读数字段：
 *   · `screens`（注册表条数）与 `name_count`（名字数组长度）——与路由表同源；
 *   · `entry` / `after_push` / `after_back` —— 导航语义逐步结果；
 *   · `transitions_carried` —— 注册表里**携带项目 transition 声明**的屏数（证明转场来自项目）。
 */
export function __proteusAppProjectRun(argsJson?: string): string {
  const args: ProjectArgs = argsJson ? JSON.parse(argsJson) : {}
  const names = Array.isArray(screenNames) ? screenNames : []
  const entry = args.entry ?? (Array.isArray(tabNames) && tabNames.length ? tabNames[0] : names[0])
  const steps = Math.max(0, args.steps ?? 3)

  const base = {
    ok: true,
    scene: 'app-project',
    screens: Object.keys(projectScreens).length,
    name_count: names.length,
    tab_count: Array.isArray(tabNames) ? tabNames.length : 0,
    route_count: Array.isArray(projectRoutes) ? projectRoutes.length : 0,
    // ★项目声明被携带的证据：多少屏带 transition（来自 router.meta / <route>）
    transitions_carried: Object.values(projectScreens).filter((s) => !!s.transition).length,
    entry,
  }

  if (!entry || !projectScreens[entry]) {
    return JSON.stringify({ ...base, ok: false, error: `入口屏 "${entry}" 不在项目屏注册表（可用：${names.slice(0, 6).join(', ')}…）` })
  }

  // ① 用项目产物直接建栈（产品路径：非夹具合成）
  const stack = createAppStack({ screens: projectScreens })
  stack.push(entry)
  stack.drainCommands()
  const afterEntry = { depth: stack.depth, top: stack.current()?.name, transition: stack.current()?.transition }

  // ② 依次 push 项目里的真实屏（按 screenNames 顺序，跳过入口与已入栈者）
  const pushed: string[] = []
  for (const n of names) {
    if (pushed.length >= steps) break
    if (n === entry) continue
    if (!projectScreens[n]) continue
    stack.push(n)
    pushed.push(n)
  }
  stack.drainCommands()
  const afterPush = {
    depth: stack.depth,
    top: stack.current()?.name,
    pushed,
    // 每个被 push 的屏，其转场声明（来自项目 meta）——空 = 该屏未声明
    transitions: pushed.map((n) => projectScreens[n]?.transition ?? null),
  }

  // ③ 返回一步（虚拟栈语义：树保留 + 上屏恢复）
  stack.pop()
  const cmds = stack.drainCommands()
  const afterBack = { depth: stack.depth, top: stack.current()?.name }
  const backOps = cmds.map((c) => c.op)

  // ④ 统一 API（同一份项目路由表 → App）：证明"同一路由表两个投影"（Web/MP 用 routes，App 用 screens）
  let apiResult: Record<string, unknown>
  try {
    const nav = createAppNavigation({
      invoke: (m: string, a: string): string => {
        const ph = (globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
        if (!ph || typeof ph.invoke !== 'function') throw new Error('宿主 invoke 通道缺失')
        return ph.invoke(m, a)
      },
      screens: projectScreens,
    })
    const router = createRouter(projectRoutes as never, { adapter: nav.adapter })
    apiResult = { adapter_ready: true, api_stack_depth: nav.stack.depth }
  } catch (e) {
    apiResult = { adapter_ready: false, error: String(e) }
  }

  return JSON.stringify({
    ...base,
    after_entry: afterEntry,
    after_push: afterPush,
    after_back: afterBack,
    back_ops: backOps,
    ...apiResult,
  })
}

// 挂全局（IIFE 无模块系统——与 __proteusAppStackRun 同法）
;(globalThis as unknown as { __proteusAppProjectRun: typeof __proteusAppProjectRun }).__proteusAppProjectRun =
  __proteusAppProjectRun

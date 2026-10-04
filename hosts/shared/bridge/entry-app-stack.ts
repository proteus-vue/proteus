// hosts/android/bridge/entry-app-stack.ts —— ★★M5：Android 真机上跑**真实的路由虚拟栈核心**
//
// 【为什么要有它（与单测的分工）】
//   `tests/app-stack.test.ts`（34 条）证明的是**逻辑正确性**（在 Node/V8 上）；
//   本入口把**同一份 TS 源码**（`packages/router/src/app-stack.ts`，零平台依赖）打进
//   Android 的 QuickJS 并在真机跑深栈读数 ⇒ 证明的是：
//     ① **端上真的没有层数上限**（20000 层 push/pop 全成，对照小程序第 10 层失败）；
//     ② **端上性能量级**（push 的毫秒读数——"高性能"不是口号，要有真机数字）；
//     ③ **冻结路径的正确性**（超预算冻结最旧屏、活跃节点守住预算、返回=重建）；
//     ④ **命令守恒**（mount/enter/exit/unmount 与栈操作一一对应——执行器契约不被破坏）。
//   ★与 S3b/S5 同一形态：跑**真实产物**，不是手写等价 JS。
//
// 【与 iOS 的关系】本入口零平台依赖（app-stack.ts 纯逻辑）⇒ iOS 若要同款读数，
//   直接把本文件加到 iOS bundle 的 entry 即可（本仓纪律：同一语义一处实现）。
//
// 【产物】`hosts/android/bridge/dist/bundle-app-stack.js`（IIFE；由 build-batch.mjs 生成）
// 【调用】Java 侧：eval(bundle) 定义 `globalThis.__proteusAppStackRun`，再 eval 调用它
import { createAppStack } from '@proteus-vue/router/app-stack'
// ★★场景 F（2026-10-02 App 端路由收口）：统一 API 全链（零胶水形态）
import { createAppNavigation } from '@proteus-vue/render-backend/app-navigation'
import { createRouter } from '@proteus-vue/router/app-route'
// ★场景 E：执行器（命令流的消费者）+ 转场规划器（真 animation 包）
import { routeTransitionBatches } from '@proteus-vue/animation'
// ★执行器在 render-backend 的**子路径**（包 exports 未暴露 ⇒ 相对导入同一 src 文件：
//   类型检查与 esbuild 走同一条路径，零 alias/paths 配置、也无'陈旧 dist'面）。
import { createScreenExecutor } from '../../../packages/render-backend/src/screen-executor'
import { createHostScreenPorts } from '../../../packages/render-backend/src/screen-executor-host'
// ★★★阶段 1b（B5 · 2026-10-04）：**SFC 产物 → 屏内容**（构建期由 gen-app-screen-content.mjs
//   用编译器 buildLayoutTemplate + 转换器生成）——端上跑的是真 SFC 产物，不是手写 stub。
import { APP_SCREEN_CONTENT } from './app-screen-content.generated'
import { flattenScreenEntries } from '@proteus-vue/router/codegen'
import type { RouteNode } from '@proteus-vue/router/types'

/** 入参（JSON 串；缺省用默认值——Java 侧不传也能跑） */
interface RunArgs {
  /** 深栈层数（默认 20000——远超小程序 10 层上限，用于证明"无人工上限"） */
  depth?: number
  /** 屏池大小（循环使用的屏数；默认 32） */
  fans?: number
  /** 冻结预算（节点数；默认 1000；传 -1 = 不配预算） */
  budget?: number
}

/** 造屏池：RouteNode 形态（与 scan/tree 管线产物同形——走真实 codegen 函数） */
function buildNodes(fans: number): RouteNode[] {
  const nodes: RouteNode[] = []
  for (let i = 0; i < fans; i++) {
    nodes.push({
      loc: { file: `page-${i}.vue`, line: 1, column: 1 },
      path: `/page-${i}`,
      name: `page-${i}`,
      meta: { title: `页面 ${i}`, transition: i % 2 === 0 ? 'slideUp' : 'halfScreen' },
      lazy: true,
      componentPath: `/pages/page-${i}.vue`,
      children: [],
    })
  }
  return nodes
}

/**
 * 主入口：跑四组场景，返回判据读数（JSON 串）。
 *
 * 场景 A（深栈）：depth 层 push → 耗尽/截断检测 + push_ms；popToRoot 回到 1 层 + pop_ms
 * 场景 B（冻结）：同规模 + nodeBudget → frozen 计数 / active_nodes ≤ 预算 / freeze 命令数 / push_ms
 * 场景 C（重建）：小栈强制冻结栈底 → pop 回冻结屏 → mount(rebuild=true) 计数
 * 场景 D（navigate diff）：深栈 → 只留前半 → 命令应"仅 unmount、零 mount"（树保留 + 最小操作集）
 */
export function __proteusAppStackRun(argsJson?: string): string {
  const args: RunArgs = argsJson ? JSON.parse(argsJson) : {}
  const depth = args.depth ?? 20000
  const fans = args.fans ?? 32
  const budget = args.budget ?? 1000

  // ① 真实 codegen 管线：RouteNode[] → 屏条目（与产品路径同函数）
  const nodes = buildNodes(fans)
  const entries = flattenScreenEntries(nodes)
  // ★直接复用 codegen 条目作为屏注册表（名字/路径/转场/预算都同型——两半接口咬合）
  const screens: Record<string, { name: string; path: string; transition?: (typeof entries)[number]['transition']; budgetNodes?: number }> = {}
  for (const e of entries) screens[e.name] = { name: e.name, path: e.path, transition: e.transition, budgetNodes: e.budgetNodes }

  const names = entries.map((e) => e.name)

  // ── 场景 A：深栈（无预算 → 无冻结；全栈保留）──
  const deep = createAppStack({ screens })
  const tA0 = Date.now()
  for (let i = 0; i < depth; i++) deep.push(names[i % fans], { i })
  const pushMs = Date.now() - tA0
  const depthReached = deep.depth
  const deepCmds = deep.drainCommands()
  const count = (arr: Array<{ op: string }>, op: string): number => arr.filter((c) => c.op === op).length
  const aMount = count(deepCmds, 'mount')
  const aEnter = count(deepCmds, 'enter')
  const aExit = count(deepCmds, 'exit')
  const aUnmount = count(deepCmds, 'unmount')
  const tPop0 = Date.now()
  deep.popToRoot()
  const popMs = Date.now() - tPop0
  const depthAfterRoot = deep.depth
  // popToRoot 命令：1 exit + (depth-1) unmount + 1 enter（回到根）
  const rootCmds = deep.drainCommands()
  const rootUnmount = count(rootCmds, 'unmount')

  // ── 场景 B：预算冻结（active 有界 + 无失败）──
  const frozen = createAppStack({ screens, policy: { nodeBudget: budget, keepWindow: 3, defaultScreenNodes: 64 } })
  const tB0 = Date.now()
  for (let i = 0; i < depth; i++) frozen.push(names[i % fans], { i })
  const frozenPushMs = Date.now() - tB0
  const frozenStats = frozen.stats()
  const frozenCmds = frozen.drainCommands()
  const freezeUnmounts = frozenCmds.filter((c) => c.op === 'unmount' && c.reason === 'freeze').length

  // ── 场景 C：重建（冻结栈底 → pop 回它 → mount(rebuild=true)）──
  //   budget=64 / 每屏 64 / keepWindow=1 ⇒ push 第二屏时冻结第一屏
  const smallScreens: Record<string, { name: string; path: string; budgetNodes?: number }> = {}
  for (const n of names) smallScreens[n] = { name: n, path: `/page-${n}`, budgetNodes: 64 }
  const rebuild = createAppStack({ screens: smallScreens, policy: { nodeBudget: 64, keepWindow: 1, defaultScreenNodes: 64 } })
  rebuild.push(names[0])
  rebuild.push(names[1]) // 触发冻结 names[0]（栈底）
  const cFrozen = rebuild.stats().frozen
  rebuild.drainCommands()
  rebuild.pop() // 回冻结屏 → 应重建
  const cCmds = rebuild.drainCommands()
  const cMounts = cCmds.filter((c) => c.op === 'mount')
  const cRebuildMounts = cMounts.filter((c) => c.op === 'mount' && c.rebuild).length
  const cRebuildStat = rebuild.stats().rebuildCount

  // ── 场景 D：navigate diff（深栈 → 只留前半；仅 unmount 零 mount）──
  const navDepth = Math.min(depth, 5000)
  const nav = createAppStack({ screens })
  for (let i = 0; i < navDepth; i++) nav.push(names[i % fans])
  nav.drainCommands()
  const keep = Math.floor(navDepth / 2)
  const frames = []
  for (let i = 0; i < keep; i++) frames.push({ name: names[i % fans] })
  const tD0 = Date.now()
  nav.navigate(frames)
  const navMs = Date.now() - tD0
  const navCmds = nav.drainCommands()
  const dMount = count(navCmds, 'mount')
  const dUnmount = count(navCmds, 'unmount')
  const dEnter = count(navCmds, 'enter')
  const dDepth = nav.depth

  const result = {
    ok: true,
    scene: 'app-stack',
    // 规模参数（读数可复现）
    depth,
    fans,
    budget,
    screens: entries.length,
    // 场景 A（深栈）
    a_depth_reached: depthReached,
    a_push_ms: pushMs,
    a_pop_ms: popMs,
    a_depth_after_pop_to_root: depthAfterRoot,
    a_mounts: aMount,
    a_enters: aEnter,
    a_exits: aExit,
    a_unmounts: aUnmount,
    a_root_unmounts: rootUnmount,
    // 场景 B（冻结）
    b_frozen_count: frozenStats.frozen,
    b_active_nodes: frozenStats.activeNodes,
    b_over_budget: frozenStats.overBudget,
    b_freeze_unmounts: freezeUnmounts,
    b_push_ms: frozenPushMs,
    b_depth: frozenStats.depth,
    // 场景 C（重建）
    c_frozen_before_pop: cFrozen,
    c_rebuild_mounts: cRebuildMounts,
    c_rebuild_stat: cRebuildStat,
    // 场景 D（navigate diff）
    d_mounts: dMount,
    d_unmounts: dUnmount,
    d_enters: dEnter,
    d_depth: dDepth,
    d_nav_ms: navMs,
  }
  return JSON.stringify(result)
}

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统）
;(globalThis as unknown as { __proteusAppStackRun: typeof __proteusAppStackRun }).__proteusAppStackRun =
  __proteusAppStackRun

/**
 * 场景 E 主体：真栈 + 真执行器 + 真转场规划器（端口 = 记录桩）。
 * 返回读数（JSON 可序列化）；断言细节在 python 判据侧（本函数只产出事实）。
 */
function invokeHostRaw(method: string): unknown {
  const ph = (globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
  if (!ph || typeof ph.invoke !== 'function') throw new Error('宿主 invoke 通道缺失')
  const out = JSON.parse(ph.invoke(method, 'null')) as { ok?: boolean; data?: unknown }
  return out && out.ok === false ? { error: out } : (out as { data?: unknown }).data ?? out
}

async function runExecutorScenario(): Promise<Record<string, unknown>> {
  const eSpecs: Record<string, { name: string; path: string; transition?: 'slideUp' | 'halfScreen' | 'none' }> = {
    home: { name: 'home', path: '/home', transition: 'slideUp' },
    detail: { name: 'detail', path: '/detail', transition: 'slideUp' },
    third: { name: 'third', path: '/third', transition: 'halfScreen' },
  }
  const eStack = createAppStack({ screens: eSpecs, policy: { keepWindow: 3 } })
  const eLog: string[] = []
  const ePlays: Array<Record<string, unknown>> = []
  // ★★真实端口（2026-09-30 续）：树操作/动画走**宿主通道**（`proteusHost.invoke`）
  //   ⇒ 宿主侧 `ScreenHost` 真建内核树 / 真改 display / 真跑内核动画 + Choreographer 帧循环。
  //   ★记录桩已退役为**观察者**（不干预调用，只记 direction/批次数——用于方向与镜像对断言）。
  const ePorts = createHostScreenPorts({
    invoke: (m, a) => {
      const ph = (globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
      if (!ph || typeof ph.invoke !== 'function') throw new Error('宿主 invoke 通道缺失（screen.* 无法送达宿主）')
      return ph.invoke(m, a)
    },
  })
  // ★观察者包装（记录**调用序**——判据 ⑦.1/⑦.4 读它；真实动作仍在 ePorts 内）
  const eTree: typeof ePorts.tree = {
    mountScreen(sc) {
      const node = ePorts.tree.mountScreen(sc)
      eLog.push(`mount:${sc.name}:rebuild=${sc.rebuild}:node=${node}`)
      return node
    },
    setScreenVisible(screenId, v, root) {
      eLog.push(`visible:${screenId}:${v}:node=${root}`)
      ePorts.tree.setScreenVisible(screenId, v, root)
    },
    destroyScreen(screenId, reason, root) {
      eLog.push(`destroy:${screenId}:${reason}:node=${root}`)
      ePorts.tree.destroyScreen(screenId, reason, root)
    },
  }
  const eExecutor = createScreenExecutor({
    host: eTree,
    anim: {
      async playRouteTransition(plan, ctx) {
        // 观察者记账（不改变调用——真实调用在 ePorts.anim 内）
        const i0 = plan.incoming.anims[0] as { from?: number; to?: number } | undefined
        const o0 = plan.outgoing.anims[0] as { from?: number; to?: number } | undefined
        ePlays.push({
          direction: ctx.direction,
          transition: ctx.transition,
          inAnims: plan.incoming.anims.length,
          outAnims: plan.outgoing.anims.length,
          firstInFrom: i0 && typeof i0.from === 'number' ? i0.from : null,
          firstInTo: i0 && typeof i0.to === 'number' ? i0.to : null,
          firstOutFrom: o0 && typeof o0.from === 'number' ? o0.from : null,
          firstOutTo: o0 && typeof o0.to === 'number' ? o0.to : null,
        })
        await ePorts.anim.playRouteTransition(plan, ctx)
      },
    },
    plan: (t: unknown, targets: { incoming?: number; outgoing?: number }, o?: { direction?: 'forward' | 'back' }) =>
      routeTransitionBatches(t, targets, o ?? {}),
    // ★★★阶段 1b（B5 · 2026-10-04）：**屏内容来自真实 SFC 产物**（构建期生成）——
    //   `APP_SCREEN_CONTENT[屏名]` 是 `buildLayoutTemplate(SFC) → screenContentFromLayoutTemplate`
    //   的产物（不是手写节点）。未命中的屏回落 `default`/首个（装置屏名与项目屏名不完全重合时）。
    contentOf: (s) => {
      const byName = APP_SCREEN_CONTENT
      return byName[s.name] ?? byName.index
    },
    onScreenMounted: (id: string) => eStack.markRebuilt(id),
  })
  const ePump = () => eExecutor.applyCommands(eStack.drainCommands())

  // E1 首屏 → E2 push（forward）→ E3 pop（back，镜像对）
  eStack.push('home')
  await ePump()
  const e1 = { log: [...eLog], plays: [...ePlays] }
  const eHomeId = eStack.stack[0]?.screenId ?? ''

  // ★★E4 第一步（2026-10-01 收诚实边界 · **跨页面共享元素的稳态几何回传**）：
  //   **在源页仍可见时**捕获源矩形（这才是真实语义——新页 mount 时旧页已被 display:none，
  //   内核按设计拒绝取隐藏节点的几何（`节点无绝对几何`）；跨页面飞行的起点本来就必须
  //   来自"切换前的那一稳态"）。捕获后的矩形以**系统坐标**注入下一次飞行。
  let e4Source: Record<string, unknown> = { captured: false }
  try {
    const homeRoot0 = eExecutor.subtreeNode(eHomeId)
    if (homeRoot0 === undefined) throw new Error(`subtreeNode 缺 home 屏根（${eHomeId}）`)
    const srcRect = await ePorts.shared.rect(eHomeId, homeRoot0 + 2)
    e4Source = { captured: true, screen: eHomeId, node: homeRoot0 + 2, rect: srcRect }
  } catch (err) {
    e4Source = { captured: false, error: String(err) }
  }

  eLog.length = 0
  ePlays.length = 0
  eStack.push('detail')
  await ePump()
  const e2 = { log: [...eLog], plays: [...ePlays] }
  const eDetailId = eStack.stack[1]?.screenId ?? ''

  // ★★E4 第二步 + 飞行：目标页已 mount ⇒ 取目标节点基准 → 用**捕获的源矩形**发起跨页面飞行。
  //
  // 【缺的是什么（边界原文）】"跨页面的稳态几何回传需页面栈层配合（未做）"。
  //   内核侧早已具备该通道（`shared_element` 的 `sourceRect` 分支 = 系统坐标注入），
  //   缺的就是**这一层**：源页矩形在切换前捕获 + 目标页 mount 后取基准 + 送内核算几何。
  // 【★时机 = push 之后、pop 之前】共享元素的自然时机（新页刚 mount）；**不改变栈状态**
  //   ⇒ ⑦ 组的"pop 后 detail 已销毁 / 树保留"断言不受影响。
  // 【★节点 id 一律经 `subtreeNode`】宿主 mount 的真实回执——硬编码在屏池复用下必错（实测）。
  let e4: Record<string, unknown> = { ran: false }
  try {
    const top = eStack.stack[eStack.stack.length - 1]
    const prev = eStack.stack[eStack.stack.length - 2]
    if (!top || !prev) throw new Error(`栈上不足两屏（depth=${eStack.depth}）——无法做跨页面飞行`)
    if (!e4Source.captured) throw new Error(`源矩形未捕获：${JSON.stringify(e4Source)}`)
    const targetRoot = eExecutor.subtreeNode(top.screenId)
    if (targetRoot === undefined) throw new Error(`subtreeNode 缺目标屏根（${top.screenId}）`)
    const targetNodeId = targetRoot + 2
    const targetRect = await ePorts.shared.rect(top.screenId, targetNodeId)
    const srcRect = e4Source.rect as { x: number; y: number; w: number; h: number }
    const flyOut = await ePorts.shared.fly({
      targetScreenId: top.screenId,
      targetNodeId,
      // ★源矩形**人为错开**（缩略图 → 大图的真实形态）：若两侧装置几何恰好相同
      //   （本装置两屏同构 ⇒ dx=dy=0/scale=1），判据的"独立复算"会退化成恒等式——
      //   错开后才真正考验"内核按两个不同矩形算几何"。错开的量进报告（判据核对）。
      sourceRect: { x: srcRect.x + 60, y: srcRect.y + 30, w: srcRect.w * 0.5, h: srcRect.h * 0.5 },
      durMs: 200,
      curve: 1,
      fadeIn: false,
    })
    e4 = {
      ran: true,
      target_screen: top.screenId,
      source_screen: e4Source.screen,
      target_node: targetNodeId,
      source_node: e4Source.node,
      source_rect: srcRect,
      /** ★实际注入的源矩形（错开后的——判据按它复算） */
      injected_source_rect: { x: srcRect.x + 60, y: srcRect.y + 30, w: srcRect.w * 0.5, h: srcRect.h * 0.5 },
      target_rect: targetRect,
      from_rect: flyOut.fromRect ?? null,
      to_rect: flyOut.toRect ?? null,
    }
  } catch (err) {
    e4 = { ran: false, error: String(err), source: e4Source }
  }

  eLog.length = 0
  ePlays.length = 0
  eStack.pop()
  await ePump()
  const e3 = { log: [...eLog], plays: [...ePlays] }
  const eStats = eExecutor.stats()
  const e2play = e2.plays[0] as Record<string, unknown> | undefined
  const e3play = e3.plays[0] as Record<string, unknown> | undefined
  const mirrorOk =
    !!e2play &&
    !!e3play &&
    e2play.firstInFrom === e3play.firstOutTo &&
    e2play.firstInTo === e3play.firstOutFrom

  return {
    e1_log: e1.log,
    e1_plays: e1.plays,
    e2_log: e2.log,
    e2_plays: e2.plays,
    e3_log: e3.log,
    e3_plays: e3.plays,
    e4,
    e_mirror_ok: mirrorOk,
    e_home_id: eHomeId,
    e_detail_id: eDetailId,
    e_stats: eStats,
    // ★真实端口读数：宿主侧记账（真建树/真可见性/真动画——判据据此证明"不是壳自述"）
    e_host_stats: (() => {
      try {
        const r = invokeHostRaw('screen.stats')
        return r
      } catch (e) {
        return { error: String(e) }
      }
    })(),
    e_pending_anims: ePorts.pendingAnimations,
    e_anim_hook: ePorts.animDoneHookInstalled,
  }
}

/**
 * ★★场景 F（2026-10-02 · App 端路由收口）：**统一路由 API 在真机上跑全链**
 *
 * 【与场景 E 的差别（本场景要证明的是"零胶水"）】E 组手写装配
 *   （`createAppStack` + `createScreenExecutor` + `createHostScreenPorts` + 手写泵）——
 *   那是"现在 App 开发者被迫写的胶水"的测试形态。本场景改走**产品形态**：
 *     `createAppNavigation({ invoke, routes })` + `createRouter(routes, { adapter })`
 *   ⇒ 开发者只写 `router.push({ name, params })`，与 Web/MP **完全同形**。
 *
 * 【为什么放在真机（QuickJS）】① 证明 app-route / app-navigation 的模块图**可在无 DOM 环境运行**
 *   （这是本次重构的核心风险点——shared adapter 的 #491 事故同源）；② 真机宿主（ScreenHost）真建
 *   内核树/真播动画 —— 与 E 组同一条纪律：读数来自宿主记账，不是 JS 自述。
 *
 * 【两相模式】与 E 组同款（QuickJS 微任务只在宿主泵 job 时执行）：kick → 宿主 runPendingJobs → read。
 */
function runRouterApiScenario(): Promise<Record<string, unknown>> {
  return (async () => {
    // ★路由记录形状与 RouteRecord 兼容（component 在本场景不加载——只走导航语义）
    const routes = [
      { name: 'r-home', path: 'r-home', meta: { title: '首页' }, component: '' },
      { name: 'r-detail', path: 'r-detail', meta: { transition: 'slideUp' }, component: '' },
      { name: 'r-user', path: 'r-user', component: '' },
    ]
    const invoke = (m: string, a: string): string => {
      const ph = (globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
      if (!ph || typeof ph.invoke !== 'function') throw new Error('宿主 invoke 通道缺失')
      return ph.invoke(m, a)
    }
    const nav = createAppNavigation({ invoke, routes: routes as never })
    const router = createRouter(routes as never, { adapter: nav.adapter })

    // ① 逐层 push（await：App 转场异步——命令流 → 执行器 → 宿主帧循环播完）
    //  ★类型断言：本场景验**导航语义**（不验路由参数类型推导——那需要 `declare module` 路由名表，
    //    属应用侧装配产物；与 Web/MP 的 `router.push({ name })` 是同一个 API，运行时行为一致）
    const push = router.push.bind(router) as (o: { name: string; params?: Record<string, string>; replace?: boolean }) => Promise<void>
    const replace = router.replace.bind(router) as (o: { name: string }) => Promise<void>
    await push({ name: 'r-home' })
    await push({ name: 'r-detail', params: { id: '42' } })
    const afterPush = {
      depth: nav.stack.depth,
      top: nav.stack.current()?.name,
      params: nav.stack.current()?.params,
    }
    // ② 同步 back（三端同签名）→ flush 收工
    router.back()
    await nav.flush()
    const afterBack = { depth: nav.stack.depth, top: nav.stack.current()?.name }
    // ③ replace 语义（不增深）
    await replace({ name: 'r-user' })
    const afterReplace = { depth: nav.stack.depth, top: nav.stack.current()?.name }
    return {
      f_ok: afterPush.depth === 2 && afterPush.top === 'r-detail' && String(afterPush.params?.id) === '42'
        && afterBack.depth === 1 && afterBack.top === 'r-home'
        && afterReplace.depth === 1 && afterReplace.top === 'r-user',
      f_after_push: afterPush,
      f_after_back: afterBack,
      f_after_replace: afterReplace,
      // ★f_host_stats：宿主记账读数。★诚实边界：**本字段可能为 null** ——
      //   F 组自带内联 invoke（`proteusHost.invoke` 的直通形态），而宿主侧的 `screenHost`
      //   实例由壳在特定路径创建；本场景不保证同一实例可读 ⇒ 读不到时**如实记 null**
      //   （不伪装成 0）。F 组的**主判据是 `f_ok`**（导航语义全绿），宿主侧的真建树/真动画
      //   证明由 **E 组**承担（`e_host_stats`，与宿主实例同源）——两者分工明确，不重复声称。
      f_host_stats: (() => {
        try {
          return JSON.parse(invoke('screen.stats', 'null'))
        } catch (e) {
          return { error: String(e) }
        }
      })(),
      f_note: '统一 API（createRouter）→ 虚拟栈 → 执行器 → 宿主 全链（零胶水形态）',
    }
  })()
}

/** 场景 E 主体（定义在上方两相导出处之后可被引用——函数提升语义，导出顺序无关） */
// ══════════════════════════════════════════════════════════════════
// ★★场景 E：宿主执行器（命令流的消费者）——**两相模式**（kick → 宿主泵 job → read）
//
// 【为什么不能挤进主入口（同步函数）】执行器端口允许返回 Promise（真机的建屏/动画完成
//   天然是异步的）⇒ 编排链要经微任务排空。而 QuickJS 的微任务只在宿主泵 job 时执行
//   （本仓已在 host-runtime 场景踩过并固化两相模式）⇒ 与它同款：
//     ① `kick()` 发起异步链（结果写全局）→ ② 宿主 `nativeRunPendingJobs()` → ③ `read()` 取读数。
// ══════════════════════════════════════════════════════════════════
export function __proteusAppStackExecutorKick(): string {
  const g = globalThis as unknown as { __proteusAppStackExecutorResult?: unknown }
  if (g.__proteusAppStackExecutorResult !== undefined) return 'already'
  void (async () => {
    try {
      // ★E（手写装配=现状胶水形态）与 F（统一 API=目标形态）**并行**跑——
      //   两者各建各的栈/宿主屏，互不干扰（屏 id 由各自 createAppStack 生成，前缀不同）。
      const [e, f] = await Promise.all([runExecutorScenario(), runRouterApiScenario()])
      g.__proteusAppStackExecutorResult = { ...e, ...f }
    } catch (err) {
      g.__proteusAppStackExecutorResult = { fatal: String(err) }
    }
  })()
  return 'kicked'
}

/** 读两相结果（宿主泵完 job 后调用；未就绪 ⇒ {pending:true}） */
export function __proteusAppStackExecutorRead(): string {
  const g = globalThis as unknown as { __proteusAppStackExecutorResult?: unknown }
  if (g.__proteusAppStackExecutorResult === undefined) return JSON.stringify({ pending: true })
  return JSON.stringify(g.__proteusAppStackExecutorResult)
}

// ★挂到全局（IIFE 无模块系统——与 __proteusAppStackRun 同法，宿主直接 eval 调用）
;(globalThis as unknown as { __proteusAppStackExecutorKick: typeof __proteusAppStackExecutorKick }).__proteusAppStackExecutorKick = __proteusAppStackExecutorKick
;(globalThis as unknown as { __proteusAppStackExecutorRead: typeof __proteusAppStackExecutorRead }).__proteusAppStackExecutorRead = __proteusAppStackExecutorRead

/**
 * ★诊断出口（2026-10-02）：**单独跑场景 F 并把中间态立即回传**——
 * 用于定位"真机 QuickJS 上 F 组卡住而 Node 通过"的环境差异（Node 已复现全绿）。
 * 返回 JSON 含每步进度（step 字段）与异常原文——不静默。
 */
export function __proteusRouterApiProbe(): string {
  const steps: string[] = []
  const g = globalThis as unknown as { __proteusRouterProbeResult?: unknown }
  void (async () => {
    try {
      steps.push('enter')
      const routes = [
        { name: 'r-home', path: 'r-home', component: '' },
        { name: 'r-detail', path: 'r-detail', meta: { transition: 'slideUp' }, component: '' },
      ]
      const ph = (globalThis as unknown as { proteusHost?: { invoke?: (m: string, a: string) => string } }).proteusHost
      if (!ph || typeof ph.invoke !== 'function') throw new Error('宿主 invoke 通道缺失')
      steps.push('host-ok')
      const nav = createAppNavigation({ invoke: (m, a) => ph.invoke!(m, a), routes: routes as never })
      steps.push('nav-built')
      const router = createRouter(routes as never, { adapter: nav.adapter })
      steps.push('router-built')
      await router.push({ name: 'r-home' } as never)
      steps.push('pushed-home depth=' + nav.stack.depth)
      await router.push({ name: 'r-detail' } as never)
      steps.push('pushed-detail depth=' + nav.stack.depth)
      g.__proteusRouterProbeResult = { ok: true, steps }
    } catch (e) {
      g.__proteusRouterProbeResult = { ok: false, steps, error: String(e) }
    }
  })()
  return JSON.stringify({ kicked: true, steps })
}

/** 读诊断结果（未就绪 ⇒ pending） */
export function __proteusRouterApiProbeRead(): string {
  const g = globalThis as unknown as { __proteusRouterProbeResult?: unknown }
  if (g.__proteusRouterProbeResult === undefined) return JSON.stringify({ pending: true })
  return JSON.stringify(g.__proteusRouterProbeResult)
}

;(globalThis as unknown as { __proteusRouterApiProbe: typeof __proteusRouterApiProbe }).__proteusRouterApiProbe = __proteusRouterApiProbe
;(globalThis as unknown as { __proteusRouterApiProbeRead: typeof __proteusRouterApiProbeRead }).__proteusRouterApiProbeRead = __proteusRouterApiProbeRead

// ══════════════════════════════════════════════════════════════════
// ★★★（2026-10-02 · 项目驱动）**从项目路由配置跑 App 导航**（非夹具）
//
// 与上面场景 A–F 的分界：那些用 `buildNodes(fans)` 合成屏池（**压测装置**）；
// 本入口读 `examples/router/auto-routes.ts`（**全端统一导航产物**：gen-routes 从 pages/**/*.vue +
// proteus.config.ts 的 router.pages 产出）——**产品路径**。
// ⇒ 一个 bundle 两个入口：`__proteusAppStackRun`（压测，装置形态）+
//   `__proteusAppProjectRun`（项目驱动，产品形态）。
// ══════════════════════════════════════════════════════════════════
export { __proteusAppProjectRun } from './entry-app-project'

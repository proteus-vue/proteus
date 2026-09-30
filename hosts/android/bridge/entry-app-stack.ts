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

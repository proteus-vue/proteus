// entry/src/main/ets/core/app-stack-probe.ts
// ★★★鸿蒙腿：App 路由虚拟栈场景探针（与 Android/iOS 的 `__proteusAppStackRun` 同口径）。
//
// 【为什么值得单独做】矩阵 #17：路由栈是所有内容的**承载地基**——三端语义已由
//   `check-app-stack.py` 对齐（判据脚本共享），缺的只是**鸿蒙端读数**。
//   本文件用**移植副本**（`./app-stack.ts`，与上游逐字节同步——见 sync-core.sh）在
//   ArkTS 引擎上跑与两端**同一组场景**：A 深栈 / B 预算冻结 / C 重建 / D navigate diff。
//
// 【口径照搬（保证与两端数字可比）】depth=20000 · fans=32 · budget=1000；
//   A: push 20000 → popToRoot；B: 同规模 + nodeBudget=1000；C: budget=64/keepWindow=1 强制冻结栈底；
//   D: 5000 层 → 回退一半（应零 mount）。
import { createAppStack } from './app-stack'
import type { AppScreenSpec, ScreenCommand } from './app-stack'

interface AppStackProbeArgs {
  depth?: number
  fans?: number
  budget?: number
}

/** 造屏池：与两端 `buildNodes(fans)` 同形（name/transition/budget 语义一致） */
function buildSpecs(fans: number): Record<string, AppScreenSpec> {
  const out: Record<string, AppScreenSpec> = {}
  for (let i = 0; i < fans; i++) {
    out[`page-${i}`] = { name: `page-${i}`, path: `/page-${i}`, transition: i % 2 === 0 ? 'slideUp' : 'halfScreen' }
  }
  return out
}

function countOp(cmds: ScreenCommand[], op: string): number {
  let n = 0
  for (let i = 0; i < cmds.length; i++) {
    if (cmds[i].op === op) n++
  }
  return n
}

/** 主入口：跑四组场景，返回判据读数（JSON 串）——字段名与两端**逐一对应** */
export function runAppStackProbe(argsJson?: string): string {
  const args: AppStackProbeArgs = argsJson ? JSON.parse(argsJson) as AppStackProbeArgs : {}
  const depth = args.depth ?? 20000
  const fans = args.fans ?? 32
  const budget = args.budget ?? 1000
  const screens = buildSpecs(fans)
  const names: string[] = []
  for (let i = 0; i < fans; i++) names.push(`page-${i}`)

  // ── 场景 A：深栈（无预算 → 不冻结）──
  const deep = createAppStack({ screens })
  const tA0 = Date.now()
  for (let i = 0; i < depth; i++) deep.push(names[i % fans], { i })
  const pushMs = Date.now() - tA0
  const depthReached = deep.depth
  const deepCmds = deep.drainCommands()
  const aMount = countOp(deepCmds, 'mount')
  const aEnter = countOp(deepCmds, 'enter')
  const aExit = countOp(deepCmds, 'exit')
  const aUnmount = countOp(deepCmds, 'unmount')
  const tPop0 = Date.now()
  deep.popToRoot()
  const popMs = Date.now() - tPop0
  const depthAfterRoot = deep.depth
  const rootCmds = deep.drainCommands()
  const rootUnmount = countOp(rootCmds, 'unmount')

  // ── 场景 B：预算冻结 ──
  const frozen = createAppStack({ screens, policy: { nodeBudget: budget, keepWindow: 3, defaultScreenNodes: 64 } })
  const tB0 = Date.now()
  for (let i = 0; i < depth; i++) frozen.push(names[i % fans], { i })
  const frozenPushMs = Date.now() - tB0
  const frozenStats = frozen.stats()
  const frozenCmds = frozen.drainCommands()
  let freezeUnmounts = 0
  for (let i = 0; i < frozenCmds.length; i++) {
    const c = frozenCmds[i]
    if (c.op === 'unmount' && c.reason === 'freeze') freezeUnmounts++
  }

  // ── 场景 C：冻结后返回 = 重建 ──
  const small: Record<string, AppScreenSpec> = {}
  for (let i = 0; i < fans; i++) small[names[i]] = { name: names[i], path: `/page-${i}`, budgetNodes: 64 }
  const rebuild = createAppStack({ screens: small, policy: { nodeBudget: 64, keepWindow: 1, defaultScreenNodes: 64 } })
  rebuild.push(names[0]!)
  rebuild.push(names[1]!)
  const cFrozen = rebuild.stats().frozen
  rebuild.drainCommands()
  rebuild.pop()
  const cCmds = rebuild.drainCommands()
  let cRebuildMounts = 0
  for (let i = 0; i < cCmds.length; i++) {
    const c = cCmds[i]
    if (c.op === 'mount' && c.rebuild) cRebuildMounts++
  }
  const cRebuildStat = rebuild.stats().rebuildCount

  // ── 场景 D：navigate diff（深栈 → 只留前半；应仅 unmount 零 mount）──
  const navDepth = depth < 5000 ? depth : 5000
  const nav = createAppStack({ screens })
  for (let i = 0; i < navDepth; i++) nav.push(names[i % fans]!)
  nav.drainCommands()
  const keep = Math.floor(navDepth / 2)
  const frames: Array<{ name: string }> = []
  for (let i = 0; i < keep; i++) frames.push({ name: names[i % fans]! })
  const tD0 = Date.now()
  nav.navigate(frames)
  const navMs = Date.now() - tD0
  const navCmds = nav.drainCommands()
  const dMount = countOp(navCmds, 'mount')
  const dUnmount = countOp(navCmds, 'unmount')
  const dEnter = countOp(navCmds, 'enter')
  const dDepth = nav.depth

  const result: Record<string, Object> = {
    ok: true,
    scene: 'app-stack',
    host: 'harmony',
    depth, fans, budget, screens: fans,
    a_depth_reached: depthReached,
    a_push_ms: pushMs,
    a_pop_ms: popMs,
    a_depth_after_pop_to_root: depthAfterRoot,
    a_mounts: aMount,
    a_enters: aEnter,
    a_exits: aExit,
    a_unmounts: aUnmount,
    a_root_unmounts: rootUnmount,
    b_frozen_count: frozenStats.frozen,
    b_active_nodes: frozenStats.activeNodes,
    b_over_budget: frozenStats.overBudget,
    b_freeze_unmounts: freezeUnmounts,
    b_push_ms: frozenPushMs,
    b_depth: frozenStats.depth,
    c_frozen_before_pop: cFrozen,
    c_rebuild_mounts: cRebuildMounts,
    c_rebuild_stat: cRebuildStat,
    d_mounts: dMount,
    d_unmounts: dUnmount,
    d_enters: dEnter,
    d_depth: dDepth,
    d_nav_ms: navMs,
  }
  return JSON.stringify(result)
}

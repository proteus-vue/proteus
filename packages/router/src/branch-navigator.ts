// packages/router/src/branch-navigator.ts
// ★★NB1/NB3/NB6（导航体系，2026-10-02）—— **多分支独立栈**组织者 + 保活三档 + 返回归属
//
// 【设计依据（用户决策：分支 = `meta.isTab` 页面，零新增配置源）】
//   `auto-routes.ts` 统一产物已有 `tabNames`（`meta.isTab` 投影）——分支清单**从它装配**，
//   不再立 `branches` 段（否则就是第二个事实源，与"统一路由页面管理"相悖）。
//   分支级配置挂在页面配置里（`router.pages['index'].branch = { keepAlive: 'active' }`）
//   ——"一个入口管全端页面"的直接兑现。
//
// 【结构】分支 = 一个 tab 根 + 它的独立 `AppStack`（每分支保栈，复用 M5 全部原语：
//   预算冻结 / removeByName / moveToTop / navigate 声明式重建）。
//   ★与小程序 `switchTab` 的本质差别：切换**保留**各分支栈（切回栈深不变）——
//   小程序是"强制清栈换根"，每次回来都是新页面。
//
// 【保活三档（NB3）】分支级声明（`BranchSpec.keepAlive`，来自 `meta.branch.keepAlive`）：
//   · `none`  —— 切走即**释放视图**（整栈 `releaseTrees`；栈位/状态/params 全保留——
//     `stackOf(name).frames()` 永远完整），切回重建（`mount(rebuild:true)`）。对齐 Android `saveBackStack`。
//   · `active`（默认）—— 当前 + **相邻**（前/后一个）保活；离开邻域的旧分支按 `none` 同款释放。
//   · `all`  —— 永不释放（对齐 Flutter `IndexedStack`；方案 §2.4 警告：几十个模块会爆内存）。
//   ★取消保活**只销毁视图、不丢状态**——这是与"清栈"的本质区别（栈状态序列化恒可读）。
//
// 【返回归属（NB6）】`back()` 只作用于**当前活跃分支的栈**；分支到根 ⇒ 交外层（`parent` 给了
//   就 pop 它，没给就报 `system` 信号——**不静默吞掉**）；外层到根 ⇒ `system`（宿主侧消费，
//   如 Android `onBackPressed` 返回 false 让系统退出）。
//
// 【平台中立】只依赖 `./app-stack` 与 `./types`（纯逻辑）——可在 JSC/QuickJS 运行。
// 【命令流】`cmd.branch` 标记所属分支（执行器按分支隔离决策）；跨分支顺序：navigator 事务
//   内部严格保序（旧分支 exit → 释放 → 新分支 enter）；对 `stackOf(x)` 的**直接栈操作**
//   在下次 `drainCommands` 时按分支归并（同分支内永远严格保序）。
import { createAppStack, KEEP_ALIVE_TIERS } from './app-stack'
import type { AppScreenSpec, AppStack, AppStackPolicy, ScreenCommand, ScreenFrame } from './app-stack'
import type { KeepAliveTier } from './types'
import type { RouteTransition } from './transforms/transform-transition'

export { KEEP_ALIVE_TIERS }

/** 外层 RootStack 命令的保留分支标签（`back()` 交外层时 parent 的命令进同一条流） */
export const OUTER_BRANCH = '#outer'

/** 分支声明（★从统一产物装配：`tabNames` + `screens`；`keepAlive` 来自 `meta.branch`） */
export interface BranchSpec {
  /** = tab 根页的路由名 */
  name: string
  /** = 该页的 path（深链/诊断用） */
  root: string
  /** 分支默认转场（拼进 `activateBranch` 的退出/进入命令；屏声明优先） */
  transition?: RouteTransition
  /**
   * ★NB3 保活档（缺省 `'active'`——装配时物化，`branches` 读到的永远是生效值）。
   * 见文件头注：`none` = 切走释放视图（状态保留）；`active` = 当前+相邻；`all` = 全保活。
   */
  keepAlive: KeepAliveTier
}

/** 保活决策项（执行器直接消费：该分支视图当下是否保留） */
export interface KeepAliveDecision {
  branch: string
  keep: boolean
}

/** 分支时钟（`seq` 单调递增——执行器按它对齐动画/视图批次；判据读它证"切换真发生"） */
export interface BranchClock {
  seq: number
  from: string
  to: string
}

/** 分支命令（**执行器契约**：`ScreenCommand` 原样 + 所属分支标记） */
export type BranchCommand = ScreenCommand & { branch: string }

/** 返回归属判定（NB6 规则 1/2/3 的机器可判形态） */
export type BackOutcome =
  /** 活跃分支内 pop（含跨屏返回）；`depth` = 弹出后的栈深 */
  | { action: 'pop'; branch: string; popped: string; depth: number }
  /** 分支已到根 ⇒ 交外层 RootStack（`parent` 给了就同时 pop 了它一层——见 `back` 注） */
  | { action: 'outer'; branch: string }
  /** 无外层（或外层也到根）⇒ 交系统（宿主侧消费） */
  | { action: 'system' }

/** 深链/持久化快照（`drainCommands` 不参与——纯状态） */
export interface BranchStackSnapshot {
  active: string
  /** 活跃分支内的栈帧（**分支根在前**） */
  frames: ScreenFrame[]
}

export type BranchEvent =
  | { type: 'switch'; from: string; to: string; seq: number }
  | { type: 'switch-noop'; branch: string }
  | { type: 'back'; branch: string; popped: string; depth: number }
  | { type: 'back-outer'; branch: string }
  | { type: 'back-system' }
  | { type: 'navigate'; branch: string; depth: number; rebuilt: boolean }
  | { type: 'release'; branch: string; screens: number }

export interface BranchNavigator {
  /** 分支清单（**顺序 = `tabNames` 顺序**；`keepAlive` 已物化默认值） */
  readonly branches: readonly BranchSpec[]
  /** 当前活跃分支名 */
  active(): string
  /** 切换活跃分支（**保留各自栈**——与小程序"强制清栈"的本质差别）；目标不存在 ⇒ 抛错（不静默） */
  switchTo(name: string): void
  /** 取某分支的栈（诊断/深链/返回归属用；也用于把该栈接进 `createAppNavigationAdapter`） */
  stackOf(name: string): AppStack
  /** 当前活跃分支的栈 */
  activeStack(): AppStack
  /** ★NB2 深链直达分支内子页（重建该分支栈；分支根永远在栈底） */
  navigate(branch: string, frames: ScreenFrame[]): AppStack
  /** ★NB6 返回（只作用于活跃分支；到根 ⇒ 交外层/系统信号——见 `BackOutcome`） */
  back(delta?: number): BackOutcome
  /** 保活决策（执行器消费；`none` 档切走 = keep:false；与释放动作同一判定） */
  keepAlivePolicy(): KeepAliveDecision[]
  /** 统一命令流（含"切分支"事务；`cmd.branch` 标记所属分支，外层为 `OUTER_BRANCH`） */
  drainCommands(): BranchCommand[]
  /** ★NB2 序列化：活跃分支的栈帧快照（与 `navigate(branch, frames)` 往返同帧） */
  snapshot(): BranchStackSnapshot
  /** 分支时钟（`seq` 单调递增——判据读它证"切换真发生"） */
  clock(): BranchClock
  /** 状态事件（`switch`/`back`/`release`/`back-system`——判据读它） */
  on(handler: (e: BranchEvent) => void): () => void
}

export interface BranchNavigatorOptions {
  /**
   * 屏注册表（`auto-routes.ts` 的 `screens` 投影——与 `tabNames` 同源，同一棵树，
   * 不新增配置源）。`screens[name].keepAlive`（若有）作为分支保活档的**兜底**。
   */
  screens: Record<string, AppScreenSpec>
  /** 分支清单（= 统一产物的 `tabNames`；顺序即 `branches` 顺序）★二选一：tabNames 或 branches */
  tabNames?: readonly string[]
  /** 显式分支声明（给了就不从 tabNames 推导；两者都给 = tabNames 顺序 + 声明覆盖） */
  branches?: readonly BranchSpec[]
  /** 内存策略（传进每个分支的 `createAppStack`——分支栈各自独立治理） */
  policy?: AppStackPolicy
  /** 初始活跃分支（缺省 branches[0]；不在清单中 ⇒ 抛错） */
  initial?: string
  /**
   * ★NB6 外层 RootStack（可选）：分支到根时 `back()` 把它 pop 一层（规则 2）并报 `outer`。
   * 它再到根 ⇒ `system`（规则 3）。**应当是独立的栈实例**（传某分支自己的栈会让
   * "分支到根"与"外层到根"混为一体——本层不做运行期拦截，靠调用方正确装配）。
   */
  parent?: AppStack
}

/** 分支运行期记录 */
interface BranchRecord {
  spec: BranchSpec
  stack: AppStack
}

/**
 * 创建分支导航器（★从统一产物装配：`tabNames` + `screens`，零胶水）。
 *
 * 用法（App 宿主 JS 入口）：
 * ```ts
 * const nav = createBranchNavigator({ screens, tabNames, policy })
 * nav.switchTo('mine')                   // 保留 home 分支栈
 * nav.back()                             // ← 只作用于 mine 分支
 * ```
 */
export function createBranchNavigator(opts: BranchNavigatorOptions): BranchNavigator {
  const { screens, policy } = opts
  const declared = opts.branches
  const tabNames = opts.tabNames

  if (!declared && !tabNames) {
    throw new Error(
      '[branch-navigator] 需要 tabNames 或 branches 之一（分支清单的来源——不猜；' +
        'tabNames 来自 auto-routes.ts 与 screens 同源的真实投影）',
    )
  }

  const specList: BranchSpec[] = []
  const byName = new Map<string, BranchSpec>()
  const materialize = (name: string, over?: Partial<BranchSpec>): BranchSpec => {
    const spec = screens[name]
    if (!spec) {
      throw new Error(
        `[branch-navigator] 分支 "${name}" 不在屏注册表中（可用：${Object.keys(screens).slice(0, 8).join(', ')}${Object.keys(screens).length > 8 ? ' …' : ''}）`,
      )
    }
    const tier = over?.keepAlive ?? spec.keepAlive ?? 'active'
    if (!KEEP_ALIVE_TIERS[tier]) {
      throw new Error(`[branch-navigator] 分支 "${name}" 的 keepAlive="${String(tier)}" 非法（合法：none / active / all）`)
    }
    const s: BranchSpec = { name, root: over?.root || spec.path, keepAlive: tier }
    const t = over?.transition ?? spec.transition
    if (t) s.transition = t
    return s
  }
  // 声明优先（tabNames 里同名的跳过——`branches` 是显式覆盖）
  for (const b of declared ?? []) {
    if (byName.has(b.name)) continue
    const s = materialize(b.name, b)
    byName.set(s.name, s)
    specList.push(s)
  }
  for (const name of tabNames ?? []) {
    if (byName.has(name)) continue
    const s = materialize(name)
    byName.set(s.name, s)
    specList.push(s)
  }
  if (specList.length === 0) {
    throw new Error('[branch-navigator] 分支清单为空——tabNames 与 branches 都未提供有效分支（检查 isTab 页面）')
  }

  const initial = opts.initial ?? specList[0]!.name
  if (!byName.has(initial)) {
    throw new Error(
      `[branch-navigator] initial="${initial}" 不在分支清单中（可用：${specList.map((s) => s.name).join(', ')}）`,
    )
  }

  const records = new Map<string, BranchRecord>()
  const handlers: Array<(e: BranchEvent) => void> = []
  /** 全局命令缓冲（navigator 事务严格保序——见文件头注的跨分支顺序纪律） */
  const commands: BranchCommand[] = []
  let activeName = initial
  let clockSeq = 0
  let lastFrom = initial

  const emit = (e: BranchEvent): void => {
    for (const h of handlers) h(e)
  }

  function recordOf(name: string): BranchRecord {
    const r = records.get(name)
    if (!r) {
      throw new Error(`[branch-navigator] 未知分支 "${name}"（可用：${specList.map((s) => s.name).join(', ')}）`)
    }
    return r
  }

  for (const spec of specList) {
    records.set(spec.name, { spec, stack: createAppStack({ screens, ...(policy ? { policy } : {}) }) })
  }

  const parent = opts.parent ?? null

  /** 把某栈缓冲的命令并入全局缓冲（带分支标记）；navigator 事务每步后调用 ⇒ 严格保序 */
  function flushInto(branch: string, stack: AppStack): void {
    for (const c of stack.drainCommands()) commands.push({ ...c, branch })
  }

  /** 分支懒建根（首次进入才建树——内存按需；已有栈不重复建） */
  function ensureRoot(r: BranchRecord): void {
    if (r.stack.depth === 0) r.stack.push(r.spec.name)
  }

  /** 切分支的可见性事务（核心；顺序 = 旧分支 exit → 释放 → 新分支 [mount] enter） */
  function activateBranch(target: BranchRecord, from: BranchRecord | null): void {
    const t = target.spec.transition
    // ① 旧分支挂起（栈顶退场；树保留）
    if (from) {
      from.stack.suspend(t ? { transition: t } : undefined)
      flushInto(from.spec.name, from.stack)
    }
    // ② 新分支就绪（懒建根 + 复活）
    if (target.stack.depth === 0) ensureRoot(target)
    target.stack.resume()
    flushInto(target.spec.name, target.stack)
    // ③ 保活扫描（新活跃已就位后再算策略）：keep=false 的分支整栈释放（幂等；活跃分支恒 keep=true）
    for (const d of keepAlivePolicy()) {
      if (d.keep) continue
      const r = recordOf(d.branch)
      if (r.stack.depth === 0) continue
      const released = r.stack.releaseTrees()
      if (released > 0) {
        emit({ type: 'release', branch: d.branch, screens: released })
        flushInto(d.branch, r.stack)
      }
    }
  }

  /** 分支声明顺序（活保扫描/drain 归并的确定性顺序） */
  function branchOrder(): string[] {
    return specList.map((s) => s.name)
  }

  function switchTo(name: string): void {
    const target = recordOf(name)
    const from = recordOf(activeName)
    if (from === target) {
      emit({ type: 'switch-noop', branch: name })
      return
    }
    lastFrom = from.spec.name
    activeName = name
    activateBranch(target, from)
    clockSeq++
    emit({ type: 'switch', from: lastFrom, to: name, seq: clockSeq })
  }

  /**
   * ★NB2 深链直达分支内子页：重建 `branch` 分支的栈为 `frames`。
   * 分支不变式：**分支根永远在栈底**——`frames` 空 ⇒ 单根；首帧不是分支根 ⇒ 自动补根
   * （深链产物 `buildColdStartStack` 可直接对接）。
   * ★不改变当前活跃分支（若深链目标是当前分支，走的是它的栈——本方法只管目标分支的栈重建）。
   */
  function navigate(branch: string, frames: ScreenFrame[]): AppStack {
    const r = recordOf(branch)
    const f: ScreenFrame[] = frames.length > 0 ? [...frames] : [{ name: r.spec.name }]
    if (f[0]!.name !== r.spec.name) f.unshift({ name: r.spec.name })
    const before = JSON.stringify(r.stack.frames())
    r.stack.navigate(f)
    flushInto(r.spec.name, r.stack)
    const rebuilt = JSON.stringify(r.stack.frames()) !== before
    emit({ type: 'navigate', branch, depth: r.stack.depth, rebuilt })
    return r.stack
  }

  /** 交外层（规则 2/3）：parent 到根 ⇒ system（不硬 pop——语义显式） */
  function handToOuter(branch: string): BackOutcome {
    emit({ type: 'back-outer', branch })
    if (parent && parent.depth > 1) {
      parent.pop(1)
      flushInto(OUTER_BRANCH, parent)
      return { action: 'outer', branch }
    }
    emit({ type: 'back-system' })
    return { action: 'system' }
  }

  /**
   * ★NB6 返回（**只作用于当前活跃分支的栈**——规则 1）：
   *   栈深 > 1 ⇒ pop（`delta` **夹在分支内**——一次调用不跨栈：弹到根为止，多余层数不"穿透"到外层）；
   *   到根（栈深 = 1）⇒ 交外层：`parent` 给了且它不在根 ⇒ pop 它一层并报 `outer`，否则报 `system`
   *   （宿主据此不消费平台返回事件——规则 3，如 Android `onBackPressed` 返回 false）。
   * ★`back(5)` 在 3 层栈上的落点 = 根（depth 1，is `pop`）；**再次** `back()` 才交外层——
   *   与"逐次调用"的语义一致（不把"用户其实只按了 2 次就到底了"混进一次返回值）。
   */
  function back(delta = 1): BackOutcome {
    const r = recordOf(activeName)
    if (r.stack.depth > 1) {
      const top = r.stack.current()!
      r.stack.pop(delta)
      flushInto(r.spec.name, r.stack)
      const depth = r.stack.depth
      emit({ type: 'back', branch: activeName, popped: top.name, depth })
      return { action: 'pop', branch: activeName, popped: top.name, depth }
    }
    return handToOuter(activeName)
  }

  /**
   * 保活决策（当下时刻的视图保留判定；执行器直接消费）：
   *   活跃分支恒 true；`all` 恒 true；`none` 恒 false（非活跃）；`active` = 相邻（±1）为 true。
   * ★与 `activateBranch` 的释放扫描**同一函数**（决策与动作不分家——不会出现"说保留却释放了"）。
   */
  function keepAlivePolicy(): KeepAliveDecision[] {
    const idx = specList.findIndex((s) => s.name === activeName)
    return specList.map((s, i) => {
      if (s.name === activeName) return { branch: s.name, keep: true }
      if (s.keepAlive === 'all') return { branch: s.name, keep: true }
      if (s.keepAlive === 'none') return { branch: s.name, keep: false }
      const adjacent = idx >= 0 && (i === idx - 1 || i === idx + 1)
      return { branch: s.name, keep: adjacent }
    })
  }

  /**
   * 统一命令流（执行器每帧消费）：
   *   · navigator 事务命令严格保序（flush 时点）
   *   · 对 `stackOf(x)` 的直接栈操作在本次 drain 时按**分支声明顺序**归并（同分支内保序）
   *   · `parent`（外层）的命令带 `OUTER_BRANCH` 标签
   */
  function drainCommands(): BranchCommand[] {
    for (const name of branchOrder()) {
      const r = recordOf(name)
      flushInto(name, r.stack)
    }
    if (parent) flushInto(OUTER_BRANCH, parent)
    const out = commands.slice()
    commands.length = 0
    return out
  }

  // 初始分支：建根（第一个分支必须可见——其余分支懒建）
  ensureRoot(recordOf(initial))

  return {
    branches: specList.map((s) => ({ ...s })),
    active: () => activeName,
    switchTo,
    stackOf(name: string): AppStack {
      return recordOf(name).stack
    },
    activeStack(): AppStack {
      return recordOf(activeName).stack
    },
    navigate,
    back,
    keepAlivePolicy,
    drainCommands,
    snapshot(): BranchStackSnapshot {
      return { active: activeName, frames: recordOf(activeName).stack.frames() }
    },
    clock(): BranchClock {
      return { seq: clockSeq, from: lastFrom, to: activeName }
    },
    on(handler: (e: BranchEvent) => void): () => void {
      handlers.push(handler)
      return () => {
        const i = handlers.indexOf(handler)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
  }
}

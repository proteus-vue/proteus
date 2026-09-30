// packages/router/src/app-stack.ts
// ★★M5（App 端）——虚拟路由栈：屏 = 树内子树；栈在逻辑层，内存由预算治理
//
// 【设计依据（2026-09-30 用户决策：「吸取小程序和 uni-app 的路由栈数量限制的经验教训……
//   路由实现必须高性能，可以参考 Flutter」）】
//   · 小程序 10 层限制的**根因** = 每页一个**独立原生容器**（WebView/Page）：内存随层数线性增长，
//     平台只能用「层数上限」这个粗粒度手段保护。第 11 层 `navigateTo` 直接**失败**，
//     业务被迫 `redirectTo` 降级 ⇒ 返回栈断裂（本仓 `index.ts` 也留有这个降级：stackDepth>=9 → redirectTo）。
//   · Flutter 恰恰相反：Navigator 是**纯逻辑栈**（Overlay + Route 对象），不占用系统导航栈；
//     不可见层是否占内存由 `opaque` / `maintainState` 决定（`maintainState=false` ⇒ 框架可整体丢弃
//     该路由的 widget 层级，官方文档原文："allow the framework to entirely discard the route's widget
//     hierarchy when it is not visible"）。⇒ **没有层数上限，只有内存按需**。
//   · Proteus App 端沿 Flutter 路线：屏 = 当前树的一棵子树；切屏 = 可见性切换
//     （内核 `Display::None`：不布局、不绘制、不命中 ⇒ 退场屏零渲染成本）；退场屏**树保留**（返程保状态）。
//   · ★**不用系统导航栈**（UIViewController / Fragment / Activity 栈）：那正是小程序路线的翻版
//     （每屏一个原生容器 = 层数上限的根因）。05-m5-app-codegen.md 初稿的
//     `UINavigationController.pushViewController` 映射路线**就此废弃**（文档已同步更新）。
//
// 【内存有界（替代「层数上限」）】节点预算 + **冻结最旧**：
//   超预算 → 从栈底起（`keepWindow` 保护栈顶）把树销毁、**栈位保留**（frozen）；
//   返回冻结屏 = 重建内容（毫秒级：本仓建树/重排能力已验，0.08ms 全量重排）。
//   ⇒ 与小程序「第 11 层失败 / popToRoot 丢栈」的本质差别：**没有失败点**，最坏结果是「重建」。
//   默认 `nodeBudget: null` = 不冻结（全栈保留，返程永远保状态——对齐原生 App 预期）；
//   超深栈超级应用可显式配预算。
//
// 【转场】命令流携带 `RouteTransition`（**声明**，不是平台动作），由执行器交给 Morpheus
//   （`APP_TRANSITION_MAP` → 内核动画，平台零参与路径）。**本文件不产生任何平台调用**——
//   纯逻辑（无 wx / DOM / native / 内核依赖），三端可单测；宿主接线见 runtime/执行器。
import type { RouteParams } from './types'
import type { RouteTransition } from './transforms/transform-transition'

/**
 * 屏状态
 *   mounted = 栈顶可见（display:flex）
 *   hidden  = 在栈中不可见（display:none，**树保留**——返程保状态）
 *   frozen  = 在栈中不可见且**树已销毁**（内存治理冻结；返回需重建）
 *   destroyed = 已出栈（内部记账；对外栈视图不会出现该状态）
 */
export type AppScreenState = 'mounted' | 'hidden' | 'frozen' | 'destroyed'

/** 屏注册表条目（`codegen/app.ts` 产物形态；transition 来自 `<route>.meta.transition`） */
export interface AppScreenSpec {
  name: string
  path: string
  transition?: RouteTransition
  /** 该屏的节点预算估算（内存治理用；缺省 policy.defaultScreenNodes） */
  budgetNodes?: number
}

/**
 * 内存治理策略（★不是栈深限制——本栈对层数**无上限**）
 *
 * `nodeBudget: null`（默认）⇒ 不冻结：全栈保留（返程保状态，对齐原生 App 预期）。
 * 配了预算 ⇒ 超预算时冻结**最旧的 hidden 屏**（栈顶 `keepWindow` 层永不动）。
 */
export interface AppStackPolicy {
  /** 活跃树节点预算（null/缺省 = 不冻结） */
  nodeBudget?: number | null
  /** 冻结保护窗口：栈顶起 N 层永不冻结（默认 3） */
  keepWindow?: number
  /** 每屏节点预估（屏未声明 budgetNodes 时用；默认 64——小屏量级） */
  defaultScreenNodes?: number
}

/** 声明式栈帧（`navigate` 输入；与 deep-link 的 `buildColdStartStack` 产物可直接对接） */
export interface ScreenFrame {
  name: string
  params?: RouteParams
  transition?: RouteTransition
}

/** 屏的只读视图（执行器/宿主消费） */
export interface AppScreen {
  readonly screenId: string
  readonly name: string
  readonly path: string
  readonly params: RouteParams
  readonly transition?: RouteTransition
  readonly state: AppScreenState
  /** 内容不在树上（冻结后未被重建）——执行器消费 mount 命令后调 `markRebuilt` 清除 */
  readonly needsRebuild: boolean
  readonly budgetNodes: number
}

/**
 * 屏命令（**执行器契约**——本层只声明"要做什么"，不执行平台动作）
 *
 * 惯序（执行器按此配对转场）：
 *   push       ：exit(旧顶, t) → mount(新屏) → enter(新屏, t)     —— t = 新屏声明的转场
 *   pop        ：exit(旧顶, t) → unmount(旧顶, 'pop') → enter(新顶, t)
 *   批量 navigate：被弹屏仅原顶屏 exit（其余静默 unmount）；新增屏全部 mount；仅最终栈顶 enter
 *   reset/tab  ：unmount(全部, 'reset') → mount(根) → enter(根)
 *   ★退场方向（pop 的反向转场）由执行器/Morpheus 推导——本层不携带方向（动画知识不在 router）。
 */
export type ScreenCommand =
  /** 建屏内容（首次挂载 rebuild=false；冻结后重建 rebuild=true）。执行器建完调 markRebuilt */
  | { op: 'mount'; screenId: string; name: string; path: string; params: RouteParams; rebuild: boolean }
  /** 屏开始可见（display:flex + 进场转场；转场期间上一屏仍在，由执行器按 exit 命令调度隐藏） */
  | { op: 'enter'; screenId: string; transition?: RouteTransition }
  /** 屏退场（退场转场播放完后 display:none；树保留——返程保状态） */
  | { op: 'exit'; screenId: string; transition?: RouteTransition }
  /** 屏子树销毁（reason 区分：pop=出栈 / reset=清栈 / freeze=内存治理冻结，栈位保留） */
  | { op: 'unmount'; screenId: string; reason: 'pop' | 'reset' | 'freeze' }

export interface AppStackStats {
  depth: number
  mounted: number
  hidden: number
  frozen: number
  /** 活跃树节点估算（mounted + hidden 屏 budgetNodes 之和） */
  activeNodes: number
  nodeBudget: number | null
  /** 已尽力冻结仍超预算（上层可观测——不静默） */
  overBudget: boolean
  freezeCount: number
  rebuildCount: number
}

export type AppStackEvent =
  | { type: 'push'; name: string; depth: number }
  | { type: 'pop'; name: string; depth: number }
  | { type: 'replace'; name: string; depth: number }
  | { type: 'reset'; name: string; depth: number }
  | { type: 'freeze'; screenId: string; name: string; depth: number }
  | { type: 'restore'; screenId: string; name: string; depth: number }
  | { type: 'over-budget'; activeNodes: number; nodeBudget: number }

export interface AppStack {
  push(name: string, params?: RouteParams, opts?: { transition?: RouteTransition }): void
  /** 出栈 delta 层（夹到至少保留 1 屏——清栈请用 popToRoot/reset） */
  pop(delta?: number): void
  replace(name: string, params?: RouteParams, opts?: { transition?: RouteTransition }): void
  /** 返回到栈中最近一个 name 匹配的屏（找不到抛错——死引用不静默） */
  popTo(name: string): void
  popToRoot(): void
  /** tab 切换（= 清栈换根，无转场；对齐 MP switchTab 语义） */
  tab(name: string, params?: RouteParams): void
  /** 重置栈（= tab 语义；命名保留 M7 三端指令表） */
  reset(name: string, params?: RouteParams): void
  /** 声明式导航：给完整目标栈 → 公共前缀 diff → 最小操作集（多端 stack-diff 同源模型） */
  navigate(frames: ScreenFrame[]): void
  /** 执行器建完屏内容后调用（清除 needsRebuild；重建计数已在此前记账） */
  markRebuilt(screenId: string): void
  /** 取出并清空命令缓冲（执行器每帧消费一次） */
  drainCommands(): ScreenCommand[]
  current(): AppScreen | null
  readonly stack: readonly AppScreen[]
  readonly depth: number
  stats(): AppStackStats
  on(handler: (e: AppStackEvent) => void): () => void
}

/** 内部可变记录（对外经 AppScreen 只读视图暴露） */
interface ScreenRecord {
  screenId: string
  name: string
  path: string
  params: RouteParams
  transition?: RouteTransition
  state: AppScreenState
  needsRebuild: boolean
  budgetNodes: number
}

/** params 稳定键（排序 key——与 JSON.stringify 的键序不稳定不同）；undefined 值忽略 */
function paramKey(params?: RouteParams): string {
  if (!params) return ''
  return Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined)
    .map((k) => `${k}=${String(params[k])}`)
    .join('&')
}

/**
 * 创建 App 虚拟路由栈
 *
 * @param opts.screens 屏注册表（`codegen/app.ts` 的 generateAppScreens 产物）
 * @param opts.policy 内存治理策略（层数**无上限**；预算只决定"何时冻结最旧"）
 */
export function createAppStack(opts: { screens: Record<string, AppScreenSpec>; policy?: AppStackPolicy }): AppStack {
  const screens = opts.screens
  const policy = {
    nodeBudget: null as number | null,
    keepWindow: 3,
    defaultScreenNodes: 64,
    ...opts.policy,
  }

  const stack: ScreenRecord[] = []
  const commands: ScreenCommand[] = []
  const handlers: Array<(e: AppStackEvent) => void> = []
  let seq = 0
  let freezeCount = 0
  let rebuildCount = 0
  let overBudget = false
  /** ★增量记账：活跃树节点数（mounted + hidden；frozen 不计——树已销毁） */
  let activeNodeCount = 0
  /** ★冻结游标：栈底连续已冻结屏数（frozenPrefix 之前的屏必为 frozen） */
  let frozenPrefix = 0

  const emit = (e: AppStackEvent): void => {
    for (const h of handlers) h(e)
  }

  function specOf(name: string): AppScreenSpec {
    const s = screens[name]
    if (!s) {
      throw new Error(`[app-stack] 未注册的屏 "${name}"（可用：${Object.keys(screens).join(', ') || '（空注册表）'}）`)
    }
    return s
  }

  function makeRecord(name: string, params?: RouteParams, transition?: RouteTransition): ScreenRecord {
    const spec = specOf(name)
    return {
      screenId: `${name}#${++seq}`,
      name,
      path: spec.path,
      params: params ?? {},
      transition: transition ?? spec.transition,
      state: 'hidden', // 调用方按角色置可见性（仅栈顶 mounted）
      needsRebuild: false,
      budgetNodes: spec.budgetNodes ?? policy.defaultScreenNodes,
    }
  }

  function pushMount(rec: ScreenRecord, rebuild: boolean): void {
    commands.push({ op: 'mount', screenId: rec.screenId, name: rec.name, path: rec.path, params: rec.params, rebuild })
  }

  function activeNodes(): number {
    return activeNodeCount
  }

  /**
   * ★内存治理（替代"层数上限"）：超预算 → 冻结最旧的 hidden 屏（栈底起，keepWindow 保护栈顶）。
   * 冻结 = 树销毁 + 栈位保留（返回时重建）；**冻结对象永远不含当前可见屏**（保底语义）。
   *
   * ★性能：`activeNodeCount` 增量维护（push/pop/冻结各自记账）⇒ **无预算时本函数 O(1)**；
   *   有预算且超限时冻结游标 `frozenPrefix` 从底部连续推进（每屏至多冻一次，均摊 O(1)）。
   *   —— 这就是"高性能"的部分答案：栈操作是常数时间，内存治理不引入随深度增长的扫描。
   */
  function applyMemoryPolicy(): void {
    overBudget = false
    const budget = policy.nodeBudget
    if (budget == null) return
    if (activeNodeCount <= budget) return
    const protectFrom = Math.max(0, stack.length - policy.keepWindow)
    while (activeNodeCount > budget) {
      let frozenOne = false
      for (let i = frozenPrefix; i < protectFrom; i++) {
        const r = stack[i]
        if (r.state !== 'hidden') continue
        r.state = 'frozen'
        r.needsRebuild = true
        freezeCount++
        commands.push({ op: 'unmount', screenId: r.screenId, reason: 'freeze' })
        activeNodeCount -= r.budgetNodes
        // 冻结游标推进：底部连续冻结段（冻完当前屏后，后续冻结从这里继续）
        while (frozenPrefix < stack.length && stack[frozenPrefix].state === 'frozen') frozenPrefix++
        emit({ type: 'freeze', screenId: r.screenId, name: r.name, depth: stack.length })
        frozenOne = true
        break
      }
      if (!frozenOne) break // 保护窗口内无可冻结项（或预算小于单屏）→ 退出，由 overBudget 暴露
    }
    overBudget = activeNodeCount > budget
    if (overBudget) emit({ type: 'over-budget', activeNodes: activeNodeCount, nodeBudget: budget })
  }

  /** 新栈顶进入可见态（frozen → mount(rebuild) + enter；hidden → enter） */
  function activateTop(): void {
    const top = stack[stack.length - 1]
    if (!top || top.state === 'mounted') return
    const rebuild = top.state === 'frozen'
    top.state = 'mounted'
    if (rebuild) {
      rebuildCount++
      activeNodeCount += top.budgetNodes // 重建 ⇒ 重新计入活跃节点
      pushMount(top, true)
      emit({ type: 'restore', screenId: top.screenId, name: top.name, depth: stack.length })
    }
    commands.push({ op: 'enter', screenId: top.screenId, transition: top.transition })
  }

  /** 旧栈顶退场（树保留：display:none）——调用方保证它确实不再是栈顶（顺序由各操作控制） */
  function deactivate(oldTop: ScreenRecord | null, transition: RouteTransition | undefined): void {
    if (!oldTop || oldTop.state !== 'mounted') return
    oldTop.state = 'hidden'
    commands.push({ op: 'exit', screenId: oldTop.screenId, transition })
  }

  function push(name: string, params?: RouteParams, o?: { transition?: RouteTransition }): void {
    const oldTop = stack[stack.length - 1] ?? null
    const rec = makeRecord(name, params, o?.transition)
    const t = rec.transition
    deactivate(oldTop, t)
    pushMount(rec, false)
    rec.state = 'mounted'
    stack.push(rec)
    activeNodeCount += rec.budgetNodes
    commands.push({ op: 'enter', screenId: rec.screenId, transition: t })
    applyMemoryPolicy()
    emit({ type: 'push', name, depth: stack.length })
  }

  /** 弹栈到指定 index（保留 [0..targetIdx]）——公共给 pop / popTo / navigate 用 */
  function popToIndex(targetIdx: number, exitTransition: RouteTransition | undefined): ScreenRecord | null {
    if (stack.length - 1 <= targetIdx) return null
    const removed: ScreenRecord[] = []
    while (stack.length - 1 > targetIdx) removed.push(stack.pop()!)
    // 原栈顶（removed[0]）播退场；其余（隐藏态）静默销毁——批量 pop 不做多段动画
    commands.push({ op: 'exit', screenId: removed[0].screenId, transition: exitTransition })
    for (const r of removed) {
      if (r.state !== 'frozen') activeNodeCount -= r.budgetNodes // 记账（frozen 本不计；★须在改状态前判）
      r.state = 'destroyed'
      commands.push({ op: 'unmount', screenId: r.screenId, reason: 'pop' })
    }
    if (frozenPrefix > stack.length) frozenPrefix = stack.length // 弹到冻结段之内 ⇒ 游标收缩
    activateTop()
    return removed[0]
  }

  function pop(delta = 1): void {
    // 目标 index = 保留 [0..length-1-delta]（pop 1 层 = 退掉栈顶）
    const target = Math.max(0, stack.length - 1 - Math.max(1, delta))
    const oldTop = stack[stack.length - 1] ?? null
    const removed = popToIndex(target, oldTop?.transition)
    if (!removed) return // 已只剩 1 屏（保底：不把栈弹空）
    applyMemoryPolicy()
    emit({ type: 'pop', name: removed.name, depth: stack.length })
  }

  function replace(name: string, params?: RouteParams, o?: { transition?: RouteTransition }): void {
    const oldTop = stack[stack.length - 1] ?? null
    if (oldTop) {
      commands.push({ op: 'exit', screenId: oldTop.screenId, transition: o?.transition ?? oldTop.transition })
      commands.push({ op: 'unmount', screenId: oldTop.screenId, reason: 'pop' })
      stack.pop()
      if (oldTop.state !== 'frozen') activeNodeCount -= oldTop.budgetNodes
      oldTop.state = 'destroyed'
      if (frozenPrefix > stack.length) frozenPrefix = stack.length
    }
    const rec = makeRecord(name, params, o?.transition)
    pushMount(rec, false)
    rec.state = 'mounted'
    stack.push(rec)
    activeNodeCount += rec.budgetNodes
    commands.push({ op: 'enter', screenId: rec.screenId, transition: rec.transition })
    applyMemoryPolicy()
    emit({ type: 'replace', name, depth: stack.length })
  }

  function popTo(name: string): void {
    let idx = -1
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === name) {
        idx = i
        break
      }
    }
    if (idx < 0) throw new Error(`[app-stack] popTo("${name}")：栈中不存在该屏（当前栈：${stack.map((r) => r.name).join(' → ') || '空'}）`)
    const oldTop = stack[stack.length - 1] ?? null
    const removed = popToIndex(idx, oldTop?.transition)
    if (!removed) return
    applyMemoryPolicy()
    emit({ type: 'pop', name: removed.name, depth: stack.length })
  }

  function popToRoot(): void {
    const oldTop = stack[stack.length - 1] ?? null
    if (stack.length <= 1) return
    const removed = popToIndex(0, oldTop?.transition)
    if (!removed) return
    applyMemoryPolicy()
    emit({ type: 'pop', name: removed.name, depth: stack.length })
  }

  function resetTo(name: string, params?: RouteParams): void {
    while (stack.length) {
      const r = stack.pop()!
      if (r.state !== 'frozen') activeNodeCount -= r.budgetNodes
      r.state = 'destroyed'
      commands.push({ op: 'unmount', screenId: r.screenId, reason: 'reset' })
    }
    frozenPrefix = 0
    const rec = makeRecord(name, params)
    pushMount(rec, false)
    rec.state = 'mounted'
    stack.push(rec)
    activeNodeCount += rec.budgetNodes
    commands.push({ op: 'enter', screenId: rec.screenId, transition: rec.transition })
    applyMemoryPolicy()
    emit({ type: 'reset', name, depth: stack.length })
  }

  function navigate(frames: ScreenFrame[]): void {
    // 先全量校验（避免"改了一半再抛错"——部分执行比全不执行更难排查）
    for (const f of frames) specOf(f.name)
    if (frames.length === 0) {
      if (stack.length > 0) {
        resetEmpty()
      }
      return
    }
    if (
      frames.length === stack.length &&
      frames.every((f, i) => stack[i].name === f.name && paramKey(stack[i].params) === paramKey(f.params))
    ) {
      return // 无变化
    }

    // 公共前缀（name + params 匹配——params 不同 = 不同屏，对齐小程序/Flutter 语义）
    let common = 0
    while (
      common < stack.length &&
      common < frames.length &&
      stack[common].name === frames[common].name &&
      paramKey(stack[common].params) === paramKey(frames[common].params)
    ) {
      common++
    }

    const oldTop = stack[stack.length - 1] ?? null
    let popRemoved: ScreenRecord | null = null
    let pushCount = 0

    // ① 弹出尾部（保留前 common 个）——保留段不动（树保留：无 mount/unmount）
    if (stack.length > common) {
      const removed: ScreenRecord[] = []
      while (stack.length > common) removed.push(stack.pop()!)
      const t = frames[common]?.transition ?? removed[0].transition
      commands.push({ op: 'exit', screenId: removed[0].screenId, transition: t })
      for (const r of removed) {
        if (r.state !== 'frozen') activeNodeCount -= r.budgetNodes
        r.state = 'destroyed'
        commands.push({ op: 'unmount', screenId: r.screenId, reason: 'pop' })
      }
      popRemoved = removed[0]
      if (frozenPrefix > stack.length) frozenPrefix = stack.length
    }

    // ② 原栈顶若仍在栈中但不再是栈顶 → 退场（树保留）
    if (oldTop && oldTop.state === 'mounted' && stack[stack.length - 1] !== oldTop) {
      deactivate(oldTop, frames[common]?.transition ?? oldTop.transition)
    }

    // ③ 压入新增（全部 mount；仅最终栈顶 enter——批量 push 不做多段动画）
    for (let i = common; i < frames.length; i++) {
      const rec = makeRecord(frames[i].name, frames[i].params, frames[i].transition)
      pushMount(rec, false)
      stack.push(rec)
      activeNodeCount += rec.budgetNodes
      pushCount++
    }

    // ④ 最终栈顶进入可见态（frozen 时含重建）
    activateTop()
    applyMemoryPolicy()
    if (popRemoved) emit({ type: 'pop', name: popRemoved.name, depth: stack.length })
    if (pushCount > 0) {
      const top = stack[stack.length - 1]
      if (top) emit({ type: 'push', name: top.name, depth: stack.length })
    }
  }

  /** 清空栈（navigate([]) 的内部实现） */
  function resetEmpty(): void {
    while (stack.length) {
      const r = stack.pop()!
      if (r.state !== 'frozen') activeNodeCount -= r.budgetNodes
      r.state = 'destroyed'
      commands.push({ op: 'unmount', screenId: r.screenId, reason: 'reset' })
    }
    frozenPrefix = 0
    emit({ type: 'reset', name: '', depth: 0 })
  }

  return {
    push,
    pop,
    replace,
    popTo,
    popToRoot,
    tab: resetTo,
    reset: resetTo,
    navigate,
    markRebuilt(screenId: string): void {
      const r = stack.find((s) => s.screenId === screenId)
      if (r) r.needsRebuild = false
    },
    drainCommands(): ScreenCommand[] {
      const out = commands.slice()
      commands.length = 0
      return out
    },
    current(): AppScreen | null {
      return stack[stack.length - 1] ?? null
    },
    get stack(): readonly AppScreen[] {
      return stack.slice()
    },
    get depth(): number {
      return stack.length
    },
    stats(): AppStackStats {
      let mounted = 0
      let hidden = 0
      let frozen = 0
      for (const r of stack) {
        if (r.state === 'mounted') mounted++
        else if (r.state === 'hidden') hidden++
        else frozen++
      }
      return {
        depth: stack.length,
        mounted,
        hidden,
        frozen,
        activeNodes: activeNodes(),
        nodeBudget: policy.nodeBudget,
        overBudget,
        freezeCount,
        rebuildCount,
      }
    },
    on(handler: (e: AppStackEvent) => void): () => void {
      handlers.push(handler)
      return () => {
        const i = handlers.indexOf(handler)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
  }
}

// packages/render-backend/src/screen-runtime.ts —— ★★★B1：App 壳**统一运行期**（2026-10-09）
//
// 【它补什么（用户「先把宿主关注点分离完全打通……别又是做一半留一半」）】
//   App 壳此前是**静态屏内容**（构建期拍平的 `{nodes}`）⇒ 事件/响应式/导航全无。
//   本模块把一屏的运行期产物（`tpl`/`table`/`events`/`handlers`/`data`，见 `buildAppRuntimeContent`）
//   **实例化 + 订阅 + 手势派发**，产出可供 `screen.mount` 的 `{viewport,nodes}`，并驱动增量更新。
//   ⇒ 交互/响应式语义全部落在**共享层**（`slot-runtime`），各宿主只实现平台原语（触摸采集/绘制/帧）。
//
// 【★关键设计：content-local id → 内核 id 的**可反查**映射（R6）】
//   宿主把 `screen.mount` 的 content 节点按**数组序**重映射到内核 id 段（基址 = 宿主给的
//   `contentIdBase`，如 Android 的 1000）⇒ `kernelId = base + index`。本模块持有
//   `localIdsOrdered(index → 内容局部 id)`，故**手势命中 kernel id** 时：
//     `index = kernelId - base; localId = localIdsOrdered[index]` ⇒ 用它去 `events` 索引查 handler。
//   ⇒ 不需要猜、不需要宿主改契约（只多回报一个 `contentIdBase`）。**这是"跨屏点击定节点"的钥匙。**
//
// 【诚实边界】① 本模块**不**建树/不绘制（那是宿主 `screen.mount` / `applyOps` 的职责）；
//   ② `flush()` 是**确定性驱动**入口（宿主每帧调），避免依赖微任务调度（端上 eval 期间不排空，
//      本仓在两处源码注释里都钉过这个坑）；③ 组件（子组件 `components`）本版**不展开**（诚实：仅顶层）。
import {
  instantiateTemplate,
  VaporRuntime,
  SlotRuntime,
  PropKeyTable,
  StringPool,
  ListRegistry,
  dispatchGesture,
  indexEventBindings,
  createDispatchState,
  evalExpr,
} from '@proteus-vue/slot-runtime'
import type {
  LayoutTemplate,
  SubscriptionTable,
  EventBinding,
  EventIndex,
  DispatchState,
  EvalContext,
} from '@proteus-vue/slot-runtime'
// ★★★运行期阶段耗时自采样（CPU Profiler · 决策 #715）——dev-only 的框架级归因
import { createRuntimeProfiler, NULL_PROFILER, type RuntimeProfiler, type ProfEntry } from './runtime-profiler'

/** 一屏的运行期产物（与 `packages/cli/src/app-runtime-content.ts` 的 `ScreenRuntimeArtifact` **同形**） */
export interface ScreenRuntimeArtifact {
  tpl: LayoutTemplate
  table: SubscriptionTable
  events: EventBinding[]
  handlers: Record<string, Array<{ op: string; source?: string; program?: unknown; event?: string }>>
  data: Record<string, unknown>
  /**
   * ★★**源文件路径**（决策 #713 · 仅供 dev）：该屏对应的 `.vue`（相对项目根）——缺省省略（release 无）。
   *   ★CLI 侧 `app-runtime-content.ts` 的 `ScreenRuntimeArtifact` 也带它；本接口"同形"必须一并带上，
   *     否则消费方（superapp-runtime / dev 面板 / 测试）读 `art.file` 报 `Property 'file' does not exist`。
   */
  file?: string
}

export interface CreateScreenRuntimeOptions {
  /** 各屏运行期产物（键 = 屏名） */
  artifacts: Record<string, ScreenRuntimeArtifact>
  /** 指令出口：把 `SlotRuntime` 编出的二进制指令（number[] JSON）交给宿主应用（同 `applyOps`） */
  applyOps: (opsJson: string) => void
  /** 视口（实例化用；宿主在挂载时给真实尺寸） */
  viewport: { width: number; height: number }
  /**
   * 手势命中的**内核 id → 内容 local id** 的映射基址。两条宿主路径口径不同：
   *   · **不传（缺省）** = 恒等：`VaporRenderHost.mount` **直接用节点 id** 建树（App 壳走这条）⇒
   *     `kernelId === localId`，无需重映射；
   *   · **传数字** = `kernelId = base + 数组序`：`ScreenHost.screen.mount` 按**数组序**重映射内容
   *     节点（Android 基址 1000）⇒ 反查 `index = kernelId − base`、`localId = 节点序[index]`。
   */
  contentIdBase?: number
  /**
   * ★★★跨调用**状态种子**（2026-10-07 · 鸿蒙一次性 VM）：`{ 屏名: { 变量: 值 } }`。
   *   【为什么需要】鸿蒙宿主为规避持久 VM 崩溃（决策 #540）**每次交互都新建一次性 VM**
   *   ⇒ 运行期实例态（如 `count`）随 VM 销毁而丢 ⇒ 「点击计数不累加」「改数据不生效」。
   *   ⇒ 宿主把上次的 `snapshot()` 回灌为种子，实例化即恢复态——**宿主充当状态持有者**，
   *     一次性 VM 变"无状态执行器"（本模式的必然形态）。缺省 ⇒ 用构建期 `data`。
   */
  seedData?: Record<string, Record<string, unknown>>
  /** 诊断出口（不静默） */
  onNote?: (note: string) => void
  /**
   * ★★★**页面处理器运行期错误出口**（决策 #712）——handler 表达式求值失败时逐条调用（带**模板源位置**）。
   *   与 `onNote` 分开：note 是"诊断信息"（console.log 级），本出口是**用户代码出错**
   *   （宿主/桥应转发到面板 Console 的 `error` 级 + 如实回传，不得静默吞掉）。
   *   缺省 ⇒ 仅落进 `handlerErrors()` 排空缓冲（仍可读，不静默）。
   */
  onError?: (error: string) => void
  /**
   * ★导航出口（B1）：handler 里的 `$nav('目标')` 动作 → 交给宿主/装配层执行导航
   *   （App 壳 = `router.push(target)`；与 `<navigator>` 同语义）。缺省 ⇒ 只记 note（不静默）。
   */
  navigate?: (target: string) => void
  /**
   * ★★★**运行期阶段耗时自采样**（CPU Profiler · 决策 #715）——dev 构建开启：给 `instantiate` /
   *   `flush` / `dispatch` / 每个 handler 计时，归因"卡在哪一段"。缺省 false ⇒ **零开销**（空实现）。
   *   采样经 `profileStats()` 排空 ⇒ 宿主每 tick 取走（随 `/ping?perf=` 上报面板）。
   */
  profile?: boolean
}

/** 一屏的运行期实例（挂载 + 事件 + 增量） */
export interface ScreenRuntimeInstance {
  /** 供 `screen.mount` 的内容载荷（`{viewport,nodes}`，节点已实例化） */
  content(): { viewport: { width: number; height: number }; nodes: unknown[] }
  /** 派发一次语义手势（宿主 collected 命中链 → 这里）；返回是否跑了 handler */
  dispatch(type: string, chain: readonly number[], state?: DispatchState): {
    handled: boolean
    fired: number[]
    /** ★跑了哪些 handler + 各自**模板源位置**（决策 #712·source map）——面板 Events 锚回 `.vue:line:col` */
    firedHandlers?: Array<{ handler: string; nodeId: number; loc?: { line: number; column: number } }>
  }
  /** 立即把脏槽位编成指令并交给 `applyOps`（确定性驱动入口） */
  flush(): void
  /**
   * ★★★**数据变更后重实例化**（2026-10-07）：用当前 `data` 重建节点树 + 重算槽位。
   *   给"`applyOps` 为 no-op"的宿主（鸿蒙一次性 VM，无驻留内核指令流）用——它们拿不到细粒度
   *   增量，只能整树重建。`content()` 之后即反映新数据。（有 applyOps 的宿主无需调本方法。）
   */
  refresh(): void
  /** 当前数据快照（诊断/判据读） */
  data(): Record<string, unknown>
  /** ★跨调用状态导出（浅拷贝）——供宿主（一次性 VM）在下次调用回灌为 `seedData`（见 CreateScreenRuntimeOptions.seedData） */
  snapshot(): Record<string, unknown>
  /**
   * ★★★**排空本屏页面处理器错误**（决策 #712）——自上次调用以来的 handler 求值失败（带模板源位置）。
   *   排空式（取走即清）：供宿主 dev-watch / 面板 Console 消费（与 `SuperappRuntime.devEvents` 同形态）。
   */
  handlerErrors(): string[]
  /**
   * ★★★**排空本屏运行期阶段耗时**（CPU Profiler · 决策 #715）——自上次调用以来的阶段采样
   *   （`instantiate` / `relink` / `flush` / `dispatch` / `handler「hN」`，按累计耗时降序）。
   *   排空式；未启用 profiling（`profile` 未开）⇒ 恒空数组。
   */
  profileStats(): ProfEntry[]
}

export interface ScreenRuntime {
  /** 取（或按需创建）某屏的运行期实例 */
  instance(name: string): ScreenRuntimeInstance
  /** 是否有该屏的运行期产物 */
  has(name: string): boolean
  /** ★跨调用状态导出（`{屏名: 数据}`）——一次性 VM 宿主回灌用 */
  snapshot(): Record<string, Record<string, unknown>>
  /** ★★★排空**当前所有已建实例**的运行期阶段耗时（CPU Profiler · 决策 #715）——排空式、按屏归并。 */
  profileStats(): Record<string, ProfEntry[]>
}
/**
 * 创建 App 壳的统一运行期。
 *
 * 用法（壳 JS 入口，QuickJS/JSC 里）：
 * ```ts
 * const rt = createScreenRuntime({ artifacts, applyOps: (ops) => proteusHost.applyOps(ops), viewport })
 * // 挂载某屏：把 rt.instance('index').content() 交给 screen.mount；记下它回报的 contentIdBase
 * // 手势：proteusHost.onGesture((type, kernelId, chain) => rt.instance(cur).dispatch(type, chain))
 * // 每帧：rt.instance(cur).flush()（或在数据变更后调）
 * ```
 */
export function createScreenRuntime(opts: CreateScreenRuntimeOptions): ScreenRuntime {
  const base = opts.contentIdBase // undefined ⇒ 恒等（VaporRenderHost 直用节点 id）
  const instances = new Map<string, ScreenRuntimeInstance>()
  const note = opts.onNote ?? (() => {})

  function make(name: string): ScreenRuntimeInstance {
    const art = opts.artifacts[name]
    if (!art) throw new Error(`[screen-runtime] 无该屏产物：${name}`)
    // ★★阶段耗时自采样器（决策 #715）：dev 才建真累加器；否则空实现（`time` 透传，零开销）。
    const prof: RuntimeProfiler = opts.profile ? createRuntimeProfiler() : NULL_PROFILER

    // ── ① 数据源（端上不执行 script ⇒ 用构建期 `data` 快照；★一次性 VM 宿主可回灌 seed 恢复态）──
    const data: Record<string, unknown> = { ...art.data, ...(opts.seedData?.[name] ?? {}) }
    const read = (n: string): unknown => data[n]

    // ── ② 实例化（模板 + 数据 → 节点树）——★可重建（`refresh()`：数据变后重实例化，供"applyOps 为 no-op"
    //   的宿主（鸿蒙一次性 VM）拿到反映新数据的整树）──
    let inst = prof.time('instantiate', () =>
      instantiateTemplate(art.tpl, { viewport: opts.viewport, read, table: art.table, registry: new ListRegistry() }))
    // ★R6：内容局部 id 的**有序表**（index → localId）——手势反查用
    let localIdsOrdered = inst.nodes.map((n) => n.id)
    /** 用**当前 data** 重实例化（节点 id 由 tpl 的 slot 序决定 ⇒ 与初实例化逐位一致，id 映射稳定） */
    function rebuild(): void {
      inst = prof.time('instantiate', () =>
        instantiateTemplate(art.tpl, { viewport: opts.viewport, read, table: art.table, registry: new ListRegistry() }))
      localIdsOrdered = inst.nodes.map((n) => n.id)
    }
    // 组件未展开 ⇒ 如实记（不静默）
    if (inst.stats.componentNodes === 0 && inst.nodes.some((n) => n.component)) {
      note(`[screen-runtime] ${name}: 模板含组件边界但本版未展开（诚实边界）`)
    }

    // ── ③ 运行期（订阅驱动增量）：SlotRuntime + VaporRuntime ──
    const keys = new PropKeyTable()
    const strings = new StringPool()
    // ★指令出口 = 宿主 applyOps（二进制指令的 number[] JSON 形态——与 entry-vapor 同式）
    const slotRt = new SlotRuntime(keys, strings, (bytes) => {
      opts.applyOps(JSON.stringify(Array.from(bytes)))
    })
    const vapor = new VaporRuntime(art.table, slotRt, VaporRuntime.buildEvaluators(art.table.evaluators), new ListRegistry())
    const evalCtx: EvalContext = { read }
    vapor.load(evalCtx, () => { /* 源变化回调：本版无响应式框架，靠 dispatch 后显式 relink */ })
    // 首帧：建订阅并写一遍全部 L1 槽位（此时树已由 content() 挂载；这些指令幂等——把初值落到内核）
    prof.time('relink', () => vapor.relink(evalCtx))
    prof.time('flush', () => slotRt.flush())

    // ── ④ 事件索引（nodeId:event → handler）──
    const byNodeEvent: EventIndex = indexEventBindings(art.events)
    const dispatchState = createDispatchState()
    // ★★★页面处理器 source map（决策 #712）：handler 名 → 绑定处**模板源位置**（`{line,column}`，1 基）。
    //   建一次即可（`art.events` 在页面生命周期内不变）；`runHandler` 出错时据此把运行期错误锚回 `.vue`。
    const locByHandler = new Map<string, { line: number; column: number }>()
    for (const e of art.events ?? []) {
      const b = e as { handler?: string; loc?: { line: number; column: number } }
      if (b.handler && b.loc) locByHandler.set(b.handler, b.loc)
    }
    /** 本屏运行期 handler 错误（排空式；宿主/dev server 取走即清——面板「错误」页消费） */
    const handlerErrors: string[] = []

    /** 跑一个 handler（动作表：set/add/emit；emit 本版无去处 ⇒ 如实忽略） */
    function runHandler(handlerName: string, _nodeId: number, payload?: unknown): boolean {
      const acts = art.handlers[handlerName]
      if (!acts) return false
      for (const a of acts) {
        if (a.op === 'emit') { note(`[screen-runtime] ${name}: handler「${handlerName}」含 $emit——本版无去处（已忽略）`); continue }
        if (a.op === 'nav') {
          const tgt = (a as { target?: string }).target
          if (tgt && opts.navigate) opts.navigate(tgt)
          else note(`[screen-runtime] ${name}: $nav('${tgt ?? ''}') 无 navigate 出口（未装配）`)
          continue
        }
        const ctx2: EvalContext = { read: (n: string) => (n === '$event' ? payload : data[n]) }
        // ★★页面处理器「源」定位（决策 #712）：handler 执行**出错时**把**handler 名 + 源表达式**
        //   （`a.source` = 编译期保留的模板表达式原文，如 `count = count + 1`）+ 节点 id + **模板行** 一并报出——
        //   否则端上栈只有解释器内部、**定位不到是模板哪一句**（"调试生态链没数据支撑"）。
        // ★★CPU Profiler（决策 #715）：给**每个 handler 的表达式求值**计时 ⇒ 归因"哪个 @click 最贵"。
        let v: unknown
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          v = prof.time(`handler「${handlerName}」`, () => evalExpr(a.program as any, ctx2 as any), locByHandler.get(handlerName))
        } catch (e) {
          const msg = String((e as Error)?.message ?? e)
          const loc = locByHandler.get(handlerName)
          const at = loc ? `（模板 ${name}.vue:${loc.line}:${loc.column}）` : ''
          const detail = `[screen-runtime] ${name}: handler「${handlerName}」节点 #${_nodeId}${at} 表达式 \`${a.source ?? '(?)'}\` 求值失败：${msg}`
          // ★不静默、也不炸掉整次手势：记为错误（面板可见）+ note，其余动作/其余 handler 照常——
          //   一个坏表达式不该让页面"点了完全没反应"（那正是本项要消灭的形态）。
          handlerErrors.push(detail)
          if (handlerErrors.length > 50) handlerErrors.shift()
          note(detail)
          opts.onError?.(detail)
          continue
        }
        if (!a.source) continue
        if (a.op === 'add') {
          const cur = data[a.source]
          data[a.source] = (typeof cur === 'number' ? cur : 0) + (typeof v === 'number' ? v : 0)
        } else if (a.op === 'set') {
          data[a.source] = v
        }
      }
      return true
    }

    /** R6 反查：内核 id → 内容局部 id（宿主重映射 = 基址 + 数组序） */
    function localIdOf(kernelId: number): number {
      if (typeof base !== 'number') return kernelId // 恒等（VaporRenderHost 直用节点 id）
      const idx = kernelId - base
      return idx >= 0 && idx < localIdsOrdered.length ? localIdsOrdered[idx]! : kernelId
    }

    /** ★数据变更后的重建：重实例化（节点反映新 data）+ 重算槽位（有 applyOps 的宿主拿到增量） */
    function refreshData(): void {
      rebuild()
      prof.time('relink', () => vapor.relink(evalCtx))
      prof.time('flush', () => slotRt.flush())
    }

    return {
      content() {
        return { viewport: inst.viewport, nodes: inst.nodes as unknown[] }
      },
      dispatch(type, chain) {
        // ★把链从内核 id 空间**翻译回内容局部 id 空间**（`events` 索引是 local 空间）
        const localChain = chain.map(localIdOf)
        const fired: Array<{ handler: string; nodeId: number; loc?: { line: number; column: number } }> = []
        // ★★CPU Profiler（决策 #715）：整次派发计时（含 handler + 重建）——"点一下总花多久"。
        const r = prof.time('dispatch', () => dispatchGesture(localChain, type, byNodeEvent, dispatchState, (h, id) => {
          const ok = runHandler(h, id)
          if (ok) fired.push({ handler: h, nodeId: id, ...(locByHandler.has(h) ? { loc: locByHandler.get(h)! } : {}) })
          return ok
        }))
        // handler 改了数据 ⇒ 重建（无 applyOps 的宿主靠 content() 重挂；有 applyOps 的宿主拿增量——两种都覆盖）
        if (r.fired.length > 0) refreshData()
        // ★★★页面处理器 source map（决策 #712）：把「跑了哪些 handler + 各自**模板源位置**」随派发结果带出——
        //   面板 Events 据此把"点了→跑了 h0"锚回 `page.vue:line:col`（调试生态链的数据支撑）。
        return { handled: r.fired.length > 0, fired: r.fired, firedHandlers: fired }
      },
      flush() { prof.time('flush', () => slotRt.flush()) },
      refresh() { refreshData() },
      data() { return data },
      snapshot() { return { ...data } },
      handlerErrors() { const out = handlerErrors.slice(); handlerErrors.length = 0; return out },
      profileStats() { return prof.drain() },
    }
  }

  return {
    has: (name) => Boolean(opts.artifacts[name]),
    instance(name) {
      let it = instances.get(name)
      if (!it) { it = make(name); instances.set(name, it) }
      return it
    },
    /** ★跨调用状态导出（每屏数据浅拷贝）——一次性 VM 宿主持有、下次回灌（见 seedData） */
    snapshot() {
      const out: Record<string, Record<string, unknown>> = {}
      for (const [name, it] of instances) out[name] = it.snapshot()
      return out
    },
    /** ★★★排空各屏阶段耗时（CPU Profiler · 决策 #715）——按屏归并（每屏只在其有数据时出现）。 */
    profileStats() {
      const out: Record<string, ProfEntry[]> = {}
      for (const [name, it] of instances) {
        const entries = it.profileStats()
        if (entries.length > 0) out[name] = entries
      }
      return out
    },
  }
}

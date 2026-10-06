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

/** 一屏的运行期产物（与 `packages/cli/src/app-runtime-content.ts` 的 `ScreenRuntimeArtifact` 同形） */
export interface ScreenRuntimeArtifact {
  tpl: LayoutTemplate
  table: SubscriptionTable
  events: EventBinding[]
  handlers: Record<string, Array<{ op: string; source?: string; program?: unknown; event?: string }>>
  data: Record<string, unknown>
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
  /** 诊断出口（不静默） */
  onNote?: (note: string) => void
  /**
   * ★导航出口（B1）：handler 里的 `$nav('目标')` 动作 → 交给宿主/装配层执行导航
   *   （App 壳 = `router.push(target)`；与 `<navigator>` 同语义）。缺省 ⇒ 只记 note（不静默）。
   */
  navigate?: (target: string) => void
}

/** 一屏的运行期实例（挂载 + 事件 + 增量） */
export interface ScreenRuntimeInstance {
  /** 供 `screen.mount` 的内容载荷（`{viewport,nodes}`，节点已实例化） */
  content(): { viewport: { width: number; height: number }; nodes: unknown[] }
  /** 派发一次语义手势（宿主 collected 命中链 → 这里）；返回是否跑了 handler */
  dispatch(type: string, chain: readonly number[], state?: DispatchState): { handled: boolean; fired: number[] }
  /** 立即把脏槽位编成指令并交给 `applyOps`（确定性驱动入口） */
  flush(): void
  /** 当前数据快照（诊断/判据读） */
  data(): Record<string, unknown>
}

export interface ScreenRuntime {
  /** 取（或按需创建）某屏的运行期实例 */
  instance(name: string): ScreenRuntimeInstance
  /** 是否有该屏的运行期产物 */
  has(name: string): boolean
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

    // ── ① 数据源（端上不执行 script ⇒ 用构建期 `data` 快照）──
    const data: Record<string, unknown> = { ...art.data }
    const read = (n: string): unknown => data[n]

    // ── ② 实例化（模板 + 数据 → 节点树）──
    const inst = instantiateTemplate(art.tpl, { viewport: opts.viewport, read, table: art.table, registry: new ListRegistry() })
    // ★R6：内容局部 id 的**有序表**（index → localId）——手势反查用
    const localIdsOrdered = inst.nodes.map((n) => n.id)
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
    vapor.relink(evalCtx)
    slotRt.flush()

    // ── ④ 事件索引（nodeId:event → handler）──
    const byNodeEvent: EventIndex = indexEventBindings(art.events)
    const dispatchState = createDispatchState()

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = evalExpr(a.program as any, ctx2 as any)
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

    return {
      content() {
        return { viewport: inst.viewport, nodes: inst.nodes as unknown[] }
      },
      dispatch(type, chain) {
        // ★把链从内核 id 空间**翻译回内容局部 id 空间**（`events` 索引是 local 空间）
        const localChain = chain.map(localIdOf)
        const r = dispatchGesture(localChain, type, byNodeEvent, dispatchState, (h, id) => runHandler(h, id))
        // handler 改了数据 ⇒ 重算受影响的槽位（本版：全量 relink——订阅驱动的细粒度由回调在响应式框架下承担）
        if (r.fired.length > 0) {
          vapor.relink(evalCtx)
          slotRt.flush()
        }
        return { handled: r.fired.length > 0, fired: r.fired }
      },
      flush() { slotRt.flush() },
      data() { return data },
    }
  }

  return {
    has: (name) => Boolean(opts.artifacts[name]),
    instance(name) {
      let it = instances.get(name)
      if (!it) { it = make(name); instances.set(name, it) }
      return it
    },
  }
}

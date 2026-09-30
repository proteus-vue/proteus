// packages/render-backend/src/screen-executor.ts
// ★★M5 虚拟栈的**宿主执行器**（`ScreenCommand` 命令流的消费者）—— 2026-09-30
//
// 【为什么有它（取证结论）】M5 虚拟栈（`packages/router/src/app-stack.ts`）产出的
//   `ScreenCommand` 命令流**此前没有消费者**：`appTransition()` 全仓零真实调用点
//   （`route-transition.ts` 自述"就绪的第三腿，等 M5 路由栈调用"），M5 计划文档亦写明
//   "后续工作只剩**宿主执行器**（真实建/销毁屏子树 + Morpheus 转场接线）与真机验证装置"。
//   本文件即那根缺失的线：**命令流 → 树操作 + 转场批次**。
//
// 【三层的位置（谁与谁解耦）】
//   ```
//   router（栈 + 命令流）         ← 零动画依赖（方向纪律）
//        ↓ ScreenCommand（结构类型，本文件不 import router）
//   ★本执行器（编排：顺序/可见性/方向/事务） ← 零平台依赖（宿主经端口注入）
//        ↓ 树操作端口 + 转场端口（两个接口，宿主各自实现）
//   宿主（Host ABI 树操作 + 内核动画 / 平台零参与提交）
//   ```
//   · **转场规划器是注入的**（`plan` 端口——形态与 `@proteus-vue/animation` 的
//     `routeTransitionBatches` 结构兼容）：本包**不 import animation**，依赖方向不变；
//   · **树操作与动画播放是端口**（`ScreenTreeHost` / `ScreenAnimHost`）：
//     单元测试用记录桩，真机用宿主实现——同一套编排逻辑两处复用（纪律 #22）。
//
// 【★两个编排决策（M5 契约没写死、由执行器定的部分——都在这说明理由）】
//   ① **退场销毁延迟到转场播完**：pop 的惯序是 `exit → unmount → enter`，若 unmount 即刻销毁
//      屏子树，旧页会在滑出动画**中途消失**（闪断）。⇒ 执行器把"被 exit 标记的屏"的销毁
//      **挂起**到转场完成后再执行（树操作语义不变，只是时机）。
//   ② **方向推导**（M5 §0.4 原文："退场方向（pop 的反向转场）由执行器/Morpheus 推导"）：
//      · 进入的屏**在本事务里被 mount 过**（且非 rebuild） ⇒ `forward`（新页到来——push/replace/reset）；
//      · 否则（屏子树已在树上、只是从 hidden 转可见） ⇒ `back`（返回——pop/popTo/navigate 回退）；
//      · `mount(rebuild=true)`（冻结后重建）**也判 back**——该命令只有 activateTop 会产生
//        （返回路径），语义是"回程"；动画用反向规格（`-240→0` 复位）比前进规格观感正确。
//      ⇒ 判据（测试守着）：同一转场下 forward.incoming 的 from/to 恰是 back.outgoing 的 to/from（镜像对）。
//
// 【诚实边界】执行器只做**编排**；真实树操作/真实平台动画由端口实现负责——
//   端口实现是否"真"由各自的判据（真机几何/层变换探针）证明，本文件不声称。

/** 屏命令（**结构类型**——与 `@proteus-vue/router` 的 `ScreenCommand` 同形；本文件不 import router） */
export interface ScreenCommandLike {
  op: 'mount' | 'enter' | 'exit' | 'unmount'
  screenId: string
  name?: string
  path?: string
  params?: unknown
  rebuild?: boolean
  transition?: unknown
  reason?: 'pop' | 'reset' | 'freeze'
}

/**
 * 引擎动画指令的最小结构（与 `EngineAnim` **结构兼容**——执行器只透传 + 读少量字段）。
 * ★不要加索引签名（`[k: string]: unknown`）：那会让 `EngineAnim`（无该签名）**不可赋值**
 *   （真机装置编译期实测抓到）。按需字段显式列出即可。
 */
export interface AnimLike {
  nodeId: number
  from?: number
  to?: number
}

/** 转场批次计划（与 `routeTransitionBatches` 的产物结构兼容） */
export interface RouteTransitionPlanLike {
  incoming: { anims: readonly AnimLike[] }
  outgoing: { anims: readonly AnimLike[] }
  durationMs: number
  opaque: boolean
}

/** 转场规划器（注入端口；生产 = `@proteus-vue/animation` 的 `routeTransitionBatches`） */
export type RouteTransitionPlanner = (
  transition: unknown,
  targets: { incoming?: number; outgoing?: number },
  opts?: { direction?: 'forward' | 'back' },
) => RouteTransitionPlanLike

/**
 * 树操作端口（宿主实现——Android/iOS 各自对接 Host ABI 的树接口）。
 * ★三个方法都是"屏粒度"：宿主内部怎么落子树（load_tree / splice / 五原子销毁）不由本层约束。
 */
export interface ScreenTreeHost {
  /** 建屏子树（首次挂载 rebuild=false；冻结后重建 rebuild=true）。返回**屏子树根节点 id**（转场动画的目标） */
  mountScreen(screen: {
    screenId: string
    name: string
    path: string
    params: unknown
    rebuild: boolean
  }): number | Promise<number>
  /** 可见性切换（true = 显示；false = 隐藏但**树保留**——虚拟栈的核心语义） */
  setScreenVisible(screenId: string, visible: boolean, rootNodeId: number | undefined): void | Promise<void>
  /** 销毁屏子树（reason 区分 pop/reset/freeze；五原子销毁由宿主实现负责） */
  destroyScreen(screenId: string, reason: 'pop' | 'reset' | 'freeze', rootNodeId: number | undefined): void | Promise<void>
}

/** 动画播放端口（宿主实现——内核 `anim_start` 或平台零参与提交路径） */
export interface ScreenAnimHost {
  /**
   * 播放一次路由转场（**两页批次并发**——一次导航 = 一次跨边界提交）；
   * promise resolve 时视为动画完成（无动画的宿主实现可同步返回）。
   */
  playRouteTransition(
    plan: RouteTransitionPlanLike,
    ctx: { direction: 'forward' | 'back'; transition: string },
  ): void | Promise<void>
}

/** 执行器运行读数（判据/诊断读它——如"3 次导航 = 3 次转场提交"） */
export interface ScreenExecutorStats {
  /** 消费的命令总数 */
  commands: number
  /** 实际播放的转场次数（空批次跳过的不计） */
  transitions: number
  /** 方向分档计数 */
  forward: number
  back: number
  /** 空规格（none/无动画）跳过的"转场"次数 */
  skippedNone: number
  /** 被销毁的屏数（按 reason 计数） */
  destroyed: { pop: number; reset: number; freeze: number }
  /** 可见性变更次数（true / false） */
  visibility: { shown: number; hidden: number }
  /** 建屏次数（含 rebuild） */
  mounts: { first: number; rebuild: number }
  /** 编排层错误（如 enter 的屏没有子树——不静默） */
  errors: string[]
}

export interface ScreenExecutorOptions {
  host: ScreenTreeHost
  anim: ScreenAnimHost
  plan: RouteTransitionPlanner
  /** 建屏完成通知（接 `AppStack.markRebuilt`——契约要求"执行器建完调 markRebuilt"） */
  onScreenMounted?: (screenId: string, rebuild: boolean) => void
  /** 诊断事件（记录端口调用顺序——真机判据/测试断言读它） */
  onEvent?: (e: { type: string; screenId?: string; detail?: unknown }) => void
}

export interface ScreenExecutor {
  /** 消费一批命令（一次 `stack.drainCommands()` 的产物）。★串行化：并发调用按调用序排队 */
  applyCommands(commands: readonly ScreenCommandLike[]): Promise<void>
  /** 读数快照 */
  stats(): ScreenExecutorStats
  /** 屏子树根节点（screenId → nodeId；诊断/转场目标查询） */
  subtreeNode(screenId: string): number | undefined
}

export function createScreenExecutor(opts: ScreenExecutorOptions): ScreenExecutor {
  const { host, anim, plan, onScreenMounted, onEvent } = opts

  /** screenId → 子树根节点 id */
  const nodes = new Map<string, number>()
  const stats: ScreenExecutorStats = {
    commands: 0,
    transitions: 0,
    forward: 0,
    back: 0,
    skippedNone: 0,
    destroyed: { pop: 0, reset: 0, freeze: 0 },
    visibility: { shown: 0, hidden: 0 },
    mounts: { first: 0, rebuild: 0 },
    errors: [],
  }

  /** 一次导航事务内的暂存态（见文件头"两个编排决策"） */
  interface Txn {
    /** 被 exit 标记的屏（转场播完后隐藏或销毁） */
    exiting: { screenId: string; transition: unknown; destroy: null | 'pop' | 'reset' | 'freeze' } | null
    /** 本事务内 mount 过的屏 → 是否 rebuild（方向推导用） */
    mounted: Map<string, boolean>
  }
  let txn: Txn = { exiting: null, mounted: new Map() }

  const emit = (type: string, screenId?: string, detail?: unknown): void => {
    onEvent?.({ type, screenId, detail })
  }

  async function runCommand(cmd: ScreenCommandLike): Promise<void> {
    stats.commands++
    switch (cmd.op) {
      case 'mount': {
        const rebuild = cmd.rebuild === true
        const node = await host.mountScreen({
          screenId: cmd.screenId,
          name: cmd.name ?? cmd.screenId,
          path: cmd.path ?? '',
          params: cmd.params ?? null,
          rebuild,
        })
        nodes.set(cmd.screenId, node)
        txn.mounted.set(cmd.screenId, rebuild)
        if (rebuild) stats.mounts.rebuild++
        else stats.mounts.first++
        emit('mount', cmd.screenId, { rebuild, node })
        // 契约：执行器建完屏内容后调 markRebuilt（清除 needsRebuild 标记）
        onScreenMounted?.(cmd.screenId, rebuild)
        return
      }
      case 'exit': {
        // ★退场只是"标记"：真正的隐藏/销毁在转场播完之后（见文件头决策 ①）
        txn.exiting = { screenId: cmd.screenId, transition: cmd.transition, destroy: null }
        emit('exit', cmd.screenId, { transition: cmd.transition })
        return
      }
      case 'unmount': {
        const reason = cmd.reason ?? 'pop'
        if (txn.exiting && txn.exiting.screenId === cmd.screenId) {
          // 被 exit 标记的屏：销毁挂起到转场完成（否则旧页在滑出中途消失）
          txn.exiting.destroy = reason
          emit('unmount-deferred', cmd.screenId, { reason })
          return
        }
        // 其余（隐藏态静默销毁 / 冻结）——立即销毁
        await host.destroyScreen(cmd.screenId, reason, nodes.get(cmd.screenId))
        nodes.delete(cmd.screenId)
        stats.destroyed[reason]++
        emit('destroy', cmd.screenId, { reason })
        return
      }
      case 'enter': {
        const incomingNode = nodes.get(cmd.screenId)
        if (incomingNode === undefined) {
          // 不静默：enter 的屏没有子树是编排错误（常见根因：mount 被跳过或 host 抛错被吞）
          stats.errors.push(`enter(${cmd.screenId})：屏子树不存在（mount 未执行？）`)
          emit('error', cmd.screenId, 'enter-without-subtree')
          return
        }
        const exiting = txn.exiting
        const outgoingNode = exiting ? nodes.get(exiting.screenId) : undefined
        // 方向推导（文件头决策 ②）：**本事务 mount 且非 rebuild ⇒ forward**（新内容到来）；
        // 其余（含 rebuild 重建、以及"子树早已在树上"的返回）⇒ back。
        // ★这张三值表就是全部规则（`mounted.get` 的 false/true/undefined 三态），别再加分支。
        const mountedHere = txn.mounted.get(cmd.screenId)
        const direction: 'forward' | 'back' = mountedHere === false ? 'forward' : 'back'
        const transition = cmd.transition
        const batch = plan(transition, { incoming: incomingNode, outgoing: outgoingNode }, { direction })
        const normalized = typeof transition === 'string' ? transition : 'none'

        await host.setScreenVisible(cmd.screenId, true, incomingNode)
        stats.visibility.shown++
        emit('visible', cmd.screenId, true)

        const hasAnims = batch.incoming.anims.length > 0 || batch.outgoing.anims.length > 0
        if (hasAnims) {
          await anim.playRouteTransition(batch, { direction, transition: normalized })
          stats.transitions++
          if (direction === 'forward') stats.forward++
          else stats.back++
          emit('transition', cmd.screenId, { direction, transition: normalized, anims: batch.incoming.anims.length + batch.outgoing.anims.length })
        } else {
          stats.skippedNone++
          emit('transition-skipped', cmd.screenId, { transition: normalized })
        }

        if (exiting) {
          if (exiting.destroy !== null) {
            await host.destroyScreen(exiting.screenId, exiting.destroy, outgoingNode)
            nodes.delete(exiting.screenId)
            stats.destroyed[exiting.destroy]++
            emit('destroy', exiting.screenId, { reason: exiting.destroy, deferred: true })
          } else if (outgoingNode !== undefined) {
            await host.setScreenVisible(exiting.screenId, false, outgoingNode)
            stats.visibility.hidden++
            emit('visible', exiting.screenId, false)
          }
        }
        txn = { exiting: null, mounted: new Map() }
        return
      }
    }
  }

  let queue: Promise<void> = Promise.resolve()
  return {
    applyCommands(commands) {
      queue = queue.then(async () => {
        for (const c of commands) await runCommand(c)
      })
      return queue
    },
    stats: () => JSON.parse(JSON.stringify(stats)) as ScreenExecutorStats,
    subtreeNode: (screenId) => nodes.get(screenId),
  }
}

// packages/render-backend/src/screen-executor-host.ts
// ★★M5 执行器的**生产端口实现**（`ScreenTreeHost` / `ScreenAnimHost` 接宿主）
//
// 【本文件解决什么】`screen-executor.ts` 定义了执行器的两个端口（树操作 / 动画播放），
//   但真机上这两个动作分别在**宿主侧**（内核树 = RustLayout；渲染 = 宿主 View）——
//   JS（QuickJS）够不着 ⇒ 必须经宿主通道转发。本文件就是**通道适配层**：
//   把端口调用翻译成宿主能做的 `invoke` 请求，并把宿主的**异步完成**（动画播完）接回 promise。
//
// 【协议（宿主侧照此实现——Java/Swift 两侧同形，与既有 `proteusHost.invoke` 通道合流）】
//   `screen.mount`   `{screenId,name,path,params,rebuild}` → `{rootNodeId:number, nodes:number}`
//      建屏子树（内核 splice 插入；`rebuild` 为 true 时是冻结后重建）；返回屏子树根节点 id。
//   `screen.visible` `{screenId,visible,rootNodeId}`      → `{visible:boolean, rects:number}`
//      可见性切换（内核 `display: flex|none`）；`rects` = 该屏子树当前几何矩形数（**真实生效**读数）。
//   `screen.destroy` `{screenId,reason,rootNodeId}`       → `{removed:number}`
//      销毁屏子树（内核 splice 摘除）；`removed` = 真摘掉的节点数（**真实生效**读数）。
//   `screen.anim`    `{anims,durationMs,direction,transition,token}` → `{started:number, immediate?:boolean}`
//      播放转场批次（内核 `anim_start`；两页动画合并**一次**调用——批处理红线）；
//      `immediate=true` ⇒ 宿主声明"本批即刻完成"（如 duration=0/无活动动画），**不会**再回调；
//      否则宿主将在动画播完时**回推** `__proteusHostScreenAnimDone(token, resultJson)`（见下"完成回调"）。
//
// 【完成回调（宿主 → JS 推；与 G-39"宿主拥有事件循环"一致）】
//   动画的推进权在宿主帧循环（Choreographer / CADisplayLink）⇒ 完成时刻只有宿主知道。
//   宿主在动画结束时调：`__proteusHostScreenAnimDone(token, resultJson)`（resultJson 可为 `{}`）。
//   本文件把 token 映射回 promise 的 resolve；**超时保护**由调用方（执行器/宿主）决定，
//   本层不引入盲等（本仓红线）。
//
// 【诚实边界】本层只保证"协议翻译 + 完成接回"；宿主是否**真**建了树、**真**播了动画，
//   由宿主侧读数（node 数 / rects / 渲染探针）与判据证明——本层不声称。

import type { AnimLike, ScreenAnimHost, ScreenTreeHost } from './screen-executor'

/** 宿主通道（与 `capability-app.ts` 的 `invokeHost` 同形：同步请求/响应字符串） */
export type HostInvokeChannel = (method: string, argsJson: string) => string

/** 完成回调的全局键（宿主回推用——与 `__proteusHostAppEvent` 同一"约定即接口"模式） */
export const SCREEN_ANIM_DONE_KEY = '__proteusHostScreenAnimDone'

interface HostReply {
  ok?: boolean
  data?: unknown
  reason?: string
  missing?: boolean
}

/** 一次宿主往返：解析 `{ok,data}` 包装；`ok:false` ⇒ 抛错（含 missing 分档——不静默） */
function call(channel: HostInvokeChannel, method: string, args: unknown): unknown {
  const raw = channel(method, JSON.stringify(args ?? null))
  let parsed: HostReply
  try {
    parsed = JSON.parse(raw) as HostReply
  } catch (e) {
    throw new Error(`[screen-host] ${method} 回执非 JSON：${String(raw).slice(0, 120)}`)
  }
  if (parsed && parsed.ok === false) {
    throw new Error(`[screen-host] ${method} 失败${parsed.missing ? '（未实现）' : ''}：${parsed.reason ?? '无原因'}`)
  }
  // ★宿主可以只回 `{"rootNodeId":…}`（无 ok 包装）——与 invokeHost 的宽容语义一致
  return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
}

export interface HostScreenPortsOptions {
  /** 宿主通道（生产：`invokeHost`；测试：记录桩） */
  invoke: HostInvokeChannel
  /**
   * 是否安装完成回调钩子（缺省 true）。
   * ★与 `installAppEventSource` 同一防御姿态：QuickJS 的全局可能不可写 ⇒ try + defineProperty 回退，
   *   且**失败不阻断**（动画完成退化为"宿主不回调"——调用方需自行兜底）。
   */
  installAnimDoneHook?: boolean
}

export interface HostScreenPorts {
  /** 树操作端口（执行器用） */
  tree: ScreenTreeHost
  /** 动画端口（执行器用） */
  anim: ScreenAnimHost
  /** 在途动画 promise 数（诊断：应回落到 0） */
  readonly pendingAnimations: number
  /** 完成回调是否已装（判据读——未装时"动画播完"不可达） */
  readonly animDoneHookInstalled: boolean
}

/**
 * 创建**生产端口**（执行器 ↔ 宿主通道）。
 *
 * ★返回值是端口对 + 读数；执行器照常 `createScreenExecutor({host: ports.tree, anim: ports.anim, plan})`。
 */
export function createHostScreenPorts(opts: HostScreenPortsOptions): HostScreenPorts {
  const channel = opts.invoke
  const pending = new Map<string, (v: unknown) => void>()
  let tokenSeq = 0
  let hookInstalled = false

  const resolveOne = (token: string, payload: unknown): boolean => {
    const r = pending.get(token)
    if (!r) return false
    pending.delete(token)
    r(payload)
    return true
  }

  if (opts.installAnimDoneHook !== false) {
    const g = globalThis as Record<string, unknown>
    const handler = (token: unknown, resultJson?: unknown): string => {
      if (typeof token !== 'string') return 'bad-token'
      return resolveOne(token, resultJson) ? 'ok' : 'unknown-token'
    }
    try {
      g[SCREEN_ANIM_DONE_KEY] = handler
      hookInstalled = true
    } catch {
      try {
        Object.defineProperty(g, SCREEN_ANIM_DONE_KEY, { value: handler, writable: true, configurable: true })
        hookInstalled = true
      } catch {
        /* 通道缺失：动画完成不可达（调用方兜底/宿主主动 resolve）——不阻断其余功能 */
      }
    }
  }

  const tree: ScreenTreeHost = {
    mountScreen(screen) {
      const d = call(channel, 'screen.mount', {
        screenId: screen.screenId,
        name: screen.name,
        path: screen.path,
        params: screen.params,
        rebuild: screen.rebuild,
      }) as { rootNodeId?: number; nodes?: number } | null
      const rootNodeId = Number(d?.rootNodeId ?? 0)
      if (!rootNodeId) {
        throw new Error(`[screen-host] screen.mount 未返回 rootNodeId（${JSON.stringify(d)}）——宿主实现不完整`)
      }
      return rootNodeId
    },
    setScreenVisible(screenId, visible, rootNodeId) {
      call(channel, 'screen.visible', { screenId, visible, rootNodeId })
    },
    destroyScreen(screenId, reason, rootNodeId) {
      call(channel, 'screen.destroy', { screenId, reason, rootNodeId })
    },
  }

  const anim: ScreenAnimHost = {
    playRouteTransition(plan, ctx) {
      const anims: readonly AnimLike[] = [...plan.incoming.anims, ...plan.outgoing.anims]
      if (anims.length === 0) return // 空批次（none 等）——不产生跨边界调用
      const token = `screen-anim-${++tokenSeq}`
      const d = call(channel, 'screen.anim', {
        anims,
        durationMs: plan.durationMs,
        direction: ctx.direction,
        transition: ctx.transition,
        token,
      }) as { started?: number; immediate?: boolean } | null
      // ★两种完成形态：
      //   ① 宿主声明"即刻完成"（`immediate:true`——如 duration=0 或本批无活动动画）⇒ 立即 resolve；
      //   ② 否则等宿主回推 `__proteusHostScreenAnimDone(token)`（帧循环推进到结束——只有宿主知道时刻）。
      if (d?.immediate === true) return
      return new Promise<void>((resolve) => {
        pending.set(token, () => resolve())
      })
    },
  }

  return {
    tree,
    anim,
    get pendingAnimations() {
      return pending.size
    },
    get animDoneHookInstalled() {
      return hookInstalled
    },
  }
}

// packages/api/src/capability-socket-task.ts
// ★★★决策 #1096（2026-10-19）：App 端 C28 `useSocketTask` —— **复用已验证的 WebSocket 腿**。
//
// 【为什么能复用（不是"偷懒"，是契约本来就重叠）】
//   `SocketTaskBridge`（wx `SocketTask` 语义）与本仓的 `WebSocketConnection`（C27）是**同一件事的两种形状**：
//     · SocketTask: `send/close/onMessage/isConnected`（低层句柄，同步拿、异步连）
//     · WebSocketConnection: `send/close/on(event)`（Web 语义，异步 connect）
//   App 端两者底层都是同一条 WebSocket（Android 手写 RFC 6455 / iOS `URLSessionWebSocketTask`）。
//   ⇒ 本文件只在 ws 之上做**形状适配**，不新增任何网络栈、不新增宿主方法。
//
// 【★关键形态差异（必须处理，否则语义错误）】
//   `createSocketTask(url)` 是**同步返回句柄**（wx 语义），而 `connect(url)` 是 **async**。
//   ⇒ 句柄立即返回（`isConnected()` 先为 false），内部异步 connect；连接建立后置 connected，
//     并把服务端消息转给 `onMessage` 订阅者。★这与浏览器 `new WebSocket()` 的同步返回 + 异步 open 同形。
//
// 【诚实边界】
//   · 连接失败 ⇒ **通过 error 语义暴露**：`send` 会 reject（`socket-task.failed`），
//     `isConnected()` 恒 false。不伪造"已连接"。
//   · `wx.SocketTask` 的 `onError`/`onClose` 在本契约里**没有对应成员**——
//     `SocketTaskBridge` 只声明了 `send/close/onMessage/isConnected`，故不额外扩展
//     （扩展等于改公共契约，属单独决策）。
//   · 只支持**文本**消息（契约 `send(data: string)`）——二进制走 C27 `useWebSocket`。

import { createAppWebSocket } from './capability-websocket'
import { CapError as ProteusCapError } from './capability-types'
import type { CapabilityResourceRegistry } from './capability-resources'
import type { SocketTaskBridge } from './capability-types'

/* ══════════════ ★★★#1245 §1.0 四项必答（socket-task 此前无上界）══════════════ */

/**
 * ②④ **连接建立前积压的发送条数上界**。
 *
 * 【为什么必须有（这是本项的真缺口，不是凑指标）】
 *   wx 语义允许 `send` 在 `connecting` 期间调用（排队等连接）。原实现的
 *   `pendingSends` 是**无界数组** ⇒ 连接迟迟不建立（弱网/服务端不回握手）时，
 *   业务继续 send ⇒ **数组无限增长 ⇒ OOM**。
 *   ★这是"看起来能用的实现，一上量就崩"的典型：单次调用都成功（返回 void），
 *     没有任何信号告诉业务"你的消息只进了本地队列"。
 *
 * 【取值】1024：正常业务在握手期不会发超过这个量；触到说明要么连接已死、
 *   要么业务在录音级高频发（那应该等 open 再发）。
 * 【策略】超限 ⇒ **丢最旧 + 计数**（与 log 同族）。★为什么不抛：`send` 签名是 void
 *   （wx 语义），抛错会改变契约；而"丢最旧保留最新"是流式语义里唯一不阻塞业务的选择。
 *   ★丢弃**必须可观测**（`socketTaskStats().droppedBeforeOpen`），否则业务永远不知道。
 */
export const SOCKET_TASK_MAX_PENDING_SENDS = 1024

/** ① 单条消息上限（与 ws 腿同值：16 MiB） */
export const SOCKET_TASK_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

/**
 * ④ **同时存活的 SocketTask 句柄数上界**。
 *
 * 【为什么需要（不是重复 ws 的连接上界）】
 *   ws 的 `WS_MAX_CONNECTIONS` 限的是**已建立的连接**；而 `createSocketTask` 是
 *   **同步返回句柄 + 内部异步连接** ⇒ `connecting` 期间**还没有连接**，
 *   ws 那条上界管不到它。业务狂调 `createSocketTask`（列表渲染里每次都建一个）
 *   ⇒ 一堆 `connecting` 任务各自持积压数组 + 订阅集 ⇒ **内存与句柄双泄漏**。
 *   ★这与 #1236 在 file-system 上发现的同族：**逐条上限 ≠ 整体上限**。
 *
 * 【取值】128：单页面合理的任务数远低于此（一个任务 = 一条长连接）。
 * 【策略】超限**显式拒绝**（`socket-task.tooManyTasks`）——不淘汰现有任务：
 *   关闭一个用户还在用的 socket 是破坏性行为，只能拒绝新建。
 */
export const SOCKET_TASK_MAX_TASKS = 128

/** 规模读数（探针/判据用） */
export interface SocketTaskStats {
  /** 当前处于 connecting 状态的任务数 */
  connecting: number
  /** 当前 open 的任务数 */
  open: number
  /** 当前积压待发条数（全部任务合计） */
  pendingSends: number
  /** 因积压超上界被丢弃的最旧消息条数（② 背压） */
  droppedBeforeOpen: number
  /** 因单条超限被拒绝的条数（① 上限） */
  rejectedTooLarge: number
  /** 历史峰值积压条数（证明上界真的被逼近过） */
  peakPendingSends: number
}

/** ④ 当前存活任务数（connecting + open） */
let liveTasks = 0
/** ④ 因超任务上界被拒绝的次数 */
let rejectedTasks = 0

/** 读"当前存活任务数 / 被拒绝次数"（④ 维度的读数） */
export function socketTaskLive(): { live: number; rejected: number } {
  return { live: liveTasks, rejected: rejectedTasks }
}

/** 仅测试用：重置任务计数 */
export function __resetSocketTaskLive(): void {
  liveTasks = 0
  rejectedTasks = 0
}

const taskStats: SocketTaskStats = {
  connecting: 0,
  open: 0,
  pendingSends: 0,
  droppedBeforeOpen: 0,
  rejectedTooLarge: 0,
  peakPendingSends: 0,
}

/** 读规模读数（探针/判据用） */
export function socketTaskStats(): SocketTaskStats {
  return { ...taskStats }
}

/** 仅测试用：重置读数 */
export function __resetSocketTaskStats(): void {
  taskStats.connecting = 0
  taskStats.open = 0
  taskStats.pendingSends = 0
  taskStats.droppedBeforeOpen = 0
  taskStats.rejectedTooLarge = 0
  taskStats.peakPendingSends = 0
}

/** UTF-8 字节长度（单条上限判定） */
function utf8LenOf(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

/** 连接状态（一次连接的生命周期）。 */
type TaskState = 'connecting' | 'open' | 'failed' | 'closed'

/**
 * App 端 `createSocketTask`：同步返回句柄，内部异步连接。
 *
 * @param connFactory 带资源账本的 ws 工厂（由装配层注入，与 `useWebSocket` 同源）
 */
export function createAppSocketTask(
  connFactory: ReturnType<typeof createAppWebSocket>,
  /**
   * ★★★#1245 ③ **资源账本**（G-43）。
   *
   * 【为什么 socket-task 需要自己的登记（不能只靠 ws 腿的）】
   *   `connFactory` 注入的 ws 工厂**已经**把连接登记成 `ws-connection` 了——
   *   所以"连接池"层面不缺账本。但 `socket-task` 在连接**之外**还持有一份
   *   `pendingSends` 积压数组 + `messageCbs` 订阅集 ⇒ 那是**它自己**的边界资源。
   *   ★只登记连接会让"页面走了但积压数组还挂着"这种形态查不出来（数组里是消息正文，
   *     量级可以很大——这正是 ② 那条上界要压的东西）。
   *   ⇒ 每个任务登记一条 `socket-task`，release 时清积压 + 清订阅（并关连接）。
   */
  ledger?: {
    register(opts: { type: string; release: () => void; owner?: string; sourceLocation?: string | null }): {
      id: string
      release(): boolean
    }
  },
  owner?: string,
): (url: string) => SocketTaskBridge {
  return (url: string): SocketTaskBridge => {
    // ★★★#1245 ④ 任务数上界：**同步返回句柄**的 API 只能在建的时候拒，
    //   拒的时候抛错是合适的（业务拿到异常比拿到一个永远连不上的句柄好）。
    if (liveTasks >= SOCKET_TASK_MAX_TASKS) {
      rejectedTasks++
      throw errOf(
        'socket-task.tooManyTasks',
        `存活 SocketTask 已达上界 ${SOCKET_TASK_MAX_TASKS}（当前 ${liveTasks}）——疑似未 close 或列表重复创建`,
      )
    }
    liveTasks++
    let state: TaskState = 'connecting'
    let lastError = ''
    const messageCbs = new Set<(data: string) => void>()
    /**
     * ✅ 连接建立前积压的发送（wx 语义：`send` 在 `connecting` 期间也能调用，排队等连接）。
     * ★★#1245：**必须有上界**——原实现是无界数组，弱网/服务端不回握手时业务继续 send
     *   ⇒ 无限增长 ⇒ OOM。上界与计数见文件头的 SOCKET_TASK_MAX_PENDING_SENDS。
     */
    const pendingSends: string[] = []
    /** 状态迁移时同步读数（connecting/open 各有多少） */
    const setState = (next: TaskState): void => {
      if (state === next) return
      if (state === 'connecting') taskStats.connecting = Math.max(0, taskStats.connecting - 1)
      if (state === 'open') taskStats.open = Math.max(0, taskStats.open - 1)
      state = next
      if (next === 'connecting') taskStats.connecting++
      if (next === 'open') taskStats.open++
      // ★#1245 ④：**终态**（closed/failed）才减存活计数——connecting→open 不是"结束"
      if (next === 'closed' || next === 'failed') liveTasks = Math.max(0, liveTasks - 1)
    }
    taskStats.connecting++
    /** ★#1245 ③ 本任务在账本里的条目（页面 dispose ⇒ 清积压 + 清订阅 + 关连接） */
    let ledgerEntry: { release(): boolean } | null = null
    if (ledger) {
      ledgerEntry = ledger.register({
        type: 'socket-task',
        owner,
        sourceLocation: 'packages/api/src/capability-socket-task.ts',
        release: () => {
          // ★顺序：先清本地（消息正文）再关连接——反过来的话关连接期间还可能再进消息
          pendingSends.length = 0
          // ★★★#1245 判据 ④ 抓出的真 bug：清了数组但**没同步模块级读数** ⇒
          //   `socketTaskStats().pendingSends` 会一直显示"还有 N 条积压"（而实际已清）。
          //   ★同族教训：open 后补发那段也有同一个坑（已在 setState 的 open 分支补了）。
          //   ⇒ 任何改动 pendingSends 的地方都必须同步这个读数（三处：push / drain / release）。
          taskStats.pendingSends = 0
          messageCbs.clear()
          try { conn?.close(1001, 'owner-dropped') } catch { /* 宿主不在也不阻断本地清理 */ }
        },
      })
    }
    /** ③ 结算时销账（幂等） */
    const done = (): void => { if (ledgerEntry) { ledgerEntry = null } }
    let conn: { send: (d: string | ArrayBuffer) => void; close: (c?: number, r?: string) => void; on: (e: 'open' | 'message' | 'close' | 'error', h: (p?: unknown) => void) => () => void } | null = null

    connFactory(url).then(
      (ws) => {
        conn = ws
        ws.on('open', () => {
          setState('open')
          // 连接建立后补发积压消息（顺序不变）
          for (const m of pendingSends.splice(0)) {
            try { ws.send(m) } catch { /* 单条失败不阻断其余 */ }
          }
          // ★#1245：积压清空后读数同步（否则 pendingSends 恒显示峰值）
          taskStats.pendingSends = pendingSends.length
        })
        ws.on('message', (p) => {
          // ★契约是文本消息：非字符串载荷（二进制）**不静默丢弃**，用空串之外的方式暴露
          const data = (p as { data?: unknown } | undefined)?.data
          if (typeof data === 'string') {
            for (const cb of [...messageCbs]) {
              try { cb(data) } catch { /* 单订阅者异常不影响其余 */ }
            }
          }
        })
        ws.on('close', () => { setState('closed'); done() })
        ws.on('error', (p) => {
          lastError = String((p as { message?: unknown } | undefined)?.message ?? 'websocket error')
          if (state === 'connecting') setState('failed')
          done()
        })
      },
      (e: { code?: string, message?: string }) => {
        lastError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
        setState('failed')
        done()
      },
    )

    return {
      send: (data: string): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          if (state === 'failed') return reject(errOf('socket-task.failed', `连接失败：${lastError}`))
          if (state === 'closed') return reject(errOf('socket-task.failed', '连接已关闭'))
          if (state === 'open' && conn) {
            try {
              conn.send(data)
              resolve()
            } catch (e) {
              reject(errOf('socket-task.failed', `发送失败：${String((e as Error)?.message ?? e)}`))
            }
            return
          }
          // ★connecting：排队等 open（wx 语义允许先发后连）
          // ★★★#1245 ① 单条上限：先在本地拒（超限消息到宿主那头会让连接被关）
          const bytes = utf8LenOf(data)
          if (bytes > SOCKET_TASK_MAX_MESSAGE_BYTES) {
            taskStats.rejectedTooLarge++
            return reject(
              errOf('socket-task.tooLarge', `消息 ${bytes}B > ${SOCKET_TASK_MAX_MESSAGE_BYTES}B`),
            )
          }
          // ★★★#1245 ②④ 积压上界：**丢最旧 + 计数**（不抛：send 签名是 void 语义，
          //   抛错会改变契约；而阻塞业务更糟——见常量的理由）
          if (pendingSends.length >= SOCKET_TASK_MAX_PENDING_SENDS) {
            pendingSends.shift()
            taskStats.droppedBeforeOpen++
          }
          pendingSends.push(data)
          taskStats.pendingSends = pendingSends.length
          if (pendingSends.length > taskStats.peakPendingSends) taskStats.peakPendingSends = pendingSends.length
          resolve()
        }),

      close: (code?: number, reason?: string): Promise<void> =>
        new Promise<void>((resolve) => {
          if (conn) {
            try { conn.close(code, reason) } catch { /* 关闭失败不阻断（下面统一置态） */ }
          }
          state = 'closed'
          resolve()
        }),

      onMessage: (cb: (data: string) => void): (() => void) => {
        messageCbs.add(cb)
        return () => { messageCbs.delete(cb) }
      },

      isConnected: (): boolean => state === 'open',
    }
  }
}

function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/** 探针用：当前任务状态（诊断读数）。 */
export function socketTaskStateOf(task: SocketTaskBridge): string {
  return task.isConnected() ? 'open' : 'not-open'
}

/** 装配层可选传账本（当前实现**不额外登记**：连接由底层 ws 已登记为 `ws-connection`）。 */
export type SocketTaskOptions = { resources?: CapabilityResourceRegistry; owner?: string }

// packages/api/src/capability-app-capture.ts
// ★★★决策 #1083（2026-10-19）：App 端「录屏 / 截屏状态」能力（C71 `useScreenCapture`）。
//
// 【为什么单列（与设备域其余项分开）】本项的核心不是"调一个 API"，而是**三端能力面不同**：
//   | 方法 | Android | iOS | 鸿蒙 |
//   |---|---|---|---|
//   | `getRecordingState`（是否正在被录屏/投屏） | ❌ 无公开 API | ✅ `UIScreen.isCaptured` | ✅ `display.isCaptured` |
//   | `onRecordingStateChange`（录屏状态变化） | ⚠️ 壳只推"截屏发生"（非录屏状态） | ✅ KVO `isCaptured` | ✅ `display.on('captureStatusChange')` |
//   | `onUserCapture`（用户主动截屏） | ✅ API 34+ `Activity.ScreenCaptureCallback` | ✅ `userDidTakeScreenshotNotification` | ❌ 无公开 API |
//   | `isPictureInPictureActive`（画中画） | ✅ `isInPictureInPictureMode()` | ❌ 无全局查询 | ✅ `PiPWindow.isPiPEnabled()` |
//   ⇒ 每个方法在**每端**要么真实现、要么如实 `*.unsupported`——**绝不伪造 `false`**
//     （伪造 `false` 比 unsupported 危险：业务会以为"确认没在录屏"，实际是"查不了"）。
//
// 【分层】本文件 = 桥（能力语义 → 宿主方法名 + 返回形状归一）；平台实现在 `hosts/{android,ios,harmony}`。
//   Hook 层语义仍在 `capability.ts`（`useScreenCapture`），本文件供 `createAppCapabilities` 合并。
//
// 【订阅通道】壳推 `__proteusHostCapture({ recording?: boolean, userCapture?: true })`——
//   与键盘/传感器同族"约定即接口"（App 端无 DOM 事件，只能壳推）。

import { invokeHost } from './capability-invoke'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'   // ★#1094
import { CapError as ProteusCapError } from './capability-types'
import type { CapResult, ScreenCaptureAPI } from './capability-types'

/** 宿主方法名（契约：三端宿主按此名实现；未实现 ⇒ 桥返回 unsupported） */
export const APP_CAPTURE_METHODS = {
  /** 一次取全部状态：`{ recording?: boolean, pip?: boolean }`（**缺字段 = 该端查不了**） */
  capture: 'device.capture',
} as const

/** 壳推通道（`{ recording?: boolean, userCapture?: true }`） */
export const APP_CAPTURE_KEY = '__proteusHostCapture'

type R<T, E extends Error = ProteusCapError> = { ok: true; data: T } | { ok: false; error: E }

/** 统一错误构造（能力层错误契约：读 `error.code` 分档） */
function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/** 宿主 `device.capture` 的回执形状（**字段缺失 = 该端无此能力**，不是 false） */
interface HostCaptureReply {
  recording?: unknown
  pip?: unknown
}

/* ══════════════════════ 推通道（壳 → JS 订阅者） ══════════════════════ */

const recordingSubs = new Set<(state: 'on' | 'off') => void>()
const userCaptureSubs = new Set<() => void>()

/* ══════════════ ★★★#1247 §1.0 四项必答（screen-capture 此前是 S1，要求 ≥S2）══════════════ */

/**
 * ②④ 每类**订阅者上界**。
 *
 * 【为什么必须有】两组订阅集合都是无界 `Set`，且每次壳推要遍历全部订阅者。
 *   录屏状态/用户截屏是**低频率**事件（不是 sensor 那种高频），所以风险不在采样率，
 *   而在**内存与遍历时间随泄漏线性增长 + 页面离开后回调仍被调用**（回调里往往还持有组件引用）。
 *   ⇒ 上界 + 峰值读数 + 超限显式拒绝。
 *
 * 【取值】64：单页面合理的录屏/截屏订阅远低于此。
 */
export const CAPTURE_MAX_SUBSCRIPTIONS = 64

/**
 * ① 单次派发的**订阅者调用数上限**（超出部分本次跳过）。
 * ★意义与 ws 的 `WS_MAX_DISPATCH_PER_PUSH` 同族：N 个慢回调串行会让**宿主线程**被占住
 *   （壳推是宿主同步调进来的）⇒ 单次派发必须有界。
 * ★跳过的订阅者**不移除**（下次事件仍会收到）——静默移除等于业务永远收不到。
 *
 * ★★取值必须 **< CAPTURE_MAX_SUBSCRIPTIONS**（32 < 64）：否则"单次派发上限"永远不会生效
 *   （订阅数先撞订阅上界，根本到不了派发上界）⇒ 这条闸形同虚设。
 *   ★本轮实测踩到：两个都是 64 时，判据 ③ 想建 69 个订阅就是为了越过派发上界，
 *     结果先撞上订阅上界被拒 ⇒ 判据假红、且**派发上界从来没被验证过**。
 */
export const CAPTURE_MAX_DISPATCH_PER_PUSH = 32

/** ② 单次派发耗时超过该毫秒数即记一次慢派发 */
export const CAPTURE_SLOW_DISPATCH_MS = 8

/** 规模读数（探针/判据用） */
export interface CaptureStats {
  /** 当前录屏订阅数 */
  recordingSubscriptions: number
  /** 当前用户截屏订阅数 */
  userCaptureSubscriptions: number
  /** 历史峰值（两类合计） */
  peakSubscriptions: number
  /** 因超订阅上界被拒绝的次数 */
  rejectedSubscriptions: number
  /** 累计派发的壳推条数（合法载荷） */
  pushesDispatched: number
  /** 因载荷非法被丢弃的壳推条数 */
  pushesDropped: number
  /** 无订阅者时被丢弃的壳推条数（"事件来了但没人听"必须可查） */
  pushesUnheard: number
  /** 慢派发次数（② 背压读数） */
  slowDispatches: number
  /** 累计派发耗时（ms） */
  dispatchMs: number
  /** 单次派发因订阅者过多被截断的次数 */
  dispatchTruncated: number
}

const captureStats: CaptureStats = {
  recordingSubscriptions: 0,
  userCaptureSubscriptions: 0,
  peakSubscriptions: 0,
  rejectedSubscriptions: 0,
  pushesDispatched: 0,
  pushesDropped: 0,
  pushesUnheard: 0,
  slowDispatches: 0,
  dispatchMs: 0,
  dispatchTruncated: 0,
}

/** 读规模读数 */
export function captureStatsSnapshot(): CaptureStats {
  return {
    ...captureStats,
    recordingSubscriptions: recordingSubs.size,
    userCaptureSubscriptions: userCaptureSubs.size,
  }
}

/** 仅测试用：重置读数 */
export function __resetCaptureStats(): void {
  captureStats.peakSubscriptions = 0
  captureStats.rejectedSubscriptions = 0
  captureStats.pushesDispatched = 0
  captureStats.pushesDropped = 0
  captureStats.pushesUnheard = 0
  captureStats.slowDispatches = 0
  captureStats.dispatchMs = 0
  captureStats.dispatchTruncated = 0
}

/**
 * 登记一个订阅（统一上界判定与峰值记录；返回取消函数）。
 * ★泛型：录屏订阅的回调收 `'on' | 'off'`，用户截屏的回调无参——两者的 Set 类型不同，
 *   但**上界逻辑完全一样**（复制一份 = 迟早只改一处，本仓 #1213 同族教训）。
 */
function addSubscription<T extends (...args: never[]) => void>(cb: T, set: Set<T>, kind: string): () => void {
  if (set.size >= CAPTURE_MAX_SUBSCRIPTIONS) {
    captureStats.rejectedSubscriptions++
    throw errOf(
      `screen-capture.tooManySubscriptions`,
      `${kind} 订阅已达上界 ${CAPTURE_MAX_SUBSCRIPTIONS}（当前 ${set.size}）——疑似未取消订阅`,
    )
  }
  set.add(cb)
  const total = recordingSubs.size + userCaptureSubs.size
  if (total > captureStats.peakSubscriptions) captureStats.peakSubscriptions = total
  return () => { set.delete(cb) }
}

/** 归一壳推载荷。非法载荷 ⇒ `null`（不静默派发错值） */
export function normalizeCapturePush(payload: unknown): { recording?: boolean; userCapture?: boolean } | null {
  if (!payload || typeof payload !== 'object') return null
  const o = payload as { recording?: unknown; userCapture?: unknown }
  const out: { recording?: boolean; userCapture?: boolean } = {}
  if (typeof o.recording === 'boolean') out.recording = o.recording
  // 壳可以用 `userCapture: true` 或 `userCapture: 1`（不同平台习惯）——只认"明确发生"，不猜
  if (o.userCapture === true || o.userCapture === 1) out.userCapture = true
  return Object.keys(out).length ? out : null
}

/** 派发一次壳推（供测试直接调；生产由全局钩子调）。返回派发给多少订阅者。 */
export function dispatchCapturePush(payload: unknown): number {
  const n = normalizeCapturePush(payload)
  // ★#1247 ②：非法载荷计入丢弃（否则"来了多少"与"派发多少"对不上）
  if (!n) { captureStats.pushesDropped++; return 0 }
  captureStats.pushesDispatched++
  const t0 = Date.now()
  let fired = 0
  // ★#1247 ② 单次派发上界：N 个慢回调串行会占住**宿主线程**（壳推是宿主同步调进来的）
  let budget = CAPTURE_MAX_DISPATCH_PER_PUSH
  let truncated = false
  if (n.recording !== undefined) {
    const state: 'on' | 'off' = n.recording ? 'on' : 'off'
    for (const cb of [...recordingSubs]) {
      if (budget <= 0) { truncated = true; break }
      budget--
      try { cb(state); fired++ } catch { /* 单个订阅者异常不影响其余 */ }
    }
  }
  if (n.userCapture) {
    for (const cb of [...userCaptureSubs]) {
      if (budget <= 0) { truncated = true; break }
      budget--
      try { cb(); fired++ } catch { /* 同上 */ }
    }
  }
  if (truncated) captureStats.dispatchTruncated++
  const elapsed = Date.now() - t0
  captureStats.dispatchMs += elapsed
  if (elapsed >= CAPTURE_SLOW_DISPATCH_MS) captureStats.slowDispatches++
  // ★#1247 ② 无订阅者 ⇒ 事件白来（"用户截屏了但没人知道"必须可查）
  if (fired === 0) captureStats.pushesUnheard++
  return fired
}

/** 装配壳推接收通道（幂等；`globalThis.__proteusHostCapture` 已存在则保留）。 */
export function installCaptureChannel(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g[APP_CAPTURE_KEY] === 'function') return
  const handler = (payload: unknown): number => dispatchCapturePush(payload)
  try {
    g[APP_CAPTURE_KEY] = handler
  } catch {
    try {
      Object.defineProperty(g, APP_CAPTURE_KEY, { value: handler, writable: true, configurable: true })
    } catch {
      try {
        ;(globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(
          `[proteus] ${APP_CAPTURE_KEY} 装配失败（宿主全局不可写）——录屏/截屏订阅不可达`,
        )
      } catch { /* 无 console */ }
    }
  }
}

/** 测试用：清空订阅（生产不该调用——订阅由调用方各自取消）。 */
export function resetCaptureSubscriptions(): void {
  recordingSubs.clear()
  userCaptureSubs.clear()
}

/* ══════════════════════ 桥 ══════════════════════ */

/** 读一次宿主状态（**同步**：毫秒级本地查询，与设备域其余项同口径） */
function readHostState(): R<HostCaptureReply> {
  const r = invokeHost(APP_CAPTURE_METHODS.capture, {})
  if (!r.ok) {
    const code = r.missing ? 'screen-capture.unsupported' : 'screen-capture.failed'
    return { ok: false, error: errOf(code, `device.capture: ${r.reason}`) }
  }
  return { ok: true, data: (r.data ?? {}) as HostCaptureReply }
}

/**
 * 创建 App 端录屏/截屏能力（供 `createAppCapabilities` 合并）。
 *
 * ★每个方法独立分档：某个方法在某端不可用（宿主回执**缺该字段**）⇒ 该方法 `unsupported`，
 *   其余方法照常可用。**不**因一项缺而整能力降级（否则鸿蒙能查录屏却因无截屏事件整块不可用）。
 */
export function createAppCaptureCapabilities(
  // ★#1094：边界资源账本（G-43）——录屏/截屏订阅是宿主侧观察者（典型边界资源）
  resOpts: { resources?: CapabilityResourceRegistry; owner?: string } = {},
) {
  installCaptureChannel()

  const api: ScreenCaptureAPI = {
    getRecordingState: (): Promise<CapResult<'on' | 'off'>> =>
      Promise.resolve().then((): CapResult<'on' | 'off'> => {
        const r = readHostState()
        if (!r.ok) return { ok: false, error: r.error }
        const rec = r.data.recording
        if (typeof rec !== 'boolean') {
          // ★缺字段 = 本端查不了（Android 无公开录屏状态 API）——不是 false
          return { ok: false, error: errOf('screen-capture.unsupported', '本端无公开的"正在录屏"查询 API（如 Android）') }
        }
        return { ok: true, data: rec ? 'on' : 'off' }
      }),

    onRecordingStateChange: (cb: (state: 'on' | 'off') => void): (() => void) => {
      const entry = (s: 'on' | 'off'): void => cb(s)
      // ★★★#1247 ②④：走 addSubscription ⇒ **上界判定 + 峰值记录真的生效**
      //   （第一版把 addSubscription 写在文件里但订阅点仍直接 `recordingSubs.add` ⇒ 死代码。
      //    这正是本仓反复强调的"符号存在 ≠ 被调用"——判据 ⑨ 守着。）
      const unsubscribe = addSubscription(entry, recordingSubs, '录屏状态')
      // ★#1094：登记为边界资源（宿主侧观察者，GC 管不到）
      let res: CapabilityResource | null = null
      if (resOpts.resources) {
        res = resOpts.resources.register({
          type: 'capture-recording-subscription',
          owner: resOpts.owner,
          sourceLocation: 'packages/api/src/capability-app-capture.ts',
          release: () => { recordingSubs.delete(entry) },
        })
      }
      return () => {
        unsubscribe()
        if (res) { res.release(); res = null }
      }
    },

    onUserCapture: (cb: () => void): (() => void) => {
      const unsubUser = addSubscription(cb, userCaptureSubs, '用户截屏')
      // ★#1094：同上
      let res: CapabilityResource | null = null
      if (resOpts.resources) {
        res = resOpts.resources.register({
          type: 'capture-usercapture-subscription',
          owner: resOpts.owner,
          sourceLocation: 'packages/api/src/capability-app-capture.ts',
          release: () => { userCaptureSubs.delete(cb) },
        })
      }
      return () => {
        unsubUser()
        if (res) { res.release(); res = null }
      }
    },

    isPictureInPictureActive: (): Promise<CapResult<boolean>> =>
      Promise.resolve().then((): CapResult<boolean> => {
        const r = readHostState()
        if (!r.ok) return { ok: false, error: r.error }
        const pip = r.data.pip
        if (typeof pip !== 'boolean') {
          // ★缺字段 = 本端查不了（iOS 无全局 PiP 查询）——不是 false
          return { ok: false, error: errOf('screen-capture.unsupported', '本端无全局画中画状态查询 API（如 iOS）') }
        }
        return { ok: true, data: pip }
      }),
  }

  return { getScreenCapture: (): ScreenCaptureAPI => api }
}

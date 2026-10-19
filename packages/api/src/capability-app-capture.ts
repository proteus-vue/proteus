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
  if (!n) return 0
  let fired = 0
  if (n.recording !== undefined) {
    const state: 'on' | 'off' = n.recording ? 'on' : 'off'
    for (const cb of recordingSubs) {
      try { cb(state); fired++ } catch { /* 单个订阅者异常不影响其余 */ }
    }
  }
  if (n.userCapture) {
    for (const cb of userCaptureSubs) {
      try { cb(); fired++ } catch { /* 同上 */ }
    }
  }
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
      recordingSubs.add(entry)
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
        recordingSubs.delete(entry)
        if (res) { res.release(); res = null }
      }
    },

    onUserCapture: (cb: () => void): (() => void) => {
      userCaptureSubs.add(cb)
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
        userCaptureSubs.delete(cb)
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

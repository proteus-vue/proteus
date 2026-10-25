// packages/api/src/capability-app-device.ts
// ★★★App 三端「设备与系统」能力域（C6/C7/C8/C9/C10/C11/C12/C13/C14/C60/C81/C83）—— 2026-10-19
//
// 【它解决什么】App 端此前只有「应用与生命周期」10 项 + fetch；`createCapabilityBridge()` 里
//   设备域全部落到 `webBridge`（`navigator.*` / `window.screen`）——App 的 JS 引擎**没有这些全局**
//   （QuickJS/JSC/JSVM 都只给裸 ECMAScript + 宿主注入的 `proteusHost`）⇒ 每个设备能力都返回
//   `*.unsupported`，而实际平台 API 全都在（Vibrator/ConnectivityManager/UIPasteboard/…）。
//
// 【分层】本文件 = **桥（能力语义 → 宿主方法名 + 返回形状归一）**；平台实现（真 API）在
//   `hosts/{android,ios,harmony}`。语义唯一实现仍在 `capability.ts` 的 Hook 层。
//
// 【★三端差异（如实登记，不粉饰）】
//   · 鸿蒙是一次性 VM（#540）⇒ 读类能力由 ArkTS 采集的**设备快照**回答；动作类（震动/剪贴板写/
//     常亮/亮度写）由宿主排队在本次渲染后执行 ⇒ **结果不可回推**（受理即返回，不谎称已生效）。
//   · iOS 的「屏幕方向」取自 `UIDevice.orientation`（设备物理方向），Web 基准取的是**视口方向**；
//     两者在「设备锁定竖屏但 App 支持横屏」时会分叉 ⇒ 宿主侧优先用 window scene 的
//     `interfaceOrientation`，拿不到才回落设备方向（见 host-capabilities.swift）。
//
// 【诚实降级】宿主未实现 ⇒ `*.unsupported`（`invokeHost` 的 missing 分档）；**不伪造成功**。

import { invokeHost } from './capability-invoke'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'   // ★#1094
// ★`capErr` 直接产 **CapError 实例**（Hook 契约的 error 类型）；本文件构造器参数名 `CapError`
//   是**泛型构造器**（返回 E），不能当类型/不能保证是 CapError ⇒ 这里用库提供的 concrete 工厂。
// ★参数名 `CapError` 是**泛型构造器**（返回 E）会遮蔽同名导入 ⇒ 用别名导入 concrete 类。
import { CapError as ProteusCapError } from './capability-types'
// ★装配用的两组能力（生命周期 / 平台能力）——见文件底部 createAppCapabilities
import { createAppLifecycleCapabilities, createAppNativeCapabilities, getHostLifecycleBus } from './capability-app'
import { createAppFileStorage } from './capability-app-storage'   // ★#1207 App 端 KV 存储
import { appLogAvailable, createAppLog } from './capability-app-log'   // ★#1225 App 端日志通道
import { appFileSystemAvailable, createAppFileSystem } from './capability-app-filesystem'   // ★#1226 文件系统（基础面）
// ★★★决策 #1081：App 端元素查询（`useElement` 选择器通路）——解析器由装配层注入
import { createAppElementCapabilities } from './capability-app-element'
// ★★★决策 #1083：录屏/截屏状态（C71）——三端能力面不同，逐方法诚实分档
import { createAppCaptureCapabilities } from './capability-app-capture'
import { createAppWebSocket } from './capability-websocket'
import { createAppSocketTask } from './capability-socket-task'   // ★#1096
import { createAppTransfer } from './capability-transfer'   // ★#1095
import { createAppLocalService } from './capability-local-service'   // ★#1097   // ★#1093
import type {
  BatteryInfo,
  CapDeviceInfo,
  DeviceCapabilityAPI,
  KeyboardInfo,
  KeyboardLifecycle,
  MediaQueryCondition,
  MediaQueryObserver,
  MediaQueryResult,
  NetworkType,
  OrientationInfo,
  ScreenInfo,
  SensorKind,
  SensorSample,
} from './capability-types'

/** 宿主方法名（**契约**：三端宿主按这些名字实现；未实现 ⇒ 桥返回 unsupported） */
export const APP_DEVICE_METHODS = {
  vibrate: 'device.vibrate',
  network: 'device.network',
  clipboardRead: 'clipboard.read',
  clipboardWrite: 'clipboard.write',
  screen: 'device.screen',
  info: 'device.info',
  battery: 'device.battery',
  orientation: 'device.orientation',
  brightnessGet: 'device.brightness.get',
  brightnessSet: 'device.brightness.set',
  keepScreenOn: 'device.keepScreenOn',
  hevc: 'device.hevc',
  // ★★2026-10-19（决策 #1080）：C5 传感器（App 端传感器 API 全是订阅式 ⇒ read 走异步回推）
  sensorRead: 'device.sensor.read',
  sensorStart: 'device.sensor.start',
  sensorStop: 'device.sensor.stop',
} as const

/** 壳推键盘状态的全局键（`{ height, visible }`；与 `__proteusHostAppEvent` 同族"约定即接口"） */
export const APP_KEYBOARD_KEY = '__proteusHostKeyboard'
/** 壳推传感器采样的全局键（{ kind, x?, y?, z?, heading?, timestamp? }） */
export const APP_SENSOR_KEY = '__proteusHostSensor'

type R<T, E extends Error = Error> = { ok: true; data: T } | { ok: false; error: E }

/**
 * 创建 App 端「设备与系统」能力（供 `createCapabilityBridge` 合并）。
 *
 * ★为什么每个方法都走 `invokeHost`（同步）而不是 `invokeHostAsync`：这些是**毫秒级**的本地查询
 *   （无网络 IO），同步返回即可；让它们走异步腿只会把「无 setTimeout 的引擎」拖进 pending 表。
 *   动作类（震动/写剪贴板/常亮）同样同步——宿主受理即返回（鸿蒙的排队语义在此对齐）。
 */
export function createAppDeviceCapabilities<E extends Error = Error>(
  CapError: new (code: string, message: string, cause?: unknown) => E,
  // ★#1094：边界资源账本（G-43）。不传 ⇒ 行为与从前一致（渐进采用）。
  resOpts: { resources?: CapabilityResourceRegistry; owner?: string } = {},
) {
  /** 统一封装：未注册/未实现 ⇒ `unsupported`；真失败 ⇒ `failed`（与 `createAppNativeCapabilities` 同口径） */
  const call = <T,>(method: string, args: unknown, slug: string): R<T, E> => {
    const r = invokeHost(method, args)
    if (r.ok) return { ok: true as const, data: r.data as T }
    const code = r.missing ? `${slug}.unsupported` : `${slug}.failed`
    return { ok: false as const, error: errNow<T>(code, `${slug}: ${r.reason}`) }
  }

  /** 异步版（Hook 层要 `Promise<CapResult<T>>`；`call` 是同步的 ⇒ 这里保持 rejection 语义） */
  const callAsync = <T,>(method: string, args: unknown, slug: string): Promise<T> =>
    Promise.resolve().then(() => {
      const r = call<T>(method, args, slug)
      if (!r.ok) throw r.error
      return r.data
    })

  const errNow = <T, Er extends Error = E>(code: string, message: string): Er => {
    const err = new CapError(code, message) as unknown as Er & { code?: string }
    if (typeof (err as { code?: unknown }).code !== 'string') {
      Object.defineProperty(err, 'code', { value: code, enumerable: true, configurable: true })
    }
    return err
  }

  installKeyboardChannel()
  installSensorChannel()

  return {
    // ── C6 震动 ──
    vibrate: (durationMs: number) => callAsync<void>(APP_DEVICE_METHODS.vibrate, { durationMs }, 'vibrate'),

    // ── C8 网络 ──
    getNetwork: () => callAsync<NetworkType>(APP_DEVICE_METHODS.network, {}, 'network'),

    // ── C9 剪贴板 ──
    readClipboard: () =>
      callAsync<string>(APP_DEVICE_METHODS.clipboardRead, {}, 'clipboard.read').then((d) => {
        // 宿主回 `{ text }` 或裸字符串——两种都收（Android/iOS 的 JSON 包装 vs 鸿蒙快照）
        if (d && typeof d === 'object' && typeof (d as { text?: unknown }).text === 'string') return (d as { text: string }).text
        return typeof d === 'string' ? d : ''
      }),
    setClipboard: (text: string) => callAsync<void>(APP_DEVICE_METHODS.clipboardWrite, { text }, 'clipboard.write'),

    // ── C10 屏幕 ──
    getScreen: () => callAsync<ScreenInfo>(APP_DEVICE_METHODS.screen, {}, 'screen'),

    // ── C11 设备 ──
    getDevice: () => callAsync<CapDeviceInfo>(APP_DEVICE_METHODS.info, {}, 'device'),

    // ── C7 电量 ──
    getBattery: () => callAsync<BatteryInfo>(APP_DEVICE_METHODS.battery, {}, 'battery'),

    // ── C12 方向 ──
    getOrientation: () => callAsync<OrientationInfo>(APP_DEVICE_METHODS.orientation, {}, 'orientation'),

    // ── C13 亮度（0–1；写=系统亮度，宿主可能因权限/策略拒绝 ⇒ 由宿主如实报 failed） ──
    // ★宿主回 `{value}`（三端都这么答，便于诊断）⇒ 解包成 Hook 契约要的 number
    getBrightness: () =>
      callAsync<number | { value?: number }>(APP_DEVICE_METHODS.brightnessGet, {}, 'brightness').then((d) =>
        typeof d === 'number' ? d : Number((d as { value?: number })?.value ?? 0),
      ),
    setBrightness: (value: number) => callAsync<void>(APP_DEVICE_METHODS.brightnessSet, { value }, 'brightness'),

    // ── C83 屏幕常亮（幂等：开=取锁，关=释放） ──
    setKeepScreenOn: (on: boolean) => callAsync<void>(APP_DEVICE_METHODS.keepScreenOn, { on }, 'screen.keep-on'),

    // ── C14 键盘（壳推 `__proteusHostKeyboard({height,visible})` → 总线 → 订阅者） ──
    getKeyboard: (): KeyboardLifecycle => {
      // ★返回**快照对象**（与 wx/web 桥同语义：`info` 是取句柄时的读数，后续变化走 onChange）
      return {
        info: { ...keyboardState },
        onChange: (cb: (i: KeyboardInfo) => void): (() => void) => {
          keyboardSubs.add(cb)
          // ★#1094：订阅登记为边界资源（G-43.1）——`dispose()` 时即使业务忘了 off 也会退订。
          //   ★keyboardSubs 是**模块级全局**：不登记就只能靠订阅者自觉，页面卸载后回调永久留存（#1071 实测同族）。
          let res: CapabilityResource | null = null
          if (resOpts.resources) {
            res = resOpts.resources.register({
              type: 'keyboard-subscription',
              owner: resOpts.owner,
              sourceLocation: 'packages/api/src/capability-app-device.ts',
              release: () => { keyboardSubs.delete(cb) },
            })
          }
          // 立即推一次当前值（订阅者无需等下一次系统事件——与 wx 的语义一致）
          try {
            cb({ ...keyboardState })
          } catch {
            /* 订阅者抛错不影响其它订阅者 */
          }
          return () => {
            keyboardSubs.delete(cb)
            if (res) { res.release(); res = null }   // ★#1094 显式 off 时同步销账
          }
        },
      }
    },

    // ── C60 媒体查询（**纯 JS**：基于宿主屏幕读数 + 方向/尺寸事件求值，无需额外原生 API） ──
    createMediaQuery: (): MediaQueryObserver => createMediaQueryObserver(CapError),

    // ── C5 传感器（一次性读取 / 流订阅） ──
    //   ★App 端传感器 API **全是订阅式**（Android SensorEventListener / iOS CMMotionManager /
    //     鸿蒙 sensor.on）⇒ "读一次" = 订阅 → 等首个采样 → 取消订阅（宿主侧实现）。
    //   ★诚实边界：三端的采样单位/坐标系不同（Android m/s² 含重力、iOS 用 g 为单位、
    //     鸿蒙按 SensorId 各自定义）——本桥**原样透传**宿主读数，不做单位换算（不猜、不静默归一）。
    readSensor: (kind: SensorKind) =>
      callAsync<SensorSample>(APP_DEVICE_METHODS.sensorRead, { kind }, 'sensor'),
    startSensor: (kind: SensorKind) =>
      callAsync<void>(APP_DEVICE_METHODS.sensorStart, { kind }, 'sensor').then(() => undefined),
    stopSensor: (kind: SensorKind) =>
      callAsync<void>(APP_DEVICE_METHODS.sensorStop, { kind }, 'sensor').then(() => undefined),
    subscribeSensor: (kind: SensorKind, cb: (sample: SensorSample) => void): (() => void) => {
      const entry = { kind, cb }
      sensorSubs.add(entry)
      // ★#1094：同上——传感器流也登记（宿主侧在真采样，属于最典型的边界资源）
      let res: CapabilityResource | null = null
      if (resOpts.resources) {
        res = resOpts.resources.register({
          type: 'sensor-stream',
          owner: resOpts.owner,
          sourceLocation: 'packages/api/src/capability-app-device.ts',
          release: () => { sensorSubs.delete(entry) },
        })
      }
      return () => {
        sensorSubs.delete(entry)
        if (res) { res.release(); res = null }
      }
    },

    // ── C81 设备能力探测（HEVC 硬解） ──
    //   ★不用 callAsync 的泛型错误分支：Hook 契约的 error 类型是 **CapError**，而 callAsync 的
    //     rejection 类型是泛型 E（调用方注入的构造器）⇒ 显式构造 CapError，别让类型系统做类型收窄。
    getDeviceCapability: (): DeviceCapabilityAPI => ({
      supportsHevc: () =>
        Promise.resolve().then(() => {
          const r = call<boolean | { supported?: boolean }>(APP_DEVICE_METHODS.hevc, {}, 'device-capability')
          if (!r.ok) {
            return { ok: false as const, error: new ProteusCapError('device-capability.failed', (r.error as Error).message) }
          }
          const v = r.data
          return { ok: true as const, data: typeof v === 'boolean' ? v : !!(v as { supported?: boolean })?.supported }
        }),
    }),
  }
}

/**
 * ★★★App 端能力的**统一装配**（生命周期 + 平台能力 + 设备域）——供 `createCapabilityBridge` 一处调用。
 *
 * 【为什么收在这里（而不是 capability.ts 逐个展开）】`capability.ts` 是存量大文件（反巨型化基线
 *   1097 行，**只减不增**）；加一次装配就 +5 行即被 `check:file-size` 判红。把"App 三组能力怎么拼"
 *   收进本文件（App 能力的归口处）既符合职责划分，也让 capability.ts 反向减少行数。
 */
export function createAppCapabilities<E extends Error = Error>(
  CapError: new (code: string, message: string, cause?: unknown) => E,
  // ★#1094：边界资源账本（G-43）——透传给设备域/WebSocket（键盘订阅、传感器流、连接都是边界资源）
  resOpts: { resources?: CapabilityResourceRegistry; owner?: string } = {},
) {
  const appWs = createAppWebSocket(resOpts)   // ★#1093/#1096 共用一条 ws 腿
  /**
   * ★★★#1207：App 端 KV 存储。**一次创建、全进程复用**（内部持有整份文档缓存，
   *   重复创建会导致两份缓存互相覆盖）。
   * ★`undefined` ⇒ 宿主不支持 `fs.*`（鸿蒙现状）⇒ **不提供该桥方法**
   *   ⇒ `useStorage` 抛 `storage.unsupported`（如实不可用）。
   *   **绝不用内存兜底冒充持久化**——那会让业务以为存住了、重启即丢。
   */
  const appKv = createAppFileStorage()
  const appLog = createAppLog()
  const appFs = createAppFileSystem(resOpts)   // ★#1236 透传账本 ⇒ 在飞配额池能在页面 dispose 时作废（不传则用进程默认池，无账本）
  return {
    ...createAppLifecycleCapabilities(getHostLifecycleBus(), CapError),
    ...createAppNativeCapabilities(CapError),
    ...createAppDeviceCapabilities(CapError, resOpts),
    ...appKv,   // ★#1207 KV 存储（宿主缺 fs.* 时是空对象 ⇒ 不提供 getStorage）
    ...(appLogAvailable() ? appLog : {}),   // ★#1225 日志（宿主缺 log 时**不提供** ⇒ useLog 如实 unsupported）
    ...(appFileSystemAvailable() ? appFs : {}),   // ★#1226 文件系统基础面（其余 22 个方法具名 unsupported）
    ...createAppElementCapabilities(CapError),   // ★#1081 元素查询（createElementQuery/createIntersection）
    ...createAppCaptureCapabilities(resOpts),   // ★#1083 录屏/截屏状态（getScreenCapture）
    connectWebSocket: appWs,   // ★#1093 App 端 WebSocket（ws.open/send/close + 壳推事件流）
    createSocketTask: createAppSocketTask(appWs),   // ★#1096 C28 低层句柄（复用同一 ws 腿）
    ...createAppTransfer(resOpts),   // ★#1095 App 端 upload/download（复用 http.request 字节腿 + 宿主 fs）
    getLocalService: createAppLocalService(resOpts),   // ★#1097 C78 mDNS（NsdManager / NWBrowser）
  }
}

/* ══════════════════════ 键盘通道（壳推 → 订阅者） ══════════════════════ */

const keyboardSubs = new Set<(i: KeyboardInfo) => void>()
let keyboardState: KeyboardInfo = { height: 0, visible: false }
let keyboardInstalled = false

/** 归一壳推载荷：`{height}` / `{height,visible}` / 裸数字都接受（三端壳字段习惯不同） */
function normalizeKeyboard(payload: unknown): KeyboardInfo {
  if (typeof payload === 'number') return { height: Math.max(0, payload), visible: payload > 0 }
  if (payload && typeof payload === 'object') {
    const h = Number((payload as { height?: unknown }).height ?? 0)
    const v = (payload as { visible?: unknown }).visible
    const height = Number.isFinite(h) ? Math.max(0, h) : 0
    return { height, visible: typeof v === 'boolean' ? v : height > 0 }
  }
  return { height: 0, visible: false }
}

/**
 * 安装 `__proteusHostKeyboard`（幂等）。
 * ★与 `installAppEventSource` 同一防御姿态：QuickJS 的全局可能不可写 ⇒ try + defineProperty 回退，
 *   失败**不阻断** bundle（通道缺失会有可观测后果：键盘高度恒 0）。
 */
function installKeyboardChannel(): void {
  const existing = (globalThis as Record<string, unknown>)[APP_KEYBOARD_KEY]
  // ★已有我们的处理器 ⇒ 幂等返回；缺失/非函数（被清掉、壳重装、测试隔离）⇒ 重新安装。
  //   只判一个布尔会导致「全局一旦被清就永久不可达」——而这条通道的失效是静默的（键盘高度恒 0）。
  if (keyboardInstalled && typeof existing === 'function') return
  keyboardInstalled = true
  const handler = (payload: unknown): string => {
    keyboardState = normalizeKeyboard(payload)
    for (const cb of [...keyboardSubs]) {
      try {
        cb({ ...keyboardState })
      } catch {
        /* 单个订阅者抛错不影响其它订阅者 */
      }
    }
    return 'ok'
  }
  const g = globalThis as Record<string, unknown>
  try {
    g[APP_KEYBOARD_KEY] = handler
  } catch {
    try {
      Object.defineProperty(g, APP_KEYBOARD_KEY, { value: handler, writable: true, configurable: true })
    } catch {
      try {
        ;(globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(
          `[proteus] ${APP_KEYBOARD_KEY} 装配失败（宿主全局不可写）——键盘高度将恒为 0`,
        )
      } catch {
        /* 无 console */
      }
    }
  }
}

/* ══════════════════════ 媒体查询（纯 JS 求值） ══════════════════════ */

/**
 * App 端媒体查询：用宿主屏幕读数（`device.screen`）求值，订阅窗口尺寸/方向变化重算。
 *
 * 【为什么不用 Web 的 matchMedia】App 引擎没有它；而媒体查询的判定输入只有**视口尺寸 + 方向**，
 *   两者宿主都能给 ⇒ 在 JS 侧做纯函数求值即可（无需为每个条件开原生订阅）。
 * 【诚实边界】只支持 `MediaQueryCondition` 声明的字段（minWidth/maxWidth/minHeight/maxHeight/orientation）；
 *   未声明的字段不参与判定（Web 语义：未给的字段 = 恒真）。
 */
function createMediaQueryObserver<E extends Error>(
  CapError: new (code: string, message: string, cause?: unknown) => E,
): MediaQueryObserver {
  interface Sub {
    condition: MediaQueryCondition
    cb: (r: MediaQueryResult) => void
    last: boolean | null
  }
  const subs = new Set<Sub>()
  let timer: ReturnType<typeof setInterval> | null = null
  let installed = false

  const readViewport = (): { width: number; height: number; orientation: 'portrait' | 'landscape' } => {
    const r = invokeHost(APP_DEVICE_METHODS.screen)
    if (r.ok && r.data && typeof r.data === 'object') {
      const d = r.data as { width?: unknown; height?: unknown; orientation?: unknown }
      const width = Number(d.width ?? 0)
      const height = Number(d.height ?? 0)
      const orientation = d.orientation === 'landscape' || d.orientation === 'portrait' ? d.orientation : width > height ? 'landscape' : 'portrait'
      return { width, height, orientation }
    }
    return { width: 0, height: 0, orientation: 'portrait' }
  }

  const matches = (c: MediaQueryCondition, v: { width: number; height: number; orientation: string }): boolean => {
    if (typeof c.minWidth === 'number' && !(v.width >= c.minWidth)) return false
    if (typeof c.maxWidth === 'number' && !(v.width <= c.maxWidth)) return false
    if (typeof c.minHeight === 'number' && !(v.height >= c.minHeight)) return false
    if (typeof c.maxHeight === 'number' && !(v.height <= c.maxHeight)) return false
    if (c.orientation && c.orientation !== v.orientation) return false
    return true
  }

  const tick = (): void => {
    if (subs.size === 0) return
    const v = readViewport()
    for (const s of subs) {
      const now = matches(s.condition, v)
      if (s.last !== now) {
        s.last = now
        try {
          s.cb({ matches: now })
        } catch {
          /* 订阅者抛错不影响其它订阅者 */
        }
      }
    }
  }

  const start = (): void => {
    if (installed || typeof setInterval !== 'function') return
    installed = true
    // ★不引 setTimeout 依赖：用引擎可用的最小轮询语义（250ms）；无定时器的引擎 ⇒ 只在 observe 时求值一次
    timer = setInterval(tick, 250)
  }

  return {
    observe: (condition: MediaQueryCondition, cb: (r: MediaQueryResult) => void): void => {
      const v = readViewport()
      const now = matches(condition, v)
      const sub: Sub = { condition, cb, last: now }
      subs.add(sub)
      start()
      // Web 语义：observe 后**立即**回调一次当前匹配态
      try {
        cb({ matches: now })
      } catch {
        /* 同上 */
      }
    },
    disconnect: (): void => {
      subs.clear()
      if (timer !== null) {
        const ct = (globalThis as { clearInterval?: (id: unknown) => void }).clearInterval
        if (typeof ct === 'function') ct(timer)
        timer = null
        installed = false
      }
    },
  }
}

/* ══════════════════════ 传感器通道（壳推 → 订阅者） ══════════════════════ */

/** 传感器订阅者（按 kind 分组：同一个采样只分发给对应 kind 的订阅者） */
const sensorSubs = new Set<{ kind: SensorKind; cb: (s: SensorSample) => void }>()
let sensorInstalled = false

/** 归一壳推载荷（容忍缺字段：三端读数形状不同，只保证 kind + 存在的分量） */
function normalizeSensor(payload: unknown): SensorSample | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const kind = p.kind
  if (kind !== 'accelerometer' && kind !== 'compass' && kind !== 'gyroscope') return null
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    kind,
    x: num(p.x),
    y: num(p.y),
    z: num(p.z),
    heading: num(p.heading),
    timestamp: num(p.timestamp),
  }
}

/**
 * 安装 `__proteusHostSensor`（幂等）。
 * ★与键盘通道同一防御姿态：全局可能不可写 ⇒ try + defineProperty 回退，失败不阻断 bundle。
 */
function installSensorChannel(): void {
  const existing = (globalThis as Record<string, unknown>)[APP_SENSOR_KEY]
  if (sensorInstalled && typeof existing === 'function') return
  sensorInstalled = true
  const handler = (payload: unknown): string => {
    const sample = normalizeSensor(payload)
    if (!sample) return 'bad-payload'
    for (const s of [...sensorSubs]) {
      if (s.kind !== sample.kind) continue
      try {
        s.cb(sample)
      } catch {
        /* 单个订阅者抛错不影响其它订阅者 */
      }
    }
    return 'ok'
  }
  const g = globalThis as Record<string, unknown>
  try {
    g[APP_SENSOR_KEY] = handler
  } catch {
    try {
      Object.defineProperty(g, APP_SENSOR_KEY, { value: handler, writable: true, configurable: true })
    } catch {
      try {
        ;(globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(
          `[proteus] ${APP_SENSOR_KEY} 装配失败（宿主全局不可写）——传感器流不可达`,
        )
      } catch {
        /* 无 console */
      }
    }
  }
}

// ★★★模块加载即自装键盘接收通道（决策 #1074）。
//
// 【为什么必须在这里装（真机探针抓出的真缺陷）】此前 `installKeyboardChannel()` 只在
//   `createAppDeviceCapabilities()` 里调 ⇒ 只有走 `createCapabilityHooks()`（= 加载整个 9000 行
//   capability.ts）的路径才有接收器。而 **`host-runtime` 场景故意不 import capability.ts**
//   （体积 + IIFE 兼容）⇒ 那里的 `__proteusHostKeyboard` 恒为 `undefined` ⇒ **壳推了没人收**。
//   真机探针实测：`typeof __proteusHostKeyboard === 'undefined'`。
//
// 【纪律同 `capability-app.ts::installAppEventSource`】**装配跟着定义走**：
//   谁 import 本模块，接收通道就装好——不依赖"另一个模块恰巧被加载"。
//   ★零成本：本函数只写一个全局函数（幂等），不构造桥、不读平台全局。
//   ★外层 try 兜底：装配失败绝不能中断 bundle 加载（与 app 事件源同款双保险）。
try {
  installKeyboardChannel()
  installSensorChannel()
} catch {
  /* 装线失败不影响其余功能（通道缺失会有可观测后果：键盘高度恒 0） */
}

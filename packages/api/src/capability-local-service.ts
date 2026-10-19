// packages/api/src/capability-local-service.ts
// ★★★决策 #1097（2026-10-19）：C78 局域网服务发现（mDNS）—— **微信侧补启停开关 + App 两端新实现**。
//
// 【★先说一个契约缺陷（与 #1091 的 useBeacon 完全同族）】
//   原 `LocalServiceAPI` **只有四个订阅**（onFound / onLost / onResolveFail / onDiscoveryStop），
//   没有启停开关。而微信的 mDNS 语义是：**必须先 `wx.startLocalServiceDiscovery({ serviceType })`**
//   才会回调 `onLocalServiceFound` —— 不搜索就订阅，业务**永远收不到任何服务**。
//   ⇒ 原契约对业务不可用（照文档写完，运行起来什么都没有）。
//   本轮补 `startDiscovery(serviceType)` / `stopDiscovery()`，并同步修 wx 桥实现。
//
// 【★为什么 App 两端能真做（不是"又一项假绿"）】
//   Android `NsdManager`（DNS-SD 发现）、iOS `NWBrowser`（Bonjour）都是**系统 API**，
//   无需第三方依赖、无需特殊权限（局域网发现本身不需要；只有 iOS 14+ 的本地网络权限提示）。
//   ⇒ 两端各写一个宿主实现，本文件只做**形状归一 + 订阅管理**。
//
// 【差异（如实登记）】
//   · wx 的 `serviceType` 是 `'_http._tcp'` 形态；Android `NsdManager` 用 `_http._tcp.`（末尾点），
//     iOS `NWBrowser` 用 `"_http._tcp"`（NWBrowser.Descriptor.bonjour 带尾点）。
//     ⇒ 本文件**不改写调用方传入的类型**，归一由各宿主自己做（避免在 JS 层猜平台）。
//   · `ip` 字段：wx 的 `onLocalServiceFound` 直接带 ip/port；NsdManager 与 NWBrowser 都需要
//     **二次解析**（resolve）才拿得到地址 ⇒ App 端宿主内部完成解析后再回推，业务侧无差异。
//
// 【诚实边界】
//   · 服务**类型必须由调用方给**（不做"扫全部"——mDNS 全扫代价大且多数平台不允许）。
//   · App 端只回**已解析成功**的服务（解析失败经 `onResolveFail`）；`ip` 缺失时如实省略字段
//     （不填假地址）。

import { invokeHost } from './capability-invoke'
import { CapError as ProteusCapError } from './capability-types'
import type { CapResult, LocalServiceAPI, LocalServiceInfo } from './capability-types'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'

/** 宿主方法名（App 两端按此实现） */
export const APP_LOCAL_SERVICE_METHODS = {
  /** 开始搜索：`{ serviceType }` → `{}`（受理即返，服务经壳推到达） */
  start: 'localService.start',
  /** 停止搜索：`{}` → `{}` */
  stop: 'localService.stop',
} as const

/** 壳推通道（`{ event:'found'|'lost'|'resolveFail'|'stop', service: {...} }`） */
export const APP_LOCAL_SERVICE_PUSH_KEY = '__proteusHostLocalService'

type EventName = 'found' | 'lost' | 'resolveFail' | 'stop'

/** 订阅表（模块级：壳推是全局通道，按事件分发） */
const subs = new Map<EventName, Set<(payload?: unknown) => void>>()

/** 归一条壳推载荷（三端字段习惯不同，但 `service` 结构统一）。 */
function normalizePush(payload: unknown): { event: EventName; service?: LocalServiceInfo } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const event = String(p.event ?? '')
  if (event !== 'found' && event !== 'lost' && event !== 'resolveFail' && event !== 'stop') return null
  if (event === 'stop') return { event }
  const s = p.service
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  if (typeof o.serviceName !== 'string' || typeof o.serviceType !== 'string') return null
  const info: LocalServiceInfo = {
    serviceName: o.serviceName,
    serviceType: o.serviceType,
    ...(typeof o.ip === 'string' ? { ip: o.ip } : {}),
    ...(typeof o.port === 'number' ? { port: o.port } : {}),
  }
  return { event, service: info }
}

/**
 * 派发一次壳推（供测试直接调；生产由全局钩子调）。
 * @returns 命中的订阅数（0 = 无主）
 */
export function dispatchLocalServicePush(payload: unknown): number {
  const n = normalizePush(payload)
  if (!n) return 0
  const set = subs.get(n.event)
  if (!set) return 0
  for (const cb of [...set]) {
    try {
      cb(n.event === 'stop' ? undefined : n.service)
    } catch {
      /* 单订阅者异常不影响其余 */
    }
  }
  return set.size
}

/** 装配壳推接收通道（幂等）。 */
export function installLocalServiceChannel(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g[APP_LOCAL_SERVICE_PUSH_KEY] === 'function') return
  try {
    g[APP_LOCAL_SERVICE_PUSH_KEY] = (p: unknown) => dispatchLocalServicePush(p)
  } catch {
    /* 冻结环境 ⇒ 保持 unsupported 语义，不抛 */
  }
}

/** 测试用：清空订阅。 */
export function resetLocalServiceSubscriptions(): void {
  subs.clear()
}

/** 订阅某事件（内部）。 */
function on(event: EventName, cb: (payload?: unknown) => void): () => void {
  let set = subs.get(event)
  if (!set) { set = new Set(); subs.set(event, set) }
  set.add(cb)
  return () => { set!.delete(cb) }
}

function errOf(code: string, message: string): ProteusCapError {
  const e = new ProteusCapError(code, message) as ProteusCapError & { code?: string }
  if (typeof (e as { code?: unknown }).code !== 'string') {
    Object.defineProperty(e, 'code', { value: code, enumerable: true, configurable: true })
  }
  return e
}

/**
 * App 端 `getLocalService`：启停走宿主方法，事件走壳推。
 *
 * @param resOpts 可选资源账本（搜索是边界资源——**页面离开时应停止搜索**）
 */
export function createAppLocalService(
  resOpts: { resources?: CapabilityResourceRegistry; owner?: string } = {},
): () => LocalServiceAPI {
  return (): LocalServiceAPI => {
    installLocalServiceChannel()
    let currentType: string | null = null
    let res: CapabilityResource | null = null

    const stopHost = (): Promise<void> => {
      const r = invokeHost(APP_LOCAL_SERVICE_METHODS.stop, {})
      currentType = null
      if (res) { res.release(); res = null }
      return r.ok ? Promise.resolve() : Promise.reject(errOf(r.missing ? 'local-service.unsupported' : 'local-service.failed', `localService.stop 失败：${r.reason}`))
    }

    return {
      startDiscovery: (serviceType: string): Promise<CapResult<void>> =>
        Promise.resolve().then((): CapResult<void> => {
          if (typeof serviceType !== 'string' || serviceType.length === 0) {
            return { ok: false, error: errOf('local-service.invalid-type', 'startDiscovery 需要 mDNS 服务类型（如 "_http._tcp"）') }
          }
          const r = invokeHost(APP_LOCAL_SERVICE_METHODS.start, { serviceType })
          if (!r.ok) {
            return {
              ok: false,
              error: errOf(
                r.missing ? 'local-service.unsupported' : 'local-service.failed',
                `localService.start 失败：${r.reason}`,
              ),
            }
          }
          currentType = serviceType
          // ★登记为边界资源：页面离开时停掉搜索（不停会一直占着系统的 mDNS 会话）
          if (resOpts.resources && !res) {
            res = resOpts.resources.register({
              type: 'mdns-discovery',
              owner: resOpts.owner,
              sourceLocation: 'packages/api/src/capability-local-service.ts',
              release: () => { void stopHost() },
            })
          }
          return { ok: true, data: undefined }
        }),

      stopDiscovery: async (): Promise<CapResult<void>> => {
        if (currentType === null) return { ok: true, data: undefined }   // 幂等：没在搜也算成功
        try {
          await stopHost()
          return { ok: true, data: undefined }
        } catch (e) {
          return { ok: false, error: e as ProteusCapError }
        }
      },

      onFound: (cb) => on('found', (p) => cb(p as LocalServiceInfo)),
      onLost: (cb) => on('lost', (p) => cb(p as LocalServiceInfo)),
      onResolveFail: (cb) => on('resolveFail', (p) => cb(p as LocalServiceInfo)),
      onDiscoveryStop: (cb) => on('stop', () => cb()),
    }
  }
}

/** 探针读数：当前订阅数（诊断）。 */
export function localServiceSubCount(): number {
  let n = 0
  for (const set of subs.values()) n += set.size
  return n
}


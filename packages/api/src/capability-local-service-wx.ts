// packages/api/src/capability-local-service-wx.ts
// ★★★决策 #1097（2026-10-19）：微信端 mDNS 桥（C78 `useLocalService`）**启停 + 四订阅**。
//
// 【为什么单列】`capability-bridges.ts` 是 4031 行的存量棘轮（只减不增）；
//   本轮补 start/stop 会 +12 行 ⇒ 越界。与 `capability-beacon.ts` 同款处置。
//
// 【为什么必须有 start/stop（本轮修的真缺陷）】
//   `wx.onLocalServiceFound` **只在调过 `wx.startLocalServiceDiscovery({ serviceType })` 后才回调**。
//   原契约只有四个订阅 ⇒ 业务照文档写完，运行起来**收不到任何服务**。
//   ★与 #1091 的 `useBeacon` 是**同一族缺陷**（订阅存在但没有启停开关）；
//     两者都是"订阅看起来正常、事件永不发生"。

import { capErr, capOk } from './capability-types'
import type { CapResult, LocalServiceAPI, WxLike } from './capability-types'

/**
 * 微信端 mDNS 桥。
 *
 * @param wx 微信全局（测试可注入假对象）
 */
export function createWxLocalService(wx: WxLike): LocalServiceAPI {
  return {
    startDiscovery: (serviceType: string): Promise<CapResult<void>> =>
      new Promise((resolve) => {
        if (typeof wx.startLocalServiceDiscovery !== 'function') {
          return resolve(capErr('local-service.unsupported', 'wx.startLocalServiceDiscovery 缺失（基础库不支持或非小程序环境）'))
        }
        if (typeof serviceType !== 'string' || serviceType.length === 0) {
          return resolve(capErr('local-service.invalid-type', 'startDiscovery 需要 mDNS 服务类型（如 "_http._tcp"）'))
        }
        wx.startLocalServiceDiscovery!({
          serviceType,
          success: () => resolve(capOk(undefined)),
          fail: (e: unknown) => resolve(capErr('local-service.failed', '开始搜索局域网服务失败', e)),
        })
      }),

    stopDiscovery: (): Promise<CapResult<void>> =>
      new Promise((resolve) => {
        if (typeof wx.stopLocalServiceDiscovery !== 'function') {
          return resolve(capErr('local-service.unsupported', 'wx.stopLocalServiceDiscovery 缺失（基础库不支持或非小程序环境）'))
        }
        wx.stopLocalServiceDiscovery!({
          success: () => resolve(capOk(undefined)),
          fail: (e: unknown) => resolve(capErr('local-service.failed', '停止搜索局域网服务失败', e)),
        })
      }),

    onFound: (cb) => {
      if (typeof wx.onLocalServiceFound !== 'function') return () => {}
      wx.onLocalServiceFound(cb)
      return () => {
        if (typeof wx.offLocalServiceFound === 'function') wx.offLocalServiceFound()
      }
    },
    onLost: (cb) => {
      if (typeof wx.onLocalServiceLost !== 'function') return () => {}
      wx.onLocalServiceLost(cb)
      return () => {
        if (typeof wx.offLocalServiceLost === 'function') wx.offLocalServiceLost()
      }
    },
    onResolveFail: (cb) => {
      if (typeof wx.onLocalServiceResolveFail !== 'function') return () => {}
      wx.onLocalServiceResolveFail(cb)
      return () => {
        if (typeof wx.offLocalServiceResolveFail === 'function') wx.offLocalServiceResolveFail()
      }
    },
    onDiscoveryStop: (cb) => {
      if (typeof wx.onLocalServiceDiscoveryStop !== 'function') return () => {}
      wx.onLocalServiceDiscoveryStop(cb)
      return () => {
        if (typeof wx.offLocalServiceDiscoveryStop === 'function') wx.offLocalServiceDiscoveryStop()
      }
    },
  }
}

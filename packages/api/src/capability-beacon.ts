// packages/api/src/capability-beacon.ts
// ★★★决策 #1090（2026-10-19）：微信端 iBeacon 桥（C77 `useBeacon`）。
//
// 【为什么单列】本能力的**关键语义不在订阅，而在"必须先搜索"**：
//   `wx.onBeaconUpdate` 只有调过 `wx.startBeaconDiscovery({ uuids })` 之后才会回调；
//   不搜索就订阅 ⇒ 上层**永远收不到任何更新**（11004 / 静默）。原契约只暴露两个订阅，
//   等于给业务一个"照文档写完什么都不会发生"的接口。
//   ⇒ 契约补 `startBeaconDiscovery` / `stopBeaconDiscovery`，本文件承载桥实现。
//
// 【分层】本文件 = 桥（能力语义 → wx API + Result 归一）；Hook 语义在 `capability.ts`。
//   ★单列而非内联进 `capability-bridges.ts`：后者是 4000+ 行存量棘轮（只减不增）。
//
// 【端边界（如实，不粉饰）】
//   · 微信：真实现（三个 API 齐备时可用；缺任一 ⇒ `beacon.unsupported`）
//   · Web：无 iBeacon 扫描标准（Web Bluetooth 需用户手势且不自带信标帧解析）⇒ 桥不提供
//   · App 三端：宿主未实现 BLE 扫描 ⇒ 桥不提供
//   ⇒ 只有微信列 ✅，其余端如实降级（见能力页兼容表）。

import { capErr, capOk } from './capability-types'
import type { CapResult, WxLike } from './capability-types'

/** iBeacon 设备信息（wx `BeaconInfo`） */
export interface BeaconInfo {
  /** 设备 uuid */
  uuid: string
  /** major 值 */
  major: number
  /** minor 值 */
  minor: number
  /** 距离（米） */
  accuracy: number
  /** 信号强度 */
  rssi: number
  /** 距离档位（0 未知 / 1 极近 / 2 近 / 3 远） */
  proximity: 0 | 1 | 2 | 3
}

/**
 * iBeacon（`useBeacon()`）。
 *
 * ★★**关键语义：必须先 `startBeaconDiscovery` 才会收到 `onUpdate`** ——
 *   微信端不搜索就订阅，上层永远收不到任何更新（错误码 11004）。
 *   这是本能力最容易被漏掉的一步，也是原契约（只有两个订阅）对业务不可用的原因。
 *
 * 端边界：只有微信提供；Web 无 iBeacon 扫描标准、App 三端宿主未实现 BLE 扫描 ⇒ Hook 返回 `beacon.unsupported`。
 */
export interface BeaconAPI {
  /**
   * 开始搜索 iBeacon。
   *
   * ★**必须先调用它才会收到 `onUpdate`**——订阅本身不会启动搜索。
   * @param uuids 要搜索的 iBeacon UUID 列表（**至少一个**；传全 0 UUID 表示匹配所有信标）
   * @returns 成功 = 搜索已开始（真正发现设备仍靠 `onUpdate`）
   */
  startBeaconDiscovery(uuids: string[]): Promise<CapResult<void>>
  /**
   * 停止搜索。停止后不再收到 `onUpdate`（订阅仍保留，下次 start 后继续回调）。
   * @returns 成功 = 搜索已停止
   */
  stopBeaconDiscovery(): Promise<CapResult<void>>
  /**
   * 订阅 Beacon 服务状态变化（蓝牙开关 / 搜索开始与结束）。
   * @param cb 状态回调（available 服务可用 / discovering 搜索中）
   * @returns 取消订阅函数
   */
  onServiceChange(cb: (res: { available: boolean; discovering: boolean }) => void): () => void
  /**
   * 订阅 Beacon 设备更新（**需先 `startBeaconDiscovery`**）。
   * @param cb 设备回调（beacons 发现的设备列表）
   * @returns 取消订阅函数
   */
  onUpdate(cb: (res: { beacons: BeaconInfo[] }) => void): () => void
}

/**
 * 微信 iBeacon 桥。
 *
 * @param wx 微信全局（测试可注入假对象）
 * @returns `BeaconAPI`：两个搜索开关 + 两个订阅
 *
 * ★搜索开关返回 `Promise<CapResult<void>>`（可 await、可判 ok）；
 *   订阅返回取消函数（与 wx 的 `off*` 同形）。
 */
export function createWxBeacon(wx: WxLike): BeaconAPI {
  return {
    startBeaconDiscovery: (uuids) =>
      new Promise<CapResult<void>>((resolve) => {
        if (typeof wx.startBeaconDiscovery !== 'function') {
          return resolve(capErr('beacon.unsupported', 'wx.startBeaconDiscovery 缺失（基础库不支持或非小程序环境）'))
        }
        const list = Array.isArray(uuids) ? uuids.filter((u) => typeof u === 'string') : []
        // ★空列表不静默成功：微信要求至少一个 UUID（全 0 UUID = 匹配所有信标）
        if (!list.length) {
          return resolve(capErr('beacon.invalid-uuids', 'startBeaconDiscovery 需要至少一个 UUID（全 0 UUID = 匹配所有信标）'))
        }
        wx.startBeaconDiscovery!({
          uuids: list,
          success: () => resolve(capOk(undefined)),
          fail: (e: unknown) => resolve(capErr('beacon.failed', '开始搜索 iBeacon 失败（常见 11004 = 未授权定位/蓝牙）', e)),
        })
      }),
    stopBeaconDiscovery: () =>
      new Promise<CapResult<void>>((resolve) => {
        if (typeof wx.stopBeaconDiscovery !== 'function') {
          return resolve(capErr('beacon.unsupported', 'wx.stopBeaconDiscovery 缺失（基础库不支持或非小程序环境）'))
        }
        wx.stopBeaconDiscovery!({
          success: () => resolve(capOk(undefined)),
          fail: (e: unknown) => resolve(capErr('beacon.failed', '停止搜索 iBeacon 失败', e)),
        })
      }),
    onServiceChange: (cb) => {
      if (typeof wx.onBeaconServiceChange !== 'function') return () => {}
      wx.onBeaconServiceChange(cb)
      return () => {
        if (typeof wx.offBeaconServiceChange === 'function') wx.offBeaconServiceChange()
      }
    },
    onUpdate: (cb) => {
      if (typeof wx.onBeaconUpdate !== 'function') return () => {}
      wx.onBeaconUpdate(cb)
      return () => {
        if (typeof wx.offBeaconUpdate === 'function') wx.offBeaconUpdate()
      }
    },
  }
}

// packages/api/src/capability-app-permission.ts
// ★★★App 能力 C16：`getPermission` —— 权限状态查询（App 桥实现）。
//
// 【为什么需要】`usePermission` 要的 `bridge.getPermission(name)` 在 App 端一直没有宿主方法
//   ⇒ 恒抛 `permission.unsupported`（与 #1285 拨号、#1336 分享、#1384 文档预览同一形态：
//   **平台有权限模型、框架没接线**）。而权限查询是**一大批 C 类能力的前置**
//   （`getLocation` / 相机 / 录音 / 通知…都要先知道"现在能不能用"）。
//
// 【★★口径（已定，不在这里重新发明）】
//   ① **只查询，不申请**：`usePermission` 的契约是"读当前状态"，不是"弹授权框"。
//      真正的申请发生在业务**实际使用**该能力时（打开相机 / 请求定位）——那时系统自己弹。
//      本方法若擅自弹框，会让"只是想知道状态"的调用产生用户可见副作用。
//   ② **iOS 无通用查询 API**：每类权限各自一套框架（AVFoundation / CoreLocation / UNUserNotificationCenter）
//      ⇒ 宿主侧按 **scope 逐框架**查，不是"传一个字符串给系统"。
//   ③ **Android / 鸿蒙无法区分"从未询问"与"永久拒绝"**（`getPermissionFlags` 是 SystemApi；
//      鸿蒙 `checkAccessTokenSync` 只给 granted/denied）
//      ⇒ **未授予一律如实报 `denied`**，不猜 `prompt`。业务若想尝试申请，应直接调用对应能力 API。
//      ★这与 Web（`navigator.permissions` 三态齐全）**语义不等价**，能力页有具名说明。
//   ④ **未知 scope 直接报错**，不返回 `denied` 也不静默当 `prompt`——
//      把"框架不认识"伪装成"系统拒绝"会让业务永远查不出问题（本仓最忌的假信号）。
//
// 【★第一批支持的 scope（3 个，三端统一）】
//   `camera` / `microphone` / `geolocation`
//   —— 选它们的理由：三端都有**同步可查**的状态 API，且是拍照/录音/定位三个大类的共同前置。
//   `notifications` 暂不在首批：iOS 只有**异步** API（`getNotificationSettings(completionHandler:)`），
//   而宿主 `invoke` 契约是同步的 ⇒ 要单独设计（已在任务板登记为后续项）。
//   鸿蒙走「渲染前快照」形态（与设备域同款）⇒ 快照里只采这 3 项。
//
// 【★诚实边界】
//   · 返回的是**查询瞬间**的状态；用户在系统设置里改了权限，下次查询才反映（不缓存）。
//   · 不返回 `prompt`：见口径 ③（Android/鸿蒙做不到；为三端一致，iOS 的 `notDetermined`
//     也统一映射为 `denied`——★这是一个**刻意的信息损失**，宁可与两端一致，也不让业务
//     在 iOS 上拿到别处拿不到的三态后再去写分叉逻辑）。
//   · `permission` 字段回显**调用方传入的原始名字**（与 Web 侧一致），不是内部规范名。
import { invokeHost } from './capability-invoke'
import type { PermissionState } from './capability-types'

/** 首批支持的能力 scope（三端同一集；改这里必须同时改三端宿主映射表） */
export const APP_PERMISSION_SCOPES = ['camera', 'microphone', 'geolocation'] as const
export type AppPermissionScope = (typeof APP_PERMISSION_SCOPES)[number]

/**
 * 别名 → 规范 scope。
 * ★为什么收别名：`usePermission(name)` 在 Web 端用 `navigator.permissions` 的名字
 *   （`camera` / `microphone` / `geolocation`），小程序端习惯写 wx scope
 *   （`scope.camera` / `scope.record` / `scope.userLocation`）。
 *   业务代码常常三端共用一份 · 收别名可以让同一行代码在 App 端也成立。
 * ★别名只做**精确匹配**（不模糊、不猜测）——见口径 ④。
 */
export const APP_PERMISSION_ALIASES: Readonly<Record<string, AppPermissionScope>> = {
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'geolocation',
  // 小程序 scope 形态（同一行业务代码三端共用时不至于在 App 端断掉）
  'scope.camera': 'camera',
  'scope.record': 'microphone',
  'scope.userLocation': 'geolocation',
}

/** 把调用方传入的权限名归一成宿主认识的 scope；未知 ⇒ 抛错（口径 ④） */
export function normalizePermissionScope(name: unknown): AppPermissionScope {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`permission.invalid: 权限名必须是非空字符串（收到 ${JSON.stringify(name)}）`)
  }
  const key = name.trim()
  const hit = APP_PERMISSION_ALIASES[key]
  if (!hit) {
    throw new Error(
      `permission.invalid: App 端不认识的权限名「${key}」——首批支持 ${APP_PERMISSION_SCOPES.join(' / ')}` +
        `（也接受小程序 scope 写法 scope.camera / scope.record / scope.userLocation）`,
    )
  }
  return hit
}

/** 桥成员对象（★抽取器契约：顶层唯一 `return { 显式属性 }`） */
export interface AppPermissionBridge {
  getPermission?: (permission: string) => Promise<PermissionState>
}

/** 宿主是否提供权限查询（缺 `permission.check` ⇒ 不提供该方法 ⇒ usePermission 如实 unsupported） */
export function appPermissionAvailable(): boolean {
  const r = invokeHost('permission.check', { probe: true })
  // 与 capability-app-phone/share/log 同款写法（短路联合窄化）：missing ⇒ 宿主没有该方法
  return r.ok || !(!r.ok && r.missing)
}

/** 宿主回执里的 state 只接受这两个值（口径 ③：App 端不存在 prompt） */
const APP_PERMISSION_STATES = new Set(['granted', 'denied'])

export function createAppPermission(): AppPermissionBridge {
  return {
    getPermission: (permission: string) => {
      // ★归一/校验失败必须返回 rejected Promise（签名是 Promise，调用方按 await 写）
      let scope: AppPermissionScope
      try {
        scope = normalizePermissionScope(permission)
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)))
      }
      const r = invokeHost('permission.check', { scope })
      if (!r.ok) {
        const kind = r.missing ? 'permission.unsupported' : 'permission.failed'
        return Promise.reject(new Error(`${kind}: 宿主拒绝查询权限（${r.reason ?? '未知原因'}）`))
      }
      // ★严格校验宿主回执：拼错的 state（如 'grant'）不得被当成合法值透给业务
      const data = r.data as { scope?: unknown; state?: unknown } | undefined
      const state = data?.state
      if (typeof state !== 'string' || !APP_PERMISSION_STATES.has(state)) {
        return Promise.reject(
          new Error(`permission.failed: 宿主回执的 state 非法（${JSON.stringify(state)}）——应为 granted/denied`),
        )
      }
      // ★回显调用方原始名字（与 Web 一致）；内部规范 scope 已在上面用掉，不泄露给业务
      return Promise.resolve({ permission, state: state as PermissionState['state'] })
    },
  }
}

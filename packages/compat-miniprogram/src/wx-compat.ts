// packages/compat-miniprogram/src/wx-compat.ts
// ★G-31 B6（migration.md §1/§4 Step 1）：`createWxCompat` 运行时兼容桥
//   旧小程序代码（wx.* + 小程序组件标签）原样跑通（渐进迁移兜底）——wx 面委托 Proteus API
//   设计：compat 层是「兜底」不是「目标」：新代码用 useXxx/p-*（Layer 0），旧代码经本桥可运行
//   ★与 @proteus-vue/web 的 installWxApi（Web 模拟层）分层：installWxApi 是 Web 端 wx.* 模拟；
//     本桥是平台无关的 wx.* → Proteus API 委托（任何端可用；MP 端真实 wx 无需此桥）
import type { CapabilityHooks } from '@proteus-vue/api'
import type { PlatformAPI } from '@proteus-vue/api'

/** wx 兼容面（旧代码可用子集——委托 Proteus） */
export interface WxCompat {
  request(options: { url: string; method?: string; success?: (res: { statusCode: number; data: unknown }) => void; fail?: (err: unknown) => void }): void
  navigateTo(options: { url: string; success?: () => void }): void
  redirectTo(options: { url: string }): void
  navigateBack(options: { delta?: number }): void
  switchTab(options: { url: string }): void
  setStorageSync(key: string, value: unknown): void
  getStorageSync(key: string): unknown
  removeStorageSync(key: string): void
  clearStorageSync(): void
  showToast(options: { title: string; duration?: number }): void
  showModal(options: { title?: string; content?: string; success?: (res: { confirm: boolean }) => void }): void
  vibrateShort(): void
  getSystemInfoSync(): { platform: string; screenWidth: number; screenHeight: number }
}

/**
 * 创建 wx 兼容桥（平台无关——委托 Proteus PlatformAPI + CapabilityHooks）
 * 用法（迁移期入口）：globalThis.wx = createWxCompat(platform, cap)
 */
export function createWxCompat(platform: PlatformAPI, cap: CapabilityHooks): WxCompat {
  return {
    // request：回调式 → platform.request Promise 桥（async 成功后调 success）
    request(options) {
      void platform
        .request({ url: options.url, method: (options.method as never) ?? 'GET' })
        .then(
          (res) => options.success?.({ statusCode: res.status ?? 200, data: res.data }),
          (err) => options.fail?.(err),
        )
    },
    navigateTo(options) {
      platform.router.push(options.url ?? '')
      options.success?.()
    },
    redirectTo(options) {
      platform.router.replace(options.url ?? '')
    },
    navigateBack(options) {
      platform.router.back(options.delta ?? 1)
    },
    switchTab(options) {
      platform.router.switchTab(options.url ?? '')
    },
    setStorageSync(key, value) {
      platform.storage.set(key, value)
    },
    getStorageSync(key) {
      return platform.storage.get(key)
    },
    removeStorageSync(key) {
      platform.storage.remove(key)
    },
    clearStorageSync() {
      platform.storage.clear()
    },
    showToast(options) {
      platform.ui.showToast(options.title ?? '', options.duration)
    },
    showModal(options) {
      void platform.ui.showModal({ title: options.title, content: options.content }).then((r) => {
        options.success?.({ confirm: r.confirm })
      })
    },
    vibrateShort() {
      void cap.useVibrate(15)
    },
    getSystemInfoSync() {
      return { platform: 'web', screenWidth: 390, screenHeight: 844 }
    },
  }
}
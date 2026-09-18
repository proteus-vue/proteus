// packages/runtime/src/pinia/mp.ts
// 微信小程序 Skyline 工厂（docs/proteus-pinia-plan M3 §2.2）
// 特性：WxStorageAdapter 持久化 + 写盘防抖拉长（主线程敏感，setStorageSync 阻塞）
// 注意：小程序无 DevTools 扩展（window.__PINIA_DEVTOOLS__ 不存在）——模块 06 的 DevTools 在 mp 端自动 no-op
import { createPinia, setActivePinia } from 'pinia'
import { WxStorageAdapter, setPlatform } from '@proteus-vue/shared'
import { createPersistence } from './persistence/lightweight'
import { createDevtoolsPlugin, registerStoreSnapshot } from './devtools'

/**
 * 创建小程序端 Pinia：平台标记 + 持久化（wx.setStorageSync，防抖 100ms）
 * 用法：应用自定义入口（全量模式 main.mp.ts）或首屏逻辑调用后，页面 useStore() 直接可用
 * 调试：小程序无浏览器 DevTools——开发构建挂 trace（[pinia] 日志）+ __PROTEUS_STORES__ 快照导出
 *
 * ★真机 bug 修复（2026-09-12）：此前**从不调用 setActivePinia** → 小程序端无 active pinia，
 *   页面 `useXxxStore()` 抛错 / 返回 undefined（Web 端靠 main.ts 的 app.use(pinia) 才可用）。
 *   小程序无 createApp 实例 → 必须 setActivePinia（pinia 的 useStore 走 getActivePinia 解析）。
 */
export function createMpPinia() {
  setPlatform('mp')
  const pinia = createPinia()
  pinia.use(
    createPersistence({
      storage: new WxStorageAdapter(),
    }),
  )
  const isDebug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
  if (isDebug) {
    pinia.use(createDevtoolsPlugin())
    registerStoreSnapshot(pinia)
  }
  // ★关键：激活 pinia（页面 onLoad 无 Vue app 上下文，必须经 active pinia 解析 store）
  setActivePinia(pinia)
  // 挂到 App 实例（供 app 级调用 / 调试读取）
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app) app.__proteusPinia = pinia
  }
  return pinia
}

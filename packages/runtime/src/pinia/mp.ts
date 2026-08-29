// packages/runtime/src/pinia/mp.ts
// 微信小程序 Skyline 工厂（docs/proteus-pinia-plan M3 §2.2）
// 特性：WxStorageAdapter 持久化 + 写盘防抖拉长（主线程敏感，setStorageSync 阻塞）
// 注意：小程序无 DevTools 扩展（window.__PINIA_DEVTOOLS__ 不存在）——模块 06 的 DevTools 在 mp 端自动 no-op
import { createPinia } from 'pinia'
import { WxStorageAdapter, setPlatform } from '@proteus/shared'
import { createPersistence } from './persistence/lightweight'

/**
 * 创建小程序端 Pinia：平台标记 + 持久化（wx.setStorageSync，防抖 100ms）
 * 用法：应用自定义入口（全量模式 main.mp.ts）或首屏逻辑调用后，页面 useStore() 直接可用
 */
export function createMpPinia() {
  setPlatform('mp')
  const pinia = createPinia()
  pinia.use(
    createPersistence({
      storage: new WxStorageAdapter(),
    }),
  )
  return pinia
}

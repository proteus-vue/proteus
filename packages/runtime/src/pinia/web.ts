// packages/runtime/src/pinia/web.ts
// Web SPA 工厂（docs/proteus-pinia-plan M3 §2.1）—— 基准实现
import { createPinia } from 'pinia'
import { LocalStorageAdapter, setPlatform } from '@proteus/shared'
import { createPersistence } from './persistence/lightweight'

/**
 * 创建 Web 端 Pinia：平台标记 + 持久化（LocalStorage 命名空间隔离）
 * 用法：app.use(createWebPinia())
 * DevTools 插件（模块 06，Batch 5）在 import.meta.env.DEV 时追加
 */
export function createWebPinia() {
  setPlatform('web')
  const pinia = createPinia()
  pinia.use(createPersistence({ storage: new LocalStorageAdapter() }))
  return pinia
}

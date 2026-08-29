// packages/runtime/src/pinia/web.ts
// Web SPA 工厂（docs/proteus-pinia-plan M3 §2.1）—— 基准实现
import { createPinia } from 'pinia'
import { LocalStorageAdapter, setPlatform } from '@proteus/shared'
import { createPersistence } from './persistence/lightweight'
import { createDevtoolsPlugin, registerStoreSnapshot } from './devtools'

/**
 * 创建 Web 端 Pinia：平台标记 + 持久化（LocalStorage 命名空间隔离）
 * 用法：app.use(createWebPinia())
 * DevTools：Vue DevTools 原生接入（pinia 官方插件）+ 开发构建挂 trace/快照（__PROTEUS_DEBUG__）
 */
export function createWebPinia() {
  setPlatform('web')
  const pinia = createPinia()
  pinia.use(createPersistence({ storage: new LocalStorageAdapter() }))
  // 开发构建（PROTEUS_DEBUG=1 → __PROTEUS_DEBUG__）：动作/变更 trace + 状态快照导出
  const isDebug = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__
  if (isDebug) {
    pinia.use(createDevtoolsPlugin())
    registerStoreSnapshot(pinia)
  }
  return pinia
}

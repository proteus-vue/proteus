// packages/runtime/src/pinia/ssr.ts
// SSR 工厂（docs/proteus-pinia-plan M3 §2.4）—— 每请求独立实例，绝不在模块顶层调用
import { createPinia } from 'pinia'
import { MemoryAdapter, setPlatform } from '@proteus-vue/shared'
import { createPersistence } from './persistence/lightweight'

/**
 * 创建 SSR 端 Pinia：MemoryAdapter（每请求独立实例 → 天然隔离）+ 持久化插件在 ssr 平台下自动跳过
 * ★必须在每个请求内调用（模块 05：SSR 隔离），绝不在模块顶层调用
 */
export function createSsrPinia() {
  setPlatform('ssr')
  const pinia = createPinia()
  pinia.use(createPersistence({ storage: new MemoryAdapter() }))
  return pinia
}

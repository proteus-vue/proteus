// packages/runtime/src/pinia/app.ts
// App 端（Custom Renderer）工厂（docs/proteus-pinia-plan M3 §2.3）—— 占位（NativeKV 待 v0.6 接入）
import { createPinia } from 'pinia'
import { NativeKVAdapter, setPlatform } from '@proteus-vue/shared'
import { createPersistence } from './persistence/lightweight'

/**
 * 创建 App 端 Pinia（v0.6 接入 MMKV 后启用）：
 * 序列化边界——经 Bridge 传递的 state 必须可序列化 JSON（不能传函数/Promise）
 * 跨线程——状态变更经 $subscribe + Bridge emit 通知原生
 */
export function createAppPinia() {
  setPlatform('app')
  const pinia = createPinia()
  pinia.use(createPersistence({ storage: new NativeKVAdapter() }))
  return pinia
}

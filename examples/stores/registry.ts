// examples/stores/registry.ts —— 全局类型注册表（docs/proteus-pinia-plan M8.4 设计 A）
// 千级 store 靠字符串 id 拼错无声失败 → 注册表让 useStore('typo') 编译期报错
// ★新增 store 必须在此追加类型（CI 门禁，见 docs/pinia-stores-conventions.md）
import { getActivePinia } from 'pinia'
import type { usePlayerStore } from './player'
import type { useCounterStore } from './counter'

/** 类型注册表：store id → store 类型（静态 id 字面量受限） */
export interface StoresRegistry {
  player: ReturnType<typeof usePlayerStore>
  counter: ReturnType<typeof useCounterStore>
  // 新增 store 在此追加：name: ReturnType<typeof useXxxStore>
}

/**
 * 类型安全取 store：useStore('player') 自动补全 + 类型检查；useStore('typo') 编译报错
 * 动态 store id（如 draft:page1）→ 显式泛型：useStore<StoresRegistry>('draft:page1') as DraftStore
 */
export function useStore<K extends keyof StoresRegistry>(id: K): StoresRegistry[K] {
  const pinia = getActivePinia()
  if (!pinia) throw new Error('[proteus] 未激活 Pinia（先 createXxxPinia + install）')
  const store = pinia._s.get(id)
  if (!store) throw new Error(`[proteus] store "${String(id)}" 未注册（检查 stores/registry.ts）`)
  return store as StoresRegistry[K]
}

// packages/shared/src/storage/index.ts
// 存储层公共入口（docs/proteus-pinia-plan M1）—— 工厂 + 类型 + 序列化 + 追踪
// stores/ 里任何代码通过 createStorage() 拿到存储，不知道自己在哪个端（平台由 M3 工厂注入）
import type { StorageAdapter } from './types'
import { MemoryAdapter } from './memory'
import { LocalStorageAdapter } from './localStorage'
import { WxStorageAdapter } from './wxStorage'
import { NativeKVAdapter } from './nativeKV'
import { getPlatform } from './platform'

export type { StorageAdapter } from './types'
export { MemoryAdapter } from './memory'
export { LocalStorageAdapter } from './localStorage'
export { WxStorageAdapter } from './wxStorage'
export { NativeKVAdapter } from './nativeKV'
export { setPlatform, getPlatform } from './platform'
export type { ProteusPlatform } from './platform'
export { serialize, deserialize, setStrictCircular } from './serialize'
export { enableStorageTrace, isStorageTraceEnabled, traced } from './trace'

/** 按平台创建存储后端（默认 Memory——未注入平台时安全降级） */
export function createStorage(): StorageAdapter {
  switch (getPlatform()) {
    case 'web':
      return new LocalStorageAdapter()
    case 'mp':
      return new WxStorageAdapter()
    case 'app':
      return new NativeKVAdapter()
    default:
      return new MemoryAdapter()
  }
}

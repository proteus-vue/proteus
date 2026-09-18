// packages/shared/src/storage/nativeKV.ts
// App 端存储（docs/proteus-pinia-plan M1 §2.4）—— 占位，待对接 MMKV/SQLite via JSI/Bridge
// 接口契约：所有调用经 Bridge 发到原生侧；序列化统一在 JS 侧完成（同 web/mp）
import type { StorageAdapter } from './types'

export class NativeKVAdapter implements StorageAdapter {
  async getItem(_key: string): Promise<string | null> {
    throw new Error('NativeKVAdapter 未接入：App 端（Custom Renderer）待 v0.6 对接 MMKV')
  }

  async setItem(_key: string, _value: string): Promise<void> {
    throw new Error('NativeKVAdapter 未接入：App 端（Custom Renderer）待 v0.6 对接 MMKV')
  }

  async removeItem(_key: string): Promise<void> {
    throw new Error('NativeKVAdapter 未接入：App 端（Custom Renderer）待 v0.6 对接 MMKV')
  }
}

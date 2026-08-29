// packages/shared/src/storage/memory.ts
// 内存版存储（docs/proteus-pinia-plan M1 §2.1）—— SSR / 测试默认后端
// SSR 下每个请求创建独立实例，天然隔离（跨请求零污染）
import type { StorageAdapter } from './types'

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, string>()

  async getItem(key: string): Promise<string | null> {
    const v = this.store.get(key)
    return v === undefined ? null : v
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.store.clear()
      return
    }
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) this.store.delete(k)
    }
  }
}

// packages/shared/src/storage/localStorage.ts
// Web 端存储（docs/proteus-pinia-plan M1 §2.2）—— 基准实现
// 命名空间前缀隔离（默认 'proteus:'），clear() 只清指定前缀
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开（本文件虽 Web-only，保持共享代码统一风格）
import type { StorageAdapter } from './types'

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private prefix = 'proteus:') {}

  async getItem(key: string): Promise<string | null> {
    const ls = globalThis.localStorage
    if (!ls) return null
    const v = ls.getItem(this.prefix + key)
    return v === null ? null : v
  }

  async setItem(key: string, value: string): Promise<void> {
    const ls = globalThis.localStorage
    if (!ls) return
    ls.setItem(this.prefix + key, value)
  }

  async removeItem(key: string): Promise<void> {
    const ls = globalThis.localStorage
    if (!ls) return
    ls.removeItem(this.prefix + key)
  }

  async clear(prefix?: string): Promise<void> {
    const p = prefix === undefined ? this.prefix : prefix
    const ls = globalThis.localStorage
    if (!ls) return
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i)
      if (k && k.startsWith(p)) ls.removeItem(k)
    }
  }
}

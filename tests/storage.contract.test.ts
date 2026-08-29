// @vitest-environment jsdom
// tests/storage.contract.test.ts
// StorageAdapter 契约测试（docs/proteus-pinia-plan M6 §2.1）—— 一条契约，四端实现一次验证
// jsdom：LocalStorage 契约需要真实 localStorage；未来加 App 端（NativeKV 实现后）只需加一行 runStorageContract
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { StorageAdapter } from '../packages/shared/src/storage'
import { MemoryAdapter, LocalStorageAdapter, WxStorageAdapter } from '../packages/shared/src/storage'

/** 契约主体：任何实现必须满足的行为 */
export function runStorageContract(name: string, createAdapter: () => StorageAdapter): void {
  describe(`StorageAdapter 契约: ${name}`, () => {
    let adapter: StorageAdapter
    beforeEach(() => {
      adapter = createAdapter()
    })

    it('getItem 返回 null（不存在时）', async () => {
      expect(await adapter.getItem('__not_exist__')).toBeNull()
    })

    it('setItem → getItem 往返', async () => {
      await adapter.setItem('k', 'v')
      expect(await adapter.getItem('k')).toBe('v')
    })

    it('removeItem 后 get 返回 null', async () => {
      await adapter.setItem('k', 'v')
      await adapter.removeItem('k')
      expect(await adapter.getItem('k')).toBeNull()
    })

    it('clear() 清空实例数据（prefix 定向清除见各实现专测——各端 key 空间不同）', async () => {
      await adapter.setItem('a', '1')
      await adapter.setItem('b', '2')
      await adapter.clear?.()
      expect(await adapter.getItem('a')).toBeNull()
      expect(await adapter.getItem('b')).toBeNull()
    })
  })
}

/** LocalStorage 需要全局（jsdom 提供） */
runStorageContract('Memory', () => new MemoryAdapter())
runStorageContract('LocalStorage', () => new LocalStorageAdapter())

/** WxStorage：mock wx 全局（node/jsdom 均无 wx） */
function mockWx(): void {
  const data = new Map<string, string>()
  ;(globalThis as { wx?: unknown }).wx = {
    getStorageSync: (k: string) => (data.has(k) ? data.get(k) : ''),
    setStorageSync: (k: string, v: string) => void data.set(k, v),
    removeStorageSync: (k: string) => void data.delete(k),
    getStorageInfoSync: () => ({ keys: Array.from(data.keys()) }),
  }
}
beforeEach(() => {
  mockWx()
})
afterEach(() => {
  delete (globalThis as { wx?: unknown }).wx
})
runStorageContract('WxStorage', () => new WxStorageAdapter())

// tests/storage.test.ts
// 存储层单测（docs/proteus-pinia-plan M1，Batch 1 验收：四端 Adapter 契约 + 序列化 + 追踪）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MemoryAdapter,
  LocalStorageAdapter,
  WxStorageAdapter,
  NativeKVAdapter,
  createStorage,
  setPlatform,
  getPlatform,
  serialize,
  deserialize,
  setStrictCircular,
  enableStorageTrace,
  isStorageTraceEnabled,
  traced,
} from '../packages/shared/src/storage'

/** 简易 localStorage mock（node 环境无全局 localStorage） */
function mockLocalStorage(): () => void {
  const data = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    clear: () => data.clear(),
    get length() {
      return data.size
    },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = ls
  return () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  }
}

/** 简易 wx mock（getStorageSync 可注入抛错） */
function mockWx(options: { throwOnSet?: boolean } = {}): void {
  const data = new Map<string, string>()
  ;(globalThis as { wx?: unknown }).wx = {
    getStorageSync: (k: string) => (data.has(k) ? data.get(k) : ''),
    setStorageSync: (k: string, v: string) => {
      if (options.throwOnSet) throw new Error('quota exceeded')
      data.set(k, v)
    },
    removeStorageSync: (k: string) => void data.delete(k),
    getStorageInfoSync: () => ({ keys: Array.from(data.keys()) }),
  }
}

afterEach(() => {
  delete (globalThis as { wx?: unknown }).wx
  delete (globalThis as { localStorage?: unknown }).localStorage
  setPlatform('web')
  setStrictCircular(true)
})

describe('存储适配器契约（四端）', () => {
  it('MemoryAdapter：set/get/remove/clear(prefix)', async () => {
    const s = new MemoryAdapter()
    await s.setItem('a', '1')
    expect(await s.getItem('a')).toBe('1')
    expect(await s.getItem('missing')).toBeNull()
    await s.setItem('proteus:x', '2')
    await s.clear('proteus:')
    expect(await s.getItem('a')).toBe('1')
    expect(await s.getItem('proteus:x')).toBeNull()
  })

  it('LocalStorageAdapter：前缀隔离 + clear(prefix) 只清指定前缀', async () => {
    const cleanup = mockLocalStorage()
    const s = new LocalStorageAdapter('app:')
    await s.setItem('user', 'u1')
    await s.setItem('order', 'o1')
    expect(await s.getItem('user')).toBe('u1')
    // 不同前缀互不影响
    const other = new LocalStorageAdapter('other:')
    await other.setItem('user', 'x')
    expect(await s.getItem('user')).toBe('u1')
    // clear(prefix) 只清 app:
    await s.clear()
    expect(await s.getItem('user')).toBeNull()
    expect(await other.getItem('user')).toBe('x')
    cleanup()
  })

  it('WxStorageAdapter：读写 + 容错（setStorageSync 抛错不阻断）', async () => {
    mockWx({ throwOnSet: true })
    const s = new WxStorageAdapter()
    // get 容错：无数据返回 null
    expect(await s.getItem('nope')).toBeNull()
    // set 容错：抛错仅警告，不抛
    await expect(s.setItem('a', '1')).resolves.toBeUndefined()
  })

  it('WxStorageAdapter：正常读写 + clear(prefix)', async () => {
    mockWx()
    const s = new WxStorageAdapter('p:')
    await s.setItem('k', 'v')
    expect(await s.getItem('k')).toBe('v')
    await s.setItem('p:other', 'o')
    await s.clear('p:')
    expect(await s.getItem('k')).toBeNull()
    expect(await s.getItem('p:other')).toBeNull()
  })

  it('NativeKVAdapter：占位（App 端 v0.6 接入，调用即抛 Not implemented）', async () => {
    const s = new NativeKVAdapter()
    await expect(s.getItem('k')).rejects.toThrow(/未接入/)
  })

  it('createStorage()：按平台工厂选择后端', async () => {
    setPlatform('mp')
    expect(createStorage()).toBeInstanceOf(WxStorageAdapter)
    setPlatform('web')
    expect(createStorage()).toBeInstanceOf(LocalStorageAdapter)
    setPlatform('ssr')
    expect(createStorage()).toBeInstanceOf(MemoryAdapter)
  })

  it('getPlatform/setPlatform 标记读写（默认 web）', () => {
    expect(getPlatform()).toBe('web')
    setPlatform('mp')
    expect(getPlatform()).toBe('mp')
  })
})

describe('序列化（Date / Map / Set / 循环引用）', () => {
  it('round-trip：Date/Map/Set/嵌套对象', () => {
    const x = {
      date: new Date('2024-01-01T00:00:00Z'),
      map: new Map([['a', 1]]),
      set: new Set([1, 2, 3]),
      plain: { arr: [1, 'two'], ok: true },
    }
    const back = deserialize<typeof x>(serialize(x))
    expect(back.date).toBeInstanceOf(Date)
    expect(back.date.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(back.map).toBeInstanceOf(Map)
    expect(back.map.get('a')).toBe(1)
    expect(back.set).toBeInstanceOf(Set)
    expect(Array.from(back.set)).toEqual([1, 2, 3])
    expect(back.plain).toEqual({ arr: [1, 'two'], ok: true })
  })

  it('循环引用：strict 抛错；非 strict 丢字段', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => serialize(a)).toThrow(/循环引用/)
    setStrictCircular(false)
    expect(() => serialize(a)).not.toThrow()
  })

  it('原始类型 round-trip', () => {
    expect(deserialize(serialize(42))).toBe(42)
    expect(deserialize(serialize('str'))).toBe('str')
    expect(deserialize(serialize(null))).toBeNull()
  })
})

describe('存储追踪（--trace-storage 对齐）', () => {
  it('默认关闭；enableStorageTrace 后 traced 打印', async () => {
    expect(isStorageTraceEnabled()).toBe(false)
    const logs: unknown[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => void logs.push(args)
    try {
      const v = await traced('get', 'k', async () => 'v')
      expect(v).toBe('v')
      expect(logs).toHaveLength(0) // 未开启不打印

      enableStorageTrace()
      expect(isStorageTraceEnabled()).toBe(true)
      await traced('set', 'kk', async () => {})
      expect((logs[0] as unknown[])[0]).toContain('[storage] set kk')
    } finally {
      console.log = orig
    }
  })
})

// @vitest-environment jsdom
// tests/pinia-persistence.test.ts
// Pinia 持久化层单测（docs/proteus-pinia-plan M2，Batch 2 验收：兼容层 + 轻量方案 + 共存 + SSR）
// jsdom：pinia→vue runtime-dom 顶层需要真实 DOM（node 环境缺 document.createElement）
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import type { PiniaPlugin } from 'pinia'
import { createApp } from 'vue'
import { MemoryAdapter, setPlatform } from '../packages/shared/src/storage'
import { createPersistedStatePlugin } from '../packages/runtime/src/pinia/persistence/plugin'
import { persisted, createPersistence } from '../packages/runtime/src/pinia/persistence/lightweight'

/** pinia.use 在 app.use(pinia)（install）时才注册插件（pinia 4.x toBeInstalled 机制）→ 测试模拟 install */
function installPinia(plugins: PiniaPlugin[] = []): ReturnType<typeof createPinia> {
  const pinia = createPinia()
  for (const p of plugins) pinia.use(p)
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

beforeEach(() => {
  setPlatform('web')
  setActivePinia(createPinia())
})

/** 等待微任务 + 防抖计时器（lightweight 默认 50ms 防抖，需真等待触达） */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 80))
}

describe('兼容层 createPersistedStatePlugin（pinia-plugin-persistedstate 零改动迁移）', () => {
  it('persist: { key } 不传 storage → 自动选平台 Adapter（MemoryAdapter，web 默认）', async () => {
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistedStatePlugin({ storage: mem })])

    const useStore = defineStore('user', {
      state: () => ({ token: '', name: 'a' }),
      persist: { key: 'user-key' },
    })
    const s = useStore()
    s.token = 'abc'
    await flush()
    const raw = await mem.getItem('user-key')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).token).toBe('abc')
  })

  it('Web Storage 兼容对象（localStorage 形态）自动包成 Adapter', async () => {
    const data = new Map<string, string>()
    const webStorage = {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    }
    const pinia = installPinia([createPersistedStatePlugin()])
    // 覆盖默认 storage：per-store 指定
    const useStore = defineStore('s1', {
      state: () => ({ n: 1 }),
      persist: { key: 'k1', storage: webStorage },
    })
    useStore().n = 42
    await flush()
    expect(data.get('k1')).toContain('"n":42')
  })

  it('paths 只持久化指定字段（嵌套 a.b.c）', async () => {
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistedStatePlugin({ storage: mem })])

    const useStore = defineStore('s2', {
      state: () => ({ a: { b: { c: 1 } }, z: 9 }),
      persist: { key: 'k2', paths: ['a.b.c'] },
    })
    const s = useStore()
    s.a.b.c = 7
    s.z = 99 // 不应持久化
    await flush()
    const saved = JSON.parse((await mem.getItem('k2'))!)
    expect(saved).toEqual({ a: { b: { c: 7 } } })
  })

  it('beforeRestore/afterRestore 钩子执行', async () => {
    const mem = new MemoryAdapter()
    await mem.setItem('k3', JSON.stringify({ v: 5 }))
    const pinia = installPinia([createPersistedStatePlugin({ storage: mem })])

    const calls: string[] = []
    const useStore = defineStore('s3', {
      state: () => ({ v: 0 }),
      persist: {
        key: 'k3',
        beforeRestore: () => void calls.push('before'),
        afterRestore: () => void calls.push('after'),
      },
    })
    useStore()
    await flush()
    expect(calls).toEqual(['before', 'after'])
    expect(useStore().v).toBe(5)
  })

  it('SSR（platform=ssr）→ 跳过 hydrate 与写入', async () => {
    setPlatform('ssr')
    const mem = new MemoryAdapter()
    await mem.setItem('k4', JSON.stringify({ v: 1 }))
    const pinia = installPinia([createPersistedStatePlugin({ storage: mem })])

    const useStore = defineStore('s4', {
      state: () => ({ v: 0 }),
      persist: { key: 'k4' },
    })
    useStore().v = 2
    await flush()
    // 未 hydrate（v 保持 0）
    expect(useStore().v).toBe(2) // 直接改的
    // 且未写入
    expect(JSON.parse((await mem.getItem('k4'))!).v).toBe(1)
  })
})

describe('轻量方案 persisted() + createPersistence', () => {
  it('pick 过滤 + 防抖（连续变更合并写盘）', async () => {
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistence({ storage: mem })])

    const useStore = defineStore('light1', {
      state: () => ({ keep: 0, drop: 0 }),
      persistence: persisted({ pick: ['keep'], key: 'l1' }),
    })
    const s = useStore()
    for (let i = 0; i < 100; i++) {
      s.keep = i
      s.drop = i
    }
    // 防抖窗口内只写 1 次
    const writes = vi.fn()
    const origSet = mem.setItem.bind(mem)
    mem.setItem = async (k, v) => {
      writes()
      return origSet(k, v)
    }
    await flush(5)
    expect(writes).toHaveBeenCalledTimes(1)
    const saved = JSON.parse((await mem.getItem('l1'))!)
    expect(saved.keep).toBe(99)
    expect(saved.drop).toBeUndefined()
  })

  it('未声明 persistence → 零开销（不挂订阅）', async () => {
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistence({ storage: mem })])

    const useStore = defineStore('light2', {
      state: () => ({ x: 0 }),
    })
    useStore().x = 5
    await flush()
    const keys = await mem.getItem('light2')
    expect(keys).toBeNull()
  })

  it('SSR 跳过', async () => {
    setPlatform('ssr')
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistence({ storage: mem })])

    const useStore = defineStore('light3', {
      state: () => ({ x: 0 }),
      persistence: persisted({ pick: ['x'] }),
    })
    useStore().x = 5
    await flush()
    expect(await mem.getItem('light3')).toBeNull()
  })
})

describe('共存：兼容层 + 轻量方案同一 Pinia 实例', () => {
  it('两插件同时 use，各自识别自己的标记', async () => {
    const mem = new MemoryAdapter()
    const pinia = installPinia([createPersistedStatePlugin({ storage: mem }), createPersistence({ storage: mem })])

    const useLegacy = defineStore('legacy', {
      state: () => ({ a: 0 }),
      persist: { key: 'legacy-k' },
    })
    const useLight = defineStore('light', {
      state: () => ({ b: 0 }),
      persistence: persisted({ pick: ['b'], key: 'light-k' }),
    })
    useLegacy().a = 1
    useLight().b = 2
    await flush(5)
    expect(JSON.parse((await mem.getItem('legacy-k'))!).a).toBe(1)
    expect(JSON.parse((await mem.getItem('light-k'))!).b).toBe(2)
  })
})

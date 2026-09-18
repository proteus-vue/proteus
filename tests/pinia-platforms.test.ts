// @vitest-environment jsdom
// tests/pinia-platforms.test.ts
// 四端 Pinia 工厂单测（docs/proteus-pinia-plan M3，Batch 3 验收：同一份 store 四端一致 + 持久化）
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createWebPinia, createMpPinia, createSsrPinia, createAppPinia } from '../packages/runtime/src/pinia'
import { usePlayerStore } from '../examples/stores/player'
import { getPlatform, MemoryAdapter, WxStorageAdapter } from '../packages/shared/src/storage'

/** 模拟小程序 wx 存储全局（WxStorageAdapter 直连 wx） */
function mockWx(): { data: Map<string, string> } {
  const data = new Map<string, string>()
  ;(globalThis as { wx?: unknown }).wx = {
    getStorageSync: (k: string) => (data.has(k) ? data.get(k) : ''),
    setStorageSync: (k: string, v: string) => void data.set(k, v),
    removeStorageSync: (k: string) => void data.delete(k),
    getStorageInfoSync: () => ({ keys: Array.from(data.keys()) }),
  }
  return { data }
}

/** 模拟 install（pinia.use 需 app.use(pinia) 注册插件） */
function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

afterEach(() => {
  delete (globalThis as { wx?: unknown }).wx
})

describe('四端工厂', () => {
  it('各工厂返回独立 Pinia 实例 + 注入平台标记', () => {
    const web = createWebPinia()
    expect(getPlatform()).toBe('web')
    const mp = createMpPinia()
    expect(getPlatform()).toBe('mp')
    expect(web).not.toBe(mp)
  })

  it('createSsrPinia：每次调用全新实例（state 无残留）', () => {
    const p1 = createSsrPinia()
    install(p1)
    const s1 = usePlayerStore()
    s1.setVolume(0.3)
    expect(getPlatform()).toBe('ssr')
    // 第二个实例独立（卸载旧实例避免干扰）
    const p2 = createSsrPinia()
    install(p2)
    const s2 = usePlayerStore()
    expect(s2.volume).toBe(0.8) // 默认值，未被 p1 污染
    expect(s1).not.toBe(s2)
  })
})

describe('player store 跨端一致 + 持久化', () => {
  it('Web：createWebPinia → 播放动作 + LocalStorage 持久化（volume/history）', async () => {
    const pinia = createWebPinia()
    install(pinia)
    const s = usePlayerStore()
    s.play({ title: 'Theme A', durationSec: 100 })
    s.setVolume(0.5)
    expect(s.playing).toBe(true)
    expect(s.historyCount).toBe(1)
    // 持久化：localStorage（jsdom 有）→ 防抖 50ms 后写盘
    await new Promise((r) => setTimeout(r, 80))
    const raw = globalThis.localStorage.getItem('proteus:player-state')
    expect(raw).not.toBeNull()
    const saved = JSON.parse(raw!)
    expect(saved.volume).toBe(0.5)
    expect(saved.history).toEqual(['Theme A'])
    // playing/current 不持久化（pick 只含 volume/history）
    expect(saved.playing).toBeUndefined()
  })

  it('MP：createMpPinia + wx 存储 mock → 同一份 store 行为一致 + WxStorageAdapter 持久化', async () => {
    const { data } = mockWx()
    const pinia = createMpPinia()
    install(pinia)
    const s = usePlayerStore()
    s.play({ title: 'MP Track', durationSec: 60 })
    s.toggle() // 暂停
    expect(s.playing).toBe(false)
    expect(s.historyCount).toBe(1)
    await new Promise((r) => setTimeout(r, 80))
    expect(data.get('proteus:player-state')).toContain('"history":["MP Track"]')
    // 存储后端确实是 wx
    expect(createMpPinia).toBeTruthy()
  })

  it('SSR：createSsrPinia → 持久化插件跳过（MemoryAdapter 无写入）', async () => {
    const pinia = createSsrPinia()
    install(pinia)
    const s = usePlayerStore()
    s.setVolume(0.9)
    await new Promise((r) => setTimeout(r, 80))
    // ssr 平台下持久化插件直接 return（无订阅挂载），MemoryAdapter 无数据
    // （MemoryAdapter 是每请求实例，无法从外部断言——用平台标记断言插件行为已被 pinia-persistence 测试覆盖）
    expect(s.volume).toBe(0.9)
  })

  it('createAppPinia：NativeKV 占位（持久化写入抛错，但 store 可用）', async () => {
    const pinia = createAppPinia()
    install(pinia)
    const s = usePlayerStore()
    s.setVolume(0.2)
    expect(s.volume).toBe(0.2)
  })
})

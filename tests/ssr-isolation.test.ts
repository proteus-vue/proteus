// @vitest-environment jsdom
// tests/ssr-isolation.test.ts
// SSR 实例隔离 + hydration 单测（docs/proteus-pinia-plan M4，Batch 4 验收）
// 核心：并发请求状态零污染 + 客户端先恢复 state 再 use(pinia)
import { describe, it, expect } from 'vitest'
import { createSSRApp } from 'vue'
import { createSsrPinia } from '../packages/runtime/src/pinia'
import { usePlayerStore } from '../examples/stores/player'

describe('M4 SSR 隔离', () => {
  it('并发请求状态完全隔离（核心验收）', async () => {
    // 模拟两个并发请求：各自 createSsrPinia + 各自填充数据
    const simulate = async (title: string) => {
      const app = createSSRApp({})
      const pinia = createSsrPinia()
      app.use(pinia)
      const store = usePlayerStore(pinia)
      store.play({ title, durationSec: 100 })
      store.setVolume(0.5)
      // 模拟服务端渲染完成 + 收集 state
      await new Promise((r) => setTimeout(r, Math.random() * 10))
      return JSON.stringify(pinia.state.value)
    }

    const [stateA, stateB] = await Promise.all([
      simulate('Track A'),
      simulate('Track B'),
      simulate('Track A'), // 同名并发
    ])

    expect(JSON.parse(stateA).player.history).toEqual(['Track A'])
    expect(JSON.parse(stateB).player.history).toEqual(['Track B'])
    expect(JSON.parse(stateA)).not.toEqual(JSON.parse(stateB))
  })

  it('createSsrPinia 每次调用返回全新 state（无跨请求残留）', () => {
    const p1 = createSsrPinia()
    const s1 = usePlayerStore(p1)
    s1.play({ title: 'X', durationSec: 1 })
    expect(Object.keys(p1.state.value).length).toBeGreaterThan(0)

    const p2 = createSsrPinia()
    expect(Object.keys(p2.state.value)).toHaveLength(0) // 全新实例，无残留
  })

  it('hydration：先恢复 state 再 use(pinia)（模块 04/05 顺序铁律）', () => {
    const pinia = createSsrPinia()
    // 模拟服务端 initialState
    const serverState = { player: { playing: true, current: { title: 'S', durationSec: 9 }, volume: 0.3, history: ['S'] } }
    pinia.state.value = serverState as typeof pinia.state.value

    const app = createSSRApp({})
    app.use(pinia)
    const s = usePlayerStore(pinia)
    // 注水后 store 值与服务端一致
    expect(s.playing).toBe(true)
    expect(s.volume).toBe(0.3)
    expect(s.history).toEqual(['S'])
  })
})

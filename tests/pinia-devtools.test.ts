// @vitest-environment jsdom
// tests/pinia-devtools.test.ts
// DevTools / 状态追踪单测（docs/proteus-pinia-plan M5，Batch 5 验收：trace + 快照导出）
import { describe, it, expect, beforeEach } from 'vitest'
import { createApp } from 'vue'
import { setActivePinia } from 'pinia'
import { createPinia } from 'pinia'
import { createWebPinia, createDevtoolsPlugin, enablePiniaTrace, disablePiniaTrace, registerStoreSnapshot } from '../packages/runtime/src/pinia'
import { usePlayerStore } from '../examples/stores/player'

/** 模拟 install（pinia.use 需 app.use(pinia) 注册插件） */
function install(pinia: ReturnType<typeof createPinia>): void {
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

beforeEach(() => {
  // trace 默认关（模块级状态，文件内重置避免污染）
  disablePiniaTrace()
  ;(globalThis as { __PROTEUS_STORES__?: unknown }).__PROTEUS_STORES__ = undefined
})

describe('M5 DevTools / 状态追踪', () => {
  it('createDevtoolsPlugin：trace 开启后动作/变更输出 [pinia] 日志', async () => {
    const logs: unknown[][] = []
    const orig = console.log
    console.log = (...args: unknown[]) => void logs.push(args)
    try {
      enablePiniaTrace()
      const pinia = createPinia()
      pinia.use(createDevtoolsPlugin())
      install(pinia)
      const s = usePlayerStore()
      s.play({ title: 'T', durationSec: 1 })
      // action trace（同步触发）
      expect(logs.some((l) => String(l[0]).includes('action:play'))).toBe(true)
    } finally {
      console.log = orig
    }
  })

  it('createDevtoolsPlugin：trace 关闭时零输出（生产构建等价）', () => {
    const logs: unknown[][] = []
    const orig = console.log
    console.log = (...args: unknown[]) => void logs.push(args)
    try {
      const pinia = createPinia()
      pinia.use(createDevtoolsPlugin())
      install(pinia)
      const s = usePlayerStore()
      s.play({ title: 'T', durationSec: 1 })
      expect(logs).toHaveLength(0)
    } finally {
      console.log = orig
    }
  })

  it('__PROTEUS_STORES__ 快照导出：返回全部 store 的合法 JSON', () => {
    const pinia = createPinia()
    install(pinia)
    usePlayerStore().play({ title: 'Snap', durationSec: 5 })
    registerStoreSnapshot(pinia)
    const fn = (globalThis as { __PROTEUS_STORES__?: () => string }).__PROTEUS_STORES__
    expect(typeof fn).toBe('function')
    const json = JSON.parse(fn!())
    expect(json.player.history).toEqual(['Snap'])
  })

  it('createWebPinia 工厂：返回可用实例（DevTools 原生由 pinia 接入）', () => {
    const pinia = createWebPinia()
    install(pinia)
    const s = usePlayerStore()
    expect(s.volume).toBe(0.8)
  })
})

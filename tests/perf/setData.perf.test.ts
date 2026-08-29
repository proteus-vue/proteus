// tests/perf/setData.perf.test.ts
// v0.4 性能基准：setData 桥接（批量合并 / 深层 diff 推送量）
// 门禁原则：断言行为与数量（不设严格时间阈值防 flaky），耗时用 console 报告
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPage = { route: 'pages/index', setData: vi.fn() }

vi.mock('@proteus/shared', () => ({
  adapter: {
    isMP: true,
    getCurrentPages: vi.fn(() => [mockPage]),
  },
}))

vi.mock('../../src/proteus.config', () => ({
  default: { setDataBridge: { batchWindow: 16, perComponent: true } },
}))

import { setDataBridge } from '../../packages/runtime/src/setDataBridge'

beforeEach(() => {
  mockPage.setData.mockClear()
  setDataBridge.reset()
})

describe('性能基准：setData 桥接（v0.4）', () => {
  it('高频更新合并：1000 次变更 → 1 次批量 setData', () => {
    const N = 1000
    for (let i = 0; i < N; i++) {
      setDataBridge.markDirty('pages/index', `k${i % 10}`, i)
    }
    setDataBridge.flushSync()
    // 10 个不同路径 → 批量合并为 1 次 setData
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    expect(Object.keys(mockPage.setData.mock.calls[0][0]).length).toBe(10)
    console.log(`[perf] 1000 次变更 → ${mockPage.setData.mock.calls.length} 次 setData（${10} 条路径批量）`)
  })

  it('对象 diff：100 次对象更新仅推送变化字段（推送量 << 全量）', () => {
    const user = { name: 'a', age: 1, addr: { city: 'x', zip: 'y' } }
    setDataBridge.markDirty('pages/index', 'user', user)
    setDataBridge.flushSync()
    const fullPush = Object.keys(mockPage.setData.mock.calls[0][0]).length // 首次全量叶路径
    expect(fullPush).toBeGreaterThan(1)
    mockPage.setData.mockClear()

    for (let i = 0; i < 100; i++) {
      setDataBridge.markDirty('pages/index', 'user', { ...user, name: `n${i}` })
    }
    setDataBridge.flushSync()
    const diffPush = Object.keys(mockPage.setData.mock.calls.at(-1)![0]).length
    expect(diffPush).toBe(1) // 仅 name 变化 → 1 条叶路径
    console.log(`[perf] 对象 diff：全量 ${fullPush} 条 vs 变化后 ${diffPush} 条（×${fullPush} 减少）`)
  })

  it('值去重：同值高频写入零推送', () => {
    for (let i = 0; i < 100; i++) {
      setDataBridge.markDirty('pages/index', 'a', 1)
    }
    setDataBridge.flushSync()
    expect(mockPage.setData).toHaveBeenCalledTimes(1) // 首次推送后同值去重
    mockPage.setData.mockClear()
    for (let i = 0; i < 100; i++) {
      setDataBridge.markDirty('pages/index', 'a', 1)
    }
    setDataBridge.flushSync()
    expect(mockPage.setData).not.toHaveBeenCalled()
  })
})

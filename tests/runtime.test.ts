// tests/runtime.test.ts
// P5 运行时桥接单测：setDataBridge（批量/路径合并/值去重）+ pageLifecycle（createPage/createComponent）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPage = { route: 'pages/index', setData: vi.fn() }

vi.mock('../src/platform', () => ({
  adapter: {
    isMP: true,
    getCurrentPages: vi.fn(() => [mockPage]),
    navigateTo: vi.fn(async () => {}),
    redirectTo: vi.fn(async () => {}),
    reLaunch: vi.fn(async () => {}),
    switchTab: vi.fn(async () => {}),
    navigateBack: vi.fn(),
  },
}))

vi.mock('../src/proteus.config', () => ({
  default: { setDataBridge: { batchWindow: 16, perComponent: true } },
}))

import { setDataBridge } from '../src/runtime/setDataBridge'
import { createPage, createComponent } from '../src/runtime/pageLifecycle'

beforeEach(() => {
  vi.useFakeTimers()
  mockPage.setData.mockClear()
  vi.mocked(mockPage.setData).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('setDataBridge 批量桥接', () => {
  it('同帧多次变更合并为一次 setData', () => {
    setDataBridge.markDirty('pages/index', 'a', 1)
    setDataBridge.markDirty('pages/index', 'b', 2)
    expect(mockPage.setData).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    expect(mockPage.setData).toHaveBeenCalledWith({ a: 1, b: 2 })
  })

  it('路径合并：父路径已脏 → 子路径跳过', () => {
    setDataBridge.markDirty('pages/index', 'a', { x: 1 })
    setDataBridge.markDirty('pages/index', 'a.x', 99) // 子路径被父覆盖
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ a: { x: 1 } })
  })

  it('路径合并：新路径为祖先 → 移除被覆盖的子路径', () => {
    setDataBridge.markDirty('pages/index', 'list[0].name', 'n')
    setDataBridge.markDirty('pages/index', 'list', [{ name: 'new' }])
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ list: [{ name: 'new' }] })
  })

  it('值比较去重：与上次推送值相同 → 不触发 setData', () => {
    setDataBridge.markDirty('pages/index', 'a', 1)
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    setDataBridge.markDirty('pages/index', 'a', 1) // 值未变化
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    setDataBridge.markDirty('pages/index', 'a', 2) // 值变化
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(2)
  })

  it('flushSync 立即刷出（onUnload 场景）', () => {
    setDataBridge.markDirty('pages/index', 'a', 1)
    setDataBridge.flushSync()
    expect(mockPage.setData).toHaveBeenCalledWith({ a: 1 })
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
  })

  it('页面不在栈中 → 跳过', () => {
    vi.mocked(mockPage.setData).mockClear()
    setDataBridge.markDirty('pages/not-exist', 'a', 1)
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).not.toHaveBeenCalled()
  })
})

describe('pageLifecycle', () => {
  it('createPage：onLoad 路由参数自动 decode 并注入 data', () => {
    const opts = createPage({ data: { title: 'x' }, methods: {} })
    const page = { setData: vi.fn() }
    opts.onLoad?.call(page, { id: '1', obj: '%7B%22a%22%3A1%7D' })
    // 标量保持字符串（P3 契约），结构化值 JSON 解析
    expect(page.setData).toHaveBeenCalledWith({ id: '1', obj: { a: 1 } })
  })

  it('createPage：onReady 执行注册的钩子', () => {
    const opts = createPage({ data: {}, methods: {} }) as any
    const spy = vi.fn()
    opts.__onReadyHooks.push(spy)
    opts.onReady.call(opts)
    expect(spy).toHaveBeenCalled()
  })

  it('createPage：onUnload 先 flushSync 再执行钩子', () => {
    const opts = createPage({ data: {}, methods: {} }) as any
    const spy = vi.fn()
    opts.__onUnloadHooks.push(spy)
    // 用全新值避免与单例 lastValues 去重冲突
    setDataBridge.markDirty('pages/index', 'pending', 'dirty-data')
    opts.onUnload.call(opts)
    expect(spy).toHaveBeenCalled()
    expect(mockPage.setData).toHaveBeenCalledWith({ pending: 'dirty-data' }) // flushSync 生效
  })

  it('createPage：methods 展开到构造器', () => {
    const fn = vi.fn()
    const opts = createPage({ data: {}, methods: { tap: fn } }) as any
    expect(opts.tap).toBe(fn)
  })

  it('createComponent：properties/methods/lifetimes.attached', () => {
    const opts = createComponent({
      properties: { id: { type: Number } },
      data: { list: [] },
      methods: { pick: vi.fn() },
    }) as any
    expect(opts.properties.id.type).toBe(Number)
    expect(opts.lifetimes.attached).toBeTypeOf('function')
    const spy = vi.fn()
    opts.__onReadyHooks.push(spy)
    opts.lifetimes.attached.call(opts)
    expect(spy).toHaveBeenCalled()
  })
})

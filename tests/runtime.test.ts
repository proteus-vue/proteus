// tests/runtime.test.ts
// P5 运行时桥接单测：setDataBridge（批量/路径合并/值去重/深层 diff）+ pageLifecycle（createPage/createComponent）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPage = { route: 'pages/index', setData: vi.fn() }

vi.mock('@proteus/shared', () => ({
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
  // 单例状态隔离：避免 lastValues/dirty 跨测试泄漏
  setDataBridge.reset()
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

  it('路径合并：父路径已脏 → 子路径覆盖（叶路径补丁语义）', () => {
    setDataBridge.markDirty('pages/index', 'a', { x: 1 })
    setDataBridge.markDirty('pages/index', 'a.x', 99) // 同叶路径覆盖，最终值正确
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ 'a.x': 99 })
  })

  it('路径合并：新路径为祖先 → 移除被覆盖的子路径（叶路径补丁语义）', () => {
    setDataBridge.markDirty('pages/index', 'list[0].name', 'n')
    setDataBridge.markDirty('pages/index', 'list', [{ name: 'new' }])
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ 'list[0].name': 'new' })
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

  // ★v0.4 深度优化：深层对象 diff（只推送变化的叶路径）
  it('对象 diff：仅变化的字段推送（叶路径补丁，非整对象）', () => {
    setDataBridge.markDirty('pages/index', 'user', { name: 'a', age: 1 })
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenLastCalledWith({ 'user.name': 'a', 'user.age': 1 })

    mockPage.setData.mockClear()
    setDataBridge.markDirty('pages/index', 'user', { name: 'b', age: 1 }) // 仅 name 变化
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    expect(mockPage.setData).toHaveBeenCalledWith({ 'user.name': 'b' })
  })

  it('数组 diff：仅变化的下标推送（list[0].x 而非整数组）', () => {
    setDataBridge.markDirty('pages/index', 'list', [{ name: 'a' }, { name: 'b' }])
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenLastCalledWith({ 'list[0].name': 'a', 'list[1].name': 'b' })

    mockPage.setData.mockClear()
    setDataBridge.markDirty('pages/index', 'list', [{ name: 'a' }, { name: 'c' }])
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ 'list[1].name': 'c' })
  })

  it('深层 diff 去重：对象未变 → 不触发 setData', () => {
    setDataBridge.markDirty('pages/index', 'user', { name: 'a', age: 1 })
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledTimes(1)
    mockPage.setData.mockClear()
    setDataBridge.markDirty('pages/index', 'user', { name: 'a', age: 1 }) // 深拷贝同值
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).not.toHaveBeenCalled()
  })

  it('深层 diff 与路径合并协同：整对象推送覆盖同帧叶路径', () => {
    setDataBridge.markDirty('pages/index', 'user.name', 'x')
    setDataBridge.markDirty('pages/index', 'user', { name: 'y', age: 2 })
    vi.advanceTimersByTime(16)
    expect(mockPage.setData).toHaveBeenCalledWith({ 'user.name': 'y', 'user.age': 2 })
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

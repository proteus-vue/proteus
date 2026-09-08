// tests/platform-adapter.test.ts
// ★#491 小程序启动白屏回归：shared adapter 平台判定——dist 预打包消费时 vite 不转换 node_modules，
//   import.meta.env?.MODE 可选链不被替换 → 编译期判定失效。运行时探测兜底（wx 存在 + window 缺席 → mp），
//   且 window 优先（@proteus-vue/web wx 模拟层注册全局 wx 不误判——devtools-panel M8 同源教训）。
//   用 vi.resetModules + 动态 import 在同文件内重求值 shared 模块（adapter 为模块顶层单例）。
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('#491 adapter 平台判定（运行时探测——小程序启动白屏回归）', () => {
  it('wx 存在 + window 缺席 → mp adapter（dist 预打包 import.meta.env 失效场景兜底）', async () => {
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ platform: 'devtools' }) })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(true)
  })

  it('getWindowInfo 新一代 API 也可判定 mp（getSystemInfoSync 废弃演进覆盖）', async () => {
    vi.stubGlobal('wx', { getWindowInfo: () => ({}) })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(true)
  })

  it('window 存在 + wx 存在（web wx 模拟层注册全局 wx）→ 仍判 web（window 优先，不误判 skyline/mp）', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({}) })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
  })

  it('wx 存在但无系统信息 API → web adapter（探测保守——避免 web 极端环境误判）', async () => {
    vi.stubGlobal('wx', { setStorageSync: () => {} })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
  })

  it('无 wx 无 window（SSR/Node dist 消费）→ web adapter（web-adapter 求值需 location——vitest node 环境内置）', async () => {
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
  })
})

describe('measureRect L2 抽象（no-platform-api——组件禁直接 wx.*/document.*，经此处消费）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('web adapter：querySelector + getBoundingClientRect 归一化（window 存在 → web）', async () => {
    vi.stubGlobal('window', {})
    const el = {
      getBoundingClientRect: () => ({ top: 5, left: 6, right: 20, bottom: 18, width: 14, height: 13 }),
    }
    vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(el) })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
    const rect = await adapter.measureRect!('.foo')
    expect(rect).toEqual({ top: 5, left: 6, right: 20, bottom: 18, width: 14, height: 13 })
    expect(document.querySelector).toHaveBeenCalledWith('.foo')
  })

  it('web adapter：元素不存在 → resolve null（不抛，调用方降级）', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { querySelector: vi.fn().mockReturnValue(null) })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
    await expect(adapter.measureRect!('.zzz')).resolves.toBe(null)
  })

  it('web adapter：SSR/无 document 环境 → resolve null（安全守卫，不崩）', async () => {
    vi.stubGlobal('window', {})
    // 不 stub document——node 环境无 document
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(false)
    await expect(adapter.measureRect!('.foo')).resolves.toBe(null)
  })

  it('mp adapter：createSelectorQuery + boundingClientRect + exec 归一化（getSystemInfoSync 判定 mp）', async () => {
    let boundCb: ((r: unknown) => void) | null = null
    const query = {
      select: vi.fn().mockReturnThis(),
      boundingClientRect: vi.fn().mockImplementation(function (this: unknown, cb: (r: unknown) => void) {
        boundCb = cb
        return this
      }),
      exec: vi.fn().mockImplementation(function (this: unknown) {
        boundCb?.({ top: 2, left: 3, right: 12, bottom: 10, width: 9, height: 8 })
        return this
      }),
    }
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({}),
      createSelectorQuery: vi.fn().mockReturnValue(query),
    })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(true)
    const rect = await adapter.measureRect!('.trigger')
    expect(rect).toEqual({ top: 2, left: 3, right: 12, bottom: 10, width: 9, height: 8 })
    expect(query.select).toHaveBeenCalledWith('.trigger')
  })

  it('mp adapter：boundingClientRect 返回 null/残缺 → normalize 兜底 or null', async () => {
    let boundCb: ((r: unknown) => void) | null = null
    const query = {
      select: vi.fn().mockReturnThis(),
      boundingClientRect: vi.fn().mockImplementation(function (this: unknown, cb: (r: unknown) => void) {
        boundCb = cb
        return this
      }),
      exec: vi.fn().mockImplementation(function (this: unknown) {
        boundCb?.(null)
        return this
      }),
    }
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({}),
      createSelectorQuery: vi.fn().mockReturnValue(query),
    })
    vi.resetModules()
    const { adapter } = await import('@proteus-vue/shared')
    expect(adapter.isMP).toBe(true)
    await expect(adapter.measureRect!('.gone')).resolves.toBe(null)
  })
})

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

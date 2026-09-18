// tests/runtime-detect.test.ts
// ★Skyline 线收口（2026-09-11）：运行时/渲染器判定 SSOT（@proteus-vue/shared/platform/runtime）
//   覆盖：web 守卫（wx 模拟层不误判）/ mp 判定（window 缺席 + wx）/ renderer 区分（宏 + 运行时兜底）/ fail-safe
import { describe, it, expect, afterEach, vi } from 'vitest'
import { detectRuntime, isMiniProgram, detectMpRenderer, isSkylineRuntime } from '@proteus-vue/shared'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectRuntime（运行时判定 SSOT）', () => {
  it('无 window 无 wx → web（node/SSR）', () => {
    expect(detectRuntime()).toBe('web')
    expect(isMiniProgram()).toBe(false)
  })

  it('window 存在 → web（即便有 wx——模拟层守卫）', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    expect(detectRuntime()).toBe('web')
  })

  it('window 缺席 + wx.getSystemInfoSync → mp', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    expect(detectRuntime()).toBe('mp')
    expect(isMiniProgram()).toBe(true)
  })

  it('window 缺席 + wx.getWindowInfo（新一代 API）→ mp', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getWindowInfo: () => ({}) })
    expect(detectRuntime()).toBe('mp')
  })

  it('window 缺席 + wx 存在 → mp（小程序 = 有 wx 无 window）', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', {})
    expect(detectRuntime()).toBe('mp')
  })
})

describe('detectMpRenderer（Skyline vs WebView）', () => {
  it('运行时 getSystemInfoSync.renderer === skyline → skyline', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    expect(detectMpRenderer()).toBe('skyline')
    expect(isSkylineRuntime()).toBe(true)
  })

  it('renderer === webview → webview', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'webview' }) })
    expect(detectMpRenderer()).toBe('webview')
    expect(isSkylineRuntime()).toBe(false)
  })

  it('无 wx / getSystemInfoSync 抛错 → webview（保守，不启用 Skyline 专有能力）', () => {
    expect(detectMpRenderer()).toBe('webview')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => { throw new Error('low version') } })
    expect(detectMpRenderer()).toBe('webview')
  })
})

// tests/web.test.ts
// ★14-mp-first-semantics：@proteus-vue/web 小程序语义 Web 模拟层——wx API 代理/存储/open-type 映射
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// wx.ts import { adapter } from '@proteus-vue/shared'（vitest 别名到 src）——mock 掉平台适配器
const { adapterMock } = vi.hoisted(() => ({
  adapterMock: {
    navigateTo: vi.fn(() => Promise.resolve()),
    redirectTo: vi.fn(() => Promise.resolve()),
    reLaunch: vi.fn(() => Promise.resolve()),
    switchTab: vi.fn(() => Promise.resolve()),
    navigateBack: vi.fn(),
    getCurrentPages: vi.fn(() => []),
  },
}))
vi.mock('@proteus-vue/shared', () => ({ adapter: adapterMock }))

import { wx, installWxApi } from '../packages/web/src/wx'
import { OPEN_TYPE_EVENTS } from '../packages/built-in-components/src/open-type'

/** node 环境无 localStorage——stub 简单实现 */
function stubLocalStorage(): void {
  const store = new Map<string, string>()
  const ls = {
    setItem: (k: string, v: string) => store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { innerWidth: 375, innerHeight: 667, devicePixelRatio: 2, screen: { width: 750, height: 1334 } })
  vi.stubGlobal('navigator', { language: 'zh-CN', platform: 'MacIntel' })
}

describe('wx API Web 模拟层（14-mp-first-semantics）', () => {
  beforeEach(() => {
    stubLocalStorage()
    adapterMock.navigateTo.mockClear()
    adapterMock.navigateBack.mockClear()
    vi.unstubAllGlobals()
    stubLocalStorage()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('路由 API 代理 PlatformAdapter（navigateTo/redirectTo/navigateBack）', async () => {
    await wx.navigateTo({ url: '/pages/showcase', routeType: 'scaleDown' })
    expect(adapterMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/showcase', routeType: 'scaleDown' })
    wx.navigateBack()
    expect(adapterMock.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    wx.navigateBack({ delta: 2 })
    expect(adapterMock.navigateBack).toHaveBeenCalledWith({ delta: 2 })
    expect(wx.getCurrentPages()).toEqual([])
  })

  it('存储 API（setStorageSync/getStorageSync JSON round-trip + remove）', () => {
    wx.setStorageSync('k', { t: 1, s: 'x' })
    expect(wx.getStorageSync('k')).toEqual({ t: 1, s: 'x' })
    wx.removeStorageSync('k')
    expect(wx.getStorageSync('k')).toBeUndefined()
  })

  it('系统信息 API（getSystemInfoSync 浏览器信息字段）', () => {
    const info = wx.getSystemInfoSync()
    expect(info.windowWidth).toBe(375)
    expect(info.language).toBe('zh-CN')
    expect(info.pixelRatio).toBeGreaterThan(0)
  })

  it('open-type 降级事件映射（share → openshare；contact → opencontact）', () => {
    expect(OPEN_TYPE_EVENTS.share).toBe('openshare')
    expect(OPEN_TYPE_EVENTS.contact).toBe('opencontact')
    expect(OPEN_TYPE_EVENTS.getUserInfo).toBe('opengetuseroinfo')
    expect(OPEN_TYPE_EVENTS.getPhoneNumber).toBe('opengetphonenumber')
  })

  it('installWxApi 注入全局 wx', () => {
    installWxApi()
    expect((globalThis as { wx?: unknown }).wx).toBe(wx)
  })
})

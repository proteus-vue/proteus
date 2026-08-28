// src/platform/mp-adapter.ts
// 小程序端适配器（P3-5）：代理 wx.*
// 所有失败静默 resolve，降级策略由调用方（router）决定
import type { PlatformAdapter, PageInstance } from './adapter'

function norm(p: any): PageInstance {
  return { route: p.route || p.__route__ || '', setData: p.setData?.bind(p) }
}

export function createMpAdapter(): PlatformAdapter {
  return {
    isMP: true,
    getCurrentPages: () => {
      if (typeof wx === 'undefined' || !wx.getCurrentPages) return []
      return wx.getCurrentPages().map(norm)
    },
    navigateTo: (opts) =>
      new Promise((resolve) => {
        // 自定义路由跳转走 skyline.ts 的 navigateWithCustomRoute（含 routeType），此处无需转发
        wx.navigateTo({ url: opts.url, success: () => resolve(), fail: () => resolve() })
      }),
    redirectTo: (opts) =>
      new Promise((resolve) => {
        wx.redirectTo({ url: opts.url, success: () => resolve(), fail: () => resolve() })
      }),
    reLaunch: (opts) =>
      new Promise((resolve) => {
        wx.reLaunch({ url: opts.url, success: () => resolve(), fail: () => resolve() })
      }),
    switchTab: (opts) =>
      new Promise((resolve) => {
        wx.switchTab({ url: opts.url, success: () => resolve(), fail: () => resolve() })
      }),
    navigateBack: ({ delta }) => {
      wx.navigateBack({ delta })
    },
  }
}

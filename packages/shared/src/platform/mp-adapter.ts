// src/platform/mp-adapter.ts
// 小程序端适配器（P3-5）：代理 wx.*
// 所有失败静默 resolve，降级策略由调用方（router）决定
import type { PlatformAdapter, PageInstance, Rect } from './adapter'

function norm(p: any): PageInstance {
  return { route: p.route || p.__route__ || '', setData: p.setData?.bind(p) }
}

// boundingClientRect 回调在元素缺失时可能返回 null/undefined 或缺失部分字段——统一归一化
function normalizeRect(rect: Rect | null | undefined): Rect | null {
  if (!rect || typeof rect.left !== 'number' || typeof rect.top !== 'number') return null
  return {
    top: rect.top,
    left: rect.left,
    right: typeof rect.right === 'number' ? rect.right : rect.left,
    bottom: typeof rect.bottom === 'number' ? rect.bottom : rect.top,
    width: typeof rect.width === 'number' ? rect.width : rect.right - rect.left,
    height: typeof rect.height === 'number' ? rect.height : rect.bottom - rect.top,
  }
}

export function createMpAdapter(): PlatformAdapter {
  return {
    isMP: true,
    getCurrentPages: () => {
      // ★getCurrentPages 是全局函数（官方 typings 声明），不在 wx.* 上
      if (typeof wx === 'undefined' || typeof getCurrentPages !== 'function') return []
      return getCurrentPages().map(norm)
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
    measureRect: (selector, scope) =>
      // ★平台层许可直接碰 wx.*（no-platform-api 审计 allow: platforms/**/packages/api/**）；组件经此 L2 抽象消费
      new Promise((resolve) => {
        if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return resolve(null)
        // ★scope 传入 → .in(scope) 下探到 p-* 自定义组件内部（页面级 query 查不到组件内 trigger——glass-easel 隔离）
        const query = wx.createSelectorQuery()
        // ★scope 类型收窄（unknown → 组件/页面实例）；无 scope → 页面级查询
        const inQuery = scope ? query.in(scope as never) : query
        inQuery
          .select(selector)
          .boundingClientRect((rect: Rect | null | undefined) => resolve(normalizeRect(rect)))
          .exec()
      }),
  }
}

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
        // ★2026-09-08 二轮修复：scope 传组件实例时优先用 **scope.createSelectorQuery()**（官方组件内查询形态——
        //   glass-easel 组件实例自带该方法；wx.createSelectorQuery().in(scope) 在 Skyline/glass-easel 实测查不到组件内元素：
        //   属性选择器/id/类选择器三选均返 null——p-popover 面板落左上角根因）。无 scope/无该方法 → 页面级查询。
        interface QueryLike {
          select(s: string): {
            boundingClientRect(cb: (r: Rect | null | undefined) => void): { exec(): void }
            exec(): void
          }
        }
        const scopeQ = scope as { createSelectorQuery?: () => QueryLike } | undefined
        const inQuery: QueryLike =
          scopeQ && typeof scopeQ.createSelectorQuery === 'function'
            ? scopeQ.createSelectorQuery()
            : (wx.createSelectorQuery() as unknown as QueryLike)
        inQuery
          .select(selector)
          .boundingClientRect((rect: Rect | null | undefined) => resolve(normalizeRect(rect)))
          .exec()
      }),
  }
}

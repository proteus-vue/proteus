// src/platform/adapter.ts
// ============================================================
// 平台无关的运行时能力抽象（P1-6，核心契约）
//
// - MP 端实现（mp-adapter.ts，P3-5）：代理 wx.*
// - Web 端实现（web-adapter.ts，P3-5）：基于 History API / popstate
// - 业务代码、router、runtime 模块只允许依赖此接口，禁止直连 wx
//   （skyline.ts 是唯一允许访问 wx.router 的模块）
// ============================================================

/** 页面栈中的页面实例（MP 为 wx 页面实例的投影；Web 为路由描述对象） */
export interface PageInstance {
  route: string
  setData?(data: Record<string, unknown>): void
}

export interface PlatformAdapter {
  /** 是否为小程序环境 */
  isMP: boolean
  /** 当前页面栈（MP 返回完整栈；Web 返回长度 1 的当前页） */
  getCurrentPages(): PageInstance[]
  /** 导航（MP: navigateTo；Web: history.pushState） */
  navigateTo(opts: { url: string; routeType?: string }): Promise<void>
  /** 替换当前页（MP: redirectTo；Web: history.replaceState） */
  redirectTo(opts: { url: string }): Promise<void>
  /** 重启（MP: reLaunch；Web: replaceState） */
  reLaunch(opts: { url: string }): Promise<void>
  /** 切换 Tab（MP: switchTab；Web: 同 navigateTo 语义） */
  switchTab(opts: { url: string }): Promise<void>
  /** 后退（MP: navigateBack；Web: history.go(-delta)） */
  navigateBack(opts: { delta: number }): void
  /**
   * 订阅路由变化（Web 端 popstate 驱动，供 RouterView 渲染）
   * routeType 用于 CSS 转场；nav 为导航类型（forward=navigateTo / back / replace=redirectTo / reLaunch / switchTab）
   */
  onPageLoad?(
    cb: (
      route: string,
      query: Record<string, string>,
      routeType?: string,
      nav?: 'forward' | 'back' | 'replace' | 'reLaunch' | 'switchTab',
    ) => void,
  ): void
}

/** 路由变化事件载荷（Web 端使用） */
export interface RouteChangeEvent {
  route: string
  query: Record<string, string>
}

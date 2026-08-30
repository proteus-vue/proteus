// packages/web/src/wx.ts
// ★wx API Web 模拟层（14-mp-first-semantics：以小程序为标准，Web 端对齐）
// 能力矩阵（反黑盒）：
//   full    完整对齐（路由→adapter、存储→localStorage、系统信息→浏览器信息）
//   partial 部分对齐（交互/网络，批次 2 DOM 实现）
//   event   无 Web 对等（支付/扫码等业务能力→触发自定义钩子/警告）
import { adapter } from '@proteus-vue/shared'

export interface WxApi {
  // ===== 路由（full：代理 PlatformAdapter，Web 端 history 驱动 RouterView 转场）=====
  navigateTo(opts: { url: string; routeType?: string }): Promise<void>
  redirectTo(opts: { url: string }): Promise<void>
  reLaunch(opts: { url: string }): Promise<void>
  switchTab(opts: { url: string }): Promise<void>
  navigateBack(opts?: { delta?: number }): void
  getCurrentPages(): Array<{ route: string }>
  /** ★15-page-scroll-container：滚动到指定位置（MP 桥接到自动包装 scroll-view；Web window.scrollTo） */
  pageScrollTo(opts?: { scrollTop?: number; duration?: number }): void

  // ===== 存储（full：localStorage，JSON 序列化对齐小程序）=====
  setStorageSync(key: string, data: unknown): void
  getStorageSync(key: string): unknown
  removeStorageSync(key: string): void
  clearStorageSync(): void

  // ===== 系统信息（full：浏览器信息）=====
  getSystemInfoSync(): Record<string, unknown>
  getDeviceInfo(): Record<string, unknown>

  // ===== 交互（partial：DOM 实现，批次 2 完善）=====
  showToast(opts?: { title?: string; icon?: 'success' | 'error' | 'loading' | 'none'; duration?: number }): void
  showLoading(opts?: { title?: string }): void
  hideLoading(): void
  showModal(opts: { title?: string; content?: string; showCancel?: boolean }): Promise<{ confirm: boolean }>
  showActionSheet(opts: { itemList: string[] }): Promise<{ tapIndex: number }>

  // ===== 网络（partial：fetch 封装）=====
  request(opts: { url: string; method?: string; data?: unknown; header?: Record<string, string> }): Promise<{ statusCode: number; data: unknown }>

  // ===== 业务能力（event：无 Web 对等，降级提示）=====
  /** 微信支付（Web 无对等）——触发自定义钩子 proteusWebPay 或警告 */
  requestPayment(_opts: unknown): Promise<never>
}

/** wx API Web 实现（以 PlatformAdapter 路由 + 浏览器能力对齐小程序语义） */
export const wx: WxApi = {
  navigateTo(opts) {
    return adapter.navigateTo(opts)
  },
  redirectTo(opts) {
    return adapter.redirectTo(opts)
  },
  reLaunch(opts) {
    return adapter.reLaunch(opts)
  },
  switchTab(opts) {
    return adapter.switchTab(opts)
  },
  navigateBack(opts) {
    adapter.navigateBack({ delta: opts?.delta ?? 1 })
  },
  getCurrentPages() {
    return adapter.getCurrentPages()
  },

  pageScrollTo(opts) {
    // Web 端页面滚动 = window 滚动（无自动包装容器）
    window.scrollTo({ top: opts?.scrollTop ?? 0, behavior: opts?.duration ? 'smooth' : 'auto' })
  },

  setStorageSync(key, data) {
    localStorage.setItem(key, JSON.stringify(data))
  },
  getStorageSync(key) {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? undefined : (JSON.parse(raw) as unknown)
    } catch {
      return undefined
    }
  },
  removeStorageSync(key) {
    localStorage.removeItem(key)
  },
  clearStorageSync() {
    localStorage.clear()
  },

  getSystemInfoSync() {
    const nav = navigator as Navigator & { userAgentData?: { platform: string } }
    return {
      platform: nav.userAgentData?.platform ?? navigator.platform,
      system: `${navigator.userAgent}`,
      brand: 'Web',
      model: 'Web',
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      pixelRatio: window.devicePixelRatio,
      language: navigator.language,
      version: '',
    }
  },
  getDeviceInfo() {
    return {
      brand: 'Web',
      model: 'Web',
      system: navigator.userAgent,
      platform: navigator.userAgent,
    }
  },

  // ★交互（partial）：MVP 简易 DOM toast/loading/modal——批次 2 对齐 runtime 组件样式
  showToast(opts) {
    const icon = opts?.icon && opts.icon !== 'none' ? opts.icon : ''
    const el = document.createElement('div')
    el.textContent = `${icon ? `[${icon}] ` : ''}${opts?.title ?? ''}`
    el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;padding:12px 24px;border-radius:8px;z-index:99999;font-size:14px;'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), opts?.duration ?? 1500)
  },
  showLoading(opts) {
    const el = document.createElement('div')
    el.textContent = opts?.title ?? '加载中…'
    el.id = 'proteus-web-loading'
    el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);color:#fff;padding:16px 24px;border-radius:8px;z-index:99999;font-size:14px;'
    document.body.appendChild(el)
  },
  hideLoading() {
    document.getElementById('proteus-web-loading')?.remove()
  },
  showModal(opts) {
    return new Promise((resolve) => {
      const ok = window.confirm(opts?.content ?? opts?.title ?? '')
      resolve({ confirm: ok })
    })
  },
  showActionSheet(opts) {
    const pick = window.prompt(`选择（输入序号 0-${opts.itemList.length - 1}）：\n${opts.itemList.map((s, i) => `${i}. ${s}`).join('\n')}`)
    const idx = pick === null ? -1 : Math.max(0, Math.min(opts.itemList.length - 1, Number(pick) || 0))
    return Promise.resolve({ tapIndex: idx })
  },

  async request(opts) {
    const res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers: opts.header,
      body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined,
    })
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      /* 非 JSON 原样返回 */
    }
    return { statusCode: res.status, data }
  },

  requestPayment(_opts) {
    // ★开放能力降级（反黑盒）：微信支付 Web 无对等——支持自定义钩子 window.__proteusWebPay 覆盖
    const custom = (window as unknown as { __proteusWebPay?: (opts: unknown) => Promise<void> }).__proteusWebPay
    if (custom) return custom(_opts).then(() => undefined as never)
    return Promise.reject(new Error('[proteus-web] wx.requestPayment 微信支付在 Web 端无对等实现——请用 window.__proteusWebPay 自定义'))
  },
}

/** 注入全局 wx（小程序语义 API 门面；Web 端运行时也可读 wx.getCurrentPages 等） */
export function installWxApi(): void {
  ;(globalThis as { wx?: WxApi }).wx = wx
}

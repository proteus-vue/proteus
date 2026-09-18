// packages/web/src/wx.ts
// ★wx API Web 模拟层（14-mp-first-semantics：以小程序为标准，Web 端对齐）
// 能力矩阵（反黑盒）：
//   full    完整对齐（路由→adapter、存储→localStorage、系统信息→浏览器信息）
//   partial 部分对齐（交互/网络，批次 2 DOM 实现）
//   event   无 Web 对等（支付/扫码等业务能力→触发自定义钩子/警告）
import { adapter } from '@proteus-vue/shared'

/** 转义 HTML（自定义 UI 注入 title/content 防 XSS） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

  // ===== 交互（partial→full：自定义 DOM UI 对齐微信表现）=====
  showToast(opts?: { title?: string; icon?: 'success' | 'error' | 'loading' | 'none'; duration?: number }): void
  hideToast(): void
  showLoading(opts?: { title?: string }): void
  hideLoading(): void
  /** ★WeUI 三种对话框样式：双按钮（默认）/ 单按钮（showCancel:false）/ 可输入（editable:true）
   *  返回对齐小程序：{ confirm, cancel, errMsg }（editable 时含 content） */
  showModal(opts: {
    title?: string
    content?: string
    showCancel?: boolean
    cancelText?: string
    cancelColor?: string
    confirmText?: string
    confirmColor?: string
    editable?: boolean
    placeholderText?: string
    /** ★微信语义：回调式结果（PlatformAPI wx 分支靠 success 转发 Promise） */
    success?: (res: { confirm: boolean; cancel: boolean; errMsg: string; content?: string }) => void
    fail?: (err: unknown) => void
  }): Promise<{ confirm: boolean; cancel: boolean; errMsg: string; content?: string }>
  showActionSheet(opts: {
    itemList: string[]
    success?: (res: { tapIndex: number; errMsg: string }) => void
    fail?: (err: unknown) => void
  }): Promise<{ tapIndex: number; errMsg: string }>

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

  // ★交互（15-page-scroll-container 之后批次 2 完善）：自定义 DOM UI 对齐微信表现（遮罩/弹层/按钮/图标）
  //   样式类见 @proteus-vue/web/style.css（proteus-web-ui 段）
  showToast(opts) {
    const title = opts?.title ?? ''
    // ★微信语义：不传 icon → 默认 success（对勾）；icon:'none' → 无图标；'success'/'error'/'loading' 对应
    const icon = opts?.icon === undefined ? 'success' : opts.icon === 'none' ? '' : opts.icon
    // ★toast 图标对齐微信：success = 无底色白色细勾（SVG）；error = 白色圆底黑色叹号（SVG）；loading = spinner
    const iconHtml =
      icon === 'success'
        ? '<div class="pwu-icon"><svg class="pwu-svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5L10 17.5L19 6.5"/></svg></div>'
        : icon === 'error'
          ? '<div class="pwu-icon"><svg class="pwu-svg" viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="12" fill="#ffffff"/><rect x="10.8" y="5" width="2.4" height="9" rx="1.2" fill="#000000"/><circle cx="12" cy="17.5" r="1.7" fill="#000000"/></svg></div>'
          : icon === 'loading'
            ? '<div class="pwu-icon pwu-icon-loading"></div>'
            : ''
    const el = document.createElement('div')
    // ★样式类：图标态 --icon（方形）/ 纯文字态 --text（WeUI weui-toast_text：小 padding）
    const mod = icon ? ' proteus-web-toast--icon' : ' proteus-web-toast--text'
    el.className = 'proteus-web-toast' + mod
    el.innerHTML = `${iconHtml}${title ? `<div class="pwu-toast-title">${escapeHtml(title)}</div>` : ''}`
    document.body.appendChild(el)
    if (icon === 'loading') {
      // loading toast 常驻（对齐 wx.showToast({ icon: 'loading' })），需 wx.hideToast 关闭
      el.classList.add('proteus-web-toast--loading')
    } else {
      setTimeout(() => el.remove(), opts?.duration ?? 1500)
    }
  },
  hideToast() {
    document.querySelectorAll('.proteus-web-toast').forEach((el) => el.remove())
  },
  showLoading(opts) {
    const el = document.createElement('div')
    el.id = 'proteus-web-loading'
    el.className = 'proteus-web-toast proteus-web-toast--loading'
    el.innerHTML = `<div class="pwu-icon pwu-icon-loading"></div>${opts?.title ? `<div class="pwu-toast-title">${escapeHtml(opts.title)}</div>` : ''}`
    document.body.appendChild(el)
  },
  hideLoading() {
    document.getElementById('proteus-web-loading')?.remove()
  },
  showModal(opts) {
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'proteus-web-ui-mask'
      const box = document.createElement('div')
      // ★WeUI 三种对话框样式：无标题时内容上下对称居中（.pwu-modal--no-title）
      box.className = 'proteus-web-modal' + (opts?.title ? '' : ' pwu-modal--no-title')
      // editable 可输入弹窗（微信 showModal editable/placeholderText）
      const editable = !!opts?.editable
      box.innerHTML =
        `${opts?.title ? `<div class="pwu-modal-title">${escapeHtml(opts.title)}</div>` : ''}` +
        `<div class="pwu-modal-content">${escapeHtml(opts?.content ?? '')}</div>` +
        (editable
          ? `<input class="pwu-modal-input" placeholder="${escapeHtml(opts?.placeholderText ?? '')}" />`
          : '') +
        `<div class="pwu-modal-btns">` +
        `${opts?.showCancel !== false ? `<button class="pwu-modal-btn pwu-modal-btn--cancel"${opts?.cancelColor ? ` style="color:${opts.cancelColor}"` : ''}>${escapeHtml(opts?.cancelText ?? '取消')}</button>` : ''}` +
        `<button class="pwu-modal-btn pwu-modal-btn--confirm"${opts?.confirmColor ? ` style="color:${opts.confirmColor}"` : ''}>${escapeHtml(opts?.confirmText ?? '确定')}</button>` +
        '</div>'
      document.body.appendChild(mask)
      document.body.appendChild(box)
      const done = (confirm: boolean): void => {
        // editable 时 resolve content 为输入值（对齐微信返回）
        const input = box.querySelector('.pwu-modal-input') as HTMLInputElement | null
        mask.remove()
        box.remove()
        // ★返回对齐小程序：{ confirm, cancel, errMsg }（confirm/cancel 互补）
        const base = { confirm, cancel: !confirm, errMsg: 'showModal:ok' }
        if (editable) {
          const withContent = { ...base, content: input?.value ?? '' }
          resolve(withContent)
          // ★微信语义：回调式 success/fail（PlatformAPI 的 wx 分支靠 success 转发 resolve）
          if (opts?.success) opts.success(withContent)
        } else {
          resolve(base)
          if (opts?.success) opts.success(base)
        }
      }
      box.querySelector('.pwu-modal-btn--cancel')?.addEventListener('click', () => done(false))
      box.querySelector('.pwu-modal-btn--confirm')?.addEventListener('click', () => done(true))
      mask.addEventListener('click', () => done(false))
    })
  },
  showActionSheet(opts) {
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'proteus-web-ui-mask'
      const sheet = document.createElement('div')
      sheet.className = 'proteus-web-actionsheet'
      const items = opts.itemList
        .map((s, i) => `<button class="pwu-sheet-item" data-i="${i}">${escapeHtml(s)}</button>`)
        .join('')
      sheet.innerHTML = `${items}<button class="pwu-sheet-cancel">取消</button>`
      document.body.appendChild(mask)
      document.body.appendChild(sheet)
      const done = (tapIndex: number): void => {
        mask.remove()
        sheet.remove()
        // ★微信语义：回调式 success/fail（PlatformAPI 的 wx 分支靠 success 转发 resolve）
        const result = { tapIndex, errMsg: 'showActionSheet:ok' }
        resolve(result)
        if (opts?.success) opts.success(result)
      }
      sheet.querySelectorAll('.pwu-sheet-item').forEach((b) => {
        b.addEventListener('click', () => done(Number((b as HTMLElement).dataset.i)))
      })
      sheet.querySelector('.pwu-sheet-cancel')?.addEventListener('click', () => done(-1))
      mask.addEventListener('click', () => done(-1))
    })
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
    // 对齐小程序 request：非 2xx 走 fail（reject）
    if (res.status < 200 || res.status >= 300) {
      return Promise.reject(new Error(`[proteus-web] wx.request 失败：${res.status} ${res.statusText}`))
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

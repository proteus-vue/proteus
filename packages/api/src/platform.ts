// packages/api/src/platform.ts
// ★types-plus-plan B9：PlatformAPI 契约的运行时统一实例（request/storage/router/ui 四域，wx/web 双端适配）
// 定位：业务层只依赖 @proteus-vue/types 的 PlatformAPI 类型 + 本工厂——不出现 wx./window. 裸调用。
// ★MP 产物安全（决策 #32/#36）：无 ?. / ?? / 对象展开 / 数组解构（显式 null 检查）
// ★平台探测：globalThis 窄类型（与 adapters.ts 一致，api 包不直接 import 官方包，保持轻量）
import type {
  ActionSheetOptions,
  ActionSheetResult,
  ModalOptions,
  ModalResult,
  PlatformAPI,
  RequestConfig,
  RequestResponse,
  RouterAPI,
  StorageAPI,
  UIAPI,
} from '@proteus-vue/types/platform-api'
import type { IRequestAdapter } from '@proteus-vue/types/api-types'
import { createRequestAdapter } from './adapters'

/** wx 窄类型（B9 官方类型桥的运行时形态——api 包 tsconfig 不激活官方全局，用 globalThis 显式窄化） */
interface WxGlobal {
  setStorageSync?: (key: string, value: unknown) => void
  getStorageSync?: (key: string) => unknown
  removeStorageSync?: (key: string) => void
  clearStorageSync?: () => void
  navigateTo?: (opt: { url: string }) => void
  redirectTo?: (opt: { url: string }) => void
  switchTab?: (opt: { url: string }) => void
  reLaunch?: (opt: { url: string }) => void
  navigateBack?: (opt: { delta?: number }) => void
  showToast?: (opt: { title: string; duration?: number; icon?: string }) => void
  showModal?: (opt: {
    title?: string
    content?: string
    showCancel?: boolean
    confirmText?: string
    cancelText?: string
    success?: (res: { confirm: boolean; cancel: boolean }) => void
  }) => void
  showActionSheet?: (opt: { itemList: string[]; success?: (res: { tapIndex: number }) => void }) => void
  showLoading?: (opt: { title?: string }) => void
  hideLoading?: () => void
}

function getWx(): WxGlobal | undefined {
  return (globalThis as { wx?: WxGlobal }).wx
}

/** 拼接 query 到 url（wx 与 web 共用） */
function withQuery(url: string, query?: Record<string, string>): string {
  if (!query) return url
  const qs = Object.keys(query)
    .filter((k) => query[k] !== undefined)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

// ---------------- storage ----------------

function createStorageAPI(): StorageAPI {
  const wx = getWx()
  if (wx && typeof wx.setStorageSync === 'function') {
    return {
      get: <T>(key: string) => (wx.getStorageSync ? (wx.getStorageSync(key) as T | undefined) : undefined),
      set: (key, value) => {
        if (wx.setStorageSync) wx.setStorageSync(key, value)
      },
      remove: (key) => {
        if (wx.removeStorageSync) wx.removeStorageSync(key)
      },
      clear: () => {
        if (wx.clearStorageSync) wx.clearStorageSync()
      },
    }
  }
  const ls = (globalThis as { localStorage?: Storage }).localStorage
  if (ls) {
    return {
      get: <T>(key: string) => {
        const raw = ls.getItem(key)
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      },
      set: (key, value) => {
        ls.setItem(key, JSON.stringify(value))
      },
      remove: (key) => {
        ls.removeItem(key)
      },
      clear: () => {
        ls.clear()
      },
    }
  }
  // 兜底：内存 Map（Node/SSR 环境）
  const mem = new Map<string, string>()
  return {
    get: <T>(key: string) => {
      const raw = mem.get(key)
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    set: (key, value) => {
      mem.set(key, JSON.stringify(value))
    },
    remove: (key) => {
      mem.delete(key)
    },
    clear: () => {
      mem.clear()
    },
  }
}

// ---------------- router ----------------

function createRouterAPI(): RouterAPI {
  const wx = getWx()
  if (wx && typeof wx.navigateTo === 'function') {
    return {
      push: (url, query) => {
        if (wx.navigateTo) wx.navigateTo({ url: withQuery(url, query) })
      },
      replace: (url, query) => {
        if (wx.redirectTo) wx.redirectTo({ url: withQuery(url, query) })
      },
      switchTab: (url, query) => {
        if (wx.switchTab) wx.switchTab({ url: withQuery(url, query) })
      },
      reLaunch: (url, query) => {
        if (wx.reLaunch) wx.reLaunch({ url: withQuery(url, query) })
      },
      back: (delta) => {
        if (wx.navigateBack) wx.navigateBack({ delta: delta === undefined ? 1 : delta })
      },
    }
  }
  // Web：pushState + 手动 popstate（框架 web-adapter/RouterView 监听 popstate 驱动路由）
  // ★switchTab/reLaunch 无微信 tab 语义，映射为 replace（决策：Web 端 tab 由路由层处理）
  const replaceState = (url: string, query?: Record<string, string>): void => {
    const full = withQuery(url, query)
    window.history.replaceState({ proteusPlatformApi: full }, '', full)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return {
    push: (url, query) => {
      const full = withQuery(url, query)
      window.history.pushState({ proteusPlatformApi: full }, '', full)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
    replace: (url, query) => replaceState(url, query),
    switchTab: (url, query) => replaceState(url, query),
    reLaunch: (url, query) => replaceState(url, query),
    back: (delta) => {
      const n = delta === undefined ? 1 : delta
      for (let i = 0; i < n; i++) window.history.back()
    },
  }
}

// ---------------- ui ----------------

let toastEl: HTMLElement | null = null

function hideDomToast(): void {
  if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl)
  toastEl = null
}

/** Web/Node 兜底 toast（document 存在时 DOM，否则 console 降级——SSR/测试安全） */
function showDomToast(message: string, loading = false): void {
  const doc = (globalThis as { document?: Document }).document
  if (!doc || typeof doc.createElement !== 'function') {
    console.info(`[proteus-ui] ${message}`)
    return
  }
  hideDomToast()
  const el = doc.createElement('div')
  el.className = 'proteus-toast'
  el.textContent = message
  el.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(0,0,0,0.75);color:#fff;padding:10px 16px;border-radius:8px;' +
    'z-index:9999;font-size:14px;pointer-events:none'
  if (loading) el.style.background = 'rgba(0,0,0,0.55)'
  if (doc.body) doc.body.appendChild(el)
  toastEl = el
  if (!loading) setTimeout(hideDomToast, 1500)
}

function createUIAPI(): UIAPI {
  const wx = getWx()
  if (wx && typeof wx.showToast === 'function') {
    return {
      showToast: (message, duration) => {
        if (wx.showToast) wx.showToast({ title: message, duration: duration === undefined ? 1500 : duration })
      },
      showLoading: (title) => {
        if (wx.showLoading) wx.showLoading({ title })
      },
      hideLoading: () => {
        if (wx.hideLoading) wx.hideLoading()
      },
      showModal: (options) =>
        new Promise((resolve) => {
          if (!wx.showModal) {
            resolve({ confirm: false, cancel: true })
            return
          }
          wx.showModal({
            title: options?.title,
            content: options?.content,
            showCancel: options?.showCancel,
            confirmText: options?.confirmText,
            cancelText: options?.cancelText,
            success: (res) => resolve(res),
          })
        }),
      showActionSheet: (options) =>
        new Promise((resolve) => {
          if (!wx.showActionSheet) {
            resolve({ tapIndex: -1 })
            return
          }
          wx.showActionSheet({ itemList: options.itemList, success: (res) => resolve(res) })
        }),
    }
  }
  return {
    showToast: (message) => showDomToast(message, false),
    showLoading: (title) => showDomToast(title === undefined ? '加载中' : title, true),
    hideLoading: hideDomToast,
    showModal: showDomModal,
    showActionSheet: showDomActionSheet,
  }
}

// ---------------- DOM modal / actionSheet（Web 端；内联样式，不依赖平台模拟层 CSS） ----------------

interface DomOverlay {
  mask: HTMLElement
  box: HTMLElement
}

function createDomOverlay(doc: Document, className: string): DomOverlay {
  const mask = doc.createElement('div')
  mask.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;' + 'display:flex;align-items:center;justify-content:center'
  mask.className = className
  const box = doc.createElement('div')
  box.style.cssText =
    'background:#fff;border-radius:12px;padding:16px;min-width:260px;max-width:320px;' + 'box-shadow:0 8px 24px rgba(0,0,0,0.2);text-align:center'
  if (doc.body) doc.body.appendChild(mask)
  mask.appendChild(box)
  return { mask, box }
}

function removeDomOverlay(overlay: DomOverlay): void {
  if (overlay.mask.parentNode) overlay.mask.parentNode.removeChild(overlay.mask)
}

/** Web 端 showModal：确认/取消对话框（返回 { confirm, cancel }） */
function showDomModal(options?: ModalOptions): Promise<ModalResult> {
  const doc = (globalThis as { document?: Document }).document
  if (!doc || typeof doc.createElement !== 'function') {
    console.info(`[proteus-ui] showModal: ${options?.content ?? ''}`)
    return Promise.resolve({ confirm: true, cancel: false })
  }
  return new Promise((resolve) => {
    const overlay = createDomOverlay(doc, 'proteus-modal')
    const { box } = overlay
    const title = doc.createElement('div')
    title.textContent = options?.title ?? ''
    title.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:8px'
    const content = doc.createElement('div')
    content.textContent = options?.content ?? ''
    content.style.cssText = 'font-size:14px;color:#666;margin-bottom:16px'
    box.appendChild(title)
    box.appendChild(content)
    const finish = (result: ModalResult): void => {
      removeDomOverlay(overlay)
      resolve(result)
    }
    const btnWrap = doc.createElement('div')
    btnWrap.style.cssText = 'display:flex;gap:8px;justify-content:center'
    const showCancel = options?.showCancel !== false
    const makeBtn = (text: string, primary: boolean): HTMLElement => {
      const btn = doc.createElement('button')
      btn.textContent = text
      btn.style.cssText =
        'border:none;border-radius:6px;padding:6px 16px;font-size:14px;cursor:pointer;' +
        (primary ? 'background:#07c160;color:#fff' : 'background:#f2f3f5;color:#333')
      return btn
    }
    if (showCancel) {
      const cancelBtn = makeBtn(options?.cancelText ?? '取消', false)
      cancelBtn.onclick = () => finish({ confirm: false, cancel: true })
      btnWrap.appendChild(cancelBtn)
    }
    const confirmBtn = makeBtn(options?.confirmText ?? '确定', true)
    confirmBtn.onclick = () => finish({ confirm: true, cancel: false })
    btnWrap.appendChild(confirmBtn)
    box.appendChild(btnWrap)
    overlay.mask.onclick = () => finish({ confirm: false, cancel: true })
  })
}

/** Web 端 showActionSheet：操作菜单（取消 tapIndex=-1） */
function showDomActionSheet(options: ActionSheetOptions): Promise<ActionSheetResult> {
  const doc = (globalThis as { document?: Document }).document
  if (!doc || typeof doc.createElement !== 'function') {
    console.info(`[proteus-ui] showActionSheet: ${options.itemList.join(' / ')}`)
    return Promise.resolve({ tapIndex: -1 })
  }
  return new Promise((resolve) => {
    const overlay = createDomOverlay(doc, 'proteus-actionsheet')
    const { box } = overlay
    box.style.cssText = box.style.cssText + ';padding:8px 0;overflow:hidden'
    const finish = (result: ActionSheetResult): void => {
      removeDomOverlay(overlay)
      resolve(result)
    }
    options.itemList.forEach((item, idx) => {
      const row = doc.createElement('div')
      row.className = 'proteus-actionsheet-item'
      row.textContent = item
      row.style.cssText =
        'padding:12px 16px;font-size:15px;cursor:pointer;border-bottom:1px solid #f0f0f0;' + 'text-align:center'
      row.onclick = () => finish({ tapIndex: idx })
      box.appendChild(row)
    })
    const cancelRow = doc.createElement('div')
    cancelRow.className = 'proteus-actionsheet-cancel'
    cancelRow.textContent = options.cancelText ?? '取消'
    cancelRow.style.cssText = 'padding:12px 16px;font-size:15px;cursor:pointer;text-align:center;color:#999'
    cancelRow.onclick = () => finish({ tapIndex: -1 })
    box.appendChild(cancelRow)
    overlay.mask.onclick = () => finish({ tapIndex: -1 })
  })
}

// ---------------- 统一实例 ----------------

/**
 * 创建 PlatformAPI 运行时统一实例（业务层唯一平台 API 入口）
 * @param adapter 请求适配器（缺省自动平台探测：wx.request / fetch）
 */
export function createPlatformAPI(adapter?: IRequestAdapter): PlatformAPI {
  const requestAdapter = adapter === undefined ? createRequestAdapter() : adapter
  return {
    request: <T = unknown>(config: RequestConfig) => requestAdapter.request<T>(config) as Promise<RequestResponse<T>>,
    storage: createStorageAPI(),
    router: createRouterAPI(),
    ui: createUIAPI(),
  }
}

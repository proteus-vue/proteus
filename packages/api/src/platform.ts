// packages/api/src/platform.ts
// ★types-plus-plan B9：PlatformAPI 契约的运行时统一实例（request/storage/router/ui 四域，wx/web 双端适配）
// 定位：业务层只依赖 @proteus-vue/types 的 PlatformAPI 类型 + 本工厂——不出现 wx./window. 裸调用。
// ★MP 产物安全（决策 #32/#36）：无 ?. / ?? / 对象展开 / 数组解构（显式 null 检查）
// ★平台探测：globalThis 窄类型（与 adapters.ts 一致，api 包不直接 import 官方包，保持轻量）
import type { PlatformAPI, RequestConfig, RequestResponse, RouterAPI, StorageAPI, UIAPI } from '@proteus-vue/types/platform-api'
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
  navigateBack?: (opt: { delta?: number }) => void
  showToast?: (opt: { title: string; duration?: number; icon?: string }) => void
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
      back: (delta) => {
        if (wx.navigateBack) wx.navigateBack({ delta: delta === undefined ? 1 : delta })
      },
    }
  }
  // Web：pushState + 手动 popstate（框架 web-adapter/RouterView 监听 popstate 驱动路由）
  return {
    push: (url, query) => {
      const full = withQuery(url, query)
      window.history.pushState({ proteusPlatformApi: full }, '', full)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
    replace: (url, query) => {
      const full = withQuery(url, query)
      window.history.replaceState({ proteusPlatformApi: full }, '', full)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
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
    }
  }
  return {
    showToast: (message) => showDomToast(message, false),
    showLoading: (title) => showDomToast(title === undefined ? '加载中' : title, true),
    hideLoading: hideDomToast,
  }
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

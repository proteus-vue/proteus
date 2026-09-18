// packages/api/src/adapters.ts
// ★api-plan A1/A8：平台适配器（wx.request / fetch）+ 设备信息——L2 唯一允许平台 API 的位置
// ★Skyline 线收口（2026-09-11）：运行时/渲染器判定走 @proteus-vue/shared SSOT（window 前置守卫 +
//   Skyline vs WebView 区分）——修「web 上 wx 模拟层使 createRequestAdapter 误选 wx」+ isSkyline 假阳性
import { detectRuntime, detectMpRenderer } from '@proteus-vue/shared'
import type { HttpMethod, IRequestAdapter, RequestConfig, RequestResponse } from './types'
import { ApiError } from './types'

export { ApiError }

/** wx.request 包装（小程序）；未提供 wx 时抛错（平台探测失败显式失败） */
function createWxAdapter(): IRequestAdapter {
  return {
    name: 'wx',
    request<T>(config: RequestConfig): Promise<RequestResponse<T>> {
      const wxGlobal = (globalThis as { wx?: { request?: (opts: Record<string, unknown>) => void } }).wx
      if (!wxGlobal || typeof wxGlobal.request !== 'function') {
        return Promise.reject(new ApiError('ADAPTER_UNAVAILABLE', 'wx.request 不可用（非小程序环境）', undefined, config))
      }
      const fullUrl = buildUrl(config.baseURL ?? '', config.url, config.params)
      return new Promise<RequestResponse<T>>((resolve, reject) => {
        wxGlobal.request!({
          url: fullUrl,
          method: (config.method ?? 'GET') as string,
          data: config.data,
          header: config.headers,
          timeout: config.timeout ?? 15000,
          success: (res: { statusCode: number; data: unknown; header: Record<string, string> }) => {
            resolve({ data: res.data as T, status: res.statusCode, headers: res.header, config })
          },
          fail: (err: { errMsg?: string }) => {
            reject(new ApiError('NETWORK_ERROR', err.errMsg ?? 'wx.request 失败', undefined, config))
          },
        })
      })
    },
  }
}

/** fetch 包装（Web/Node） */
function createWebAdapter(): IRequestAdapter {
  return {
    name: 'web',
    async request<T>(config: RequestConfig): Promise<RequestResponse<T>> {
      const fullUrl = buildUrl(config.baseURL ?? '', config.url, config.params)
      const timeoutMs = config.timeout ?? 15000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(fullUrl, {
          method: config.method ?? 'GET',
          headers: config.headers,
          body: config.data !== undefined ? JSON.stringify(config.data) : undefined,
          signal: controller.signal,
        })
        const data = (await res.json().catch(() => undefined)) as T
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          headers[k] = v
        })
        return { data, status: res.status, headers, config }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ApiError('TIMEOUT', `请求超时（${timeoutMs}ms）`, undefined, config)
        }
        throw new ApiError('NETWORK_ERROR', (err as Error).message ?? 'fetch 失败', undefined, config)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** 拼接 url（baseURL + url + query string） */
export function buildUrl(baseURL: string, url: string, params?: Record<string, unknown>): string {
  const base = baseURL ? `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}` : url
  if (!params) return base
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base
}

/** ★A8 设备信息：MP wx.getWindowInfo / Web window */
export interface DeviceInfo {
  platform: string
  screenWidth: number
  screenHeight: number
  pixelRatio: number
  isSkyline: boolean
}

export function getDeviceInfo(): DeviceInfo {
  const wxGlobal = (globalThis as { wx?: { getWindowInfo?: () => Record<string, unknown> } }).wx
  // ★SSOT：仅真·小程序运行时（window 缺席）读 wx——避免 web 模拟层污染
  if (detectRuntime() === 'mp' && wxGlobal && typeof wxGlobal.getWindowInfo === 'function') {
    const info = wxGlobal.getWindowInfo()
    return {
      platform: String(info.platform ?? 'unknown'),
      screenWidth: Number(info.screenWidth ?? 0),
      screenHeight: Number(info.screenHeight ?? 0),
      pixelRatio: Number(info.pixelRatio ?? 1),
      // ★真实渲染器判定（原实现恒 true——WebView 渲染器下也误报 Skyline）
      isSkyline: detectMpRenderer() === 'skyline',
    }
  }
  return {
    platform: 'web',
    screenWidth: (globalThis as { innerWidth?: number }).innerWidth ?? 0,
    screenHeight: (globalThis as { innerHeight?: number }).innerHeight ?? 0,
    pixelRatio: (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1,
    isSkyline: false,
  }
}

/** 创建请求适配器（★SSOT：真·小程序运行时 → wx；否则 web——web 模拟层 wx 不误选） */
export function createRequestAdapter(): IRequestAdapter {
  return detectRuntime() === 'mp' ? createWxAdapter() : createWebAdapter()
}

export const ALL_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

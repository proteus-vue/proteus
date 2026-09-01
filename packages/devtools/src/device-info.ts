// packages/devtools/src/device-info.ts
// ★M8 设备面板采集纯逻辑（install.ts collectDeviceInfo 用；独立可测）
// ★真实运行平台检测：window/document 存在 → web（小程序逻辑层无 window）——
//   ⚠ 勿直接用 capabilities detectPlatform：@proteus-vue/web 小程序语义模拟层会注册 wx 全局 → 误判 skyline
import { detectPlatform } from '@proteus-vue/capabilities'

export function detectRuntimePlatform(): 'web' | 'skyline' | 'app' {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') return 'web'
  return detectPlatform()
}

/** web 基础库降级展示：浏览器内核版本（UA 解析；匹配不到 → undefined） */
export function detectBrowserVersion(ua: string | undefined): string | undefined {
  if (!ua) return undefined
  const m = ua.match(/(?:Chrome|Firefox|Safari|Edg)\/([\d.]+)/)
  if (!m) return undefined
  const name = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : 'Safari'
  return name + ' ' + m[1]
}

/** 小程序基础库版本（wx SDKVersion；异常静默） */
export function detectMpLibVersion(wxGlobal: unknown): string | undefined {
  const g = wxGlobal as
    | { getAppBaseInfo?: () => { SDKVersion?: string }; getSystemInfoSync?: () => { SDKVersion?: string } }
    | undefined
  try {
    return g?.getAppBaseInfo?.()?.SDKVersion ?? g?.getSystemInfoSync?.()?.SDKVersion
  } catch {
    return undefined
  }
}

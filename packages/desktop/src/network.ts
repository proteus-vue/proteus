// packages/desktop/src/network.ts
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 p-network-status）：网络状态纯逻辑（NWPathMonitor / ConnectivityManager 语义）
//   · detectNetwork：online + 连接类型归一（navigator.onLine + connection.type/effectiveType 注入——typeof 守卫）
//   · createNetworkTracker：online/offline/connection change 订阅 → onChange（env 注入可单测）
//   与 @proteus-vue/api useNetwork（CapResult 双桥）互补：本模块为桌面/全终端注入式 tracker（无 vue 依赖）
export type NetworkKind = 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown'

export interface NetworkInfo {
  online: boolean
  kind: NetworkKind
  effectiveType?: string
}

export interface NetworkEnv {
  onLine?: () => boolean
  /** 连接类型（navigator.connection.type——wifi/ethernet/cellular…） */
  connectionType?: () => string | null
  /** 有效带宽类型（4g/3g/slow-2g…） */
  effectiveType?: () => string | null
  on?: (type: 'online' | 'offline' | 'change', fn: () => void) => void
  off?: (type: 'online' | 'offline' | 'change', fn: () => void) => void
}

function defaultOnLine(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function defaultConnectionType(): string | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const c = (nav as { connection?: { type?: string; effectiveType?: string } })?.connection
  return c && typeof c.type === 'string' ? c.type : null
}

function defaultEffectiveType(): string | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const c = (nav as { connection?: { effectiveType?: string } })?.connection
  return c && typeof c.effectiveType === 'string' ? c.effectiveType : null
}

function defaultOn(type: 'online' | 'offline' | 'change', fn: () => void): void {
  if (typeof window === 'undefined') return
  if (type === 'change') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    const c = (nav as { connection?: { addEventListener?: (t: string, f: () => void) => void } })?.connection
    if (c && typeof c.addEventListener === 'function') c.addEventListener('change', fn)
    return
  }
  window.addEventListener(type, fn)
}

function defaultOff(type: 'online' | 'offline' | 'change', fn: () => void): void {
  if (typeof window === 'undefined') return
  if (type === 'change') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    const c = (nav as { connection?: { removeEventListener?: (t: string, f: () => void) => void } })?.connection
    if (c && typeof c.removeEventListener === 'function') c.removeEventListener('change', fn)
    return
  }
  window.removeEventListener(type, fn)
}

function normalizeKind(type: string | null, online: boolean): NetworkKind {
  if (!online) return 'none'
  if (type === 'wifi' || type === 'ethernet') return type
  if (type === 'cellular') return 'cellular'
  return 'unknown'
}

/** ★detectNetwork：即时网络状态（online + kind + effectiveType） */
export function detectNetwork(env: NetworkEnv = {}): NetworkInfo {
  const online = (env.onLine ?? defaultOnLine)()
  const kind = normalizeKind((env.connectionType ?? defaultConnectionType)(), online)
  const effectiveType = (env.effectiveType ?? defaultEffectiveType)()
  const info: NetworkInfo = { online, kind }
  if (effectiveType != null) info.effectiveType = effectiveType
  return info
}

export interface NetworkTracker {
  getInfo(): NetworkInfo
  destroy(): void
}

/** ★createNetworkTracker：订阅 online/offline/connection change → onChange(NetworkInfo) */
export function createNetworkTracker(opts: { onChange: (info: NetworkInfo) => void }, env: NetworkEnv = {}): NetworkTracker {
  const on = env.on ?? defaultOn
  const off = env.off ?? defaultOff
  const notify = (): void => {
    opts.onChange(detectNetwork(env))
  }
  on('online', notify)
  on('offline', notify)
  on('change', notify)
  return {
    getInfo: () => detectNetwork(env),
    destroy: () => {
      off('online', notify)
      off('offline', notify)
      off('change', notify)
    },
  }
}

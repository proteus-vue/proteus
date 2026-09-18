// packages/api/src/auth.ts
// ★api-plan B3 + security-plan M2：凭证托管（AuthManager）——业务读 useAuth() 不读 raw token（铁律 2）
// 与 createApi 集成：beforeRequest 后自动加 Authorization（skipAuth 跳过，refresh token 防循环）
export interface AuthManager {
  /** 当前 token（无 → null） */
  getToken(): string | null
  /** 设置/清除 token（null 清除） */
  setToken(token: string | null): void
  isAuthenticated(): boolean
  /** 订阅登录态变化（用于响应式 UI：登录后刷新） */
  subscribe(cb: (token: string | null) => void): () => void
}

export interface AuthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const TOKEN_KEY = 'proteus.auth.token'

/** 内存 fallback 存储（无持久化后端时；刷新丢失——生产建议接入 Storage） */
function memoryStorage(): AuthStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

/** 创建凭证托管（持久化可选——默认内存；接入 StorageAdapter 可持久化） */
export function createAuth(storage?: AuthStorage): AuthManager {
  const store = storage ?? memoryStorage()
  const listeners = new Set<(token: string | null) => void>()
  let token: string | null = store.getItem(TOKEN_KEY)
  return {
    getToken: () => token,
    setToken: (t) => {
      token = t
      if (t === null) store.setItem(TOKEN_KEY, '')
      else store.setItem(TOKEN_KEY, t)
      for (const cb of listeners) cb(t)
    },
    isAuthenticated: () => token !== null && token !== '',
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

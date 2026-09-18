// packages/desktop/src/state-restoration.ts
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 p-state-restoration）：状态恢复纯逻辑（iOS UIStateRestoration / SavedStateHandle 语义）
//   竞品几乎无人映射的 iOS 核心能力——Proteus 语义化（01 §8）
//   · buildRestoreToken(state)：JSON 稳定序列化（恢复令牌）
//   · captureState / restoreState：注入 storage 读写（默认 localStorage——typeof 守卫；测试注入 Map）
//   · filterRestorable(state, allowKeys)：白名单过滤（敏感字段不入恢复态——安全默认）
//   纯函数 + storage 注入可单测；Web 载体 localStorage/sessionStorage（桌面/刷新恢复）
export interface RestoreStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function defaultStorage(): RestoreStorage | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const ls = localStorage
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => void ls.setItem(k, v),
      remove: (k) => void ls.removeItem(k),
    }
  } catch {
    return null
  }
}

/** 命名空间化存储键：'proteus-restore:page:scroll' */
export function restoreKey(namespace: string, key: string): string {
  return `proteus-restore:${namespace}:${key}`
}

/** ★buildRestoreToken：状态 → 恢复令牌（JSON 序列化；undefined/函数字段剔除——可序列化白名单） */
export function buildRestoreToken(state: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {}
  for (const k of Object.keys(state)) {
    const v = state[k]
    if (v === undefined || typeof v === 'function') continue
    clean[k] = v
  }
  return JSON.stringify(clean)
}

/** ★filterRestorable：白名单过滤（敏感字段不入恢复态——安全默认） */
export function filterRestorable(state: Record<string, unknown>, allowKeys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of allowKeys) {
    if (Object.prototype.hasOwnProperty.call(state, k)) out[k] = state[k]
  }
  return out
}

/** ★captureState：序列化 + 持久化（storage 缺（非浏览器）→ 仅返回 token——诚实降级） */
export function captureState(namespace: string, key: string, state: Record<string, unknown>, storage?: RestoreStorage | null): string {
  const token = buildRestoreToken(state)
  const store = storage === undefined ? defaultStorage() : storage
  if (store) {
    try {
      store.set(restoreKey(namespace, key), token)
    } catch {
      // 配额/隐私模式 → 仅返回 token
    }
  }
  return token
}

/** ★restoreState：读取 + 反序列化（无记录/解析失败 → null——不抛） */
export function restoreState<T = unknown>(namespace: string, key: string, storage?: RestoreStorage | null): T | null {
  const store = storage === undefined ? defaultStorage() : storage
  if (!store) return null
  try {
    const raw = store.get(restoreKey(namespace, key))
    if (raw == null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 清除恢复态 */
export function clearRestoreState(namespace: string, key: string, storage?: RestoreStorage | null): void {
  const store = storage === undefined ? defaultStorage() : storage
  if (store) store.remove(restoreKey(namespace, key))
}

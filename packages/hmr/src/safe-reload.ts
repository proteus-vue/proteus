// packages/hmr/src/safe-reload.ts —— 安全 reload（devtools-plus G-34 M1：stub + Web 实现）
// HMR002：原生 binding 变更等不可热替换场景 → 保存状态（路由栈 + 页面状态）→ reload → 恢复。
// Web 实现：注入式存储（sessionStorage）+ 状态收集器（缺省 location 快照）。
// M3：原生侧实现（联动 Router G-32 栈序列化 + App Renderer 原生视图恢复）。
import type { SafeReload } from './types'

export interface SafeReloadOptions {
  /** 状态收集器（缺省：location 快照；M3 原生侧：Router G-32 栈序列化 + 页面状态） */
  collect?: () => Record<string, unknown>
  /** 存储（缺省 sessionStorage；可注入 mock 单测） */
  storage?: { get(key: string): string | null; set(key: string, value: string): void } | null
  /** 页面刷新（缺省 location.reload；可注入） */
  reloadPage?: () => void
  /** 存储键（缺省 __proteus_hmr_state__） */
  storageKey?: string
}

export function createSafeReload(options: SafeReloadOptions = {}): SafeReload {
  const storage = options.storage !== undefined ? options.storage : typeof sessionStorage !== 'undefined' ? sessionStorage : null
  const storageKey = options.storageKey ?? '__proteus_hmr_state__'
  const reloadPage = options.reloadPage ?? (() => location.reload())
  const collect = options.collect ?? (() => ({ url: location.pathname + location.search }))

  return {
    saveState(): Record<string, unknown> {
      const state = collect()
      if (storage) storage.set(storageKey, JSON.stringify(state))
      return state
    },
    restoreState(state?: Record<string, unknown>): Record<string, unknown> | undefined {
      if (state) return state
      if (!storage) return undefined
      const raw = storage.get(storageKey)
      if (!raw) return undefined
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return undefined
      }
    },
    reload(): void {
      this.saveState()
      reloadPage()
    },
  }
}

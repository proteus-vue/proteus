// packages/desktop/src/lifecycle.ts
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 Lifecycle p-lifecycle）：应用前后台/激活纯逻辑
//   映射：UIApplicationDelegate didEnterBackground/willEnterForeground / onPause·onResume（01 §8）
//   · phaseOf：hidden 判定归一 'foreground' | 'background'
//   · createLifecycleTracker：Web visibilitychange/focus 订阅 → onPhase（env 注入可单测；缺省 env 直连 document——typeof 守卫）
export type AppPhase = 'foreground' | 'background'

export interface LifecycleEnv {
  /** 当前是否隐藏（缺省 document.hidden） */
  getHidden?: () => boolean
  /** 事件注册/注销注入（缺省 window visibilitychange/focus——typeof 守卫） */
  on?: (type: 'visibilitychange' | 'focus', fn: () => void) => void
  off?: (type: 'visibilitychange' | 'focus', fn: () => void) => void
}

function defaultHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.hidden === true
}

function defaultOn(type: 'visibilitychange' | 'focus', fn: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener(type, fn)
}

function defaultOff(type: 'visibilitychange' | 'focus', fn: () => void): void {
  if (typeof window === 'undefined') return
  window.removeEventListener(type, fn)
}

/** 前后台相位归一（hidden → background；否则 foreground） */
export function phaseOf(getHidden: () => boolean): AppPhase {
  return getHidden() ? 'background' : 'foreground'
}

export interface LifecycleTracker {
  getPhase(): AppPhase
  destroy(): void
}

/** ★createLifecycleTracker：订阅 visibilitychange/focus → onPhase（页面切后台/回前台即时通知） */
export function createLifecycleTracker(opts: { onPhase: (phase: AppPhase) => void }, env: LifecycleEnv = {}): LifecycleTracker {
  const getHidden = env.getHidden ?? defaultHidden
  const on = env.on ?? defaultOn
  const off = env.off ?? defaultOff
  const notify = (): void => {
    opts.onPhase(phaseOf(getHidden))
  }
  on('visibilitychange', notify)
  on('focus', notify)
  return {
    getPhase: () => phaseOf(getHidden),
    destroy: () => {
      off('visibilitychange', notify)
      off('focus', notify)
    },
  }
}

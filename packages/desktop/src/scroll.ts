// packages/desktop/src/scroll.ts
// ★#449 G-24 B5（proteus-semantic-primitives-plan 续批）：页面滚动观测原语——「滚动进度/滚动态」收口
//   语义：订阅页面滚动 → rAF 节流 → 状态回调（y / viewport / docHeight / max / progress）
//   消费：App 顶部进度条（progress）+ 导航 scrolled 态、Home Hero 滚动联动（y）——页面零裸 window/document
//   分层：纯逻辑 + Web 接线（env 注入可单测；缺省回落真实全局——同 network/lifecycle 族惯例）
export interface ScrollState {
  /** 绝对滚动距离（px） */
  y: number
  /** 视口高度（px） */
  viewport: number
  /** 文档高度（px） */
  docHeight: number
  /** 可滚总量 = max(0, docHeight - viewport) */
  max: number
  /** 进度 0..1（max=0 → 0） */
  progress: number
}

export interface ScrollObserverEnv {
  /** 订阅滚动（缺省 window.addEventListener('scroll', {passive:true})） */
  on?: (fn: () => void) => void
  /** 取消订阅 */
  off?: (fn: () => void) => void
  /** rAF 调度（缺省 requestAnimationFrame——事件合并成帧回调） */
  raf?: (fn: () => void) => number
  /** 取消 rAF */
  caf?: (id: number) => void
  /** 读取滚动状态（缺省真实窗口/文档几何） */
  read?: () => ScrollState
}

export interface ScrollObserver {
  /** 当前状态（未滚动过 → 首帧值；destroy 后返回最后状态） */
  getState(): ScrollState
  destroy(): void
}

function defaultOn(fn: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener('scroll', fn as EventListener, { passive: true })
}
function defaultOff(fn: () => void): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('scroll', fn as EventListener)
}
function defaultRaf(fn: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn)
  fn()
  return 0
}
function defaultCaf(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
}

/** 真实窗口/文档几何（SSR/无 DOM → 全零诚实态） */
export function readPageScroll(): ScrollState {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { y: 0, viewport: 0, docHeight: 0, max: 0, progress: 0 }
  }
  const y = window.scrollY ?? document.documentElement?.scrollTop ?? 0
  const viewport = window.innerHeight ?? document.documentElement?.clientHeight ?? 0
  const docHeight = document.documentElement?.scrollHeight ?? document.body?.scrollHeight ?? 0
  const max = Math.max(0, docHeight - viewport)
  const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0
  return { y, viewport, docHeight, max, progress }
}

/** ★createScrollObserver：订阅页面滚动（rAF 节流——一帧至多一次回调；immediate 首帧即回调） */
export function createScrollObserver(
  opts: { onChange: (s: ScrollState) => void; immediate?: boolean },
  env: ScrollObserverEnv = {},
): ScrollObserver {
  const on = env.on ?? defaultOn
  const off = env.off ?? defaultOff
  const raf = env.raf ?? defaultRaf
  const caf = env.caf ?? defaultCaf
  const read = env.read ?? readPageScroll

  let last = read()
  let pending = false
  let rafId = 0

  const notify = (): void => {
    pending = false
    last = read()
    opts.onChange(last)
  }
  const schedule = (): void => {
    if (pending) return // 帧内合并（多个滚动事件 → 一次回调）
    pending = true
    rafId = raf(notify)
  }
  if (opts.immediate) notify()
  on(schedule)

  return {
    getState: () => last,
    destroy: () => {
      off(schedule)
      if (pending && rafId) caf(rafId)
      pending = false
    },
  }
}

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

// ★#477（2026-09-12）：滚动高亮（scroll-spy）原语——目录/侧栏「当前章节」高亮的 window/document 收口
//   语义：订阅滚动 → 按「滚动线」（视口顶部 + offset）取最后一个越过该线的元素 id → 回调。
//   消费：官网文档页左栏/右栏目录 scroll-spy（原裸 window.scrollY/document.getElementById/getBoundingClientRect）。
//   分层：纯逻辑 + Web 接线（env 注入可单测；缺省回落真实全局——同 createScrollObserver 惯例）。

/** 元素最小形状（鸭子类型——不依赖 DOM 全局类型） */
export interface ScrollSpyElement {
  /** 相对视口顶部的距离（px）——缺省取 getBoundingClientRect().top */
  top?: () => number
}

export interface ScrollSpyEnv {
  /** 订阅滚动（缺省 window.addEventListener('scroll', {passive:true})） */
  on?: (fn: () => void) => void
  /** 取消订阅 */
  off?: (fn: () => void) => void
  /** rAF 调度（缺省 requestAnimationFrame） */
  raf?: (fn: () => void) => number
  /** 取消 rAF */
  caf?: (id: number) => void
  /** 按 id 取元素（缺省 document.getElementById——返回带 top()/getBoundingClientRect 的形状或 null） */
  find?: (id: string) => ScrollSpyElement | null
  /** 是否已滚到底（缺省 window.innerHeight + scrollY ≥ documentElement.scrollHeight - 阈值） */
  atBottom?: (threshold: number) => boolean
}

export interface ScrollSpyOptions {
  /** 滚动线偏移（视口顶部 + offset——须大于吸顶栏高度，否则标题在吸顶栏下即被判当前） */
  offset?: number
  /** 命中变化回调（相同 id 不重复触发；空列表 → ''） */
  onChange: (id: string) => void
}

export interface ScrollSpy {
  /** 设置观测目标 id 列表（按文档顺序；切换页面/内容后重设） */
  setIds(ids: string[]): void
  /** 当前命中 id（未计算/无目标 → ''） */
  getActive(): string
  destroy(): void
}

/** 纯函数：给定「元素到视口顶距离」序列与滚动线，取最后一个越过滚动线的 id（无 → ''） */
export function pickActiveId(tops: Array<{ id: string; top: number }>, line: number): string {
  let current = ''
  for (const t of tops) {
    if (t.top <= line) current = t.id
    else break
  }
  return current
}

function defaultFind(id: string): ScrollSpyElement | null {
  if (typeof document === 'undefined') return null
  const el = document.getElementById(id)
  if (!el) return null
  return { top: () => el.getBoundingClientRect().top }
}
function defaultAtBottom(threshold: number): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const viewport = window.innerHeight ?? 0
  const y = window.scrollY ?? document.documentElement?.scrollTop ?? 0
  const docHeight = document.documentElement?.scrollHeight ?? 0
  return viewport + y >= docHeight - threshold
}

/** ★createScrollSpy：滚动高亮（rAF 节流；setIds 后立即计算一次） */
export function createScrollSpy(opts: ScrollSpyOptions, env: ScrollSpyEnv = {}): ScrollSpy {
  const on = env.on ?? defaultOn
  const off = env.off ?? defaultOff
  const raf = env.raf ?? defaultRaf
  const caf = env.caf ?? defaultCaf
  const find = env.find ?? defaultFind
  const atBottom = env.atBottom ?? defaultAtBottom
  const offset = opts.offset ?? 0

  let ids: string[] = []
  let active = ''
  let pending = false
  let rafId = 0

  const compute = (): void => {
    pending = false
    if (!ids.length) {
      if (active !== '') {
        active = ''
        opts.onChange('')
      }
      return
    }
    const tops: Array<{ id: string; top: number }> = []
    for (const id of ids) {
      const el = find(id)
      if (!el) continue
      const top = typeof el.top === 'function' ? el.top() : (el as { getBoundingClientRect?: () => { top: number } }).getBoundingClientRect?.().top ?? 0
      tops.push({ id, top })
    }
    let next = pickActiveId(tops, offset + 8)
    // 滚到底：强制高亮最后一项（末段条目常在线下）
    if (next && atBottom(8) && tops.length) next = tops[tops.length - 1]!.id
    if (next !== active) {
      active = next
      opts.onChange(active)
    }
  }
  const schedule = (): void => {
    if (pending) return
    pending = true
    rafId = raf(compute)
  }
  on(schedule)

  return {
    setIds(next) {
      ids = [...next]
      compute()
    },
    getActive: () => active,
    destroy: () => {
      off(schedule)
      if (pending && rafId) caf(rafId)
      pending = false
    },
  }
}

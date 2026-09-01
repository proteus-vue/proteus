// packages/fluid/src/context.ts
// ★Fluid System 核心抽象：FluidContext 响应式上下文——容器尺寸/方向/容器级断点统一求解上下文
//   Web 实现：ResizeObserver（结构类型注入可单测——happy-dom 无 ResizeObserver，测试传 fake）
//   折叠屏/车机形态在 env.ts（createDeviceEnv），本模块只做容器级（尺寸/方向/断点）
export type FluidOrientation = 'portrait' | 'landscape'

export interface FluidContextState {
  width: number
  height: number
  orientation: FluidOrientation
  /** 容器级断点名（sm/md/lg/xl）——响应式基准是容器而非视口 */
  breakpoint: string
}

export interface FluidContext {
  get(): FluidContextState
  /** 订阅容器状态变化（节流由调用方或 ResizeObserver 自身承担），返回取消函数 */
  subscribe(cb: (state: FluidContextState) => void): () => void
  destroy(): void
}

/** ResizeObserver 结构类型（observe/disconnect；条目回调经工厂接线） */
export interface ResizeObserverLike {
  observe(target: unknown): void
  disconnect(): void
}

/** 尺寸观察器工厂：query 注入自己的 onSize 回调（真实实现 new ResizeObserver(entries→contentRect)；测试返回 fire 驱动的 fake） */
export type SizeObserverFactory = (onSize: (width: number, height: number) => void) => ResizeObserverLike

export interface ContainerQueryOptions {
  /** 设计稿宽度（断点推导基准；缺省 375） */
  designWidth?: number
  /** 容器断点（缺省 deriveContainerBreakpoints(designWidth)） */
  breakpoints?: Array<{ name: string; min: number }>
  /** 尺寸观察器工厂（缺省 globalThis.ResizeObserver；无则 no-op 观察器） */
  createObserver?: SizeObserverFactory
  /** 尺寸读取器（初始尺寸；测试注入） */
  readSize?: () => { width: number; height: number }
}

/** 方向判定 */
export function resolveOrientation(width: number, height: number): FluidOrientation {
  return height > width ? 'portrait' : 'landscape'
}

/** 默认尺寸观察器工厂：globalThis.ResizeObserver → contentRect；无 RO → no-op（容器保持初始/静态） */
function defaultObserverFactory(onSize: (width: number, height: number) => void): ResizeObserverLike {
  const RO = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
  if (typeof RO !== 'function') return { observe() {}, disconnect() {} }
  try {
    return new (RO as new (cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) => ResizeObserverLike)((entries) => {
      const first = entries && entries[0]
      if (first && first.contentRect) onSize(first.contentRect.width, first.contentRect.height)
    })
  } catch {
    return { observe() {}, disconnect() {} }
  }
}

/**
 * 创建容器查询上下文：监听元素尺寸 → 更新 FluidContextState（宽度/高度/方向/容器级断点）
 * ★可单测：createObserver 工厂注入（fake 的 fire 驱动 onSize）
 */
export function createContainerQuery(el: unknown, options: ContainerQueryOptions = {}): FluidContext {
  const designWidth = options.designWidth ?? 375
  const breakpoints = options.breakpoints ?? undefined
  const derive = (w: number, h: number): FluidContextState => {
    const bps = breakpoints && breakpoints.length ? breakpoints : defaultBreakpoints(designWidth)
    return {
      width: w,
      height: h,
      orientation: resolveOrientation(w, h),
      breakpoint: resolveBp(w, bps),
    }
  }
  let state: FluidContextState = { width: 0, height: 0, orientation: 'portrait', breakpoint: 'sm' }
  const handlers: Array<(s: FluidContextState) => void> = []
  let destroyed = false

  function setSize(width: number, height: number): void {
    if (width === state.width && height === state.height) return
    state = derive(width, height)
    for (const h of handlers) h(state)
  }

  // 初始尺寸：注入 readSize（测试）优先
  if (options.readSize) {
    const s = options.readSize()
    state = derive(s.width, s.height)
  }
  // 尺寸观察器：工厂（真实 RO → contentRect；fake → fire 驱动）
  let observer: ResizeObserverLike | null = null
  const factory = options.createObserver ?? defaultObserverFactory
  try {
    observer = factory(setSize)
  } catch {
    observer = null
  }
  if (observer) {
    try {
      observer.observe(el)
    } catch {
      // 目标不可观察（非 Element/测试环境）→ 仅保留注入驱动
    }
  }

  return {
    get: () => ({ ...state }),
    subscribe(cb) {
      handlers.push(cb)
      cb(state)
      let removed = false
      return () => {
        if (removed) return
        removed = true
        const idx = handlers.indexOf(cb)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      observer?.disconnect()
      handlers.length = 0
    },
  }
}

function defaultBreakpoints(designWidth: number): Array<{ name: string; min: number }> {
  return [0.5, 0.875, 1.25, 1.625].map((r, i) => ({ name: ['sm', 'md', 'lg', 'xl'][i] as string, min: Math.round(designWidth * r) }))
}

function resolveBp(width: number, breakpoints: Array<{ name: string; min: number }>): string {
  let fallback = breakpoints.length ? (breakpoints[0] as { name: string }).name : 'sm'
  for (let i = breakpoints.length - 1; i >= 0; i--) {
    const bp = breakpoints[i] as { name: string; min: number }
    if (width >= bp.min) return bp.name
    fallback = bp.name
  }
  return fallback
}

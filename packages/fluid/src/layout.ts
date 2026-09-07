// packages/fluid/src/layout.ts
// ★Fluid System（essence 02 §2 统一断点入口）：容器查询 + 视口断点 + 方向的统一布局感知
//   呼应 essence「Proteus 统一入口 useBreakpoint() + onLayoutChange（内部桥接各端 API）」——
//   本包纯逻辑无 Vue 依赖，组件层组合式入口 / App 端求解器在此之上桥接（createContainerQuery 只做
//   容器级，本入口叠加视口级断点：window resize / orientationchange 监听，注入可单测）
import { createContainerQuery } from './context'
import type { ContainerQueryOptions, FluidContext, FluidOrientation } from './context'
import { deriveContainerBreakpoints, resolveBreakpoint } from './breakpoint'
import type { FluidBreakpoint } from './breakpoint'

export interface SizeAwareState {
  /** 容器宽（px）——响应式基准是容器而非视口 */
  containerWidth: number
  /** 容器级断点（sm/md/lg/xl） */
  containerBreakpoint: string
  /** 视口宽（px） */
  viewportWidth: number
  /** 视口级断点（窗口/屏幕宽度） */
  viewportBreakpoint: string
  /** 方向（由容器尺寸推导；折叠屏/车机按容器） */
  orientation: FluidOrientation
}

export interface SizeAwareObserver {
  get(): SizeAwareState
  subscribe(cb: (state: SizeAwareState) => void): () => void
  destroy(): void
}

/** resize 监听目标结构类型（window 或测试注入 fake EventTarget） */
export interface ResizeTargetLike {
  addEventListener?(type: string, cb: () => void): void
  removeEventListener?(type: string, cb: () => void): void
}

export interface SizeAwareOptions extends ContainerQueryOptions {
  /** 视口宽度读取器（缺省 globalThis.innerWidth；测试注入） */
  viewportSize?: () => number
  /** resize/orientationchange 监听目标（缺省 globalThis；测试注入） */
  resizeTarget?: ResizeTargetLike
}

function defaultViewportSize(): number {
  const w = (globalThis as { innerWidth?: number }).innerWidth
  return typeof w === 'number' && w > 0 ? w : 0
}

function defaultResizeTarget(): ResizeTargetLike | null {
  const g = globalThis as { addEventListener?: unknown; removeEventListener?: unknown }
  if (typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function') {
    return g as ResizeTargetLike
  }
  return null
}

/**
 * 统一断点入口：容器级（ResizeObserver/container query）+ 视口级（window resize/方向变化）
 * - 容器变化 → containerBreakpoint / containerWidth / orientation 更新
 * - 窗口 resize / orientationchange → viewportBreakpoint / viewportWidth 更新
 * - 尺寸观察器工厂与事件目标均可注入（单测）；destroy 全量释放
 */
export function createSizeAwareObserver(el: unknown, options: SizeAwareOptions = {}): SizeAwareObserver {
  const designWidth = options.designWidth ?? 375
  const breakpoints: FluidBreakpoint[] | undefined = options.breakpoints && options.breakpoints.length ? options.breakpoints : undefined
  function resolve(w: number): string {
    const bps = breakpoints && breakpoints.length ? breakpoints : deriveContainerBreakpoints(designWidth)
    return resolveBreakpoint(w, bps)
  }

  const initial: SizeAwareState = {
    containerWidth: 0,
    containerBreakpoint: 'sm',
    viewportWidth: 0,
    viewportBreakpoint: 'sm',
    orientation: 'portrait',
  }
  let state = initial
  const handlers: Array<(s: SizeAwareState) => void> = []
  let destroyed = false

  function emit(): void {
    for (const h of handlers) h({ ...state })
  }

  // 容器级：复用 createContainerQuery（断点/方向/尺寸 + destroy）
  const query: FluidContext = createContainerQuery(el, {
    designWidth,
    breakpoints,
    createObserver: options.createObserver,
    readSize: options.readSize,
  })
  query.subscribe((s) => {
    state = { ...state, containerWidth: s.width, containerBreakpoint: s.breakpoint, orientation: s.orientation }
    emit()
  })

  // 视口级：窗口宽度 → 视口断点（resize/orientationchange 监听）
  const readViewport: () => number = options.viewportSize ?? defaultViewportSize
  function refreshViewport(): void {
    if (destroyed) return
    const w = readViewport()
    if (typeof w !== 'number' || !isFinite(w) || w < 0) return
    if (w === state.viewportWidth) return
    state = { ...state, viewportWidth: w, viewportBreakpoint: resolve(w) }
    emit()
  }
  refreshViewport()

  const target: ResizeTargetLike | null = options.resizeTarget ?? defaultResizeTarget()
  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('resize', refreshViewport)
    target.addEventListener('orientationchange', refreshViewport)
  }

  return {
    get: () => ({ ...state }),
    subscribe(cb) {
      handlers.push(cb)
      cb({ ...state })
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
      query.destroy()
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener('resize', refreshViewport)
        target.removeEventListener('orientationchange', refreshViewport)
      }
      handlers.length = 0
    },
  }
}

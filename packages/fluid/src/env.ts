// packages/fluid/src/env.ts
// ★Fluid System：设备环境——折叠屏形态 / 驾驶模式 / 减少动效（Web matchMedia，注入可单测）
//   车机 drive-mode 无标准 CSS 检测：预留接口（开发者/宿主可注入），缺省 false
export type FluidDisplayMode = 'standard' | 'fold' | 'span' | 'expand'

export interface DeviceEnvState {
  displayMode: FluidDisplayMode
  /** 车机驾驶中（限制动效/高对比度）：无标准 CSS 检测——宿主注入，缺省 false */
  isDriveMode: boolean
  /** 系统减少动效（prefers-reduced-motion）——动效降级信号 */
  prefersReducedMotion: boolean
  orientation: 'portrait' | 'landscape'
}

/** matchMedia 结构类型（浏览器全局或注入 fake） */
export interface MatchMediaLike {
  matches: boolean
  addEventListener?(event: 'change', cb: () => void): void
  removeEventListener?(event: 'change', cb: () => void): void
}

export interface DeviceEnvDeps {
  matchMedia?: (query: string) => MatchMediaLike
  /** 驾驶模式注入（车机宿主传入；缺省 false） */
  isDriveMode?: boolean
}

function readOrientation(matchMedia: (q: string) => MatchMediaLike): 'portrait' | 'landscape' {
  try {
    return matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
  } catch {
    return 'portrait'
  }
}

/** 折叠屏形态：display-mode fold/span/expand 检测（无匹配 → standard） */
export function readDisplayMode(matchMedia: (q: string) => MatchMediaLike): FluidDisplayMode {
  const modes: FluidDisplayMode[] = ['fold', 'span', 'expand']
  for (const m of modes) {
    try {
      if (matchMedia(`(display-mode: ${m})`).matches) return m
    } catch {
      // 内核不支持该 display-mode → 继续
    }
  }
  return 'standard'
}

export interface DeviceEnv {
  get(): DeviceEnvState
  subscribe(cb: (state: DeviceEnvState) => void): () => void
  destroy(): void
}

/** 创建设备环境（折叠形态/驾驶模式/减少动效/方向；matchMedia 注入可单测） */
export function createDeviceEnv(deps: DeviceEnvDeps = {}): DeviceEnv {
  const mm = deps.matchMedia ?? ((q: string) => {
    const mql = (globalThis as { matchMedia?: (q: string) => MatchMediaLike }).matchMedia
    return typeof mql === 'function' ? mql(q) : ({ matches: false, addEventListener() {}, removeEventListener() {} } as MatchMediaLike)
  })
  let state: DeviceEnvState = {
    displayMode: readDisplayMode(mm),
    isDriveMode: deps.isDriveMode ?? false,
    prefersReducedMotion: mm('(prefers-reduced-motion: reduce)').matches,
    orientation: readOrientation(mm),
  }
  const handlers: Array<(s: DeviceEnvState) => void> = []
  const changeCbs: Array<() => void> = []

  function refresh(): void {
    state = {
      displayMode: readDisplayMode(mm),
      isDriveMode: deps.isDriveMode ?? false,
      prefersReducedMotion: mm('(prefers-reduced-motion: reduce)').matches,
      orientation: readOrientation(mm),
    }
    for (const h of handlers) h(state)
  }

  // 订阅媒体变化（浏览器支持时）
  for (const query of ['(orientation: landscape)', '(prefers-reduced-motion: reduce)']) {
    try {
      const mql = mm(query)
      if (typeof mql.addEventListener === 'function') {
        const cb = (): void => refresh()
        changeCbs.push(cb)
        mql.addEventListener('change', cb)
      }
    } catch {
      // 无媒体监听能力 → 静态快照
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
      handlers.length = 0
      changeCbs.length = 0
    },
  }
}

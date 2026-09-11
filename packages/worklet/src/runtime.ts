// packages/worklet/src/runtime.ts
// ★Skyline 线收口（2026-09-11）：worklet 运行时——官方 wx.worklet 封装 + 非 Skyline 诚实降级。
//   官方机制：wx.worklet.shared/derived/timing/spring/decay/sequence/delay/repeat/Easing/runOnJS/runOnUI
//   + 组件实例 applyAnimatedStyle(selector, workletFn)（绑定 UI 线程驱动样式）。
//   降级：非 Skyline（WebView / Web / SSR）→ JS 线程 requestAnimationFrame 插值——能力诚实声明（不假装有）。
//   原则：不裸引用 wx（globalThis 取值）；能力矩阵 SSOT 见 @proteus-vue/shared detectMpRenderer。
import { detectRuntime, detectMpRenderer } from '@proteus-vue/shared'
import { EASING, resolveEasing } from './easing'
import type {
  AnimatedStyleConfig,
  SharedValue,
  WorkletAnimation,
  WorkletDecayConfig,
  WorkletEasing,
  WorkletEasingFn,
  WorkletSpringConfig,
  WorkletTimingConfig,
  WxWorkletLike,
} from './types'

function wxWorklet(): WxWorkletLike | null {
  const g = globalThis as { wx?: { worklet?: WxWorkletLike } }
  return g.wx && g.wx.worklet ? g.wx.worklet : null
}

/** 是否真实 Skyline worklet 可用（真·小程序 + Skyline 渲染器 + wx.worklet 存在） */
export function hasWorklet(): boolean {
  return detectRuntime() === 'mp' && detectMpRenderer() === 'skyline' && wxWorklet() !== null
}

/** 降级插值动画句柄（JS 线程 rAF 驱动 SharedValue.value） */
function fallbackAnimate(
  fromTo: { from: number; to: number; config: WorkletTimingConfig; onFrame?: (v: number) => void },
): void {
  const duration = fromTo.config.duration ?? 300
  const easing = resolveEasing(fromTo.config.easing)
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
  const start = now()
  const tick = (): void => {
    const t = duration <= 0 ? 1 : Math.min(1, (now() - start) / duration)
    const v = fromTo.from + (fromTo.to - fromTo.from) * easing(t)
    fromTo.onFrame?.(v)
    if (t < 1 && raf) raf(tick)
  }
  if (raf) raf(tick)
  else fromTo.onFrame?.(fromTo.to)
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/**
 * 创建 worklet 运行时（惰性单例）。
 * 真实 Skyline → 官方 wx.worklet；否则 JS 降级（同 API，行为诚实：无 UI 线程隔离）。
 */
export function createWorkletRuntime(): WorkletRuntime {
  return workletRuntime
}

interface WorkletRuntime {
  /** 是否真实 worklet（false = JS 降级；调用方应据此 capabilityWarn） */
  readonly real: boolean
  shared<T>(initial: T): SharedValue<T>
  derived<T>(fn: () => T): SharedValue<T>
  timing(toValue: number, config?: WorkletTimingConfig): WorkletAnimation
  spring(toValue: number, config?: WorkletSpringConfig): WorkletAnimation
  decay(config?: WorkletDecayConfig): WorkletAnimation
  sequence(...animations: WorkletAnimation[]): WorkletAnimation
  delay(ms: number, animation: WorkletAnimation): WorkletAnimation
  repeat(animation: WorkletAnimation, times?: number, reverse?: boolean): WorkletAnimation
  cancelAnimation(sharedValue: SharedValue): void
  runOnJS(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void
  runOnUI(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void
  scrollTo(option: { scrollTop?: number; scrollLeft?: number; animated?: boolean; duration?: number; selector?: string }): void
  /** 绑定 worklet 驱动样式到节点（官方 applyAnimatedStyle）；返回解绑函数 */
  applyAnimatedStyle(
    scope: { applyAnimatedStyle?: (selector: string, updater: () => Record<string, string>, cfg?: unknown, cb?: unknown) => void; clearAnimatedStyle?: (selector: string, ids: number[], cb?: () => void) => void },
    selector: string,
    updater: () => Record<string, string>,
    config?: AnimatedStyleConfig,
  ): () => void
  readonly Easing: WorkletEasing
}

function makeRuntime(): WorkletRuntime {
  const native = wxWorklet()
  const real = hasWorklet()

  const fallbackShared = <T,>(initial: T): SharedValue<T> => ({ value: initial })

  return {
    real,
    get Easing() {
      // 优先原生 Easing（Skyline），否则纯实现
      return (native && native.Easing ? { ...EASING, ...native.Easing } : EASING) as WorkletEasing
    },
    shared<T>(initial: T): SharedValue<T> {
      return real && native ? native.shared(initial) : fallbackShared(initial)
    },
    derived<T>(fn: () => T): SharedValue<T> {
      if (real && native) return native.derived(fn)
      // ★降级：derived 无响应式依赖追踪——JS 侧一次性求值（诚实边界：依赖变化不自动重算）
      return fallbackShared(fn())
    },
    timing(toValue: number, config?: WorkletTimingConfig): WorkletAnimation {
      if (real && native) return native.timing(toValue, config) as WorkletAnimation
      return { current: toValue }
    },
    spring(toValue: number, config?: WorkletSpringConfig): WorkletAnimation {
      if (real && native) return native.spring(toValue, config) as WorkletAnimation
      return { current: toValue }
    },
    decay(config?: WorkletDecayConfig): WorkletAnimation {
      if (real && native) return native.decay(config) as WorkletAnimation
      return { current: config && typeof config.velocity === 'number' ? config.velocity : 0 }
    },
    sequence(...animations: WorkletAnimation[]): WorkletAnimation {
      if (real && native) return native.sequence(animations) as WorkletAnimation
      const last = animations.length ? animations[animations.length - 1] : undefined
      return { current: last ? last.current : 0 }
    },
    delay(ms: number, animation: WorkletAnimation): WorkletAnimation {
      if (real && native) return native.delay(ms, animation) as WorkletAnimation
      return { current: animation.current }
    },
    repeat(animation: WorkletAnimation, times?: number, reverse?: boolean): WorkletAnimation {
      if (real && native) return native.repeat(animation, times, reverse) as WorkletAnimation
      return { current: animation.current }
    },
    cancelAnimation(sharedValue: SharedValue): void {
      if (real && native) native.cancelAnimation(sharedValue)
    },
    runOnJS(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void {
      if (real && native) native.runOnJS(fn, ...args)
      else fn(...args)
    },
    runOnUI(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void {
      if (real && native) native.runOnUI(fn, ...args)
      else fn(...args)
    },
    scrollTo(option): void {
      if (real && native) native.scrollTo(option)
      // 降级：非 Skyline 无此能力（调用方用平台滚动替代）——静默（能力由 hasWorklet 声明）
    },
    applyAnimatedStyle(scope, selector, updater, config): () => void {
      if (real && scope && typeof scope.applyAnimatedStyle === 'function') {
        let styleId = 0
        scope.applyAnimatedStyle(selector, updater, config, (res: { styleId?: number }) => {
          if (res && typeof res.styleId === 'number') styleId = res.styleId
        })
        return () => {
          if (styleId && scope.clearAnimatedStyle) scope.clearAnimatedStyle(selector, [styleId])
        }
      }
      // ★降级：JS 侧一次性应用 updater 结果（无 UI 线程驱动——诚实边界）
      try {
        updater()
      } catch {
        /* updater 依赖 worklet 运行时，降级下失败即忽略 */
      }
      return () => {}
    },
  }
}

/** 惰性单例（首次调用求值；测试 resetWorklet 后可重探） */
let singleton: WorkletRuntime | null = null

export function getWorklet(): WorkletRuntime {
  if (!singleton) singleton = makeRuntime()
  return singleton
}

export const workletRuntime = getWorklet()

/** 测试重置 */
export function resetWorklet(): void {
  singleton = null
}

export { fallbackAnimate }
export type { WorkletRuntime, WorkletEasingFn }

// packages/worklet/src/types.ts
// ★Skyline 线收口（2026-09-11）：worklet 公共类型——对齐官方 wx.worklet + Skyline.SharedValue/AnimatedStyle
//   来源：miniprogram-api-typings 5.2.3（lib.wx.api.d.ts Worklet / lib.wx.skyline.d.ts）

/** UI 线程共享值（官方 Skyline.SharedValue<T> 同形） */
export interface SharedValue<T = unknown> {
  value: T
}

/** 动画对象（官方 AnimationObject 的简化面——opaque 句柄，不暴露内部） */
export interface WorkletAnimation {
  /** 官方 AnimationObject.current（可选——JS 侧只读观测） */
  readonly current?: number
}

/** 动画配置：时长 + 缓动（官方 timing/spring 参数子集） */
export interface WorkletTimingConfig {
  duration?: number
  /** 缓动函数（Easing.* 产物）或字符串名 */
  easing?: WorkletEasingFn | string
}

/** spring 配置（官方 spring 参数） */
export interface WorkletSpringConfig extends WorkletTimingConfig {
  damping?: number
  mass?: number
  stiffness?: number
  velocity?: number
  overshootClamping?: boolean
  restDisplacementThreshold?: number
  restSpeedThreshold?: number
}

/** decay 配置（官方基于滚动的衰减动画） */
export interface WorkletDecayConfig {
  velocity?: number
  deceleration?: number
  clamp?: [number, number]
}

/** 缓动函数（t∈[0,1] → 进度） */
export type WorkletEasingFn = (t: number) => number

/** AnimatedStyle 配置（官方 applyAnimatedStyle userConfig） */
export interface AnimatedStyleConfig {
  immediate?: boolean
  flush?: 'sync' | 'async'
}

/** Easing 命名空间（官方 Easing 模块面） */
export interface WorkletEasing {
  linear: WorkletEasingFn
  quad: WorkletEasingFn
  cubic: WorkletEasingFn
  poly: (n: number) => WorkletEasingFn
  circle: WorkletEasingFn
  sin: WorkletEasingFn
  exp: WorkletEasingFn
  bounce: WorkletEasingFn
  ease: WorkletEasingFn
  elastic: (bounciness?: number) => WorkletEasingFn
  bezier: (x1: number, y1: number, x2: number, y2: number) => WorkletEasingFn
  in: (fn: WorkletEasingFn) => WorkletEasingFn
  out: (fn: WorkletEasingFn) => WorkletEasingFn
  inOut: (fn: WorkletEasingFn) => WorkletEasingFn
}

/** wx.worklet 结构（不裸引用 wx 全局——注入探测） */
export interface WxWorkletLike {
  shared<T>(initial: T): SharedValue<T>
  derived<T>(fn: () => T): SharedValue<T>
  timing(toValue: number, config?: unknown): WorkletAnimation
  spring(toValue: number, config?: unknown): WorkletAnimation
  decay(config?: unknown): WorkletAnimation
  sequence(...animations: unknown[]): WorkletAnimation
  delay(ms: number, animation: unknown): WorkletAnimation
  repeat(animation: unknown, times?: number, reverse?: boolean, cb?: unknown): WorkletAnimation
  cancelAnimation(sharedValue: SharedValue, animation?: unknown): void
  runOnJS(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void
  runOnUI(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void
  scrollTo(option: { scrollTop?: number; scrollLeft?: number; animated?: boolean; duration?: number; selector?: string }): void
  Easing?: Partial<WorkletEasing>
}

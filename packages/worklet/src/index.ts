// packages/worklet/src/index.ts
// @proteus-vue/worklet —— ★Skyline 线收口：worklet（UI 线程动画）统一入口。
//   封装官方 wx.worklet（shared/derived/timing/spring/decay/sequence/delay/repeat/Easing/runOnJS/runOnUI/scrollTo）
//   + 组件 applyAnimatedStyle 绑定；非 Skyline 环境诚实降级 JS 线程（real=false，调用方 capabilityWarn）。
//   设计：编译期「worklet:style」属性通道由编译器透传（官方 WXML 前缀）；本包提供运行时驱动。
export type {
  SharedValue,
  WorkletAnimation,
  WorkletTimingConfig,
  WorkletSpringConfig,
  WorkletDecayConfig,
  WorkletEasing,
  WorkletEasingFn,
  AnimatedStyleConfig,
  WxWorkletLike,
} from './types'

export { EASING, resolveEasing } from './easing'

export { hasWorklet, getWorklet, workletRuntime, createWorkletRuntime, resetWorklet, fallbackAnimate } from './runtime'
export type { WorkletRuntime } from './runtime'

// 便捷导出：真实 Skyline 走原生；降级同 API（行为诚实）
import { getWorklet } from './runtime'
import { EASING } from './easing'

/** 共享值（官方 wx.worklet.shared；非 Skyline → JS 对象） */
export function shared<T>(initial: T) {
  return getWorklet().shared(initial)
}
/** 派生值（官方 derived） */
export function derived<T>(fn: () => T) {
  return getWorklet().derived(fn)
}
/** 定时动画（官方 timing） */
export function timing(toValue: number, config?: import('./types').WorkletTimingConfig) {
  return getWorklet().timing(toValue, config)
}
/** 弹簧动画（官方 spring） */
export function spring(toValue: number, config?: import('./types').WorkletSpringConfig) {
  return getWorklet().spring(toValue, config)
}
/** 基于滚动的衰减动画（官方 decay） */
export function decay(config?: import('./types').WorkletDecayConfig) {
  return getWorklet().decay(config)
}
/** 回 JS 线程执行 */
export function runOnJS(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void {
  getWorklet().runOnJS(fn, ...args)
}
/** 回 UI 线程执行 */
export function runOnUI(fn: (...args: unknown[]) => unknown, ...args: unknown[]): void {
  getWorklet().runOnUI(fn, ...args)
}
/** 绑定 worklet 驱动样式到节点（返回解绑函数） */
export const applyAnimatedStyle: import('./runtime').WorkletRuntime['applyAnimatedStyle'] = (scope, selector, updater, config) =>
  getWorklet().applyAnimatedStyle(scope, selector, updater, config)
/** Easing（原生优先，否则纯实现） */
export { EASING as Easing }

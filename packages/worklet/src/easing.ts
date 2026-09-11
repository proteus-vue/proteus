// packages/worklet/src/easing.ts
// ★Skyline 线收口：Easing 纯函数实现（官方 Easing 模块面——降级路径使用；真实 Skyline 走原生）
//   语义来源：微信官方 Easing（easings.net 标准曲线）。in(fn)===fn（官方文档：Easing.in(Easing.sin) 与 Easing.sin 同效）
import type { WorkletEasing, WorkletEasingFn } from './types'

const linear: WorkletEasingFn = (t) => t
const quad: WorkletEasingFn = (t) => t * t
const cubic: WorkletEasingFn = (t) => t * t * t
const poly = (n: number): WorkletEasingFn => (t) => Math.pow(t, n)
const circle: WorkletEasingFn = (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t))
const sin: WorkletEasingFn = (t) => 1 - Math.cos((t * Math.PI) / 2)
const exp: WorkletEasingFn = (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1)))
const bounceOut: WorkletEasingFn = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
// 官方 bounce = easeInBounce（文档标注 easings.net/#easeInBounce）
const bounce: WorkletEasingFn = (t) => 1 - bounceOut(1 - t)
const elastic = (bounciness = 1): WorkletEasingFn => {
  const p = Math.max(0, bounciness) * 0.3
  return (t) => {
    if (t === 0 || t === 1) return t
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1
  }
}
// cubic-bezier(.42,0,1,1) —— 用二分法近似 x→t，再求 y
const bezier = (x1: number, y1: number, x2: number, y2: number): WorkletEasingFn => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t
  return (x) => {
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2
      if (sampleX(t) < x) lo = t
      else hi = t
    }
    return sampleY(t)
  }
}
const ease: WorkletEasingFn = bezier(0.42, 0, 1, 1)

const inFn = (fn: WorkletEasingFn): WorkletEasingFn => fn
const out = (fn: WorkletEasingFn): WorkletEasingFn => (t) => 1 - fn(1 - t)
const inOut = (fn: WorkletEasingFn): WorkletEasingFn => (t) => (t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 - 2 * t) / 2)

/** Easing 纯实现（降级路径 + 测试基准；真实 Skyline 用原生 Easing） */
export const EASING: WorkletEasing = {
  linear,
  quad,
  cubic,
  poly,
  circle,
  sin,
  exp,
  bounce,
  ease,
  elastic,
  bezier,
  in: inFn,
  out,
  inOut,
}

/** 字符串缓动名 → 函数（timing config.easing 可为字符串） */
export function resolveEasing(easing: string | WorkletEasingFn | undefined): WorkletEasingFn {
  if (typeof easing === 'function') return easing
  if (!easing) return EASING.ease
  const key = easing as keyof WorkletEasing
  const v = EASING[key]
  return typeof v === 'function' ? (v as WorkletEasingFn) : EASING.ease
}

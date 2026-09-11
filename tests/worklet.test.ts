// tests/worklet.test.ts
// ★Skyline 线收口：@proteus-vue/worklet —— 官方 wx.worklet 封装 + 非 Skyline 诚实降级
//   覆盖：hasWorklet 判定 / shared/derived / timing 等工厂 / runOnJS·runOnUI 降级 / applyAnimatedStyle / Easing 纯实现
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  shared,
  derived,
  timing,
  spring,
  decay,
  runOnJS,
  runOnUI,
  applyAnimatedStyle,
  hasWorklet,
  getWorklet,
  resetWorklet,
  Easing,
  EASING,
  resolveEasing,
} from '@proteus-vue/worklet'

afterEach(() => {
  vi.unstubAllGlobals()
  resetWorklet()
})

describe('hasWorklet（能力判定）', () => {
  it('无 wx → false（Web/SSR）', () => {
    expect(hasWorklet()).toBe(false)
  })

  it('MP 但 renderer=webview → false', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'webview' }), worklet: {} })
    expect(hasWorklet()).toBe(false)
  })

  it('MP + renderer=skyline + wx.worklet → true', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), worklet: { shared: (v: unknown) => ({ value: v }) } })
    expect(hasWorklet()).toBe(true)
    expect(getWorklet().real).toBe(true)
  })

  it('MP + skyline 但无 wx.worklet → false（基础库不足，诚实降级）', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }) })
    expect(hasWorklet()).toBe(false)
  })
})

describe('降级路径（非 Skyline → JS 线程，行为诚实）', () => {
  it('shared/derived：普通对象；derived 一次性求值', () => {
    const s = shared(10)
    expect(s.value).toBe(10)
    const d = derived(() => 3 + 4)
    expect(d.value).toBe(7)
  })

  it('timing/spring/decay 占位动画（current = 目标/初值）', () => {
    expect(timing(100, { duration: 200 }).current).toBe(100)
    expect(spring(50).current).toBe(50)
    expect(decay({ velocity: 2 }).current).toBe(2)
  })

  it('runOnJS / runOnUI 直接调用（降级无线程切换）', () => {
    let v = 0
    runOnJS(() => { v = 1 })
    runOnUI(() => { v = 2 })
    expect(v).toBe(2)
  })

  it('applyAnimatedStyle：无 scope 方法 → 一次性应用 + 返回解绑函数', () => {
    let applied = false
    const unbind = applyAnimatedStyle({} as never, '.x', () => { applied = true; return {} })
    expect(applied).toBe(true)
    expect(typeof unbind).toBe('function')
    expect(() => unbind()).not.toThrow()
  })

  it('applyAnimatedStyle：scope 支持时调用官方 applyAnimatedStyle + clearAnimatedStyle', () => {
    // 模拟真·Skyline 组件实例
    vi.stubGlobal('window', undefined)
    const apply = vi.fn((_s: string, _u: () => Record<string, string>, _c: unknown, cb: (r: { styleId: number }) => void) => cb({ styleId: 7 }))
    const clear = vi.fn()
    vi.stubGlobal('wx', {
      getSystemInfoSync: () => ({ renderer: 'skyline' }),
      worklet: { shared: (v: unknown) => ({ value: v }) },
    })
    resetWorklet()
    const scope = { applyAnimatedStyle: apply, clearAnimatedStyle: clear }
    const unbind = getWorklet().applyAnimatedStyle(scope as never, '.card', () => ({ transform: 'translateX(1px)' }))
    expect(apply).toHaveBeenCalled()
    unbind()
    expect(clear).toHaveBeenCalledWith('.card', [7])
  })
})

describe('Easing 纯实现（降级基准）', () => {
  it('线性/二次/三次端点正确', () => {
    expect(EASING.linear(0.5)).toBe(0.5)
    expect(EASING.quad(0.5)).toBe(0.25)
    expect(EASING.cubic(0.5)).toBe(0.125)
  })

  it('in/out/inOut 组合关系', () => {
    const linearOut = EASING.out(EASING.linear)
    expect(linearOut(0.25)).toBeCloseTo(0.25, 5) // out(linear)(t) = 1-(1-t) = t
    const quadOut = EASING.out(EASING.quad)
    expect(quadOut(0.5)).toBeCloseTo(0.75, 5) // 1-(1-0.5)^2
    const io = EASING.inOut(EASING.linear)
    expect(io(0)).toBeCloseTo(0, 5)
    expect(io(1)).toBeCloseTo(1, 5)
    expect(io(0.5)).toBeCloseTo(0.5, 5)
  })

  it('bezier(.42,0,1,1)（官方 ease）单调且端点固定', () => {
    const e = EASING.bezier(0.42, 0, 1, 1)
    expect(e(0)).toBeCloseTo(0, 2)
    expect(e(1)).toBeCloseTo(1, 2)
    expect(e(0.5)).toBeGreaterThan(0)
    expect(e(0.5)).toBeLessThan(1)
  })

  it('bounce/elastic 端点合法（0→0，1→1）', () => {
    expect(EASING.bounce(0)).toBe(0)
    expect(EASING.bounce(1)).toBeCloseTo(1, 5)
    expect(EASING.elastic()(0)).toBe(0)
    expect(EASING.elastic()(1)).toBeCloseTo(1, 5)
  })

  it('resolveEasing：函数直传 / 字符串名 / 缺省 fallback', () => {
    const fn = () => 1
    expect(resolveEasing(fn)).toBe(fn)
    expect(resolveEasing('quad')).toBe(EASING.quad)
    expect(resolveEasing(undefined)).toBe(EASING.ease)
  })

  it('Easing 导出与 EASING 同源（降级）', () => {
    expect(Easing.linear(0.5)).toBe(0.5)
  })
})

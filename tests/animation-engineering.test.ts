// tests/animation-engineering.test.ts
// ★G-32 B5 续二（proteus-semantic-primitives-plus-plan §8 ③）：E21-E23 动画语义面——注入式 createAnimationEngineering
//   验证点：E21 useAnimation 构建器（set/step/export/play——wx.createAnimation 语义）· E22 useGestureAnimation
//   （增量累积 → 提交帧）· E23 useScrollAnimation + interpolateAnimationProps（进度 → 插值关键帧）· 缺 driver 安全 no-op
import { describe, it, expect } from 'vitest'
import { createAnimationEngineering, interpolateAnimationProps } from '@proteus-vue/api'
import type { AnimationDescriptor, AnimationDriver, AnimationProps, AnimationRun, Reactivity, ScrollAnimationRange } from '@proteus-vue/api'

/** 简单 reactivity mock（ref：{value} 可写；computed/watch 静态）——与 engineering/router-engineering.test 同构 */
function mockReactivity(): Reactivity {
  return {
    ref: <T>(initial: T) => {
      let v = initial
      return {
        get value() {
          return v
        },
        set value(nv: T) {
          v = nv
        },
      }
    },
    computed: <T>(getter: () => T) => ({ value: getter() }),
    watch: <T>(getter: () => T, cb: (v: T, o: T) => void) => {
      void getter
      void cb
      return () => undefined
    },
  }
}

/** 记录调用的 mock driver（run 录制 target+descriptor；onFinish 回调可手动触发） */
function mockDriver() {
  const runs: Array<{ target: unknown; descriptor: AnimationDescriptor }> = []
  const finishes: Array<() => void> = []
  const driver: AnimationDriver = {
    run: (target, descriptor) => {
      runs.push({ target, descriptor })
      const run: AnimationRun = {
        play: () => undefined,
        pause: () => undefined,
        reverse: () => undefined,
        cancel: () => undefined,
        finish: () => undefined,
        seek: () => undefined,
        onFinish: (cb) => {
          finishes.push(cb)
        },
      }
      return run
    },
  }
  return { driver, runs, finishes }
}

describe('G-32 B5 续二 动画语义（E21-E23）', () => {
  it('E21 useAnimation：set/step 构建关键帧 → export 按时长占比分布 offset（wx.createAnimation 语义）', () => {
    const anim = createAnimationEngineering({ reactivity: mockReactivity() })
    const c = anim.useAnimation({ duration: 300 })
    c.set({ opacity: 0, y: 16 }).step()
    c.set({ opacity: 1, y: 0, rotate: 90 }).step({ duration: 600 })
    c.reset()
    c.set({ x: 0 }).step()
    c.set({ x: 100 }).step()
    const d = c.export()
    expect(d.keyframes.length).toBe(2)
    expect(d.keyframes[0].props.x).toBe(0)
    expect(d.keyframes[1].props.x).toBe(100)
    expect(d.keyframes[1].offset).toBe(1)
    expect(d.duration).toBe(600) // reset 后两帧各 300
    expect(d.iterations).toBe(1)
  })

  it('E21 useAnimation：export offset 分布（多步）与帧合并', () => {
    const anim = createAnimationEngineering({ reactivity: mockReactivity() })
    const c = anim.useAnimation({ duration: 100 })
    c.set({ opacity: 0 }).step()
    c.set({ y: 10 }).step()
    c.set({ opacity: 1, y: 0 }).step()
    const d = c.export()
    // 等时长三步：offset 0.333 / 0.667 / 1（末帧恒 1）
    expect(d.keyframes[0].offset).toBeCloseTo(1 / 3, 3)
    expect(d.keyframes[1].offset).toBeCloseTo(2 / 3, 3)
    expect(d.keyframes[2].offset).toBe(1)
    expect(d.keyframes[2].props.opacity).toBe(1)
  })

  it('E21 useAnimation：play 委托 driver（录制 target+descriptor；state idle→running→finished）', () => {
    const { driver, runs, finishes } = mockDriver()
    const reactivity = mockReactivity()
    const anim = createAnimationEngineering({ reactivity, driver })
    const c = anim.useAnimation({ duration: 200 })
    c.set({ opacity: 0, x: 0 }).step()
    c.set({ opacity: 1, x: 60 }).step()
    const target = { kind: 'stage' }
    const run = c.play(target)
    expect(run).toBeDefined()
    expect(c.state.value).toBe('running')
    expect(runs.length).toBe(1)
    expect(runs[0].target).toBe(target)
    expect(runs[0].descriptor.keyframes.length).toBe(2)
    expect(finishes.length).toBe(1)
    finishes[0]()
    expect(c.state.value).toBe('finished')
  })

  it('E21 useAnimation：缺 driver → play 安全 no-op（MP/SSR 诚实体面）', () => {
    const anim = createAnimationEngineering({ reactivity: mockReactivity() })
    const c = anim.useAnimation()
    expect(c.play()).toBeUndefined()
    expect(c.state.value).toBe('idle')
  })

  it('E22 useGestureAnimation：增量累积 → 提交帧（apply 合并到当前帧；多次 commit 生多关键帧）', () => {
    const anim = createAnimationEngineering({ reactivity: mockReactivity() })
    const g = anim.useGestureAnimation()
    // 手势会话 1：连续增量合并为一帧（跟随手指语义）
    g.apply({ x: 4 })
    g.apply({ x: 20 })
    g.apply({ y: 8 })
    g.commit({ duration: 200 })
    // 会话 2
    g.apply({ x: 30, rotate: 12 })
    g.commit({ duration: 200 })
    const d = g.export()
    expect(d.keyframes.length).toBe(2)
    // 会话 1 三增量合并：x=20 + y=8（末增量覆盖 x）
    expect(d.keyframes[0].props.x).toBe(20)
    expect(d.keyframes[0].props.y).toBe(8)
    expect(d.keyframes[0].props.rotate).toBeUndefined()
    expect(d.keyframes[1].props.rotate).toBe(12)
    g.reset()
    expect(g.export().keyframes.length).toBe(0)
  })

  it('E23 useScrollAnimation：进度 → 插值属性（0/0.5/1 线性过渡；越界钳制）', () => {
    const anim = createAnimationEngineering({ reactivity: mockReactivity() })
    const range: ScrollAnimationRange = { from: { opacity: 1, y: 0 }, to: { opacity: 0.2, y: -60 } }
    const s = anim.useScrollAnimation(range)
    s.setProgress(0)
    expect(s.value()).toEqual({ opacity: 1, y: 0 })
    s.setProgress(0.5)
    expect(s.value().opacity).toBeCloseTo(0.6, 3)
    expect(s.value().y).toBeCloseTo(-30, 3)
    s.setProgress(1)
    expect(s.value().opacity).toBeCloseTo(0.2, 3)
    expect(s.value().y).toBeCloseTo(-60, 3)
    // 越界钳制
    s.setProgress(2)
    expect(s.value().y).toBeCloseTo(-60, 3)
    s.setProgress(-1)
    expect(s.value().opacity).toBe(1)
    const d = s.export()
    expect(d.keyframes.length).toBe(2)
    expect(d.keyframes[0].props.y).toBe(0)
    expect(d.keyframes[1].props.y).toBe(-60)
  })

  it('E23 interpolateAnimationProps 纯函数：双向/缺失侧/非法进度', () => {
    const from: AnimationProps = { x: 0, opacity: 1 }
    const to: AnimationProps = { x: 100, opacity: 0 }
    const mid = interpolateAnimationProps(from, to, 0.5)
    expect(mid.x).toBe(50)
    expect(mid.opacity).toBe(0.5)
    // 缺失侧（to 无 y → 从 0 插到…无 to 数值 → y 保留 from 语义：a→0）
    const fade = interpolateAnimationProps({ y: 40 }, {}, 0.25)
    expect(fade.y).toBeCloseTo(30, 3)
    // 全缺失 key → 不产出
    expect(interpolateAnimationProps({}, {}, 0.5)).toEqual({})
  })
})
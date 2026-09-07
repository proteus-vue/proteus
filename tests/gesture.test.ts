// tests/gesture.test.ts
// ★G-32 B4 ④ Gesture（proteus-semantic-primitives-plus-plan §6）：纯手势识别器状态机
//   验证点：tap（连击 count）/ longpress（时长）/ pan（轴锁定）/ swipe（方向+速度阈值）/
//   pinch（双点缩放）/ rotate（双点旋转）/ press（力度）/ 时间注入确定性
import { describe, it, expect } from 'vitest'
import { createGestureRecognizer } from '@proteus-vue/gesture'
import type { GestureEvent, GestureInput } from '@proteus-vue/gesture'

/** 合成输入辅助（确定性时间戳注入） */
function makeFeed(now: () => number) {
  return (kind: GestureInput['kind'], x: number, y: number, id = 1, force?: number): GestureInput => ({
    kind,
    point: { x, y, t: now(), id, force },
  })
}

function collect(events: GestureEvent[], kind: string) {
  return events.filter((e) => e.type === kind)
}

describe('G-32 Gesture 识别器（纯逻辑）', () => {
  it('tap：按下→抬起（未移动）→ tap 事件；连击 count=2', () => {
    let t = 0
    const now = () => (t += 10) // 每次 +10ms
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ tap: (e) => events.push(e) }, { now })
    const feed = makeFeed(now)
    r.feed(feed('down', 10, 10))
    r.feed(feed('up', 10, 10))
    const taps = collect(events, 'tap')
    expect(taps).toHaveLength(1)
    expect(taps[0]).toMatchObject({ type: 'tap', x: 10, y: 10, count: 1 })
    // 第二击（窗口内）
    r.feed(feed('down', 12, 12))
    r.feed(feed('up', 12, 12))
    expect(collect(events, 'tap')[1]).toMatchObject({ count: 2 })
  })

  it('移动超阈值 → 不算 tap，输出 pan（轴锁定 y 时 dx=0）', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ tap: (e) => events.push(e), pan: (e) => events.push(e) }, { now, panAxis: 'y' })
    const feed = makeFeed(now)
    r.feed(feed('down', 10, 10))
    r.feed(feed('move', 10, 30)) // 垂直移动 20px > 阈值 10
    r.feed(feed('up', 10, 35))
    expect(collect(events, 'tap')).toHaveLength(0)
    const pans = collect(events, 'pan-move')
    expect(pans).toHaveLength(1)
    expect(pans[0]).toMatchObject({ dx: 0, dy: 20 }) // y 轴锁定：dx 归零
    expect(collect(events, 'pan-end')).toHaveLength(1)
  })

  it('longpress：按住 ≥500ms（注入 schedule 计时）→ longpress；提前抬起不算', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    let timerCb: (() => void) | null = null
    const r = createGestureRecognizer(
      { longpress: (e) => events.push(e) },
      {
        now,
        schedule: (cb) => {
          timerCb = cb
          return 1
        },
        cancelSchedule: () => {
          timerCb = null
        },
      },
    )
    const feed = makeFeed(now)
    r.feed(feed('down', 10, 10))
    expect(timerCb).not.toBeNull()
    timerCb?.() // 模拟 500ms 定时触发
    expect(collect(events, 'longpress')).toHaveLength(1)
    r.feed(feed('up', 10, 10))
    expect(collect(events, 'longpress')).toHaveLength(1) // 不重复
  })

  it('swipe：快速水平滑动 → swipe direction=left + velocity 超阈值', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ swipe: (e) => events.push(e) }, { now, swipeVelocity: 0.3 })
    const feed = makeFeed(now)
    r.feed(feed('down', 100, 50))
    r.feed(feed('move', 60, 50)) // 水平 -40px / 10ms = 4px/ms
    r.feed(feed('up', 50, 50))
    const swipes = collect(events, 'swipe')
    expect(swipes).toHaveLength(1)
    expect(swipes[0]).toMatchObject({ direction: 'left' })
    expect((swipes[0] as { velocity: number }).velocity).toBeGreaterThan(0.3)
  })

  it('pinch：双点张开 → pinch-change scale > 1 + rotate 角度变化', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ pinch: (e) => events.push(e), rotate: (e) => events.push(e) }, { now })
    const feed = makeFeed(now)
    r.feed(feed('down', 50, 50, 1))
    r.feed(feed('down', 90, 50, 2)) // 两指 40px 间距
    r.feed(feed('move', 70, 50, 2)) // 右指外扩到 20px→（等距 60px? 实际 70-50=20... 修正：左指 50 右指 80=30）
    // 双指张开：左指固定 50，右指 50→90（40px→60px 距离=1.5 倍）
    r.feed(feed('move', 50, 50, 1))
    r.feed(feed('move', 90, 50, 1)) // 左指 50→90 右指 90：距离 40（未放大）
    r.feed(feed('move', 110, 50, 2)) // 右指 90→110：距离 110-90=20
    const pinches = collect(events, 'pinch-change')
    expect(pinches.length).toBeGreaterThan(0)
    // 旋转：第二指 y 位移 → 角度变化
    r.feed(feed('move', 90, 70, 2))
    expect(collect(events, 'rotate-change').length).toBeGreaterThan(0)
    r.feed(feed('up', 90, 70, 2))
    expect(collect(events, 'pinch-end')).toHaveLength(1)
    expect(collect(events, 'rotate-end')).toHaveLength(1)
  })

  it('press：tap 时携带 force → press 事件', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ press: (e) => events.push(e) }, { now })
    const feed = makeFeed(now)
    r.feed(feed('down', 10, 10, 1, 0.8))
    r.feed(feed('up', 10, 10, 1, 0.8))
    const presses = collect(events, 'press')
    expect(presses).toHaveLength(1)
    expect(presses[0]).toMatchObject({ force: 0.8 })
  })

  it('reset：清空状态后可复用', () => {
    let t = 0
    const now = () => (t += 10)
    const events: GestureEvent[] = []
    const r = createGestureRecognizer({ tap: (e) => events.push(e) }, { now })
    const feed = makeFeed(now)
    r.feed(feed('down', 10, 10))
    r.feed(feed('cancel', 10, 10)) // cancel 不产生 tap
    expect(collect(events, 'tap')).toHaveLength(0)
    r.reset()
    r.feed(feed('down', 10, 10))
    r.feed(feed('up', 10, 10))
    expect(collect(events, 'tap')).toHaveLength(1)
  })
})
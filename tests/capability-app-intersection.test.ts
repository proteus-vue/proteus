// tests/capability-app-intersection.test.ts
// ★★★决策 #1086（2026-10-19）：App 端交叉观察（C59 `useIntersection`）的语义判据。
//
// 【本项此前的状态】一直记为"如实不支持"，理由是"缺渲染宿主的帧级几何变化通知"。
//   本轮取证后改为**已实现**：`element.rect` 已返回视口坐标（#1081），视口尺寸运行期可知，
//   三端滚动入口都是单点 ⇒ 宿主只需推"几何变了"的 tick，相交计算全在 JS。
//
// 【判据（对齐 Web `IntersectionObserver`）】
//   ① **初始回调**：`observe` 后立刻评估一次（Web 语义——不是等第一次滚动）；
//   ② **阈值跨档才回调**：比例在同一档内变化**不**回调（否则每 tick 都刷——Web 不是这语义）；
//   ③ **相交比例**：`intersection 面积 / 目标面积`（Web 的定义，非"占视口比例"）；
//   ④ **margins**：`relativeToViewport({top})` 等外扩/内缩参照矩形；
//   ⑤ **observeAll**：观察选择器全部匹配；
//   ⑥ **disconnect**：只清本句柄，别的句柄不受影响；
//   ⑦ **拿不到几何就跳过**：节点没了/参照查不到 ⇒ 不回调（不伪造 0 比例）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  installIntersectionDeps,
  createAppIntersection,
  evaluateIntersections,
  intersectionStats,
  resetIntersections,
  ratioOf,
} from '../packages/api/src/capability-app-intersection'

/** 假宿主：nodeId → 矩形（视口坐标） */
function makeHost(rects: Record<number, { x: number; y: number; w: number; h: number }>, viewport = { width: 390, height: 844 }) {
  ;(globalThis as Record<string, unknown>).proteusHost = {
    invoke: (method: string, args: string) => {
      if (method !== 'element.rect') return JSON.stringify({ ok: false, missing: true, reason: 'nope' })
      const id = (JSON.parse(args) as { nodeId: number }).nodeId
      const r = rects[id]
      if (!r) return JSON.stringify({ ok: false, reason: '无几何' })
      return JSON.stringify({ ok: true, data: { x: r.x, y: r.y, width: r.w, height: r.h, scrollY: 0 } })
    },
  }
  installIntersectionDeps({
    viewport: () => viewport,
    resolve: (sel) => {
      const m = /^#(\w+)$/.exec(sel.trim())
      if (!m) return null
      const map: Record<string, number> = { a: 1, b: 2, c: 3, box: 9 }
      const id = map[m[1]!]
      return id === undefined ? null : { nodeId: id, source: 'screen' }
    },
    resolveAll: (sel) => {
      if (sel.trim() !== '.item') return []
      return [{ nodeId: 1, source: 'screen' }, { nodeId: 2, source: 'screen' }]
    },
  })
}

describe('★#1086 ① 相交比例（Web 定义：相交面积 / 目标面积）', () => {
  it('完全在视口内 ⇒ 1；完全在外 ⇒ 0；一半 ⇒ 0.5', () => {
    const target = { left: 0, top: 0, right: 100, bottom: 100 }
    expect(ratioOf(target, { left: 0, top: 0, right: 390, bottom: 844 })).toBe(1)
    expect(ratioOf(target, { left: 500, top: 0, right: 900, bottom: 844 })).toBe(0)
    expect(ratioOf(target, { left: 0, top: 50, right: 390, bottom: 844 })).toBeCloseTo(0.5, 6)
  })

  it('目标面积为 0 ⇒ 0（保守，不返回 NaN/Infinity）', () => {
    expect(ratioOf({ left: 10, top: 10, right: 10, bottom: 10 }, { left: 0, top: 0, right: 100, bottom: 100 })).toBe(0)
  })
})

describe('★#1086 ② 初始回调 + 阈值跨档', () => {
  beforeEach(() => resetIntersections())
  afterEach(() => {
    resetIntersections()
    delete (globalThis as Record<string, unknown>).proteusHost
  })

  it('observe 后**立即**回调一次（Web 语义：不等第一次滚动）', () => {
    makeHost({ 1: { x: 10, y: 10, w: 100, h: 100 } })
    const got: number[] = []
    createAppIntersection({ thresholds: [0] })
      .relativeToViewport()
      .observe('#a', (r) => got.push(r.intersectionRatio))
    expect(got, 'observe 必须立即评估一次').toEqual([1])
  })

  it('同一档内变化**不**回调；跨档才回调', () => {
    // 目标 100 高；先用一半可见（ratio 0.5，thresholds [0, 0.5] ⇒ 落档 2）
    makeHost({ 1: { x: 0, y: 794, w: 100, h: 100 } })   // 视口 844 ⇒ 可见 50/100
    const got: number[] = []
    createAppIntersection({ thresholds: [0, 0.5] })
      .relativeToViewport()
      .observe('#a', (r) => got.push(r.intersectionRatio))
    expect(got.length).toBe(1)
    expect(got[0]).toBeCloseTo(0.5, 6)

    // 同档内（ratio 仍在 [0.5,1)）⇒ 调 tick 不该再回调
    makeHost({ 1: { x: 0, y: 794, w: 100, h: 100 } })
    expect(evaluateIntersections(), '同档内不回调').toBe(0)

    // 跨档（ratio 降到 0.3 → 落档 1）⇒ 回调
    makeHost({ 1: { x: 0, y: 900, w: 100, h: 100 } })
    expect(evaluateIntersections(), '跨档应回调').toBe(1)
    expect(got.length).toBe(2)
    expect(got[1]).toBe(0)
  })
})

describe('★#1086 ③ margins 外扩参照', () => {
  beforeEach(() => resetIntersections())
  afterEach(() => {
    resetIntersections()
    delete (globalThis as Record<string, unknown>).proteusHost
  })

  it('relativeToViewport({top: 200}) 让视口上边界外扩 200 ⇒ 原本不可见的变可见', () => {
    // 目标在视口上方 100px（top=-100,bottom=0）⇒ 正常视角 ratio 0
    makeHost({ 1: { x: 0, y: -100, w: 100, h: 100 } })
    const plain: number[] = []
    createAppIntersection({ thresholds: [0] }).relativeToViewport().observe('#a', (r) => plain.push(r.intersectionRatio))
    expect(plain[0], '无 margins ⇒ 不可见').toBe(0)

    resetIntersections()
    const withMargin: number[] = []
    createAppIntersection({ thresholds: [0] })
      .relativeToViewport({ top: 200 })   // 视口上边界扩到 -200
      .observe('#a', (r) => withMargin.push(r.intersectionRatio))
    expect(withMargin[0], 'top:200 ⇒ 完全可见').toBe(1)
  })
})

describe('★#1086 ④ observeAll / disconnect / 拿不到几何', () => {
  beforeEach(() => resetIntersections())
  afterEach(() => {
    resetIntersections()
    delete (globalThis as Record<string, unknown>).proteusHost
  })

  it('observeAll ⇒ 每个匹配都回调', () => {
    makeHost({ 1: { x: 0, y: 0, w: 10, h: 10 }, 2: { x: 0, y: 20, w: 10, h: 10 } })
    const ids: Array<string | undefined> = []
    createAppIntersection({ thresholds: [0], observeAll: true })
      .relativeToViewport()
      .observe('.item', (r) => ids.push(r.id))
    expect(ids.length, '两个匹配都回调').toBe(2)
    expect(intersectionStats().total).toBe(2)
  })

  it('disconnect 只清本句柄（别的句柄不受影响）', () => {
    makeHost({ 1: { x: 0, y: 0, w: 10, h: 10 }, 2: { x: 0, y: 0, w: 10, h: 10 } })
    const h1 = createAppIntersection({ thresholds: [0] }).relativeToViewport()
    h1.observe('#a', () => {})
    const h2 = createAppIntersection({ thresholds: [0] }).relativeToViewport()
    h2.observe('#b', () => {})
    expect(intersectionStats().total).toBe(2)
    h1.disconnect()
    expect(intersectionStats().total, '只清 h1 的那一个').toBe(1)
    expect(intersectionStats().targets).toEqual([2])
  })

  it('节点查不到几何 ⇒ 跳过（不伪造 0 比例）', () => {
    makeHost({})   // 没有任何节点
    const got: number[] = []
    createAppIntersection({ thresholds: [0] }).relativeToViewport().observe('#a', (r) => got.push(r.intersectionRatio))
    expect(got, '拿不到几何 ⇒ 不回调').toEqual([])
  })

  it('relativeTo 一个不存在的元素 ⇒ 不静默退回视口（永不回调）', () => {
    makeHost({ 1: { x: 0, y: 0, w: 10, h: 10 } })
    const got: number[] = []
    createAppIntersection({ thresholds: [0] }).relativeTo('#nope').observe('#a', (r) => got.push(r.intersectionRatio))
    expect(got, '参照不存在 ⇒ 不回调（不退化成视口）').toEqual([])
  })

  it('未装配依赖 ⇒ observe 不抛、不注册（诚实降级）', () => {
    installIntersectionDeps(null)
    const got: number[] = []
    expect(() => createAppIntersection({ thresholds: [0] }).relativeToViewport().observe('#a', (r) => got.push(r.intersectionRatio))).not.toThrow()
    expect(got).toEqual([])
    expect(intersectionStats().total).toBe(0)
  })
})

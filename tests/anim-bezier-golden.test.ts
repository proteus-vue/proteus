// tests/anim-bezier-golden.test.ts —— ★★自定义三次贝塞尔（2026-10-01 转正）的跨语言钉值测试
//
// 【与内核的分工】内核 `anim.rs::bezier_table` 生成 65 点采样表并缓存；TS 侧只做
//   **解析与校验**（`parseCubicBezier` / `validateAnimations`），求值数学**不在 TS**
//   （纪律 #22：曲线知识只在引擎一处）。
//
// 【本测试守什么】
//   ① 字符串解析（CSS 形态 / 裸形态 / 非法形态的**可定位错误**）；
//   ② 编译期校验（x 范围 / 与 curve/spring/keyframes 互斥 / 非有限数）；
//   ③ 编译产物形态（`curveBezier` 落在 EngineAnim 上；颜色四条通道共享同一控制点）；
//   ④ **跨语言求值对拍**：TS 侧用与内核 `bezier_eval` **同一数学**的独立实现算期望值，
//      与内核单测 `custom_bezier_table_matches_live_eval_and_pins_endpoints` 的钉值同源——
//      任一侧改了数学，两侧测试必有一侧红。
import { describe, it, expect } from 'vitest'
import { compileAnimations, parseCubicBezier, validateAnimations, formatIssues, Curve } from '@proteus-vue/animation'
import type { ScalarAnimDecl, ColorAnimDecl } from '@proteus-vue/animation'

/** 与内核 `bezier_eval` 同一数学的独立实现（测试用期望值——不 import 生产代码） */
function bezierEvalRef(c: readonly [number, number, number, number], u: number): number {
  const [x1, y1, x2, y2] = c
  const bez = (a: number, b: number, t: number): number => {
    const mt = 1 - t
    return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bez(x1, x2, mid) < u) lo = mid
    else hi = mid
  }
  return bez(y1, y2, (lo + hi) / 2)
}

describe('A1 · 自定义三次贝塞尔（转正）', () => {
  describe('parseCubicBezier —— CSS 字符串解析', () => {
    it('标准 css 形态（含空格 / 大写 / 简写小数）', () => {
      expect(parseCubicBezier('cubic-bezier(0.34, 1.56, 0.64, 1)')).toEqual([0.34, 1.56, 0.64, 1])
      expect(parseCubicBezier('CUBIC-BEZIER(.34,1.56,.64,1)')).toEqual([0.34, 1.56, 0.64, 1])
      expect(parseCubicBezier('cubic-bezier( .25 , .1 , .25 , 1 )')).toEqual([0.25, 0.1, 0.25, 1])
    })
    it('裸 "a,b,c,d" 形态', () => {
      expect(parseCubicBezier('0,0,1,1')).toEqual([0, 0, 1, 1])
    })
    it('★非法：x 越界 ⇒ 抛错且消息含原文（可定位）', () => {
      expect(() => parseCubicBezier('cubic-bezier(-0.5, 0, 0, 1)')).toThrow(/x1\/x2 必须在 \[0,1\]/)
      expect(() => parseCubicBezier('cubic-bezier(0, 0, 1.5, 1)')).toThrow(/x1\/x2/)
      // y 越界**合法**（回弹）
      expect(parseCubicBezier('cubic-bezier(0, -0.5, 1, 1.5)')).toEqual([0, -0.5, 1, 1.5])
    })
    it('★非法：数量/数值错 ⇒ 抛错带原文', () => {
      expect(() => parseCubicBezier('cubic-bezier(0.1, 0.2, 0.3)')).toThrow(/无法从/)
      expect(() => parseCubicBezier('ease-in-out')).toThrow(/无法从/)
      expect(() => parseCubicBezier('cubic-bezier(a,b,c,d)')).toThrow(/无法从/)
    })
  })

  describe('validateAnimations —— 编译期校验', () => {
    const base = (extra: Partial<ScalarAnimDecl>): ScalarAnimDecl => ({
      kind: 'translateY',
      from: -40,
      to: 0,
      durationMs: 400,
      curveBezier: [0.34, 1.56, 0.64, 1],
      ...extra,
    })
    it('合法声明通过', () => {
      expect(validateAnimations([base({})])).toHaveLength(0)
    })
    it('★x 越界 ⇒ invalid-range（与内核同一条规则）', () => {
      const issues = validateAnimations([base({ curveBezier: [-0.2, 0, 1, 1] })])
      expect(issues.some((s) => s.code === 'invalid-range' && /x1\/x2/.test(s.message))).toBe(true)
      expect(formatIssues(issues)).toContain('cubic-bezier')
    })
    it('★非有限数 / 数量错 ⇒ invalid-range', () => {
      expect(
        validateAnimations([base({ curveBezier: [0, Number.NaN, 1, 1] as never })]).some((s) => s.code === 'invalid-range'),
      ).toBe(true)
      expect(
        validateAnimations([base({ curveBezier: [0, 1, 1] as never })]).some((s) => s.code === 'invalid-range'),
      ).toBe(true)
    })
    it('★与 curve / spring / keyframes 互斥（求值模式必须唯一）', () => {
      expect(validateAnimations([base({ curve: 'easeOut' })]).some((s) => s.code === 'conflicting-easing')).toBe(true)
      expect(
        validateAnimations([base({ spring: { stiffness: 180, damping: 26 } }) as ScalarAnimDecl]).some(
          (s) => s.code === 'conflicting-easing',
        ),
      ).toBe(true)
      expect(
        validateAnimations([
          base({ keyframes: [{ to: 0, durationMs: 100 }] as never }),
        ]).some((s) => s.code === 'conflicting-easing'),
      ).toBe(true)
    })
    it('颜色路径同校验（四条通道共享同一曲线）', () => {
      const decl: ColorAnimDecl = {
        kind: 'color',
        from: '#2f6fed',
        to: '#ff5533',
        durationMs: 200,
        curveBezier: [0.34, 1.56, 0.64, 1],
      }
      expect(validateAnimations([decl])).toHaveLength(0)
      const bad: ColorAnimDecl = { ...decl, curveBezier: [2, 0, 0, 1] }
      expect(validateAnimations([bad]).some((s) => s.code === 'invalid-range')).toBe(true)
    })
  })

  describe('compileAnimations —— 编译产物', () => {
    it('标量：curveBezier 原样落在指令上（与 curve id 并存——内核求值优先自定义）', () => {
      const b = compileAnimations(
        [{ kind: 'translateY', from: -40, to: 0, durationMs: 400, curveBezier: [0.34, 1.56, 0.64, 1] }],
        { nodeId: 7 },
      )
      expect(b.anims).toHaveLength(1)
      expect(b.anims[0]!.curveBezier).toEqual([0.34, 1.56, 0.64, 1])
      expect(b.anims[0]!.curve).toBe(Curve.EASE_OUT) // 缺省占位（内核优先自定义）
    })
    it('★颜色：四条通道共享同一控制点（颜色不能分通道变缓动）', () => {
      const b = compileAnimations(
        [{ kind: 'color', from: '#000000', to: '#ffffff', durationMs: 200, curveBezier: [0.34, 1.56, 0.64, 1] }],
        { nodeId: 7 },
      )
      expect(b.anims).toHaveLength(4)
      for (const a of b.anims) {
        expect(a.curveBezier).toEqual([0.34, 1.56, 0.64, 1])
      }
    })
    it('不给 curveBezier ⇒ 指令上不出现该字段（线格式零污染）', () => {
      const b = compileAnimations([{ kind: 'opacity', from: 0, to: 1, durationMs: 200 }], { nodeId: 7 })
      expect('curveBezier' in b.anims[0]!).toBe(false)
    })
  })

  describe('★★跨语言求值对拍（与内核 bezier_eval 同一数学）', () => {
    it('四条代表性曲线的关键点值（内核单测同源钉值）', () => {
      // ★期望值 = **独立解法**（牛顿迭代，与内核/本测试参考实现的二分法**不同解法**）
      //   经 Python 独立算得（60 次迭代，收敛到 1e-6）——三方互验：牛顿 ⇄ 二分 ⇄ 内核单测。
      const cases: Array<[readonly [number, number, number, number], Array<[number, number]>]> = [
        // 线性
        [[0, 0, 1, 1], [[0, 0], [0.25, 0.25], [0.5, 0.5], [1, 1]]],
        // 标准 ease（CSS 默认）
        [[0.25, 0.1, 0.25, 1], [[0.25, 0.408511], [0.5, 0.802403], [0.7, 0.940765]]],
        // 回弹（y > 1 过冲）
        [[0.34, 1.56, 0.64, 1], [[0.25, 0.816289], [0.5, 1.087401], [0.7, 1.075776]]],
        // 预期（y < 0 先下潜）
        [[0.6, -0.28, 0.735, 0.045], [[0.25, -0.086946], [0.5, -0.063622], [0.7, 0.14374]]],
      ]
      for (const [c, pts] of cases) {
        for (const [u, want] of pts) {
          const got = bezierEvalRef(c, u)
          expect(Math.abs(got - want), `c=${c} u=${u} got=${got} want=${want}`).toBeLessThan(0.001)
        }
      }
    })
    it('端点精确（u=0 → 0；u=1 → 1）——回弹曲线同样', () => {
      for (const c of [[0, 0, 1, 1], [0.34, 1.56, 0.64, 1], [0.6, -0.28, 0.735, 0.045]] as const) {
        expect(bezierEvalRef(c, 0)).toBeCloseTo(0, 6)
        expect(bezierEvalRef(c, 1)).toBeCloseTo(1, 6)
      }
    })
    it('★回弹曲线确实过冲（> 1）——这是"转正"要提供的能力', () => {
      const c = [0.34, 1.56, 0.64, 1] as const
      const peak = Math.max(...Array.from({ length: 65 }, (_, i) => bezierEvalRef(c, i / 64)))
      expect(peak).toBeGreaterThan(1.05)
    })
  })
})

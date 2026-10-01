// tests/anim-repeat-golden.test.ts —— ★★循环与往复（A2：repeat / yoyo）的编译期+语义测试
//
// 【A2 要解决什么】"呼吸灯 / 无限脉冲 / 来回摆动"此前只能"把时长写长"——那会把曲线在
//   整段上拉伸（呼吸变成慢速单摆），无限循环根本写不出来。现在进封闭集：
//   `repeat: 3 | 'infinite'`（= CSS animation-iteration-count）＋ `direction: 'alternate'`（= yoyo）。
//
// 【数学本质（内核单测同源）】yoyo 的净位移 = 0（第 1 遍 to、第 2 遍回 from）——
//   这正是"往复"的定义；内核 `repeat_anim_runs_to_end_and_yoyo_returns_home` 钉住它。
import { describe, it, expect } from 'vitest'
import { compileAnimations, validateAnimations } from '@proteus-vue/animation'
import type { ScalarAnimDecl, ColorAnimDecl } from '@proteus-vue/animation'

describe('A2 · 循环与往复（repeat / yoyo）', () => {
  describe('编译产物', () => {
    it('repeat: 3 ⇒ 指令带 repeat=3（无 alternate 字段）', () => {
      const b = compileAnimations(
        [{ kind: 'scale', from: 1, to: 1.08, durationMs: 900, repeat: 3 }],
        { nodeId: 1 },
      )
      expect(b.anims[0]!.repeat).toBe(3)
      expect('alternate' in b.anims[0]!).toBe(false)
    })
    it("repeat: 'infinite' ⇒ 内核哨兵 -1；direction: 'alternate' ⇒ alternate: true", () => {
      const b = compileAnimations(
        [{ kind: 'scale', from: 1, to: 1.08, durationMs: 900, repeat: 'infinite', direction: 'alternate' }],
        { nodeId: 1 },
      )
      expect(b.anims[0]!.repeat).toBe(-1)
      expect(b.anims[0]!.alternate).toBe(true)
    })
    it('不给 repeat ⇒ 指令上不出现该字段（线格式零污染——单遍是缺省）', () => {
      const b = compileAnimations([{ kind: 'opacity', from: 0, to: 1, durationMs: 200 }], { nodeId: 1 })
      expect('repeat' in b.anims[0]!).toBe(false)
      expect('alternate' in b.anims[0]!).toBe(false)
    })
    it('★颜色：四条通道**都带** repeat（少一条 = 颜色分叉）', () => {
      const b = compileAnimations(
        [
          {
            kind: 'color',
            from: '#000000',
            to: '#ffffff',
            durationMs: 500,
            repeat: 'infinite',
            direction: 'alternate',
          },
        ],
        { nodeId: 1 },
      )
      expect(b.anims).toHaveLength(4)
      for (const a of b.anims) {
        expect(a.repeat).toBe(-1)
        expect(a.alternate).toBe(true)
      }
    })
  })

  describe('编译期校验', () => {
    const base = (extra: Record<string, unknown>): ScalarAnimDecl =>
      ({ kind: 'scale', from: 1, to: 1.08, durationMs: 900, ...extra }) as ScalarAnimDecl

    it('合法：数字 ≥ 1 / infinite / direction normal|alternate', () => {
      expect(validateAnimations([base({ repeat: 3 })])).toHaveLength(0)
      expect(validateAnimations([base({ repeat: 'infinite' })])).toHaveLength(0)
      expect(validateAnimations([base({ repeat: 2, direction: 'alternate' })])).toHaveLength(0)
    })
    it('★非法 repeat（0 / 负数 / NaN / 字符串）⇒ invalid-range', () => {
      for (const bad of [0, -1, Number.NaN, 'forever']) {
        const issues = validateAnimations([base({ repeat: bad })])
        expect(issues.some((s) => s.code === 'invalid-range'), `repeat=${String(bad)}`).toBe(true)
      }
    })
    it('★非法 direction ⇒ invalid-range', () => {
      expect(validateAnimations([base({ repeat: 2, direction: 'reverse' })]).some((s) => s.code === 'invalid-range')).toBe(true)
    })
    it('★repeat 与 scroll 互斥（滚动驱动没有"轮"的概念）', () => {
      const issues = validateAnimations([
        base({ repeat: 'infinite', scroll: { from: 0, to: 400 } }),
      ])
      expect(issues.some((s) => s.code === 'conflicting-easing')).toBe(true)
      // 单遍（repeat 缺省）与 scroll 可共存（既有语义不变）
      expect(validateAnimations([base({ scroll: { from: 0, to: 400 } })])).toHaveLength(0)
    })
    it('颜色路径同校验', () => {
      const bad: ColorAnimDecl = {
        kind: 'color',
        from: '#000',
        to: '#fff',
        durationMs: 100,
        repeat: 0 as never,
      }
      expect(validateAnimations([bad]).some((s) => s.code === 'invalid-range')).toBe(true)
    })
  })
})

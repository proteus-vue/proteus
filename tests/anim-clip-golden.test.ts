// tests/anim-clip-golden.test.ts —— ★★C1 裁剪形变（`clip`）的编译期测试
//
// 【C1 是什么（2026-10-01）】`clip-path` 形变动画——与颜色通道**同源的分解法**：
//   用户面一个 `clip` 声明 → 内核面**最多 16 条标量参数通道**（kind 15..30）⇒
//   曲线/弹簧/序列/循环/接管**零改动复用**。
//
// 【与颜色/标量的三方差异】`clip` 的 `from`/`to` 是**参数数组**（标量是数字、颜色是字符串）
//   ⇒ 独立类型 `ClipAnimDecl` + 独立编译分支（`isClipDecl`）。
import { describe, it, expect } from 'vitest'
import { compileAnimations, validateAnimations, reverseDecls, isClipDecl } from '@proteus-vue/animation'
import type { ClipAnimDecl, ScalarAnimDecl } from '@proteus-vue/animation'

const insetDecl: ClipAnimDecl = {
  kind: 'clip',
  from: [0.1, 0.1, 0.1, 0.1],
  to: [0.4, 0.1, 0.1, 0.1],
  durationMs: 400,
}

describe('C1 · 裁剪形变（clip）', () => {
  describe('编译产物（一个声明 → N 条参数通道）', () => {
    it('inset 4 参 → 4 条通道（kind 15/16/17/18，clipSlot 0..3）', () => {
      const b = compileAnimations([insetDecl], { nodeId: 7 })
      expect(b.anims).toHaveLength(4)
      expect(b.anims.map((a) => a.kind)).toEqual([15, 16, 17, 18])
      expect(b.anims.map((a) => a.clipSlot)).toEqual([0, 1, 2, 3])
      // 每通道的 from/to = 声明数组的对应项
      expect(b.anims[0]!.from).toBe(0.1)
      expect(b.anims[0]!.to).toBe(0.4)
      expect(b.anims[1]!.to).toBe(0.1)
    })
    it('circle 3 参 → 3 条通道；polygon 6 参 → 6 条', () => {
      const c = compileAnimations(
        [{ kind: 'clip', from: [0.5, 0.5, 0.1], to: [0.5, 0.5, 0.4], durationMs: 300 }],
        { nodeId: 1 },
      )
      expect(c.anims.map((a) => a.kind)).toEqual([15, 16, 17])
      const p = compileAnimations(
        [{ kind: 'clip', from: [0, 0, 1, 0, 0.5, 1], to: [0.1, 0.1, 0.9, 0.1, 0.5, 0.9], durationMs: 300 }],
        { nodeId: 1 },
      )
      expect(p.anims.map((a) => a.kind)).toEqual([15, 16, 17, 18, 19, 20])
      expect(p.anims[5]!.to).toBe(0.9)
    })
    it('★非合成（tick 路径——与 color/3D 同一跨端一致决策）', () => {
      const b = compileAnimations([insetDecl], { nodeId: 7 })
      expect(b.composited).toBe(false)
      expect(b.nonComposited).toContain('clip')
    })
    it('曲线/弹簧/循环随通道一起下发（求值机器零改动复用的证据）', () => {
      const b = compileAnimations(
        [
          {
            kind: 'clip',
            from: [0.1, 0.1, 0.1, 0.1],
            to: [0.4, 0.4, 0.4, 0.4],
            durationMs: 400,
            curveBezier: [0.34, 1.56, 0.64, 1],
            repeat: 'infinite',
            direction: 'alternate',
          },
        ],
        { nodeId: 1 },
      )
      for (const a of b.anims) {
        expect(a.curveBezier).toEqual([0.34, 1.56, 0.64, 1])
        expect(a.repeat).toBe(-1)
        expect(a.alternate).toBe(true)
      }
    })
    it('序列：每段参数逐槽展开（末段 = 声明 to）', () => {
      const b = compileAnimations(
        [
          {
            kind: 'clip',
            from: [0.0, 0.0, 0.0, 0.0],
            to: [0.5, 0.5, 0.5, 0.5],
            keyframes: [
              { to: [0.6, 0.6, 0.6, 0.6], durationMs: 100 },
              { to: [0.5, 0.5, 0.5, 0.5], durationMs: 100 },
            ],
          },
        ],
        { nodeId: 1 },
      )
      expect(b.anims).toHaveLength(4)
      const kf = b.anims[0]!.keyframes!
      expect(kf.map((s) => s.to)).toEqual([0.6, 0.5])
      expect(kf.map((s) => s.durMs)).toEqual([100, 100])
    })
  })

  describe('编译期校验', () => {
    const base = (extra: Partial<ClipAnimDecl>): ClipAnimDecl => ({ ...insetDecl, ...extra })
    it('合法声明通过（inset/circle/polygon）', () => {
      expect(validateAnimations([insetDecl])).toHaveLength(0)
      expect(validateAnimations([{ kind: 'clip', from: [0.5, 0.5, 0.1], to: [0.5, 0.5, 0.3], durationMs: 300 }])).toHaveLength(0)
    })
    it('★to 为空 / 超过 16 / from 不足 / 非有限数 ⇒ 各自明确报错', () => {
      const empty = validateAnimations([base({ to: [] })])
      expect(empty.some((s) => s.code === 'empty' && /至少给一个参数/.test(s.message))).toBe(true)
      const tooMany = validateAnimations([base({ from: Array(17).fill(0), to: Array(17).fill(0.5) })])
      expect(tooMany.some((s) => /最多 16/.test(s.message))).toBe(true)
      const shortFrom = validateAnimations([base({ from: [0.1], to: [0.1, 0.1, 0.1, 0.4] })])
      expect(shortFrom.some((s) => /参数不足/.test(s.message))).toBe(true)
      const nan = validateAnimations([base({ from: [0.1, 0.1, 0.1, Number.NaN], to: [0.4, 0.1, 0.1, 0.1] })])
      expect(nan.some((s) => /非有限数/.test(s.message))).toBe(true)
    })
    it('★与 curve/spring 互斥（求值模式必须唯一）', () => {
      // curve + spring 并存 ⇒ 报错
      const cf = validateAnimations([
        base({ curve: 'easeOut', spring: { stiffness: 180, damping: 26 } } as never),
      ])
      expect(cf.some((s) => s.code === 'conflicting-easing')).toBe(true)
      // ★只给 curve（无 spring）**合法**（clip 与标量同规：curve 默认 easeOut 本就是常态）
      const only = validateAnimations([base({ curve: 'easeOut' } as never)])
      expect(only.some((s) => s.code === 'conflicting-easing')).toBe(false)
      // curveBezier + curve 并存 ⇒ 报错（checkCurveBezier 复用）
      const cb = validateAnimations([base({ curve: 'easeOut', curveBezier: [0.34, 1.56, 0.64, 1] } as never)])
      expect(cb.some((s) => s.code === 'conflicting-easing')).toBe(true)
    })
  })

  describe('类型窄化与反转', () => {
    it('isClipDecl 谓词：clip 为真、标量/颜色为假', () => {
      expect(isClipDecl(insetDecl)).toBe(true)
      expect(isClipDecl({ kind: 'scale', from: 1, to: 2, durationMs: 100 })).toBe(false)
      expect(isClipDecl({ kind: 'color', from: '#000', to: '#fff', durationMs: 100 })).toBe(false)
    })
    it('★reverseDecls：clip 端点互换（数组不落进标量路径的 `?? 0`）', () => {
      const [rev] = reverseDecls([insetDecl]) as ClipAnimDecl[]
      expect(Array.isArray(rev.from)).toBe(true)
      expect(rev.from).toEqual(insetDecl.to)
      expect(rev.to).toEqual(insetDecl.from)
      void (0 as unknown as ScalarAnimDecl)
    })
  })
})

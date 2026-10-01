// tests/anim-stroke-golden.test.ts —— ★★C2 SVG 描边进度（`strokeProgress`）的编译期测试
//
// 【C2 是什么（2026-10-01）】SVG 路径描边动画——"手写字"动效的引擎底座：
//   路径本体（`d`）在**节点样式**里静态声明（内核解析成段列表 + 弧长），
//   动画只有一个标量通道：`strokeProgress`（kind **31**，0..1 = 沿弧长画到哪）。
//
// 【与 clip 的关键差异】clip 是"一个声明 → N 条参数通道"（分解法）；
//   strokeProgress 是**单通道标量**（路径本体不动，只动"画到哪"）⇒
//   它走标量泛型编译路径，编号 31 在 `ANIM_KIND_ID` 里与内核**同号**钉住。
//
// 【为什么单独建这条】与 `anim-clip-golden` 同一纪律：每个新能力条数要有
//   "编译形态 + 校验 + 类型级防线"三类断言，不能只靠内核单测（那条不校验 TS 面）。
import { describe, it, expect } from 'vitest'
import { compileAnimations, validateAnimations, isTickOnly, isComposited, ANIM_KIND_ID } from '@proteus-vue/animation'
import type { ScalarAnimDecl } from '@proteus-vue/animation'

const strokeDecl: ScalarAnimDecl = {
  kind: 'strokeProgress',
  from: 0,
  to: 1,
  durationMs: 800,
  curve: 'linear',
}

describe('C2 · SVG 描边进度（strokeProgress）', () => {
  describe('编译产物（单通道标量）', () => {
    it('一个声明 → 一条指令（kind 31——与内核同号，不得改）', () => {
      const b = compileAnimations([strokeDecl], { nodeId: 11 })
      expect(b.anims).toHaveLength(1)
      expect(b.anims[0]!.kind).toBe(31)
      expect(b.anims[0]!.kind).toBe(ANIM_KIND_ID.strokeProgress)
      expect(b.anims[0]!.from).toBe(0)
      expect(b.anims[0]!.to).toBe(1)
      expect(b.anims[0]!.durMs).toBe(800)
    })
    it('★非合成（tick 路径——与 color/clip/3D 同一跨端一致决策）', () => {
      const b = compileAnimations([strokeDecl], { nodeId: 11 })
      expect(b.composited).toBe(false)
      expect(b.nonComposited).toContain('strokeProgress')
      expect(isTickOnly('strokeProgress')).toBe(true)
      expect(isComposited('strokeProgress')).toBe(false)
    })
    it('曲线/自定义贝塞尔/循环随通道一起下发（求值机器零改动复用的证据）', () => {
      // ★curve 与 curveBezier 互斥（校验器会拦——上面第 7 条断言之外，这里显式去掉 curve）
      const { curve: _drop, ...noCurve } = strokeDecl
      const b = compileAnimations(
        [{ ...noCurve, curveBezier: [0.34, 1.56, 0.64, 1], repeat: 'infinite', direction: 'alternate' }],
        { nodeId: 11 },
      )
      expect(b.anims[0]!.curveBezier).toEqual([0.34, 1.56, 0.64, 1])
      expect(b.anims[0]!.repeat).toBe(-1)
      expect(b.anims[0]!.alternate).toBe(true)
    })
    it('序列：多段收敛在一条动画里（末段 = 声明 to）', () => {
      const b = compileAnimations(
        [
          {
            kind: 'strokeProgress',
            from: 0,
            to: 1,
            keyframes: [
              { to: 0.6, durationMs: 100 },
              { to: 1, durationMs: 100 },
            ],
          },
        ],
        { nodeId: 11 },
      )
      expect(b.anims).toHaveLength(1)
      expect(b.anims[0]!.keyframes!.map((s) => s.to)).toEqual([0.6, 1])
      expect(b.anims[0]!.durMs).toBe(200) // 序列模式：时长 = 各段之和（不是缺省 300）
    })
    it('滚动驱动（drive: progress / scroll 窗口）可用（与标量同语义）', () => {
      const b = compileAnimations(
        [{ ...strokeDecl, drive: 'progress' }],
        { nodeId: 11 },
      )
      expect(b.anims[0]!.drive).toBe(1)
    })
  })

  describe('编译期校验（与标量同规——值域与端点）', () => {
    it('from > to 合法（倒放：已画的擦掉——"擦除"动效）', () => {
      expect(validateAnimations([{ ...strokeDecl, from: 1, to: 0 }])).toHaveLength(0)
    })
    it('from 缺省 ⇒ 编译落 0（不做"取当前值"——见 constraint/from-is-mandatory）', () => {
      const b = compileAnimations([{ kind: 'strokeProgress', to: 1, durationMs: 300 }], { nodeId: 11 })
      expect(b.anims[0]!.from).toBe(0)
    })
    it('非有限数 ⇒ 明确报错', () => {
      const bad = validateAnimations([{ ...strokeDecl, to: Number.NaN }])
      expect(bad.length).toBeGreaterThan(0)
    })
  })
})

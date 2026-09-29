// tests/i2-snap-e2e.test.ts
// ★★卡 I2（舍入时机统一）· **端到端**判据：真实 PNode 树 → 求解 → 发射，断言宿主看到的坐标。
//
// 【为什么不能只测 `snapRect` 纯函数（本仓纪律：工具对了 ≠ 链路接上了）】
//   `pixel-snap.test.ts` 只证明函数行为；若 `emitRenderCmds` 没调用它（或调用了却用回原值），
//   纯函数测试**全绿而宿主仍拿到亚像素**。⇒ 本文件从真实树走完整 emit 路径，断言最终指令坐标。
//
// 【判据】① 全部指令坐标（含裁剪框）为整数；② 三列 flexGrow:1 均分总宽守恒且首尾相接
//   （卡 I2 的原始触发场景：鸿蒙把 0.333 舍成 0.33 ⇒ 第三列错位）；
//   ③ 非整数几何树下 `stats.snappedCount > 0`（证明吸附真在跑，不是空转）；
//   ④ 求解器内部仍保持亚像素（吸附只发生在导出边界，不牺牲布局精度）。
import { describe, it, expect } from 'vitest'
import type { PNode } from '../packages/component-ir/src/pnode'
import { layoutTreeFromPNode, solveLayout, emitRenderCmds, loose } from '../packages/layout-core/src/index'

function pnode(over: Partial<PNode> & { id: number }): PNode {
  return {
    kind: 'view',
    props: { layout: { flexDirection: 'column' }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
    children: [],
    flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
    ...over,
  } as PNode
}
const V = { viewportWidth: 375, viewportHeight: 812, fontSize: 16, rootFontSize: 16 }

describe('I2 端到端', () => {
  it('三列 flex:1 均分：坐标整数 + 总宽守恒（卡 I2 的原始场景）', () => {
    const cols = [2, 3, 4].map((id) => pnode({
      id,
      props: {
        layout: { flexDirection: 'column', flexGrow: 1 },
        paint: { backgroundColor: '#111111' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
    }))
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'row', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 50 } },
        paint: { backgroundColor: '#eeeeee' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: cols,
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(100, 50))
    const list = emitRenderCmds(tree)
    const bg = list.cmds.filter((c) => c.kind === 'background' && c.nodeId !== 1)
    console.log('三列指令：', bg.map((c) => `${c.width}@${c.x}`).join(' | '), ' snappedCount=', list.stats.snappedCount)
    // ① 坐标必须全整数
    for (const c of list.cmds) {
      expect(Number.isInteger(c.x), `x 应为整数：${c.x}`).toBe(true)
      expect(Number.isInteger(c.y), `y 应为整数：${c.y}`).toBe(true)
      expect(Number.isInteger(c.width), `width 应为整数：${c.width}`).toBe(true)
      expect(Number.isInteger(c.height), `height 应为整数：${c.height}`).toBe(true)
    }
    // ② 三列总宽守恒 + 无缝隙（相邻列首尾相接）
    const sum = bg.reduce((a, c) => a + c.width, 0)
    expect(sum, '三列总宽必须守恒 = 100').toBe(100)
    const sorted = [...bg].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.x, `列 ${i} 应与前一列首尾相接（无 1px 缝/重叠）`).toBe(sorted[i - 1]!.x + sorted[i - 1]!.width)
    }
  })

  it('非整数几何树：snappedCount > 0（证明吸附真在 emit 生效，不是空转）', () => {
    const child = pnode({
      id: 2,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 33.333 }, height: { kind: 'absolute', dp: 10.7 } },
        paint: { backgroundColor: '#333333' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
    })
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100.5 }, height: { kind: 'absolute', dp: 50.25 } },
        paint: { backgroundColor: '#eeeeee' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: [child],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(100.5, 50.25))
    const list = emitRenderCmds(tree)
    expect(list.stats.snappedCount, '非整数几何必须真的被吸附').toBeGreaterThan(0)
    // 内核几何仍是亚像素（吸附只在导出边界，求解精度不受影响）
    const r = tree[0]!.rect!
    expect(r.width, '求解器内部保持亚像素').toBeCloseTo(100.5, 5)
    // 导出坐标是整数
    expect(list.cmds[0]!.width).toBe(101)
  })
})

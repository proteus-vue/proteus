// tests/layout-core-m1.test.ts
// ★★M1 排版核心回归锁（2026-09-29）——App 端高性能渲染的布局求解。
//
// 锁什么（每条都对应计划约束或本仓实测结论）：
//   ① flex 语义正确性：主轴/交叉轴/间距/grow/shrink/basis（CSS Profile L2 的 flex 子集）
//   ② **严格单次测量**（D3）：measureCalls ≈ nodeCount（禁 View 体系的多轮 measure）
//   ③ 约束传播：自顶向下传、尺寸自底向上回（松约束下子级可取更小）
//   ④ absolute/relative 定位 · display:none · overflow
//   ⑤ 文本度量钩子（平台注入 + 可缓存前提）
//   ⑥ 与 PNode（M0）的对接：归一化样式 → 布局输入
import { describe, it, expect } from 'vitest'
import { solveLayout, rectOf, tight, loose, UNBOUNDED, type LayoutNode } from '../packages/layout-core/src/index'

/** 构造布局节点（默认值贴近 M0 归一化输出） */
function mk(over: Partial<LayoutNode> & { id: number }): LayoutNode {
  return {
    tag: 'view',
    display: 'flex',
    flexDirection: 'column',
    flexWrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    flexGrow: 0,
    flexShrink: 1,
    gap: 0,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    overflow: 'visible',
    position: 'static',
    children: [],
    ...over,
  }
}

describe('★★M1 · flex 主轴与交叉轴', () => {
  it('column + 固定尺寸子级：主轴纵向堆叠', () => {
    const root = mk({
      id: 1,
      width: 300,
      height: 200,
      children: [mk({ id: 2, width: 100, height: 40 }), mk({ id: 3, width: 100, height: 60 })],
    })
    const r = solveLayout(root, tight(300, 200))
    expect(rectOf(r, 1)).toEqual({ x: 0, y: 0, width: 300, height: 200 })
    expect(rectOf(r, 2)).toEqual({ x: 0, y: 0, width: 100, height: 40 })
    expect(rectOf(r, 3)).toEqual({ x: 0, y: 40, width: 100, height: 60 })
  })

  it('row：横向排列 + gap', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 300,
      height: 50,
      gap: 10,
      children: [mk({ id: 2, width: 50, height: 50 }), mk({ id: 3, width: 50, height: 50 })],
    })
    const r = solveLayout(root, tight(300, 50))
    expect(rectOf(r, 2)).toMatchObject({ x: 0, width: 50 })
    expect(rectOf(r, 3)).toMatchObject({ x: 60, width: 50 }) // 50 + gap 10
  })

  it('justify-content：center / space-between / flex-end 定位正确', () => {
    const build = (jc: string): LayoutNode =>
      mk({
        id: 1,
        flexDirection: 'row',
        width: 100,
        height: 20,
        justifyContent: jc,
        children: [mk({ id: 2, width: 20, height: 20 }), mk({ id: 3, width: 20, height: 20 })],
      })
    // 余量 = 100 - 40 = 60
    expect(rectOf(solveLayout(build('flex-start'), tight(100, 20)), 2).x).toBe(0)
    expect(rectOf(solveLayout(build('center'), tight(100, 20)), 2).x).toBe(30)
    expect(rectOf(solveLayout(build('flex-end'), tight(100, 20)), 2).x).toBe(60)
    const sb = solveLayout(build('space-between'), tight(100, 20))
    expect(rectOf(sb, 2).x).toBe(0)
    expect(rectOf(sb, 3).x).toBe(80) // 20 + 60
  })

  it('align-items：center / flex-end / stretch（stretch 仅对交叉轴为 auto 的子级生效）', () => {
    const build = (ai: string, childHeight: number | undefined): LayoutNode =>
      mk({
        id: 1,
        flexDirection: 'row',
        width: 100,
        height: 60,
        alignItems: ai,
        children: [mk({ id: 2, width: 20, height: childHeight })],
      })
    expect(rectOf(solveLayout(build('center', 20), tight(100, 60)), 2).y).toBe(20) // (60-20)/2
    expect(rectOf(solveLayout(build('flex-end', 20), tight(100, 60)), 2).y).toBe(40)
    expect(rectOf(solveLayout(build('stretch', undefined), tight(100, 60)), 2).height, '交叉轴 auto → 拉伸填满').toBe(60)
    expect(rectOf(solveLayout(build('stretch', 20), tight(100, 60)), 2).height, '★显式 height 不被 stretch 覆盖（CSS 语义）').toBe(20)
  })

  it('flex-grow：按权重分配主轴余量', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 100,
      height: 20,
      children: [mk({ id: 2, width: 20, height: 20, flexGrow: 1 }), mk({ id: 3, width: 20, height: 20, flexGrow: 3 })],
    })
    const r = solveLayout(root, tight(100, 20))
    // 余量 60 按 1:3 分配 → 2 得 15（宽 35）、3 得 45（宽 65）
    expect(rectOf(r, 2).width).toBe(35)
    expect(rectOf(r, 3).width).toBe(65)
    expect(rectOf(r, 3).x).toBe(35)
  })

  it('flex-shrink：按 shrink × base 加权收缩', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 100,
      height: 20,
      children: [mk({ id: 2, width: 80, height: 20 }), mk({ id: 3, width: 80, height: 20 })],
    })
    const r = solveLayout(root, tight(100, 20))
    // 溢出 60，等权收缩 → 各减 30 → 宽 50
    expect(rectOf(r, 2).width).toBe(50)
    expect(rectOf(r, 3).width).toBe(50)
  })

  it('★百分比基准 = 父**内容盒**（不含父 padding）——适配层不解析，求解器解析', () => {
    // 父宽 200、左右各 20 padding → 内容盒 160；子级 50% 应为 80（而非 100）
    const root = mk({
      id: 1,
      flexDirection: 'column',
      width: 200,
      height: 100,
      padding: { top: 0, right: 20, bottom: 0, left: 20 },
      children: [mk({ id: 2, widthRatio: 0.5, height: 10 })],
    })
    expect(rectOf(solveLayout(root, tight(200, 100)), 2).width, '★50% of 内容盒 160 = 80').toBe(80)
  })

  it('★百分比主轴尺寸在 row 下按父内容宽解算（且被 flex 收缩正常处理）', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 300,
      height: 40,
      columnGap: 10,
      children: [mk({ id: 2, widthRatio: 0.5, height: 40 }), mk({ id: 3, widthRatio: 0.5, height: 40 })],
    })
    const r = solveLayout(root, tight(300, 40))
    // 两个 150 + gap 10 = 310 > 300 → 收缩 10（等权）→ 各 145
    expect(rectOf(r, 2).width).toBeCloseTo(145, 5)
    expect(rectOf(r, 3).width).toBeCloseTo(145, 5)
    expect(rectOf(r, 3).x, '第二项 x = 145 + gap 10').toBeCloseTo(155, 5)
  })

  it('flex-basis 优先于 width（CSS 语义）', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 200,
      height: 20,
      children: [mk({ id: 2, width: 100, height: 20, flexBasis: 40 })],
    })
    expect(rectOf(solveLayout(root, tight(200, 20)), 2).width).toBe(40)
  })

  it('margin / padding 参与尺寸与偏移计算', () => {
    const root = mk({
      id: 1,
      width: 100,
      height: 100,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      children: [mk({ id: 2, width: 20, height: 20, margin: { top: 5, right: 0, bottom: 0, left: 5 } })],
    })
    const r = solveLayout(root, tight(100, 100))
    // 子级坐标系原点 = 父内容区左上（padding 内：10,10），再加自身 margin（5,5）
    expect(rectOf(r, 2).x).toBe(15)
    expect(rectOf(r, 2).y).toBe(15)
  })
})

describe('★★M1 · 单次测量约束（计划 D3 —— 禁多轮 measure）', () => {
  it('深层树：measureCalls **恰好等于** nodeCount（严格单次测量）', () => {
    // 构造 3 层 × 每层 3 子 = 13 节点
    const leaf = (id: number): LayoutNode => mk({ id, width: 10, height: 10 })
    const level2 = (base: number): LayoutNode => mk({ id: base, flexDirection: 'row', width: 50, height: 10, children: [leaf(base + 1), leaf(base + 2), leaf(base + 3)] })
    const root = mk({
      id: 1,
      width: 200,
      height: 100,
      children: [level2(10), level2(20), level2(30)],
    })
    const r = solveLayout(root, tight(200, 100))
    expect(r.stats.nodeCount).toBe(13)
    // ★严格判据：每个节点**恰好**测量一次。任何 >nodeCount 都说明存在多轮 measure
    //   （View 体系的多轮 measure 在深层树上会退化成 O(n·depth)，见文件头注释）
    expect(r.stats.measureCalls, '必须恰好 nodeCount 次测量').toBe(r.stats.nodeCount)
    expect(r.diagnostics.filter((d) => d.code === 'layout.multi-pass'), '不应报多轮测量').toEqual([])
  })

  it('规模化：4050 节点树线性测量且不超时（对齐内存专项 S1 场景）', () => {
    // 2050 view + 2000 text —— 与 iOS 内存专项 S1 场景同规模
    let id = 1
    const textLeaf = (): LayoutNode =>
      mk({ id: ++id, width: 40, height: 16, measureText: () => ({ width: 40, height: 16 }) })
    const row = (): LayoutNode => mk({ id: ++id, flexDirection: 'row', gap: 4, children: Array.from({ length: 4 }, textLeaf) })
    const groups: LayoutNode[] = []
    for (let i = 0; i < 500; i++) {
      const rows: LayoutNode[] = Array.from({ length: 4 }, row)
      groups.push(mk({ id: ++id, gap: 2, children: rows })) // 每 group：1 + 4×(1+4) = 21 节点
    }
    const root = mk({ id: 1, flexDirection: 'column', width: 750, children: groups })
    const t0 = Date.now()
    const r = solveLayout(root, loose(750, UNBOUNDED))
    const ms = Date.now() - t0
    expect(r.stats.measureCalls, '线性：测量次数 = 节点数').toBe(r.stats.nodeCount)
    expect(r.stats.nodeCount).toBeGreaterThan(4000)
    expect(ms, `规模化布局耗时 ${ms}ms 异常（应有量级余量）`).toBeLessThan(500)
  })

  it('嵌套 flex 的尺寸自底向上传播（内容撑开父级）', () => {
    // 外层 column 无显式高度 → 由子级内容决定
    const root = mk({
      id: 1,
      width: 100,
      flexDirection: 'column',
      children: [mk({ id: 2, width: 50, height: 30 }), mk({ id: 3, width: 50, height: 40 })],
    })
    const r = solveLayout(root, loose(100, UNBOUNDED))
    expect(rectOf(r, 1).height, '父高应由内容撑开 = 30 + 40').toBe(70)
  })
})

describe('★★M1 · 定位与显示', () => {
  it('absolute：脱离流 + 按 top/left 定位；流内兄弟不受影响', () => {
    const root = mk({
      id: 1,
      width: 100,
      height: 100,
      children: [
        mk({ id: 2, width: 20, height: 20 }),
        mk({ id: 3, width: 10, height: 10, position: 'absolute', top: 30, left: 40 }),
        mk({ id: 4, width: 20, height: 20 }),
      ],
    })
    const r = solveLayout(root, tight(100, 100))
    expect(rectOf(r, 2).y).toBe(0)
    expect(rectOf(r, 4).y, 'absolute 不占流内空间').toBe(20)
    expect(rectOf(r, 3)).toMatchObject({ x: 40, y: 30, width: 10, height: 10 })
  })

  it('display:none：零尺寸且兄弟位移不受其影响', () => {
    const root = mk({
      id: 1,
      width: 100,
      height: 100,
      children: [mk({ id: 2, width: 20, height: 20, display: 'none' }), mk({ id: 3, width: 20, height: 20 })],
    })
    const r = solveLayout(root, tight(100, 100))
    expect(rectOf(r, 2)).toMatchObject({ width: 0, height: 0 })
    expect(rectOf(r, 3).y, '隐藏项不占位').toBe(0)
  })

  it('min/max 约束生效', () => {
    const root = mk({
      id: 1,
      flexDirection: 'row',
      width: 200,
      height: 20,
      children: [
        mk({ id: 2, flexBasis: 10, height: 20, flexGrow: 1, maxWidth: 30 }),
        mk({ id: 3, flexBasis: 10, height: 20, flexGrow: 1, minWidth: 100 }),
      ],
    })
    const r = solveLayout(root, tight(200, 20))
    expect(rectOf(r, 2).width, 'maxWidth 应封顶').toBeLessThanOrEqual(30)
    expect(rectOf(r, 3).width, 'minWidth 应保底').toBeGreaterThanOrEqual(100)
  })
})

describe('★★M1 · 文本度量钩子（平台注入 —— §5.3 可缓存）', () => {
  it('叶子文本：由 measureText 决定尺寸（含 padding）', () => {
    let calls = 0
    const text = mk({
      id: 2,
      width: undefined,
      height: undefined,
      padding: { top: 2, right: 4, bottom: 2, left: 4 },
      measureText: (maxW) => {
        calls++
        return { width: Math.min(60, maxW), height: 16 }
      },
    })
    const root = mk({ id: 1, width: 100, height: 50, children: [text] })
    const r = solveLayout(root, tight(100, 50))
    expect(calls, '★文本度量在一次布局中只调用一次（可缓存的前提）').toBe(1)
    expect(rectOf(r, 2).width).toBe(60 + 8) // 文本 60 + padding 8
    expect(rectOf(r, 2).height).toBe(16 + 4)
  })

  it('无 measureText 的叶子：零内容尺寸（不抛错）', () => {
    const root = mk({ id: 1, width: 50, height: 50, children: [mk({ id: 2 })] })
    const r = solveLayout(root, tight(50, 50))
    expect(rectOf(r, 2)).toMatchObject({ width: 0, height: 0 })
  })
})

describe('★★M1 · 与 M0（渲染 IR）的对接', () => {
  it('解法可复现：同输入 → 同输出（对拍/快照的前提）', () => {
    const build = (): LayoutNode =>
      mk({
        id: 1,
        width: 200,
        height: 100,
        gap: 5,
        children: [mk({ id: 2, flexGrow: 1, height: 20 }), mk({ id: 3, flexGrow: 2, height: 20 })],
      })
    const a = solveLayout(build(), tight(200, 100))
    const b = solveLayout(build(), tight(200, 100))
    expect([...a.rects.entries()]).toEqual([...b.rects.entries()])
  })
})

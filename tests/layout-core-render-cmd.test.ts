// tests/layout-core-render-cmd.test.ts
// ★★M1-4 回归锁：PNode 适配 + 平台无关绘制指令流。
//
// 锁什么：
//   ① ResolvedLength → 数值（绝对 / vw·vh / % / em·rem）——比例解算在运行时，不在编译期
//   ② PNode → LayoutNode 的样式映射（含 M0 的 paintHint 透传）
//   ③ 指令流：**绝对坐标**（父链偏移已累加）——平台层零换算
//   ④ 拍平：被拍平节点不产出指令，绘制并入最近绘画祖先，**不新建合成位图**（§12.3 硬性规则）
//   ⑤ 裁剪：overflow 非 visible 产出 push/popClip，且裁剪内不并入外部指令
//   ⑥ 文本指令携带字面量与样式（平台文本栈消费）
import { describe, it, expect } from 'vitest'
import type { PNode } from '../packages/component-ir/src/pnode'
import {
  layoutTreeFromPNode,
  resolveLength,
  solveLayout,
  emitRenderCmds,
  formatRenderCmds,
  attachParents,
  paintInfoOf,
  tight,
  loose,
  UNBOUNDED,
  type LayoutNode,
} from '../packages/layout-core/src/index'

/** 构造最小 PNode（默认值：column + stretch，贴近浏览器 flex 默认） */
function pnode(over: Partial<PNode> & { id: number }): PNode {
  return {
    kind: 'view',
    props: {
      layout: { flexDirection: 'column' },
      paint: {},
      paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false },
    },
    children: [],
    flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
    ...over,
  } as PNode
}

const V = { viewportWidth: 375, viewportHeight: 812, fontSize: 16, rootFontSize: 16 }

describe('★★M1-4 · ResolvedLength 解算（运行时比例求值）', () => {
  it('绝对值直接返回；比例按基准解算', () => {
    const parent = { width: 200, height: 100 }
    expect(resolveLength({ kind: 'absolute', dp: 42 }, parent, V)).toBe(42)
    expect(resolveLength({ kind: 'ratio', ratio: 0.5, base: 'parentWidth' }, parent, V)).toBe(100)
    expect(resolveLength({ kind: 'ratio', ratio: 0.5, base: 'parentHeight' }, parent, V)).toBe(50)
    expect(resolveLength({ kind: 'ratio', ratio: 0.1, base: 'viewportWidth' }, parent, V)).toBe(37.5)
    expect(resolveLength({ kind: 'ratio', ratio: 0.1, base: 'viewportHeight' }, parent, V)).toBe(81.2)
    expect(resolveLength({ kind: 'ratio', ratio: 2, base: 'fontSize' }, parent, V)).toBe(32)
    expect(resolveLength({ kind: 'ratio', ratio: 2, base: 'rootFontSize' }, parent, V)).toBe(32)
    expect(resolveLength(undefined, parent, V)).toBeUndefined()
  })
})

describe('★★M1-4 · PNode → LayoutNode 适配', () => {
  it('样式映射：flex 属性/边距/尺寸与 paintHint 透传', () => {
    const node = pnode({
      id: 7,
      kind: 'view',
      props: {
        layout: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: { kind: 'absolute', dp: 8 },
          width: { kind: 'absolute', dp: 300 },
          height: { kind: 'absolute', dp: 44 },
          padding: { left: { kind: 'absolute', dp: 12 }, right: { kind: 'absolute', dp: 12 } },
          margin: { top: { kind: 'absolute', dp: 4 } },
          flexGrow: 1,
        },
        paint: { backgroundColor: '#ff0000' },
        paintHint: { isMonochrome: true, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
    })
    const [ln] = layoutTreeFromPNode([node], { lengthContext: V }) as [LayoutNode]
    expect(ln.tag).toBe('view')
    expect(ln.flexDirection).toBe('row')
    expect(ln.justifyContent).toBe('space-between')
    expect(ln.alignItems).toBe('center')
    expect(ln.gap).toBe(8)
    expect(ln.width).toBe(300)
    expect(ln.height).toBe(44)
    expect(ln.padding.left).toBe(12)
    expect(ln.margin.top).toBe(4)
    expect(ln.flexGrow).toBe(1)
    // paintHint 由适配层挂在内部字段，指令流消费
    expect(paintInfoOf(ln)!.hint.isPureBackground).toBe(true)
    expect(paintInfoOf(ln)!.paint.backgroundColor).toBe('#ff0000')
  })

  it('文本节点：注入度量钩子后可在布局中被消费', () => {
    const text = pnode({ id: 2, kind: 'text', text: '你好世界' })
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [text],
    })
    const calls: number[] = []
    const tree = layoutTreeFromPNode([root], {
      lengthContext: V,
      measureText: (_n, maxW) => {
        calls.push(maxW)
        return { width: Math.min(80, maxW), height: 20 }
      },
    })
    attachParents(tree[0]!)
    const r = solveLayout(tree[0]!, loose(200, UNBOUNDED))
    expect(calls.length, '文本度量被调用一次').toBe(1)
    expect(r.rects.get(2)!.height).toBe(20)
    expect(r.rects.get(1)!.height, '父高由文本撑开').toBe(20)
  })
})

describe('★★M1-4 · 绘制指令流', () => {
  it('绝对坐标：深层嵌套的偏移正确累加（平台层零换算）', () => {
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, padding: { top: { kind: 'absolute', dp: 10 }, left: { kind: 'absolute', dp: 20 } } },
        paint: { backgroundColor: '#111111' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: [
        pnode({
          id: 2,
          props: {
            layout: { flexDirection: 'row', height: { kind: 'absolute', dp: 50 }, margin: { left: { kind: 'absolute', dp: 5 } } },
            paint: { backgroundColor: '#222222' },
            paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
          },
        }),
      ],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(200, UNBOUNDED))
    const list = emitRenderCmds(tree)
    const child = list.cmds.find((c) => c.nodeId === 2)!
    // 父 padding-left 20 + 自身 margin-left 5 = 25；父 padding-top 10
    expect(child.x, '绝对 x = padding(20) + margin(5)').toBe(25)
    expect(child.y, '绝对 y = padding(10)').toBe(10)
    // stretch 填满父内容盒（180）**减去自身 margin**（5）→ 175；右缘正好落在父的右边界
    expect(child.width, '★stretch 尺寸 = 父内容宽 − 自身 margin').toBe(175)
    expect(child.x + child.width, '子级右缘 = 父右边界（无右 padding）').toBe(200)
    expect(child.height).toBe(50)
  })

  it('拍平：被拍平节点**不产出指令**，绘制并入最近绘画祖先且不新建位图', () => {
    const flatChild = (id: number): PNode =>
      pnode({
        id,
        props: {
          layout: { flexDirection: 'column', height: { kind: 'absolute', dp: 10 } },
          paint: { backgroundColor: '#333333' },
          paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
        },
        flags: { isStatic: true, flattenEligible: true, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
      })
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 50 } },
        paint: { backgroundColor: '#eeeeee' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: [flatChild(2), flatChild(3)],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, tight(100, 50))
    const list = emitRenderCmds(tree)

    expect(list.cmds.map((c) => c.nodeId), '拍平子级不产出指令').toEqual([1])
    expect(list.stats.flattenedCount).toBe(2)
    expect(list.stats.mergedCount).toBe(2)
    expect(list.cmds[0]!.mergedFrom, '★并入清单 = 拍平结果的可验证读数').toEqual([2, 3])
    expect(list.cmds[0]!.x, '★绘制落在父级已有区域（复用父 backing store，不新建位图）').toBe(0)
    expect(list.cmds[0]!.width).toBe(100)
  })

  it('拍平边界：无绘画祖先时退化为正常发指令（不丢绘制）', () => {
    const flatRoot = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 50 } },
        paint: { backgroundColor: '#abcdef' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      flags: { isStatic: true, flattenEligible: true, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
    })
    const tree = layoutTreeFromPNode([flatRoot], { lengthContext: V })
    solveLayout(tree[0]!, tight(100, 50))
    const list = emitRenderCmds(tree)
    expect(list.cmds.length, '★根节点无可并入的祖先 → 必须正常绘制（不丢内容）').toBe(1)
    expect(list.cmds[0]!.nodeId).toBe(1)
    expect(list.stats.flattenedCount, '根不参与拍平统计').toBe(0)
  })

  it('裁剪：overflow 非 visible 产出 push/popClip，且裁剪内不并入外部指令', () => {
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 100 }, overflow: 'hidden' },
        paint: { backgroundColor: '#ffffff' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: [
        pnode({
          id: 2,
          props: {
            layout: { flexDirection: 'column', height: { kind: 'absolute', dp: 20 } },
            paint: { backgroundColor: '#000000' },
            paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
          },
          flags: { isStatic: true, flattenEligible: true, isLayoutBoundary: false, hasEvent: false, isNativeHost: false },
        }),
      ],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, tight(100, 100))
    const list = emitRenderCmds(tree)
    const kinds = list.cmds.map((c) => c.kind)
    // ★裁剪边界 = 拍平边界（已知边界，M3 处理 overflow 时再评估）：
    //   裁剪区内唯一内容若并入**裁剪前**的祖先指令，绘制会落到裁剪区外 → 不成立，
    //   故该节点退化为独立指令（渲染正确性优先于拍平收益）
    expect(kinds, 'push/popClip 成对；裁剪内内容独立成指令').toEqual(['background', 'pushClip', 'background', 'popClip'])
    const outer = list.cmds[0]!
    expect(outer.mergedFrom, '★不跨裁剪边界并入（否则绘制落到裁剪区外）').toBeUndefined()
    const inner = list.cmds[2]!
    expect(inner.nodeId, '裁剪内的拍平节点退化为自身指令（不丢绘制）').toBe(2)
  })

  it('文本指令：携带字面量与字号/颜色（平台文本栈消费）', () => {
    const text = pnode({
      id: 2,
      kind: 'text',
      text: '提交订单',
      props: {
        layout: { flexDirection: 'column' },
        paint: {},
        text: { fontSize: { kind: 'absolute', dp: 14 }, color: '#333333', fontWeight: 600 },
        paintHint: { isMonochrome: true, isPureBackground: false, staticSubtree: true, needsCompositingLayer: false },
      },
    })
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 30 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [text],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V, measureText: () => ({ width: 56, height: 17 }) })
    solveLayout(tree[0]!, tight(100, 30))
    const list = emitRenderCmds(tree)
    const t = list.cmds.find((c) => c.kind === 'text')!
    expect(t.text).toBe('提交订单')
    expect(t.fontSize).toBe(14)
    expect(t.color_).toBe('#333333')
    expect(t.fontWeight).toBe(600)
    expect(t.hint.isMonochrome, '单色 → 平台可用紧凑 backing store（实测 −39%）').toBe(true)
  })

  it('空绘制节点不产出指令（避免平台空转）', () => {
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 50 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [pnode({ id: 2, props: { layout: { flexDirection: 'column', height: { kind: 'absolute', dp: 10 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } })],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, tight(100, 50))
    const list = emitRenderCmds(tree)
    expect(list.cmds.length, '无绘制属性 → 零指令').toBe(0)
  })

  it('指令序稳定：同输入两次生成结果一致（快照/差分回归的前提）', () => {
    const mk3 = (): PNode[] => {
      const leaves = [1, 2, 3].map((i) =>
        pnode({
          id: 10 + i,
          props: { layout: { flexDirection: 'column', height: { kind: 'absolute', dp: 10 } }, paint: { backgroundColor: `#00000${i}` }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false } },
        }),
      )
      return [pnode({ id: 1, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 } }, paint: { backgroundColor: '#fff' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false } }, children: leaves })]
    }
    const a = emitRenderCmds(solveAndAdapt(mk3()))
    const b = emitRenderCmds(solveAndAdapt(mk3()))
    expect(formatRenderCmds(a)).toBe(formatRenderCmds(b))
  })
})

/** 适配 + 求解（测试内复用） */
function solveAndAdapt(roots: PNode[]): LayoutNode[] {
  const tree = layoutTreeFromPNode(roots, { lengthContext: V })
  for (const t of tree) attachParents(t)
  for (const t of tree) solveLayout(t, loose(375, UNBOUNDED))
  return tree
}

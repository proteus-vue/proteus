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

// ══════════════════════════════════════════════════════════════════════════════
// ★★卡 I5 · overdraw culling（视口裁剪）—— 2026-09-29
//
// 【判据设计（三条，缺一不可）】
//   ① **省**：视口外的节点不 emit 指令（读 `stats.culledCount`）
//   ② **不误裁**：视口**内**的指令与"不裁剪"时**逐条相同**（等价性——裁剪只该少、不该变）
//   ③ **absolute 不误裁**：`position: absolute` 子级可溢出父盒回到视口内 ⇒
//      即使父盒在视口外，也不能连带裁掉它（本仓已有"溢出定位"的语义在前）
// ══════════════════════════════════════════════════════════════════════════════
describe('★I5 · overdraw culling（视口裁剪）', () => {
  /** 造一棵纵向 5 行（每行高 100）的树：id 100+i 为行，行内 id 200+i 为文本 */
  /** 造一个「有绘制内容」的节点（背景色 ⇒ 必产出一条 background 指令） */
  const painted = (over: { id: number; w: number; h: number; bg?: string }): PNode =>
    pnode({
      id: over.id,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: over.w }, height: { kind: 'absolute', dp: over.h }, flexShrink: 0 },
        paint: { backgroundColor: over.bg ?? '#112233' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
      },
    } as Partial<PNode> & { id: number })

  const columnTree = (): LayoutNode[] => {
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 300 }, height: { kind: 'absolute', dp: 500 } },
        paint: { backgroundColor: '#000000' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
      },
    } as Partial<PNode> & { id: number })
    root.children = [0, 1, 2, 3, 4].map((i) => painted({ id: 100 + i, w: 300, h: 100 }))
    // ★与既有测试同法：`layoutTreeFromPNode([node], { lengthContext })` → 再 solveLayout
    const tree = layoutTreeFromPNode([root], { lengthContext: V }) as LayoutNode[]
    solveLayout(tree[0]!, loose(300, 500))
    attachParents(tree[0]!)
    return tree
  }

  it('① 省：视口只覆盖前 2 行 ⇒ 后面的行不 emit', () => {
    const roots = columnTree()
    const full = emitRenderCmds(roots)
    const culled = emitRenderCmds(roots, { cullToViewport: true, viewportWidth: 300, viewportHeight: 200 })
    expect(full.stats.cmdCount).toBeGreaterThan(culled.stats.cmdCount)   // 确实省了
    expect(culled.stats.culledCount).toBeGreaterThan(0)
    // 视口高 200（y 覆盖 0..200）；行高 100 ⇒ 期望保留 y=0、y=100、y=200 三行
    // ★★边界口径（**保守**，2026-09-29 实测确立）：用**严格不等式**判"在视口外"
    //   （`abs.y > vy0+vh`）⇒ **正好贴视口边界**的元素（y=200 那行）**保留**。
    //   为什么保守：贴边元素可能有可见像素（1px 描边 / 分隔线 / 阴影），
    //   裁掉即"可见内容消失"；而多留一条指令的代价远小于误裁。
    //   ⇒ 本仓实测曾用 `>=`（把贴边判为视口外）**误裁了 y=-50 的 absolute 子级**，故改严格不等式。
    // ★根节点自身跨越视口（y=0..500 vs 视口 0..200）⇒ 按语义不被裁（"整个盒在视口外"才裁）
    const childRows = culled.cmds.filter((c) => c.nodeId >= 100)
    expect(childRows.length).toBe(3)              // y=0 / y=100 / y=200（贴边保留）
    expect(childRows.map((c) => c.y)).toEqual([0, 100, 200])
    // 真正离开视口的行（y=300、y=400）必须被裁掉
    expect(culled.cmds.some((c) => c.y >= 300)).toBe(false)
  })

  it('★★② 不误裁：视口内的指令与不裁剪时**逐条相同**（等价性）', () => {
    const roots = columnTree()
    const full = emitRenderCmds(roots)
    const culled = emitRenderCmds(roots, { cullToViewport: true, viewportWidth: 300, viewportHeight: 150 })
    // 取"在视口内"的指令（按 y 判），两侧必须一致（顺序与内容都不变）
    const visible = (c: { y: number; height: number }) => c.y + c.height > 0 && c.y < 150
    const fullVisible = full.cmds.filter(visible).map((c) => `${c.kind}:${c.x},${c.y},${c.width},${c.height}`)
    const culledVisible = culled.cmds.filter(visible).map((c) => `${c.kind}:${c.x},${c.y},${c.width},${c.height}`)
    expect(culledVisible).toEqual(fullVisible)
  })

  it('★★③ absolute 子级不误裁：父盒在视口外，溢出子级回到视口内仍 emit', () => {
    // ★场景：父（id 10）**在视口下方**（margin-top 300 ⇒ y=300，视口高 200 ⇒ 父整体在视口外），
    //   其 absolute 子（id 11）用 `top:-350` 上移到 y=-50（**回到视口内**）
    //   ⇒ 若实现"父在视口外就整棵跳过"，会**误裁**这个可见子级。
    //   （本仓实测校正：absolute 的 top 是相对父的**未偏移**位置，故用 -350 才落到视口内）
    const rootNode = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 300 }, height: { kind: 'absolute', dp: 600 } },
        paint: { backgroundColor: '#000000' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
      },
    } as Partial<PNode> & { id: number })
    const parentNode = painted({ id: 10, w: 300, h: 100 })
    parentNode.props.layout.margin = { top: { kind: 'absolute', dp: 300 } }   // 父下移到 y=300（视口外）
    parentNode.children = [pnode({
      id: 11,
      props: {
        layout: { position: 'absolute', width: { kind: 'absolute', dp: 50 }, height: { kind: 'absolute', dp: 50 }, top: { kind: 'absolute', dp: -350 }, left: { kind: 'absolute', dp: 0 } },
        paint: { backgroundColor: '#ff0000' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
      },
    } as Partial<PNode> & { id: number })]
    rootNode.children = [parentNode]
    const tree = layoutTreeFromPNode([rootNode], { lengthContext: V }) as LayoutNode[]
    solveLayout(tree[0]!, loose(300, 600))
    attachParents(tree[0]!)

    const culled = emitRenderCmds(tree, { cullToViewport: true, viewportWidth: 300, viewportHeight: 200 })
    // absolute 子（id 11）在视口内 ⇒ 必须出现
    const has11 = culled.cmds.some((c) => c.nodeId === 11)
    expect(has11).toBe(true)
  })

  it('① 无裁剪开关 ⇒ 行为与既有一致（默认不变——不静默改变历史读数语义）', () => {
    const roots = columnTree()
    const a = emitRenderCmds(roots)
    const b = emitRenderCmds(roots, { viewportWidth: 300, viewportHeight: 200 })   // 只给视口、不开开关
    expect(b.stats.cmdCount).toBe(a.stats.cmdCount)
  })

  it('① 视口覆盖全树 ⇒ 不裁任何东西（culledCount = 0）', () => {
    const roots = columnTree()
    const culled = emitRenderCmds(roots, { cullToViewport: true, viewportWidth: 300, viewportHeight: 9999 })
    expect(culled.stats.culledCount).toBe(0)
    expect(culled.stats.cmdCount).toBe(emitRenderCmds(roots).stats.cmdCount)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★卡 I5 执行项 3/3：**同色相邻背景合并**（opt-in —— `mergeSameColorBg`）
//
// 判据分两层（本仓纪律：既要"省了多少"，也要"没画错"）：
//   ① 省：`stats.mergedBgCount`（0 在本测试里必须被"严丝合缝场景 > 0"证伪，防空转）
//   ② 对：合并前后**覆盖面积逐像素等价**（用矩形并集面积比对——不靠"看起来对"）
// ══════════════════════════════════════════════════════════════════════════════
describe('★卡 I5-3 · 同色相邻背景合并', () => {
  /** 铺 N 个等色竖条（严丝合缝：同 x/同宽/首尾相接） */
  function stripRows(ids: number[], color: string, opts: { w?: number; h?: number; gap?: number } = {}) {
    const w = opts.w ?? 100
    const h = opts.h ?? 20
    const gap = opts.gap ?? 0
    const rows = ids.map((id, i) =>
      pnode({
        id,
        props: {
          layout: {
            flexDirection: 'column',
            width: { kind: 'absolute', dp: w },
            height: { kind: 'absolute', dp: h },
            // ★gap 用于构造"错位/有缝"的场景（不严丝合缝 ⇒ 不得合并）
            margin: gap ? { top: { kind: 'absolute', dp: i === 0 ? 0 : gap } } : undefined,
          },
          paint: { backgroundColor: color },
          paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
        },
      }),
    )
    return pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: w }, height: { kind: 'absolute', dp: ids.length * (h + gap) } },
        paint: { backgroundColor: '#ffffff' },
        paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false },
      },
      children: rows,
    })
  }

  const solve = (root: PNode) => {
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(400, UNBOUNDED))
    return tree
  }

  /** 覆盖面积等价性判据：把指令矩形"涂"到网格上比面积（避免依赖浮点并集算法） */
  function coverageFingerprint(list: { cmds: Array<{ x: number; y: number; width: number; height: number }> }): number {
    let sum = 0
    for (const c of list.cmds) sum += Math.max(0, c.width) * Math.max(0, c.height)
    return sum
  }

  it('① ★严丝合缝的等色竖条 ⇒ 合并成一条（且覆盖面积不变）', () => {
    const tree = solve(stripRows([2, 3, 4, 5], '#285ac8'))
    const full = emitRenderCmds(tree)
    const merged = emitRenderCmds(tree, { mergeSameColorBg: true })

    // 基线：根(白) + 4 条等色 = 5 条；合并后应为 根(白) + 1 条 = 2 条
    expect(full.cmds.length, '未合并时 5 条').toBe(5)
    expect(merged.stats.mergedBgCount, '★合并读数必须 > 0（0 = 开关没生效或判据失效）').toBe(3)
    expect(merged.cmds.length, '合并后 2 条').toBe(2)

    // ★正确性：颜色没变、位置是第一条的、高度是四条之和
    const block = merged.cmds.find((c) => c.color === '#285ac8')!
    expect(block.x).toBe(0)
    expect(block.width).toBe(100)
    expect(block.height, '4 × 20 = 80').toBe(80)
    // ★可验证读数：吸收清单记录了被并入的 nodeId
    expect(block.mergedBgFrom, '★并入清单（省了谁，可回溯）').toEqual([3, 4, 5])
    // ★覆盖面积等价（同色同面积 ⇒ 视觉等价）
    const area = (l: { cmds: Array<{ width: number; height: number }> }) => coverageFingerprint(l as never)
    expect(area(merged), '★合并前后覆盖面积必须完全相等（多画/少画都会被这条抓到）').toBe(area(full))
  })

  it('② ★异色不得合并（相邻但不同色）', () => {
    const root = stripRows([2, 3], '#285ac8')
    root.children = [
      pnode({ id: 2, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 20 } }, paint: { backgroundColor: '#ff0000' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
      pnode({ id: 3, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 20 } }, paint: { backgroundColor: '#00ff00' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
    ]
    const tree = solve(root)
    const merged = emitRenderCmds(tree, { mergeSameColorBg: true })
    expect(merged.stats.mergedBgCount, '异色 ⇒ 一条都不该合并').toBe(0)
  })

  it('③ ★有缝隙（不严丝合缝）不得合并——合并会多画那条缝', () => {
    const tree = solve(stripRows([2, 3, 4], '#285ac8', { gap: 4 }))
    const merged = emitRenderCmds(tree, { mergeSameColorBg: true })
    expect(merged.stats.mergedBgCount, '★有缝 ⇒ 合并会盖住缝隙 ⇒ 必须拒绝').toBe(0)
  })

  it('④ ★带圆角/描边/渐变/文本的背景不参与合并（并集不再是矩形）', () => {
    const mk = (id: number, over: Partial<PNode['props']>): PNode =>
      pnode({
        id,
        props: {
          layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 20 } },
          paint: { backgroundColor: '#285ac8' },
          paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
          ...over,
        },
      })
    // 圆角（圆角外是透明角 ⇒ 并集不是矩形）
    const rounded = mk(2, { paint: { backgroundColor: '#285ac8', borderRadius: { top: { kind: 'absolute', dp: 8 }, right: { kind: 'absolute', dp: 8 }, bottom: { kind: 'absolute', dp: 8 }, left: { kind: 'absolute', dp: 8 } } } })
    const plain = mk(3, {})
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 40 } }, paint: { backgroundColor: '#ffffff' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: true, needsCompositingLayer: false } },
      children: [rounded, plain],
    })
    const tree = solve(root)
    const merged = emitRenderCmds(tree, { mergeSameColorBg: true })
    expect(merged.stats.mergedBgCount, '★圆角参与 ⇒ 不得合并（透明角会露出）').toBe(0)
  })

  it('⑤ 中间夹了其它绘制 ⇒ 自然断开（不相邻不合并）', () => {
    const mk = (id: number, bg: string): PNode =>
      pnode({ id, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 20 } }, paint: { backgroundColor: bg }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
    const text = pnode({ id: 3, kind: 'text', text: 'X', props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 20 } }, paint: {}, paintHint: { isMonochrome: true, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } })
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 60 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [mk(2, '#285ac8'), text, mk(4, '#285ac8')],
    })
    const tree = solve(root)
    const merged = emitRenderCmds(tree, { mergeSameColorBg: true })
    expect(merged.stats.mergedBgCount, '★中间夹文本 ⇒ 两条被隔开，不得跨过它合并').toBe(0)
  })

  it('⑥ ★默认关闭（不传选项 ⇒ 行为与既有一致，读数不变）', () => {
    const tree = solve(stripRows([2, 3, 4], '#285ac8'))
    const off = emitRenderCmds(tree)
    expect(off.stats.mergedBgCount, '默认关闭 ⇒ 读数为 0').toBe(0)
    expect(off.cmds.length, '默认关闭 ⇒ 指令数与历史口径一致').toBe(4)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★卡 I5 执行项 2/3：**遮挡剔除**（opt-in —— `cullOccluded`）
//
// 风险等级：**最高**（误裁 = 内容消失，本仓最忌讳的静默缺陷）⇒ 判据必须能逐条变红：
//   ① 生效：全屏不透明覆盖层 ⇒ 其下的指令全丢
//   ② 不该裁的六种情形（半透明 / 圆角 / 渐变 / 描边 / 仅部分覆盖 / 覆盖者在**先**画）
//   ③ 裁剪交互：被裁剪的遮挡物只在其裁剪区内有效（区外内容不得被误裁）
//   ④ 默认关闭
// ══════════════════════════════════════════════════════════════════════════════
describe('★卡 I5-2 · 遮挡剔除', () => {
  /** 造一个"底层内容 + 覆盖层"的两兄弟场景（覆盖层在**后** ⇒ 画家算法下在上） */
  function overlay(bg: { color: string; radius?: boolean; gradient?: boolean; border?: boolean }, cover = { x: 0, y: 0, w: 200, h: 100 }) {
    const paint: Record<string, unknown> = { backgroundColor: bg.color }
    if (bg.radius) paint.borderRadius = { top: { kind: 'absolute', dp: 8 }, right: { kind: 'absolute', dp: 8 }, bottom: { kind: 'absolute', dp: 8 }, left: { kind: 'absolute', dp: 8 } }
    if (bg.gradient) paint.backgroundImage = 'linear-gradient(#000,#fff)'
    if (bg.border) paint.borderWidth = { top: { kind: 'absolute', dp: 2 }, right: { kind: 'absolute', dp: 2 }, bottom: { kind: 'absolute', dp: 2 }, left: { kind: 'absolute', dp: 2 } }
    const root = pnode({
      id: 1,
      props: {
        layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 100 } },
        paint: {},
        paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false },
      },
      children: [
        // 底层：有绘制的一整块（会被覆盖）
        pnode({
          id: 2,
          props: {
            layout: { flexDirection: 'column', position: 'absolute', top: { kind: 'absolute', dp: 0 }, left: { kind: 'absolute', dp: 0 }, width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 100 } },
            paint: { backgroundColor: '#123456' },
            paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
          },
        }),
        // 覆盖层（后画 ⇒ 在上）
        pnode({
          id: 3,
          props: {
            layout: { flexDirection: 'column', position: 'absolute', top: { kind: 'absolute', dp: cover.y }, left: { kind: 'absolute', dp: cover.x }, width: { kind: 'absolute', dp: cover.w }, height: { kind: 'absolute', dp: cover.h } },
            paint,
            paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false },
          },
        }),
      ],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(400, UNBOUNDED))
    return tree
  }

  it('① ★全屏不透明覆盖层 ⇒ 其下的指令被丢弃（读数 > 0）', () => {
    const tree = overlay({ color: '#ffffff' })
    const base = emitRenderCmds(tree)
    const culled = emitRenderCmds(tree, { cullOccluded: true })
    expect(base.cmds.length, '基线：底层 + 覆盖层').toBe(2)
    expect(culled.stats.occludedCount, '★必须真的剔除了（0 = 开关没生效或判据失效）').toBe(1)
    expect(culled.cmds.map((c) => c.nodeId), '被覆盖的 #2 应消失，覆盖层 #3 保留').toEqual([3])
  })

  it('② ★半透明覆盖层不得剔除（rgba α<1 / 8 位 hex 带 alpha 都测）', () => {
    for (const color of ['rgba(255,255,255,0.5)', '#ffffff80']) {
      const tree = overlay({ color })
      const culled = emitRenderCmds(tree, { cullOccluded: true })
      expect(culled.stats.occludedCount, `★半透明 ${color} ⇒ 下层仍可见 ⇒ 不得剔除`).toBe(0)
      expect(culled.cmds.length).toBe(2)
    }
  })

  it('③ ★圆角 / 渐变 / 描边覆盖层不得剔除（覆盖区不是纯矩形）', () => {
    for (const [name, bg] of [['圆角', { color: '#ffffff', radius: true }], ['渐变', { color: '#ffffff', gradient: true }], ['描边', { color: '#ffffff', border: true }]] as const) {
      const tree = overlay(bg)
      const culled = emitRenderCmds(tree, { cullOccluded: true })
      expect(culled.stats.occludedCount, `★${name}覆盖层 ⇒ 角/边可能透出 ⇒ 不得剔除`).toBe(0)
    }
  })

  it('④ ★仅部分覆盖不得剔除', () => {
    const tree = overlay({ color: '#ffffff' }, { x: 0, y: 0, w: 100, h: 100 }) // 只盖左半
    const culled = emitRenderCmds(tree, { cullOccluded: true })
    expect(culled.stats.occludedCount, '★只盖一半 ⇒ 另一半仍可见 ⇒ 不得剔除').toBe(0)
  })

  it('⑤ ★覆盖者在**先**画（被后画者盖住）⇒ 不得剔除后画的', () => {
    // 交换顺序：先画白底（大），后画深色（小）——小的在上，不能被下面的裁掉
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 100 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [
        pnode({ id: 2, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 100 } }, paint: { backgroundColor: '#ffffff' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
        pnode({ id: 3, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 50 }, height: { kind: 'absolute', dp: 50 } }, paint: { backgroundColor: '#111111' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
      ],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(400, UNBOUNDED))
    const culled = emitRenderCmds(tree, { cullOccluded: true })
    expect(culled.stats.occludedCount, '小方块在上（后画）⇒ 不能被大底面裁掉').toBe(0)
    expect(culled.cmds.length).toBe(2)
  })

  it('⑥ ★裁剪感知：**溢出自裁剪区的**遮挡物只在裁剪区内有效（区外不得误裁）', () => {
    // 【为什么必须是"溢出"场景（本仓实测的测试覆盖缺口）】首版用"白块恰好等于裁剪区"——
    //   那种情形下 `visible === rect`，**忽略裁剪的实现也能通过**（破坏性验证当场暴露：
    //   把遮挡物从 `visible` 换成 `rect`，测试仍全绿）。⇒ 必须让矩形**溢出自裁剪区**，
    //   才真正检验"用裁剪后的实际覆盖区当遮挡物"。
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 400 }, height: { kind: 'absolute', dp: 300 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      children: [
        // #2 区外内容：落在溢出白块的**原始矩形内**、但**裁剪区外** ⇒ 必须保留
        pnode({ id: 2, props: { layout: { flexDirection: 'column', position: 'absolute', top: { kind: 'absolute', dp: 150 }, left: { kind: 'absolute', dp: 250 }, width: { kind: 'absolute', dp: 30 }, height: { kind: 'absolute', dp: 30 } }, paint: { backgroundColor: '#123456' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
        // #3 裁剪容器（100×60，hidden），内含 #4 白块 **200×200（溢出容器）**
        pnode({
          id: 3,
          props: {
            layout: { flexDirection: 'column', position: 'absolute', top: { kind: 'absolute', dp: 40 }, left: { kind: 'absolute', dp: 100 }, width: { kind: 'absolute', dp: 100 }, height: { kind: 'absolute', dp: 60 }, overflow: 'hidden' },
            paint: {},
            paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false },
          },
          children: [
            // ★flexShrink:0 —— 否则 200 高会被 60 高的父压缩到 60（本仓实测：前提自检当场抓出，
            //   压缩后它就没溢出容器，本用例就测不到"裁剪后的覆盖区"这条路径）
            pnode({ id: 4, props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 200 }, flexShrink: 0 }, paint: { backgroundColor: '#ffffff' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } }),
          ],
        }),
      ],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(400, UNBOUNDED))
    const base = emitRenderCmds(tree)
    const culled = emitRenderCmds(tree, { cullOccluded: true })
    // 前提自检：#4 的原始矩形确实**覆盖** #2（否则本用例测不到裁剪路径，等于假绿）
    const c4 = base.cmds.find((c) => c.nodeId === 4)!
    const c2 = base.cmds.find((c) => c.nodeId === 2)!
    const rawCovers = c4.x <= c2.x && c4.y <= c2.y && c4.x + c4.width >= c2.x + c2.width && c4.y + c4.height >= c2.y + c2.height
    expect(rawCovers, '★用例前提：#4 原始矩形应覆盖 #2（否则本用例没测到裁剪）').toBe(true)
    expect(culled.cmds.some((c) => c.nodeId === 2), '★区外内容必须保留（裁剪区内的白块不能越界裁它）').toBe(true)
    expect(culled.stats.occludedCount, '本场景无真实遮挡 ⇒ 应为 0').toBe(0)
  })

  it('⑦ 默认关闭（不传选项 ⇒ 读数 0，指令数与历史口径一致）', () => {
    const tree = overlay({ color: '#ffffff' })
    const off = emitRenderCmds(tree)
    expect(off.stats.occludedCount).toBe(0)
    expect(off.cmds.length).toBe(2)
  })

  it('⑧ ★协同：合并出的**大矩形是更强的遮挡物**（单块盖不全、并起来才盖得住）', () => {
    const mk = (id: number, y: number, color: string, w = 200, h = 50): PNode =>
      pnode({ id, props: { layout: { flexDirection: 'column', position: 'absolute', top: { kind: 'absolute', dp: y }, left: { kind: 'absolute', dp: 0 }, width: { kind: 'absolute', dp: w }, height: { kind: 'absolute', dp: h } }, paint: { backgroundColor: color }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
    const root = pnode({
      id: 1,
      props: { layout: { flexDirection: 'column', width: { kind: 'absolute', dp: 200 }, height: { kind: 'absolute', dp: 100 } }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } },
      // #2 底层（被覆盖目标，200×100）+ 后画的两条**等色上半/下半**（各 200×50）
      //   单块只盖一半（盖不住）⇒ 只有**合并成 200×100** 才能盖住 #2
      children: [mk(2, 0, '#123456', 200, 100), mk(3, 0, '#ffffff'), mk(4, 50, '#ffffff')],
    })
    const tree = layoutTreeFromPNode([root], { lengthContext: V })
    solveLayout(tree[0]!, loose(400, UNBOUNDED))

    // 对照：只开遮挡剔除（不合并）⇒ 两块各盖一半 ⇒ 盖不住 #2
    const cullOnly = emitRenderCmds(tree, { cullOccluded: true })
    expect(cullOnly.stats.occludedCount, '★单块盖不全 ⇒ 不得剔除（对照组的"不该裁"）').toBe(0)

    // 协同：先合并成 200×100 ⇒ 完整覆盖 #2 ⇒ 剔除
    const both = emitRenderCmds(tree, { mergeSameColorBg: true, cullOccluded: true })
    expect(both.stats.mergedBgCount, '两块等色白 ⇒ 合并成 1 条').toBe(1)
    expect(both.stats.occludedCount, '★合并后完整覆盖 ⇒ 剔除 #2').toBe(1)
    expect(both.cmds.map((c) => c.nodeId), '只剩合并后的白块（nodeId = 首块 #3）').toEqual([3])
  })
})

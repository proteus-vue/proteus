// tests/layout-core-dirty.test.ts
// ★★M1-3 回归锁：脏区标记 + 最小重排（度量缓存）。
//
// 锁什么：
//   ① 未变更子树**不下钻**（增量收益：measureReused > 0）
//   ② 变更后标记脏 → 祖先链重算，**结果与全量重排逐像素一致**（增量的正确性红线）
//   ③ 约束签名变化（父级改尺寸）→ 即使节点未标脏也必须重算（缓存失效的第二来源）
//   ④ 破坏性：故意不标脏 → 结果陈旧（证明缓存确实在生效，而不是碰巧全量重算）
//   ⑤ 求解后树回归干净（否则下次增量会错误跳过）
import { describe, it, expect } from 'vitest'
import {
  solveLayout,
  rectOf,
  tight,
  loose,
  UNBOUNDED,
  createMeasureCache,
  attachParents,
  markDirty,
  isClean,
  resetMeasureCache,
  type LayoutNode,
} from '../packages/layout-core/src/index'

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

/** 三个文本叶子的列表（可计数的度量调用） */
function buildList(spec: Array<{ w: number; h: number }>): { root: LayoutNode; leaves: LayoutNode[]; calls: { n: number } } {
  const calls = { n: 0 }
  const leaves = spec.map((s, i) =>
    mk({
      id: 100 + i,
      width: undefined,
      height: undefined,
      measureText: () => {
        calls.n++
        return { width: s.w, height: s.h }
      },
    }),
  )
  const root = mk({ id: 1, width: 400, children: leaves })
  attachParents(root)
  return { root, leaves, calls }
}

describe('★★M1-3 · 度量缓存与增量重排', () => {
  it('首次求解全量测量；二次求解（无变更）全部命中缓存且不下钻', () => {
    const { root, calls } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()

    const r1 = solveLayout(root, tight(400, 200), { cache })
    expect(calls.n, '首帧：3 个叶子各测一次').toBe(3)
    expect(r1.stats.measureCalls).toBe(4) // 根 + 3 叶
    expect(r1.stats.measureReused).toBe(0)

    calls.n = 0
    const r2 = solveLayout(root, tight(400, 200), { cache })
    expect(calls.n, '★二帧：文本度量一次都没调用（增量核心收益）').toBe(0)
    expect(r2.stats.measureCalls, '根节点约束签名未变 → 整棵树命中').toBe(1)
    expect(r2.stats.measureReused).toBe(1)
    // 结果必须与首帧一致
    expect([...r2.rects.entries()]).toEqual([...r1.rects.entries()])
  })

  it('单叶子变更：只重测该子树，其余复用；且结果与全量重排**逐像素一致**', () => {
    const { root, leaves } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()
    solveLayout(root, tight(400, 200), { cache })

    // 改第 2 个叶子的文本度量（模拟文本/字体变化——宽高都变）
    leaves[1]!.measureText = () => ({ width: 99, height: 24 })
    markDirty(leaves[1]!)

    const inc = solveLayout(root, tight(400, 200), { cache })
    expect(inc.stats.measureReused, '★2 个未变叶命中缓存').toBe(2)
    expect(inc.stats.relayoutCount, '脏节点：叶2 + 根（向上传播）').toBe(2)

    // 对拍：同一状态的**全量**求解（无缓存，叶片度量与增量侧完全一致）
    const fresh = buildList([{ w: 40, h: 16 }, { w: 99, h: 24 }, { w: 80, h: 16 }]).root
    const full = solveLayout(fresh, tight(400, 200))
    for (const id of [1, 100, 101, 102]) {
      expect(rectOf(inc, id), `节点 #${id} 增量结果须与全量一致`).toEqual(rectOf(full, id))
    }
  })

  it('约束签名变化 → 未标脏也得到**正确的新结果**（尺寸约束是缓存的第二失效来源）', () => {
    const { root, calls } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()

    const r1 = solveLayout(root, tight(400, 200), { cache })
    expect(rectOf(r1, 1).height).toBe(200)

    calls.n = 0
    const r2 = solveLayout(root, tight(400, 300), { cache }) // 高度变了 → 根签名变
    expect(rectOf(r2, 1).height, '★新约束必须生效（不得返回陈旧尺寸）').toBe(300)
    // ★平台文本度量按 (节点, 最大宽) 记忆化（Profile §5.3）：宽度约束没变 →
    //   即便父高变了，文本 shaping 也复用上次结果（这正是「度量可缓存」的收益）
    expect(calls.n, '宽度约束未变 → 文本 shaping 复用').toBe(0)

    // 宽度约束变了 → 必须真正重新度量
    calls.n = 0
    const r3 = solveLayout(root, tight(250, 300), { cache })
    expect(calls.n, '★宽度约束变化 → 必须重新向平台要度量').toBe(3)
    expect(rectOf(r3, 1).width).toBe(250)
  })

  it('破坏性：故意不标脏 → 缓存返回陈旧结果（证明缓存确实生效，非碰巧全量）', () => {
    const { root, leaves } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()
    solveLayout(root, tight(400, 200), { cache })

    // 改宽度但**故意不标脏** —— 契约违反，缓存应返回陈旧值
    leaves[0]!.measureText = () => ({ width: 999, height: 16 })
    const stale = solveLayout(root, tight(400, 200), { cache })
    expect(rectOf(stale, 100).width, '未标脏 → 陈旧（这正是契约要求调用方 markDirty 的原因）').toBe(40)

    // 标脏后立即正确
    markDirty(leaves[0]!)
    const ok = solveLayout(root, tight(400, 200), { cache })
    expect(rectOf(ok, 100).width).toBe(999)
  })

  it('markDirty 只向上传播（后代不受影响——增量收益的来源）', () => {
    const { root, leaves } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()
    solveLayout(root, tight(400, 200), { cache })

    markDirty(leaves[0]!)
    expect(root.dirty, '祖先应被标记').toBe(true)
    expect(leaves[1]!.dirty, '★兄弟不被标记').toBeFalsy()
    expect(leaves[2]!.dirty, '★兄弟不被标记').toBeFalsy()
  })

  it('求解后整棵树回归干净（否则下次增量会错误跳过）', () => {
    const { root, leaves } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()
    solveLayout(root, tight(400, 200), { cache })
    expect(isClean(root), '首帧后应全干净').toBe(true)

    markDirty(leaves[2]!)
    expect(isClean(root)).toBe(false)
    solveLayout(root, tight(400, 200), { cache })
    expect(isClean(root), '二帧后应再次全干净').toBe(true)
  })

  it('规模化：4050 节点单点变更 → 复用率 > 99%（增量重排的实际效果）', () => {
    const calls = { n: 0 }
    let id = 1
    const leaves: LayoutNode[] = []
    const groups: LayoutNode[] = []
    for (let i = 0; i < 500; i++) {
      const rows: LayoutNode[] = []
      for (let j = 0; j < 4; j++) {
        const rowLeaves: LayoutNode[] = []
        for (let k = 0; k < 4; k++) {
          const leaf = mk({
            id: ++id,
            width: 40,
            height: 16,
            measureText: () => {
              calls.n++
              return { width: 40, height: 16 }
            },
          })
          leaves.push(leaf)
          rowLeaves.push(leaf)
        }
        rows.push(mk({ id: ++id, flexDirection: 'row', gap: 4, children: rowLeaves }))
      }
      groups.push(mk({ id: ++id, gap: 2, children: rows }))
    }
    const root = mk({ id: 1, width: 750, children: groups })
    attachParents(root)

    const cache = createMeasureCache()
    solveLayout(root, loose(750, UNBOUNDED), { cache })

    // 改一个叶子的度量 → 只重算该叶 + 祖先链（1 叶 + 1 行 + 1 组 + 根 = 4）
    calls.n = 0
    leaves[2000]!.measureText = () => {
      calls.n++
      return { width: 88, height: 16 }
    }
    markDirty(leaves[2000]!)
    const inc = solveLayout(root, loose(750, UNBOUNDED), { cache })

    expect(calls.n, '★只有被改的叶子需要重新度量').toBe(1)
    // ★读数语义（本仓实测校正）：`measureReused` 计的是**命中次数**——命中一个子树根即**整棵子树不下钻**，
    //   故 500 次命中覆盖 8000 个叶子。真正的效率读数应与 `nodeCount` 对比的是 `measureCalls`（被访问的节点数）。
    expect(inc.stats.measureReused, '★500 个未变分组命中（各自跳过整棵子树）').toBeGreaterThanOrEqual(500)
    expect(inc.stats.measureCalls, `★实际访问节点 ${inc.stats.measureCalls} / 全树 ${inc.stats.nodeCount}`).toBeLessThan(inc.stats.nodeCount / 10)
    expect(inc.stats.relayoutCount, '重排范围 = 叶 + 祖先链').toBeLessThanOrEqual(8)
  })

  it('resetMeasureCache：全局失效（字体切换等场景）后回到全量测量', () => {
    const { root, calls } = buildList([{ w: 40, h: 16 }, { w: 60, h: 16 }, { w: 80, h: 16 }])
    const cache = createMeasureCache()
    solveLayout(root, tight(400, 200), { cache })
    resetMeasureCache(cache)
    calls.n = 0
    solveLayout(root, tight(400, 200), { cache })
    expect(calls.n, '失效后必须重测').toBe(3)
  })
})

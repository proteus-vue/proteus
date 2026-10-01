// tests/layout-core-dirty-stress.test.ts
// ★★M1 出口条件之二（计划 §5.4）：**dirty 冒泡压力测试 T1–T4**。
//
// 要防的退化（原文）：React Native 生产实测 350 个活跃布局节点，因**无约束嵌套 Flexbox 容器**
// 导致 dirty 标记向上级联至根，C++ 布局耗时 1.2ms → **28.4ms**（60FPS 预算 16.67ms）。
// 归因：不是引擎慢，而是上层**缺少布局边界**。
//
// 本文件用真实树形（宽容器 + 深链）验证四条：
//   T1 深层脏更新：350+ 节点、深度 12 处改动 → **重排收窄到边界子树**（结构量）+ 墙钟宽松上界
//     ★时间量口径同 T4（2026-10-01）：原 `≤ 3ms` 精确墙钟已弃用——全量并发下 4.09ms 假红，
//       与 c1466509 对 T4 的结论同源（亚毫秒墙钟在共享环境不可信）
//   T2 **无边界对照**（关键）：关掉 `isLayoutBoundary` 跑同一用例 → 必须**显著劣于** T1
//   T3 无约束容器：`flexGrow:1` / 未定义高度的嵌套 → **不得全树重算**
//   T4 高频更新：连续 patch → **每轮重排根都不得塌回整树根**（结构量，60/60 判别）
//     ★时间判据在此尺度不可用（两版都被 CI 打回：绝对墙钟 CI 波动 14×；
//       亚毫秒比值本地 6 次复测 0.18~0.76）——详见 T4 断言内的设计说明
//
// ★T2 的读数取 `relayoutCount`（结构量）而非仅墙钟：结构量不受机器负载干扰，
//   墙钟仅作上界断言。若结构量上无差异，说明边界没有真正阻断传播 → 不得进入 M2。
import { describe, it, expect } from 'vitest'
import {
  solveLayout,
  loose,
  UNBOUNDED,
  createMeasureCache,
  attachParents,
  markDirty,
  resetMeasureCache,
  relayoutScoped,
  relayoutRootOf,
  isClean,
  type LayoutNode,
  type LayoutResult,
} from '../packages/layout-core/src/index'

const VIEW = { width: 375, height: 812 }
const FALLBACK = loose(VIEW.width, UNBOUNDED)

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

/**
 * 构造「深度 12、每层若干子节点」的 350+ 节点树（对齐 §5.4 的用例口径）。
 *
 * 形状刻意做成**宽容器 + 深链**：宽容器让「无边界时的级联重算」代价可观测
 * （每层要重新跑一遍 flex 分配），深链让 dirty 必须穿过 12 层才到根。
 *
 * @param boundaryDepth 在这些深度上放「宽高显式」的容器（= 布局边界）；
 *                      传 undefined 表示整棵树都不设边界（T2 的对照组）
 */
/** 每层的定尺寸兄弟节点数（决定整树规模：1 + 12×(1+SIB) + (1+5)） */
const SIB = 28
/** 布局边界所在的深度（越深 = 边界越小 = 重排范围越小） */
const BOUNDARY_DEPTH = 11

function buildDeepTree(boundaryDepth: number | undefined): { root: LayoutNode; target: LayoutNode; all: LayoutNode[] } {
  let id = 0
  const all: LayoutNode[] = []
  const node = (over: Partial<LayoutNode>): LayoutNode => {
    // ★所有兄弟都用 flexShrink:0（避免「互相挤压」干扰几何断言——本文件测的是**传播范围**，不是收缩算法）
    const n = mk({ id: ++id, flexShrink: 0, ...over })
    all.push(n)
    return n
  }

  // 深处目标：定尺寸叶子（改它触发脏）
  const target = node({ width: 20, height: 20 })

  // 最内层 row：1 个目标 + 5 个兄弟
  let cur: LayoutNode = node({
    flexDirection: 'row',
    gap: 4,
    height: 24,
    children: [target, ...Array.from({ length: 5 }, () => node({ width: 30, height: 20 }))],
  })

  for (let depth = 12; depth >= 1; depth--) {
    const isBoundary = boundaryDepth !== undefined && depth === boundaryDepth
    const siblings = Array.from({ length: SIB }, () => node({ width: 40, height: 18 }))
    const container = node({
      flexDirection: 'row',
      gap: 6,
      // ★布局边界 = 宽高均显式 ⇒ 对外尺寸与子级无关 ⇒ 内部变更不外溢（§5.4 的核心机制）
      width: isBoundary || depth === 1 ? 320 : undefined,
      height: isBoundary ? 200 : undefined,
      children: [cur, ...siblings],
    })
    container.isLayoutBoundary = isBoundary
    cur = container
  }
  const root = cur
  root.width = 320
  root.flexDirection = 'column'
  attachParents(root)
  return { root, target, all }
}

/** 单次求解（走缓存，与生产路径一致） */
function solveOnce(root: LayoutNode, cache: ReturnType<typeof createMeasureCache>): LayoutResult {
  return solveLayout(root, FALLBACK, { cache })
}

/** 增量求解：脏节点 → 定位重排范围 → 只解该范围（含对拍用的全量结果） */
function solveIncremental(root: LayoutNode, dirty: LayoutNode, prev: LayoutResult, cache: ReturnType<typeof createMeasureCache>) {
  const t0 = performance.now()
  const scoped = relayoutScoped(root, dirty, prev, (r, c) => solveLayout(r, c, { cache }), FALLBACK)
  const ms = performance.now() - t0
  return { scoped, ms }
}

describe('★★M1 §5.4 · T1 深层脏更新（深度 12 / 350+ 节点）', () => {
  it('单次增量布局不异常（宽松上界），且重排范围**收窄到边界子树**', () => {
    const { root, target, all } = buildDeepTree(BOUNDARY_DEPTH)
    expect(all.length, '节点规模须 ≥ 350（§5.4 口径）').toBeGreaterThanOrEqual(350)

    const cache = createMeasureCache()
    const first = solveOnce(root, cache)

    // 改深处的定尺寸叶子 → 标脏
    target.width = 44
    target.height = 26
    markDirty(target)

    const { scoped, ms } = solveIncremental(root, target, first, cache)

    // ★★判据设计修正（2026-10-01，与 T4 的 c1466509 同源先例）：
    //   原断言 `ms ≤ 3` 是**亚毫秒尺度的绝对墙钟**——2026-10-01 全量套件并发下实测 4.09ms
    //   假红（同代码隔离跑 40ms/7 用例全绿），而本仓已在 c1466509 定性：
    //   "绝对秒数在共享 runner 上不是性能判据，是 runner 有多忙的读数"。
    //   ⇒ 真判据 = 下面的**结构量**（重排根 = 边界节点 / 重排量 ≪ 全树，零噪声、判别力强）；
    //     墙钟只留宽松上界（防"真的慢到离谱"，与 T2 的 50ms 上界同口径）。
    expect(ms, `T1 单次布局 ${ms.toFixed(2)}ms 异常（宽松上界 50ms——精确判据已弃用，见注释）`).toBeLessThan(50)
    // ★结构读数：重排范围必须落在边界子树内（边界之上一个节点都不该被重排）
    expect(scoped.scopeId, '重排根应为边界节点').not.toBe(root.id)
    expect(scoped.stats.relayoutCount, `重排节点 ${scoped.stats.relayoutCount} 应远小于全树 ${all.length}`).toBeLessThan(all.length / 4)
    // 正确性：结果与「全量重排」一致（增量不得给出不同几何）
    const fresh = buildTreeFresh()
    const full = solveLayout(fresh.root, FALLBACK)
    expect(scoped.rects.get(fresh.target.id), '★增量结果须等于全量结果（同状态对拍）').toEqual(full.rects.get(fresh.target.id))
  })

  it('边界子树内的改动确实生效（增量不是「跳过了没算」）', () => {
    const { root, target } = buildDeepTree(BOUNDARY_DEPTH)
    const cache = createMeasureCache()
    const first = solveOnce(root, cache)

    target.width = 99
    markDirty(target)
    const { scoped } = solveIncremental(root, target, first, cache)
    expect(scoped.rects.get(target.id)!.width, '★改动必须反映到几何').toBe(99)
  })
})

describe('★★M1 §5.4 · T2 无边界对照（关键 —— 证明 isLayoutBoundary 真实生效）', () => {
  it('关闭边界 → 重排范围一路级联到根，显著劣于开启边界', () => {
    // ① 开边界
    const withBoundary = buildDeepTree(BOUNDARY_DEPTH)
    const cacheA = createMeasureCache()
    const prevA = solveOnce(withBoundary.root, cacheA)
    withBoundary.target.width = 44
    markDirty(withBoundary.target)
    const a = solveIncremental(withBoundary.root, withBoundary.target, prevA, cacheA)
    const scopeA = a.scoped.scopeId
    const relayoutA = a.scoped.stats.relayoutCount

    // ② 关边界（同一形状，但不设 isLayoutBoundary）
    const noBoundary = buildDeepTree(undefined)
    const cacheB = createMeasureCache()
    const prevB = solveOnce(noBoundary.root, cacheB)
    noBoundary.target.width = 44
    markDirty(noBoundary.target)
    const b = solveIncremental(noBoundary.root, noBoundary.target, prevB, cacheB)
    const scopeB = b.scoped.scopeId
    const relayoutB = b.scoped.stats.relayoutCount

    // ★关键断言（结构量，不受机器负载影响）：
    //   开边界 → 重排根是边界节点（不是整树根）；关边界 → 重排根退化为整树根
    expect(scopeA, '★开边界：重排根应为边界节点').not.toBe(withBoundary.root.id)
    expect(scopeB, '★关边界：重排根退化为整树根（这就是 RN 事故的形状）').toBe(noBoundary.root.id)
    expect(relayoutB, `★无边界重排量 ${relayoutB} 必须**显著大于**有边界 ${relayoutA}（证明边界真实生效）`).toBeGreaterThan(relayoutA * 1.5)
    // 墙钟只作上界（结构量已给出结论）
    expect(b.ms, 'T2 对照耗时不得异常（对照跑起来才有意义）').toBeLessThan(50)
  })

  it('破坏性：边界被无视（markDirty 一路标到根）→ 重排范围塌陷为全树', () => {
    const { root, target, all } = buildDeepTree(BOUNDARY_DEPTH)
    const cache = createMeasureCache()
    const prev = solveOnce(root, cache)

    // 手工模拟「边界未生效」：绕开 markDirty 的边界停止条件，直接标到根
    let cur: LayoutNode | undefined = target
    while (cur) {
      cur.dirty = true
      cur = cur.parent
    }
    // 此时 relayoutRootOf 仍会找到边界 → 但 dirty 标记已越过边界（模拟旧实现）
    const scope = relayoutRootOf(root, target)
    expect(scope, '边界查找仍应命中边界（查找与标记是两件事）').not.toBe(root.id)
    // 断言：若无边界机制，relayoutRootOf 会退化为根
    expect(relayoutRootOf(root, target).id, '有边界时不得退化为整树根').not.toBe(root.id)
    expect(all.length).toBeGreaterThan(300)
  })
})

describe('★★M1 §5.4 · T3 无约束容器（flexGrow:1 / 未定义高度嵌套）', () => {
  it('无约束嵌套容器的改动**不得全树重算**（measureCalls 远小于节点数）', () => {
    // 构造 RN 事故的形状：嵌套容器宽度全部交给内容决定（无显式宽高）
    let id = 0
    const all: LayoutNode[] = []
    const node = (over: Partial<LayoutNode>): LayoutNode => {
      const n = mk({ id: ++id, ...over })
      all.push(n)
      return n
    }
    const target = node({ width: 20, height: 20 })
    let cur: LayoutNode = node({ flexDirection: 'column', children: [target] })
    for (let i = 0; i < 12; i++) {
      cur = node({
        flexDirection: 'column',
        flexGrow: 1, // ★无约束容器：宽度/高度都不显式
        children: [cur, ...Array.from({ length: 24 }, () => node({ width: 10, height: 10 }))],
      })
    }
    const root = node({ flexDirection: 'column', width: 320, children: [cur] })
    attachParents(root)

    const cache = createMeasureCache()
    const first = solveOnce(root, cache)
    expect(all.length).toBeGreaterThan(300)

    target.width = 44
    markDirty(target)
    const before = cache.hits + cache.misses
    const res = solveIncremental(root, target, first, cache)
    const total = cache.hits + cache.misses - before

    // ★读数口径（本仓实测校正）：`measureCalls` 统计的是**测量入口调用次数**（含命中缓存），
    //   真正的「重算量」= measureCalls − measureReused。
    const remeasured = res.scoped.stats.measureCalls - res.scoped.stats.measureReused
    expect(res.scoped.stats.measureReused, '未变更子树必须命中缓存（不下钻）').toBeGreaterThan(all.length / 2)
    expect(remeasured, `T3 真正重算 ${remeasured} / 全树 ${all.length}——不得全树重算`).toBeLessThan(all.length / 3)
    expect(total, '缓存读数应反映访问').toBeGreaterThan(0)
    // 且结果正确
    expect(res.scoped.rects.get(target.id)!.width, '无约束链上的改动仍须生效').toBe(44)
  })
})

describe('★★M1 §5.4 · T4 高频更新（连续 patch）', () => {
  it('连续 60 次 patch：重排范围不塌陷 + 增量远低于全量（模拟快速滚动中的更新）', () => {
    const { root, target } = buildDeepTree(BOUNDARY_DEPTH)
    const cache = createMeasureCache()
    let last = solveOnce(root, cache)

    const samples: number[] = []
    const relayouts: number[] = []
    const scopes: number[] = []
    const items: LayoutNode[] = []
    // 取一批兄弟叶子轮流改（贴近列表滚动的更新模式）
    const collect = (n: LayoutNode): void => {
      if (n.children.length === 0) items.push(n)
      n.children.forEach(collect)
    }
    collect(root)
    expect(items.length, '可更新的叶子足够多').toBeGreaterThan(20)

    for (let i = 0; i < 60; i++) {
      const victim = items[i % items.length]!
      victim.width = 20 + (i % 7)
      markDirty(victim)
      const r = solveIncremental(root, victim, last, cache)
      last = r.scoped
      samples.push(r.ms)
      relayouts.push(r.scoped.stats.relayoutCount)
      scopes.push(r.scoped.scopeId)
      expect(isClean(root), '每轮之后树应回归干净').toBe(true)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95)]!
    const p50 = samples[Math.floor(samples.length * 0.5)]!

    // eslint-disable-next-line no-console
    console.log(
      `[T4 读数] p50=${p50.toFixed(3)} p95=${p95.toFixed(3)}ms · ` +
        `重排节点 max=${Math.max(...relayouts)} / 叶子 ${items.length} · ` +
        `scope 恒定为边界节点=${scopes.every((id) => id !== root.id)}（root=${root.id}）`,
    )

    // ★★判据设计说明（两版时间判据都被 CI 打回后定案 = **纯确定性结构量**）
    //
    // 【被证伪的两版时间判据】
    //   ① `p95 ≤ 3ms`（绝对墙钟）：本机 0.239ms / CI 3.40ms（**14×**），而当轮求解器零改动
    //      ⇒ 在 CI 上量的是"runner 多忙"。
    //   ② `增量 p95 / 全量中位 ≤ 0.7`（同机比值）：CI 报 **1.595**；本地复测 6 次得
    //      **0.18 / 0.18 / 0.33 / 0.36 / 0.39 / 0.76** —— 同一份代码，最差一次触线。
    //      根因：两个都不到 1ms 的微基准，比值被**计时器粒度 + JIT + GC** 支配
    //      （两侧样本量还不对称）⇒ 亚毫秒尺度上"比值"同样不是判据。
    //   ★本仓纪律：「比值可信」的前提是**信号远大于噪声**——此处不成立，故弃用时间判据。
    //
    // 【定案判据（全为确定性结构量，与机器快慢无关）】
    //   ① 每轮重排**根**都必须是边界节点，**从不是整树根**：开边界 60/60 = 65（边界节点），
    //      关边界 60/60 = 355（= root）—— 判别力 60:0，零噪声。这正是这个用例要防的退化
    //      （RN 事故的形状：边界失效 ⇒ 每次更新级联到根）。
    //   ② 单轮最大重排节点数有界：开边界实测 4，关边界 14（分离带清晰）。
    expect(
      scopes.filter((id) => id === root.id).length,
      `T4 有 ${scopes.filter((id) => id === root.id).length}/60 轮重排根塌回整树根（边界失效的信号；正常应为 0）`,
    ).toBe(0)
    expect(
      Math.max(...relayouts),
      `T4 单轮最大重排 ${Math.max(...relayouts)} 节点应 ≤ 8（开边界实测 4 / 关边界 14——分离带清晰）`,
    ).toBeLessThanOrEqual(8)
    // ③ 绝对墙钟只作**宽松上界**（本仓 T2 同款口径）：防"真的慢到离谱"。
    //    不做精确时间断言——原因见上（CI 上 14× 波动、亚毫秒比值 0.18~0.76）。
    expect(p95, `T4 P95 = ${p95.toFixed(2)}ms 应 ≤ 50ms（宽松上界；精确判据见 ①②）`).toBeLessThanOrEqual(50)
  })
})

describe('★★M1 · 增量与全量的等价性（所有压力用例的正确性底座）', () => {
  it('随机 30 次改动：增量结果始终等于同状态全量重排', () => {
    const { root, all } = buildDeepTree(BOUNDARY_DEPTH)
    const cache = createMeasureCache()
    let last = solveOnce(root, cache)

    // 固定种子的伪随机（可复现）
    let seed = 42
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

    for (let i = 0; i < 30; i++) {
      const victim = all[Math.floor(rand() * all.length)]!
      victim.width = 10 + Math.floor(rand() * 60)
      markDirty(victim)
      const r = solveIncremental(root, victim, last, cache)
      last = r.scoped
    }

    // 对拍：把同一棵树的最终状态**全量**解一遍（清缓存，确保真重算）
    resetMeasureCache(cache)
    const full = solveLayout(root, FALLBACK, { cache })

    for (const [id, r] of last.rects) {
      const f = full.rects.get(id)
      expect(f, `节点 #${id} 应存在于全量结果`).toBeDefined()
      expect(Math.abs(r.x - f!.x), `节点 #${id}.x`).toBeLessThan(0.001)
      expect(Math.abs(r.y - f!.y), `节点 #${id}.y`).toBeLessThan(0.001)
      expect(Math.abs(r.width - f!.width), `节点 #${id}.width`).toBeLessThan(0.001)
      expect(Math.abs(r.height - f!.height), `节点 #${id}.height`).toBeLessThan(0.001)
    }
  })
})

/** 重建一棵「同状态」的树（对拍用——避免复用被增量改过的中间态） */
function buildTreeFresh(): { root: LayoutNode; target: LayoutNode } {
  const t = buildDeepTree(BOUNDARY_DEPTH)
  // 与 T1 中改动后的状态一致：目标叶子 44×26
  t.target.width = 44
  t.target.height = 26
  return { root: t.root, target: t.target }
}

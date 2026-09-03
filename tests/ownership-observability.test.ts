// tests/ownership-observability.test.ts
// ★G-43 B4（proteus-ownership-plan batches B4）：DevTools 所有权图数据层（权威 TS 版）
//   验收 V-01~V-07（devtools-ownership-graph.md §6）：
//   V-01 图节点数 = 实际资源数（计数器一致）· V-02 泄漏路径定位到源码行 · V-03 长期借用被检测
//   V-04 跨页面强引用被检测 · V-05 无主资源被检测 · V-06 时间线 alloc/drop 配对 + 未配对高亮
//   V-07 生产期采样（计数器）开销 O(1) 不显著影响性能
import { describe, it, expect } from 'vitest'
import {
  OwnershipGraph,
  Owned,
  createOwnershipHistory,
  createOwnershipCounters,
  diagnoseOwnershipIssues,
  buildOwnershipTimeline,
  formatOwnershipDiagnosis,
} from '@proteus-vue/render-backend'

function makeGraph(): { graph: OwnershipGraph } {
  const graph = new OwnershipGraph()
  return { graph }
}

describe('G-43 B4 计数器（V-01/V-07）', () => {
  it('V-01 计数器与图 stats 一致（alloc/drop/transfer 全程）', () => {
    const { graph } = makeGraph()
    const counters = createOwnershipCounters(graph)
    const r1 = graph.register({ id: 'a', type: 'array-buffer', byteSize: 8 * 1024 * 1024, owner: 'PageA', sourceLocation: 'P.vue:1' })
    graph.register({ id: 'b', type: 'camera-handle', byteSize: 1024, owner: 'PageA' })
    expect(counters.alive).toBe(2)
    expect(counters.total).toBe(2)
    expect(counters.consistent()).toBe(true)

    graph.setState('a', 'dropped')
    expect(counters.alive).toBe(1)
    expect(counters.byType['array-buffer']).toEqual({ allocated: 1, alive: 0 })
    expect(counters.byType['camera-handle']).toEqual({ allocated: 1, alive: 1 })
    expect(counters.consistent()).toBe(true)
    void r1

    // moved（transferTo 语义：原节点终态 moved——计数器净减 1）
    graph.setState('b', 'moved')
    expect(counters.alive).toBe(0)
    expect(counters.consistent()).toBe(true)
  })

  it('V-01 挂载于已有节点的图（先快照再订阅——计数器不丢存量）', () => {
    const graph = new OwnershipGraph()
    graph.register({ id: 'early', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })
    const counters = createOwnershipCounters(graph) // 图已存在后挂载
    expect(counters.alive).toBe(1)
    expect(counters.total).toBe(1)
    expect(counters.consistent()).toBe(true)

    graph.register({ id: 'late', type: 'array-buffer', byteSize: 2048, owner: 'PageA' })
    expect(counters.alive).toBe(2)
    expect(counters.consistent()).toBe(true)
  })

  it('V-07 万级 alloc/drop 计数器开销可控（O(1) 每资源）+ 关闭完整历史不影响计数', () => {
    const { graph } = makeGraph()
    const history = createOwnershipHistory(graph, { enabled: false }) // 生产期：历史关、计数开
    const counters = createOwnershipCounters(graph)

    const N = 10000
    const t0 = Date.now()
    for (let i = 0; i < N; i++) {
      graph.register({ id: `r${i}`, type: 'array-buffer', byteSize: 64, owner: 'PageA' })
      graph.setState(`r${i}`, 'dropped')
    }
    const elapsed = Date.now() - t0
    expect(history.records).toHaveLength(0) // 历史关闭零记录
    expect(counters.total).toBe(N)
    expect(counters.alive).toBe(0)
    expect(counters.consistent()).toBe(true)
    expect(elapsed).toBeLessThan(2000) // 宽松烟测上界（实际应 <100ms）——抓病态回归
  })
})

describe('G-43 B4 历史时间线（V-06）', () => {
  it('alloc/drop/borrow/weak/moved 事件入历史；owns/moved-from 边不重复表达', () => {
    const { graph } = makeGraph()
    const history = createOwnershipHistory(graph)
    graph.register({ id: 'a', type: 'array-buffer', byteSize: 8 * 1024 * 1024, owner: 'PageA', sourceLocation: 'Gallery.vue:5' })
    graph.addEdge({ kind: 'borrows', from: 'GalleryView', to: 'a' })
    graph.addEdge({ kind: 'weak', from: 'cache', to: 'a' })
    graph.addEdge({ kind: 'strong', from: 'PageB', to: 'a' })
    graph.setState('a', 'dropped')

    const kinds = history.records.map((r) => r.kind)
    expect(kinds).toEqual(['alloc', 'borrow', 'weak', 'strong', 'drop'])
    const alloc = history.records[0]
    expect(alloc).toMatchObject({ kind: 'alloc', id: 'a', byteSize: 8 * 1024 * 1024, sourceLocation: 'Gallery.vue:5' })
    const drop = history.records[4]
    expect(drop).toMatchObject({ kind: 'drop', id: 'a', byteSize: 8 * 1024 * 1024 })
  })

  it('V-06 alloc/drop 配对（drop 带 matchedAlloc 可点到源码行）+ 未配对 alive alloc 高亮', () => {
    const { graph } = makeGraph()
    const history = createOwnershipHistory(graph, { limit: 100 })
    graph.register({ id: 'a', type: 'array-buffer', byteSize: 8 * 1024 * 1024, owner: 'PageA', sourceLocation: 'Leaky.vue:23' })
    graph.register({ id: 'b', type: 'array-buffer', byteSize: 1024, owner: 'PageA', sourceLocation: 'Ok.vue:1' })
    graph.setState('a', 'dropped')

    let tl = buildOwnershipTimeline(history, graph)
    expect(tl.events).toHaveLength(3) // alloc×2 + drop×1
    const drop = tl.events.find((e) => e.kind === 'drop')
    expect(drop?.matchedAlloc?.sourceLocation).toBe('Leaky.vue:23') // 升降可点到源码行
    expect(tl.unpairedAllocs.map((r) => r.id)).toEqual(['b']) // alive 未配对 = 可疑高亮

    // 页面销毁 force-drop 后未配对消失
    graph.setState('b', 'dropped')
    tl = buildOwnershipTimeline(history, graph)
    expect(tl.unpairedAllocs).toHaveLength(0)
  })

  it('环形缓冲裁剪（limit 超限丢最旧）+ clear + dispose 解绑', () => {
    const { graph } = makeGraph()
    const history = createOwnershipHistory(graph, { limit: 3 })
    for (let i = 0; i < 5; i++) graph.register({ id: `r${i}`, type: 'x', byteSize: 1, owner: 'PageA' })
    expect(history.records.map((r) => r.id)).toEqual(['r2', 'r3', 'r4'])

    history.clear()
    expect(history.records).toHaveLength(0)
    history.dispose()
    graph.register({ id: 'r5', type: 'x', byteSize: 1, owner: 'PageA' })
    expect(history.records).toHaveLength(0) // dispose 后不再记录
  })
})

describe('G-43 B4 四类检测（V-02~V-05）', () => {
  it('V-05 无主资源（owner=null 的存活节点）', () => {
    const { graph } = makeGraph()
    graph.register({ id: 'orphan-1', type: 'array-buffer', byteSize: 1024 }) // 无 owner（框架 bug 形态）
    graph.register({ id: 'ok-1', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })

    const d = diagnoseOwnershipIssues(graph)
    expect(d.orphans.map((o) => o.id)).toEqual(['orphan-1'])
  })

  it('V-02 泄漏路径定位（页面已销毁仍存活 + 引用链 + 源码行）', () => {
    const { graph } = makeGraph()
    const owned = new Owned({
      id: 'buf-a',
      resourceType: 'video-stream',
      byteSize: 3 * 1024 * 1024,
      owner: 'PageA',
      value: new ArrayBuffer(1),
      graph,
      sourceLocation: 'Player.vue:12',
    })
    // 模拟 PageB 的定时器闭包仍持有 PageA 资源（引用链经 backTrace 可见）
    graph.addEdge({ kind: 'borrows', from: 'PageB.timer', to: 'buf-a' })

    const d = diagnoseOwnershipIssues(graph, { destroyedScopes: ['PageA'] })
    expect(d.leaks).toHaveLength(1)
    expect(d.leaks[0]).toMatchObject({ resourceId: 'buf-a', type: 'video-stream', sourceLocation: 'Player.vue:12' })
    expect(d.leaks[0].referenceChain.some((hop) => hop.includes('PageB.timer --borrows--> buf-a'))).toBe(true)
    void owned
  })

  it('V-03 长期借用被检测（借用持续时间 > 阈值；短借用不报）', () => {
    const { graph } = makeGraph()
    const now = Date.now()
    graph.register({ id: 'long-1', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })
    graph.addEdge({ kind: 'borrows', from: 'ComponentX', to: 'long-1', since: now - 5000 }) // 5s 前借用
    graph.register({ id: 'short-1', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })
    graph.addEdge({ kind: 'borrows', from: 'ComponentY', to: 'short-1', since: now - 100 }) // 100ms 前借用

    const d = diagnoseOwnershipIssues(graph, { longBorrowMs: 1000, now: () => now })
    expect(d.longBorrows).toHaveLength(1)
    expect(d.longBorrows[0]).toMatchObject({ resourceId: 'long-1', borrowedBy: 'ComponentX' })
    expect(d.longBorrows[0].sinceMs).toBe(now - 5000)
  })

  it('V-04 跨页面强引用被检测（strong edge 引用方 ≠ 资源 owner；同 owner 与 dropped 不报）', () => {
    const { graph } = makeGraph()
    graph.register({ id: 'res-a', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })
    graph.addEdge({ kind: 'strong', from: 'PageB', to: 'res-a' }) // B 页强持有 A 资源 → 告警
    graph.register({ id: 'res-self', type: 'array-buffer', byteSize: 1024, owner: 'PageB' })
    graph.addEdge({ kind: 'strong', from: 'PageB', to: 'res-self' }) // 同 owner 自持有 → 不告警
    graph.register({ id: 'res-dropped', type: 'array-buffer', byteSize: 1024, owner: 'PageA' })
    graph.addEdge({ kind: 'strong', from: 'PageB', to: 'res-dropped' })
    graph.setState('res-dropped', 'dropped') // 已释放 → 不告警

    const d = diagnoseOwnershipIssues(graph)
    expect(d.crossPageRefs).toHaveLength(1)
    expect(d.crossPageRefs[0]).toMatchObject({ resourceId: 'res-a', owner: 'PageA', heldBy: 'PageB' })
  })

  it('空诊断输出（无异常）+ format 报告可读', () => {
    const { graph } = makeGraph()
    const owned = new Owned({
      id: 'ok',
      resourceType: 'array-buffer',
      byteSize: 1024,
      owner: 'PageA',
      value: new ArrayBuffer(1),
      graph,
      sourceLocation: 'Ok.vue:1',
    })
    const d = diagnoseOwnershipIssues(graph)
    expect(d.orphans).toHaveLength(0)
    expect(d.leaks).toHaveLength(0)
    expect(d.longBorrows).toHaveLength(0)
    expect(d.crossPageRefs).toHaveLength(0)
    expect(formatOwnershipDiagnosis(d)).toContain('✅ 无异常')

    const leakGraph = new OwnershipGraph()
    leakGraph.register({ id: 'x', type: 'array-buffer', byteSize: 1024, sourceLocation: 'X.vue:2' })
    const leaky = diagnoseOwnershipIssues(leakGraph)
    expect(formatOwnershipDiagnosis(leaky)).toContain('🔴 无主资源')
    void owned
  })
})

// tests/ownership.test.ts
// ★G-43 B1（proteus-ownership-plan batches B1）：所有权核心类型 + Tracker（权威 TS 版）
//   验收：Owned Move 语义（G-43.2）/ Borrow 作用域（G-43.3）/ Drop 五阶段（G-43.6）/ 所有权图（G-43.5）/ Managed 代管（G-43.4）
import { describe, it, expect } from 'vitest'
import {
  OwnershipGraph,
  Owned,
  Borrow,
  Weak,
  Managed,
  ManagedRegistry,
  createQuotaTracker,
  OWNERSHIP_ERRORS,
} from '@proteus-vue/render-backend'

function makeOwned(overrides: { owner?: string } = {}): { graph: OwnershipGraph; owned: Owned<ArrayBuffer> } {
  const graph = new OwnershipGraph()
  const owned = new Owned<ArrayBuffer>({
    id: 'buf-1',
    resourceType: 'array-buffer',
    byteSize: 8 * 1024 * 1024,
    owner: overrides.owner ?? 'pageA',
    value: new ArrayBuffer(8 * 1024 * 1024),
    graph,
    transferable: true,
    sourceLocation: 'ProductCard.vue:47',
  })
  return { graph, owned }
}

describe('G-43 B1 Owned<T> Move 语义（G-43.2）', () => {
  it('read 正常；transferTo 后原实例 use-after-move 抛错', () => {
    const { owned, graph } = makeOwned()
    expect(owned.read()).toBeInstanceOf(ArrayBuffer)

    const target = owned.transferTo('pageB')
    expect(target.owner).toBe('pageB')
    expect(owned.state).toBe('moved')
    let code = ''
    try {
      owned.read()
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe('use_after_move') // 错误码（G-43.2 Move 后禁访问）
    expect(graph.stats().moved).toBe(1)
    expect(graph.edges.some((e) => e.kind === 'moved-from')).toBe(true)
  })

  it('transferTo 时存在活跃借用 → 拒绝（has_active_borrows）', () => {
    const { owned } = makeOwned()
    owned.borrow('componentX')
    let code = ''
    try {
      owned.transferTo('pageB')
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe('has_active_borrows')
  })

  it('double move 拒绝', () => {
    const { owned } = makeOwned()
    owned.transferTo('B')
    let code = ''
    try {
      owned.transferTo('C')
    } catch (e) {
      code = (e as { code: string }).code
    }
    expect(code).toBe('use_after_move') // moved 后再次 transfer → use_after_move（_assertAlive 拦截）
  })
})

describe('G-43 B1 Borrow<T> 作用域（G-43.3）', () => {
  it('borrow 可读；release 后失效；drop 后借用失效', () => {
    const { owned } = makeOwned()
    const b = owned.borrow('componentX')
    expect(b.valid).toBe(true)
    expect(b.get()).toBeInstanceOf(ArrayBuffer)

    b.release()
    expect(b.valid).toBe(false)
    expect(b.get()).toBeUndefined()
  })

  it('Owned.drop 强制失效活跃借用（invalidate）', () => {
    const { owned } = makeOwned()
    const b = owned.borrow('x')
    const result = owned.drop({ force: true })
    expect(result.ok).toBe(true)
    expect(result.invalidatedBorrows).toBe(1)
    expect(b.valid).toBe(false)
    expect(owned.state).toBe('dropped')
  })

  it('非 force drop 且存在活跃借用 → 拒绝（has_active_borrows）', () => {
    const { owned } = makeOwned()
    owned.borrow('x')
    const result = owned.drop()
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('has_active_borrows')
  })
})

describe('G-43 B1 Drop 五阶段协议（G-43.6 确定性释放）', () => {
  it('drop 返回 freedBytes + 状态转 dropped；重复 drop 拒绝（already_dropped）', () => {
    let released = 0
    const graph = new OwnershipGraph()
    const owned = new Owned<ArrayBuffer>({
      id: 'buf-2',
      resourceType: 'array-buffer',
      byteSize: 8 * 1024 * 1024,
      owner: 'pageA',
      value: new ArrayBuffer(8 * 1024 * 1024),
      graph,
      releaseHook: () => {
        released++
      },
    })
    expect(graph.stats().alive).toBe(1)

    const result = owned.drop()
    expect(result.ok).toBe(true)
    expect(result.freedBytes).toBe(8 * 1024 * 1024)
    expect(result.freedHandles).toBe(1)
    expect(released).toBe(1) // releaseHook 执行（③ release）
    expect(graph.stats().alive).toBe(0) // ④ unregister 移除

    const again = owned.drop()
    expect(again.ok).toBe(false)
    expect(again.error?.code).toBe('already_dropped')
  })
})

describe('G-43 B1 Weak<T> 打破循环 + Managed<T> 框架代管（G-43.4）', () => {
  it('weak 弱引用：持有者存活可 upgrade；drop 后 upgrade 返回 undefined', () => {
    const { owned } = makeOwned()
    const w = owned.weak()
    expect(w.alive).toBe(true)
    const upgraded = w.upgrade()
    expect(upgraded?.valid).toBe(true)

    owned.drop({ force: true })
    expect(w.alive).toBe(false)
    expect(w.upgrade()).toBeUndefined()
  })

  it('Managed 框架代管：registry 批量 disposeAll（页面销毁自动释放——业务零心智负担）', () => {
    const registry = new ManagedRegistry()
    const disposed: string[] = []
    const m1 = new Managed({ value: 'timer', owner: 'pageA', disposeFn: () => disposed.push('timer'), registry })
    const m2 = new Managed({ value: 'listener', owner: 'pageA', disposeFn: () => disposed.push('listener'), registry })
    expect(registry.size).toBe(2)
    expect(registry.disposeAll()).toBe(2)
    expect(disposed).toEqual(['timer', 'listener'])
    expect(m1.disposed).toBe(true)
    expect(m2.disposed).toBe(true)
    expect(registry.size).toBe(0)
  })
})

describe('G-43 B1 所有权图 + QuotaTracker（G-43.5 可观测 + CMP073 记账一致）', () => {
  it('所有权图：register/resourcesOf/findOrphans/detectLeaks/backTrace', () => {
    const graph = new OwnershipGraph()
    graph.register({ id: 'a', type: 'timer', byteSize: 1024, owner: 'pageA' })
    graph.register({ id: 'b', type: 'handle', byteSize: 8192, owner: 'pageA' })
    graph.register({ id: 'orphan', type: 'array-buffer', byteSize: 4096 }) // 无主
    graph.addEdge({ kind: 'borrows', from: 'componentX', to: 'a', since: Date.now() })

    expect(graph.resourcesOf('pageA').map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(graph.findOrphans().map((n) => n.id)).toEqual(['orphan']) // G-43.1 无主资源
    const leaks = graph.detectLeaks('pageA')
    expect(leaks.every((l) => l.referenceChain.length >= 0)).toBe(true)
    // backTrace：componentX --borrows--> a
    const chain = graph.backTrace('a')
    expect(chain.some((c) => c.includes('borrows'))).toBe(true)
  })

  it('QuotaTracker：request/release 记账（CMP073 与图一致）', () => {
    const tracker = createQuotaTracker()
    tracker.request('pageA', 8192)
    tracker.request('pageA', 4096)
    expect(tracker.usageOf('pageA')).toBe(12288)
    tracker.release('pageA', 8192)
    expect(tracker.usageOf('pageA')).toBe(4096)
  })

  it('OWNERSHIP_ERRORS 错误码语义（负向用例——校验器能抓违规）', () => {
    const moved = OWNERSHIP_ERRORS.useAfterMove('buf-1', 'pageB')
    expect(moved.code).toBe('use_after_move')
    expect(() => {
      throw moved
    }).toThrow(/已转移/)
  })
})
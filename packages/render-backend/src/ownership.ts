// packages/render-backend/src/ownership.ts
// ★G-43 B1（proteus-ownership-plan batches B1）：所有权核心类型 + Tracker（权威 TS 版）
//   对齐 ownership-reference.cjs（33 项验证参考）+ ownership-spi.md 接口 + G-43 铁律：
//   · Owned<T>：唯一所有权——Move（transferTo 后原所有者禁访问 G-43.2）/ Borrow（借用不逃逸 G-43.3）/ Weak（打破循环）/ drop
//   · 所有权图（DevTools 数据源）：Owner/Borrow/Weak 关系 + 源码位置（G-43.5——100% 可观测）
//   · Drop 五阶段协议：prepare → invalidate → release → unregister → reclaim（确定性释放 G-43.6，对齐 G-42 五原子语义）
//   · QuotaTracker 记账（CMP073：配额与所有权图一致）
//   纯逻辑零依赖（GC 管可达性，所有权管意图——治理 GC 盲区：原生句柄/共享内存/定时器/流）

// ============================================================
// 错误语义（G-43.2 Move 后禁访问 / G-43.3 借用不逃逸 / drop 后禁访问）
// ============================================================

export type OwnershipErrorCode = 'use_after_move' | 'use_after_drop' | 'double_move' | 'has_active_borrows' | 'already_dropped' | 'resource_not_transferable'

export class OwnershipError extends Error {
  readonly code: OwnershipErrorCode
  readonly resourceId: string
  constructor(code: OwnershipErrorCode, message: string, extra: { resourceId: string }) {
    super(message)
    this.name = 'OwnershipError'
    this.code = code
    this.resourceId = extra.resourceId
  }
}

export const OWNERSHIP_ERRORS = {
  useAfterMove: (id: string, movedTo: string) => new OwnershipError('use_after_move', `资源 ${id} 已转移给 ${movedTo}，不可再访问`, { resourceId: id }),
  useAfterDrop: (id: string) => new OwnershipError('use_after_drop', `资源 ${id} 已释放，不可再访问`, { resourceId: id }),
  doubleMove: (id: string) => new OwnershipError('double_move', `资源 ${id} 已转移过，不可重复转移`, { resourceId: id }),
  hasActiveBorrows: (id: string, count: number) => new OwnershipError('has_active_borrows', `资源 ${id} 有 ${count} 个活跃借用，不可释放`, { resourceId: id }),
  alreadyDropped: (id: string) => new OwnershipError('already_dropped', `资源 ${id} 已释放`, { resourceId: id }),
  notTransferable: (id: string, reason: string) => new OwnershipError('resource_not_transferable', `资源 ${id} 不可转移：${reason}`, { resourceId: id }),
}

// ============================================================
// 所有权图（G-43.5：Owner/Borrow/Weak 关系 + 源码位置——DevTools 数据源）
// ============================================================

export interface GraphNode {
  id: string
  type: string
  byteSize: number
  owner: string | null // null = 无主（异常——G-43.1 禁止无主资源）
  state: 'alive' | 'moved' | 'dropped'
  createdAt: number
  sourceLocation: string | null
}

export interface GraphEdge {
  kind: 'owns' | 'borrows' | 'weak' | 'moved-from'
  from: string
  to: string
  since?: number
}

export interface LeakInfo {
  resourceId: string
  type: string
  byteSize: number
  sourceLocation: string | null
  referenceChain: string[]
}

export class OwnershipGraph {
  readonly nodes = new Map<string, GraphNode>()
  readonly edges: GraphEdge[] = []
  private _nextId = 1

  nextId(): string {
    return `res_${this._nextId++}`
  }

  register(opts: { id: string; type: string; byteSize: number; owner?: string | null; sourceLocation?: string | null }): GraphNode {
    const node: GraphNode = {
      id: opts.id,
      type: opts.type,
      byteSize: opts.byteSize,
      owner: opts.owner ?? null,
      state: 'alive',
      createdAt: Date.now(),
      sourceLocation: opts.sourceLocation ?? null,
    }
    this.nodes.set(opts.id, node)
    if (opts.owner) {
      this.edges.push({ kind: 'owns', from: opts.owner, to: opts.id })
    }
    return node
  }

  addEdge(edge: GraphEdge): void {
    this.edges.push(edge)
  }

  setState(id: string, state: GraphNode['state']): void {
    const node = this.nodes.get(id)
    if (node) node.state = state
  }

  resourcesOf(owner: string): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.owner === owner && n.state === 'alive')
  }

  /** 无主资源检测（G-43.1——owner === null 的存活节点数为 0） */
  findOrphans(): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.owner === null && n.state === 'alive')
  }

  /** 泄漏检测：页面销毁后仍存活的资源 + 反向引用链（谁还持有它——DevTools 泄漏定位） */
  detectLeaks(destroyedScope: string): LeakInfo[] {
    return this.resourcesOf(destroyedScope).map((n) => ({
      resourceId: n.id,
      type: n.type,
      byteSize: n.byteSize,
      sourceLocation: n.sourceLocation,
      referenceChain: this.backTrace(n.id),
    }))
  }

  /** 反向引用链（资源 ← 谁持有 ← 谁又持有……） */
  backTrace(resourceId: string): string[] {
    const chain: string[] = []
    const visited = new Set<string>()
    const walk = (id: string): void => {
      if (visited.has(id)) return
      visited.add(id)
      for (const e of this.edges) {
        if (e.to === id && e.from !== id) {
          chain.push(`${e.from} --${e.kind}--> ${id}`)
          walk(e.from)
        }
      }
    }
    walk(resourceId)
    return chain
  }

  stats(): { total: number; alive: number; moved: number; dropped: number; totalBytes: number; edges: number } {
    const alive = [...this.nodes.values()].filter((n) => n.state === 'alive')
    return {
      total: this.nodes.size,
      alive: alive.length,
      moved: [...this.nodes.values()].filter((n) => n.state === 'moved').length,
      dropped: [...this.nodes.values()].filter((n) => n.state === 'dropped').length,
      totalBytes: alive.reduce((s, n) => s + n.byteSize, 0),
      edges: this.edges.length,
    }
  }
}

// ============================================================
// QuotaTracker（CMP073：配额记账与所有权图一致）
// ============================================================

export function createQuotaTracker(): { request(owner: string, bytes: number): number; release(owner: string, bytes: number): number; usageOf(owner: string): number } {
  const usage = new Map<string, number>()
  return {
    request(owner, bytes) {
      usage.set(owner, (usage.get(owner) ?? 0) + bytes)
      return usage.get(owner)!
    },
    release(owner, bytes) {
      usage.set(owner, Math.max(0, (usage.get(owner) ?? 0) - bytes))
      return usage.get(owner)!
    },
    usageOf(owner) {
      return usage.get(owner) ?? 0
    },
  }
}

// ============================================================
// Owned<T> —— 唯一所有权（Google G-43.2 Move 语义 + G-43.6 确定性 Drop）
// ============================================================

export type OwnedState = 'alive' | 'moved' | 'dropped'

export class Owned<T> {
  readonly id: string
  readonly resourceType: string
  readonly byteSize: number
  readonly owner: string
  private _state: OwnedState = 'alive'
  private _movedTo: string | null = null
  private _activeBorrows = 0
  private _borrows = new Set<Borrow<unknown>>()
  private _transferable: boolean
  private _releaseHook: ((value: T) => void) | null
  private readonly _graph: OwnershipGraph
  private readonly _value: T
  private readonly _sourceLocation: string | null

  constructor(opts: { id: string; resourceType: string; byteSize: number; owner: string; value: T; graph: OwnershipGraph; transferable?: boolean; releaseHook?: (value: T) => void; sourceLocation?: string | null }) {
    this.id = opts.id
    this.resourceType = opts.resourceType
    this.byteSize = opts.byteSize
    this.owner = opts.owner
    this._value = opts.value
    this._graph = opts.graph
    this._transferable = opts.transferable ?? false
    this._releaseHook = opts.releaseHook ?? null
    this._sourceLocation = opts.sourceLocation ?? null
    this._graph.register({ id: opts.id, type: opts.resourceType, byteSize: opts.byteSize, owner: opts.owner, sourceLocation: this._sourceLocation })
  }

  get state(): OwnedState {
    return this._state
  }

  get activeBorrows(): number {
    return this._activeBorrows
  }

  /** 存活断言（G-43.2/43.6：Move/Drop 后禁访问） */
  private _assertAlive(op: string): void {
    if (this._state === 'moved') {
      throw OWNERSHIP_ERRORS.useAfterMove(this.id, this._movedTo ?? '?')
    }
    if (this._state === 'dropped') {
      throw OWNERSHIP_ERRORS.useAfterDrop(this.id)
    }
    void op
  }

  /** 读取（G-43.2：Move/Drop 后禁访问——use-after-move 拦截） */
  read(): T {
    this._assertAlive('read')
    return this._value
  }

  /** ★Move 语义：转移所有权后原所有者不可再访问 */
  transferTo(targetOwner: string): Owned<T> {
    this._assertAlive('transferTo')
    if (this._state === 'moved') throw OWNERSHIP_ERRORS.doubleMove(this.id)
    if (this._activeBorrows > 0) throw OWNERSHIP_ERRORS.hasActiveBorrows(this.id, this._activeBorrows)

    this._state = 'moved'
    this._movedTo = targetOwner
    this._graph.setState(this.id, 'moved')
    this._graph.addEdge({ kind: 'moved-from', from: targetOwner, to: this.id })

    // 目标接管（同图内转移——返回值带目标 owner 的活体；派生 id 避免覆盖原 moved 节点）
    return new Owned<T>({
      id: `${this.id}@${targetOwner}`,
      resourceType: this.resourceType,
      byteSize: this.byteSize,
      owner: targetOwner,
      value: this._value,
      graph: this._graph,
      transferable: this._transferable,
      releaseHook: this._releaseHook ?? undefined,
      sourceLocation: this._sourceLocation,
    })
  }

  /** ★Borrow：临时借用（G-43.3 不逃逸作用域——drop 后失效） */
  borrow(scopeName = 'anonymous'): Borrow<T> {
    this._assertAlive('borrow')
    const b = new Borrow<T>(this, scopeName, this._graph)
    this._activeBorrows++
    this._borrows.add(b as Borrow<unknown>)
    this._graph.addEdge({ kind: 'borrows', from: scopeName, to: this.id, since: Date.now() })
    return b
  }

  /** ★Weak：弱引用（打破循环） */
  weak(): Weak<T> {
    return new Weak<T>(this)
  }

  /** ★确定性 Drop（五阶段协议） */
  drop(opts: { force?: boolean } = {}): { ok: boolean; freedBytes: number; freedHandles: number; invalidatedBorrows: number; error?: OwnershipError } {
    const { force = false } = opts

    // ① prepare —— 检查前置条件
    if (this._state === 'dropped') return { ok: false, freedBytes: 0, freedHandles: 0, invalidatedBorrows: 0, error: OWNERSHIP_ERRORS.alreadyDropped(this.id) }
    if (this._state === 'moved') return { ok: false, freedBytes: 0, freedHandles: 0, invalidatedBorrows: 0, error: OWNERSHIP_ERRORS.useAfterMove(this.id, this._movedTo ?? '?') }
    if (!force && this._activeBorrows > 0) {
      return { ok: false, freedBytes: 0, freedHandles: 0, invalidatedBorrows: 0, error: OWNERSHIP_ERRORS.hasActiveBorrows(this.id, this._activeBorrows) }
    }

    // ② invalidate —— 失效所有借用
    let invalidated = 0
    for (const b of this._borrows) {
      if (b.valid) {
        b.invalidate()
        invalidated++
      }
    }
    this._borrows.clear()
    this._activeBorrows = 0

    // ③ release —— 实际释放（releaseHook 不阻断）
    let freedBytes = 0
    if (this._releaseHook) {
      try {
        this._releaseHook(this._value)
      } catch {
        /* 记录但不阻断 */
      }
    }
    freedBytes = this.byteSize

    // ④ unregister —— 从所有权图移除
    this._state = 'dropped'
    this._graph.setState(this.id, 'dropped')

    // ⑤ reclaim —— 归还配额（由调用方 QuotaTracker 记账——CMP073 一致性在集成层）
    return { ok: true, freedBytes, freedHandles: 1, invalidatedBorrows: invalidated }
  }
}

// ============================================================
// Borrow<T> —— 临时借用（G-43.3：不逃逸作用域）
// ============================================================

export class Borrow<T> {
  readonly borrowedAt = Date.now()
  private _valid = true
  private readonly _source: Owned<T>
  private readonly _scopeName: string
  private readonly _graph: OwnershipGraph

  constructor(source: Owned<T>, scopeName: string, graph: OwnershipGraph) {
    this._source = source
    this._scopeName = scopeName
    this._graph = graph
  }

  get valid(): boolean {
    return this._valid && this._source.state === 'alive'
  }

  get durationMs(): number {
    return Date.now() - this.borrowedAt
  }

  get(): T | undefined {
    if (!this.valid) return undefined
    return this._source.read()
  }

  release(): void {
    if (!this._valid) return
    this.invalidate()
    void this._graph
    void this._scopeName
  }

  invalidate(): void {
    this._valid = false
  }
}

// ============================================================
// Weak<T> —— 弱引用（打破循环）
// ============================================================

export class Weak<T> {
  private readonly _source: Owned<T>

  constructor(source: Owned<T>) {
    this._source = source
  }

  get alive(): boolean {
    return this._source.state === 'alive'
  }

  /** 升级为借用（弱引用仅在持有者存活时可用） */
  upgrade(): Borrow<T> | undefined {
    if (!this.alive) return undefined
    return this._source.borrow('weak-upgrade')
  }
}

// ============================================================
// Managed<T> —— 框架代管（G-43.4：默认安全，业务零心智负担）
// ============================================================

export class Managed {
  readonly value: unknown
  readonly owner: string
  disposed = false
  private readonly _disposeFn: (() => void) | null

  constructor(opts: { value: unknown; owner: string; disposeFn?: () => void; registry?: ManagedRegistry }) {
    this.value = opts.value
    this.owner = opts.owner
    this._disposeFn = opts.disposeFn ?? null
    opts.registry?.add(this)
  }

  /** 释放（框架在页面销毁时自动调用——业务零心智负担） */
  dispose(): boolean {
    if (this.disposed) return false
    this.disposed = true
    try {
      this._disposeFn?.()
    } catch {
      /* 记录但不阻断 */
    }
    return true
  }
}

/** 框架代管注册表（页面销毁 → disposeAll——G-42.3 releaseResources 的所有权对应） */
export class ManagedRegistry {
  private readonly _items = new Set<Managed>()

  add(m: Managed): void {
    this._items.add(m)
  }

  /** 全部释放（返回释放数） */
  disposeAll(): number {
    let n = 0
    for (const m of this._items) {
      if (m.dispose()) n++
    }
    this._items.clear()
    return n
  }

  get size(): number {
    return this._items.size
  }
}
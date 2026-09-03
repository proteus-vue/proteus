// packages/render-backend/src/ownership-observability.ts
// ★G-43 B4（proteus-ownership-plan batches B4）：DevTools 所有权图数据层（权威 TS 版）
//   对齐 devtools-ownership-graph.md §3（四类检测）/ §6（Conformance V-01~V-07）：
//   · 所有权图 mutation 事件流（graph.subscribe）→ 历史时间线（alloc/drop/moved/borrow/weak/strong）
//   · 计数器（V-07 生产期采样：O(1) 每资源——默认只计数，完整历史可关）
//   · diagnoseOwnershipIssues：V-01 一致性 / V-02 泄漏路径 / V-03 长期借用 / V-04 跨页强引用 / V-05 无主资源
//   · buildOwnershipTimeline：V-06 alloc/drop 配对 + 未配对高亮（每条 alloc 可点到源码行）
//   纯逻辑零依赖（graph 是唯一事实源——DevTools 面板/远程协议/CLI 报告的公共数据层）
import type { GraphEdge, GraphNode, LeakInfo, OwnershipGraph, OwnershipMutation } from './ownership'

// ============================================================
// 1. 历史时间线（graph mutation 事件 → 可读记录序列）
// ============================================================

export type OwnershipRecordKind = 'alloc' | 'drop' | 'moved' | 'borrow' | 'weak' | 'strong'

export interface OwnershipRecord {
  readonly ts: number
  readonly kind: OwnershipRecordKind
  readonly id?: string
  readonly owner?: string | null
  readonly type?: string
  readonly byteSize?: number
  readonly sourceLocation?: string | null
  /** borrow/weak/strong 的引用方（edge.from） */
  readonly from?: string
  /** edge.to（borrow/weak/strong 的目标资源） */
  readonly to?: string
}

export interface OwnershipHistoryOptions {
  /** 环形缓冲上限（缺省 2000——V-06 时间线消费，超限丢最旧） */
  readonly limit?: number
  /** 缺省 true；生产期可关（setEnabled(false)——仅计数仍开） */
  readonly enabled?: boolean
}

export interface OwnershipHistory {
  readonly records: readonly OwnershipRecord[]
  enabled: boolean
  setEnabled(v: boolean): void
  clear(): void
  /** 解绑图订阅并清空（面板/诊断生命周期结束） */
  dispose(): void
}

/** ★G-43 B4：历史时间线——订阅 graph mutation 记录 alloc/drop/borrow/weak/strong（面板/诊断消费） */
export function createOwnershipHistory(graph: OwnershipGraph, opts: OwnershipHistoryOptions = {}): OwnershipHistory {
  const limit = opts.limit ?? 2000
  let records: OwnershipRecord[] = []
  let enabled = opts.enabled ?? true
  let disposed = false

  function push(rec: OwnershipRecord): void {
    records.push(rec)
    if (records.length > limit) records = records.slice(-limit)
  }

  const unsub = graph.subscribe((m: OwnershipMutation) => {
    if (!enabled || disposed) return
    if (m.kind === 'register') {
      push({ ts: m.ts, kind: 'alloc', id: m.id, owner: m.owner, type: m.type, byteSize: m.byteSize, sourceLocation: m.sourceLocation })
    } else if (m.kind === 'state') {
      if (m.state === 'dropped') {
        const n = graph.nodes.get(m.id)
        push({ ts: m.ts, kind: 'drop', id: m.id, owner: n?.owner, type: n?.type, byteSize: n?.byteSize, sourceLocation: n?.sourceLocation ?? null })
      } else if (m.state === 'moved') {
        const n = graph.nodes.get(m.id)
        push({ ts: m.ts, kind: 'moved', id: m.id, owner: n?.owner, type: n?.type, byteSize: n?.byteSize, sourceLocation: n?.sourceLocation ?? null })
      }
    } else if (m.kind === 'edge') {
      const k = m.edge.kind
      if (k === 'owns' || k === 'moved-from') return // owns 由 register 表达；moved-from 由 moved 记录表达
      push({ ts: m.ts, kind: k === 'borrows' ? 'borrow' : k, from: m.edge.from, to: m.edge.to })
    }
  })

  const history: OwnershipHistory = {
    get records() {
      return records
    },
    get enabled() {
      return enabled
    },
    set enabled(v: boolean) {
      enabled = v
    },
    setEnabled(v: boolean) {
      enabled = v
    },
    clear() {
      records = []
    },
    dispose() {
      disposed = true
      unsub()
      records = []
    },
  }
  return history
}

// ============================================================
// 2. 计数器（V-07 生产期采样——O(1) 每资源，默认只计数不建完整历史）
// ============================================================

export interface TypeCounter {
  readonly allocated: number
  readonly alive: number
}

export interface OwnershipCounters {
  readonly alive: number
  readonly total: number
  readonly bytesAlive: number
  readonly byType: Readonly<Record<string, TypeCounter>>
  /** V-01 一致性：计数器与图 stats 同步（counter 模式下的自证） */
  consistent(): boolean
}

/** ★G-43 B4：计数器采样（V-07——生产期开销 O(1) 每资源；完整历史可单独关闭） */
export function createOwnershipCounters(graph: OwnershipGraph): OwnershipCounters {
  let alive = 0
  let total = 0
  let bytesAlive = 0
  const byType = new Map<string, { allocated: number; alive: number }>()

  const bump = (type: string, delta: number): void => {
    const c = byType.get(type) ?? { allocated: 0, alive: 0 }
    c.alive += delta
    if (c.alive < 0) c.alive = 0
    byType.set(type, c)
  }

  // 先快照已有节点（图可能先于计数器创建——挂载即一致，V-01），再订阅后续 mutation
  for (const n of graph.nodes.values()) {
    total++
    const c = byType.get(n.type) ?? { allocated: 0, alive: 0 }
    c.allocated++
    byType.set(n.type, c)
    if (n.state === 'alive') {
      alive++
      bytesAlive += n.byteSize
      c.alive++
    }
  }

  graph.subscribe((m: OwnershipMutation) => {
    if (m.kind === 'register') {
      alive++
      total++
      bytesAlive += m.byteSize
      const c = byType.get(m.type) ?? { allocated: 0, alive: 0 }
      c.allocated++
      c.alive++
      byType.set(m.type, c)
    } else if (m.kind === 'state') {
      // setState 先改 node.state 再 emit——每个节点从 register(+1) 到终态恰好一次 mutation（moved/dropped）
      if (m.state === 'dropped' || m.state === 'moved') {
        const n = graph.nodes.get(m.id)
        alive = Math.max(0, alive - 1)
        bytesAlive = Math.max(0, bytesAlive - (n?.byteSize ?? 0))
        bump(n?.type ?? '?', -1)
      }
    }
  })

  return {
    get alive() {
      return alive
    },
    get total() {
      return total
    },
    get bytesAlive() {
      return bytesAlive
    },
    get byType() {
      return Object.fromEntries(byType)
    },
    consistent() {
      const s = graph.stats()
      return alive === s.alive && total === s.total && bytesAlive === s.totalBytes
    },
  }
}

// ============================================================
// 3. 四类检测（devtools-ownership-graph.md §3——诊断一次跑齐）
// ============================================================

export interface LongBorrow {
  readonly resourceId: string
  readonly type: string
  readonly owner: string | null
  readonly borrowedBy: string
  readonly sinceMs: number
}

export interface CrossPageRef {
  readonly resourceId: string
  readonly type: string
  readonly owner: string | null
  /** 跨页强持有的引用方（strong edge.from——显式登记，见 GraphEdge.kind 'strong'） */
  readonly heldBy: string
}

export interface OwnershipDiagnosisOptions {
  /** 已销毁页面 scope（V-02 泄漏路径输入——该域资源预期已释放） */
  readonly destroyedScopes?: readonly string[]
  /** 长期借用阈值（缺省 1000ms——V-03） */
  readonly longBorrowMs?: number
  /** 时钟注入（测试用——缺省 Date.now） */
  readonly now?: () => number
}

export interface OwnershipDiagnosis {
  /** V-01：图中存活节点数（与 stats 一致性在计数器模块自证） */
  readonly aliveNodes: number
  readonly totalNodes: number
  /** V-05：无主资源（owner === null 的存活节点——必然泄漏） */
  readonly orphans: GraphNode[]
  /** V-02：泄漏路径（destroyedScopes 内仍存活资源 + 反向引用链 + 源码行） */
  readonly leaks: LeakInfo[]
  /** V-03：长期借用（借用持续时间 > longBorrowMs——借用的运行时逃逸表现） */
  readonly longBorrows: LongBorrow[]
  /** V-04：跨页面强引用（资源 owner=A 被 B 强持有——销毁时无法释放，应 transferTo/weak） */
  readonly crossPageRefs: CrossPageRef[]
}

/** ★G-43 B4：四类检测一次跑齐（V-01~V-05——DevTools 面板/远程诊断的公共输入） */
export function diagnoseOwnershipIssues(graph: OwnershipGraph, opts: OwnershipDiagnosisOptions = {}): OwnershipDiagnosis {
  const now = opts.now ? opts.now() : Date.now()
  const longBorrowMs = opts.longBorrowMs ?? 1000
  const destroyedScopes = opts.destroyedScopes ?? []
  const stats = graph.stats()

  // V-05 无主资源（G-43.1——框架 bug/未正确登记的必然泄漏）
  const orphans = graph.findOrphans()

  // V-02 泄漏路径（每个已销毁 scope 上仍存活资源 + 引用链 + 源码位置）
  const leaks: LeakInfo[] = []
  for (const scope of destroyedScopes) {
    leaks.push(...graph.detectLeaks(scope))
  }

  // V-03 长期借用（borrows edge.since 距今超阈值——借用本应临时）
  const longBorrows: LongBorrow[] = []
  for (const e of graph.edges) {
    if (e.kind !== 'borrows') continue
    const sinceMs = e.since ?? 0
    const duration = sinceMs > 0 ? now - sinceMs : 0
    if (duration > longBorrowMs) {
      const n = graph.nodes.get(e.to)
      longBorrows.push({ resourceId: e.to, type: n?.type ?? '?', owner: n?.owner ?? null, borrowedBy: e.from, sinceMs: sinceMs })
    }
  }

  // V-04 跨页面强引用（strong edge 的目标资源 owner ≠ 引用方——强引用不应跨 owner，跨 owner 应 transferTo）
  const crossPageRefs: CrossPageRef[] = []
  for (const e of graph.edges) {
    if (e.kind !== 'strong') continue
    const n = graph.nodes.get(e.to)
    if (!n || n.state !== 'alive') continue
    if (e.from === n.owner) continue // 同 owner 强引用不跨页（自持有）
    crossPageRefs.push({ resourceId: e.to, type: n.type, owner: n.owner, heldBy: e.from })
  }

  return { aliveNodes: stats.alive, totalNodes: stats.total, orphans, leaks, longBorrows, crossPageRefs }
}

// ============================================================
// 4. 时间线配对（devtools-ownership-graph.md §4.2 / V-06）
// ============================================================

export interface TimelineEvent extends OwnershipRecord {
  /** 该 drop/moved 对应的 alloc 记录（V-06：每条升降可点到源码行；无 = 历史裁剪或前置分配） */
  readonly matchedAlloc?: OwnershipRecord
}

export interface OwnershipTimeline {
  readonly events: readonly TimelineEvent[]
  /** 未配对 alloc（历史内有 alloc 无 drop 且图节点仍 alive——可疑高亮；页面销毁 force-drop 后消失） */
  readonly unpairedAllocs: readonly OwnershipRecord[]
}

/** ★G-43 B4：alloc/drop 配对时间线（V-06——输入记录序列，输出可渲染事件序列 + 可疑未配对） */
export function buildOwnershipTimeline(history: Pick<OwnershipHistory, 'records'>, graph: OwnershipGraph): OwnershipTimeline {
  const events: TimelineEvent[] = []
  const allocById = new Map<string, OwnershipRecord>()

  for (const rec of history.records) {
    if (rec.kind === 'alloc' && rec.id) {
      allocById.set(rec.id, rec)
      events.push(rec)
    } else if ((rec.kind === 'drop' || rec.kind === 'moved') && rec.id) {
      const matched = allocById.get(rec.id)
      if (matched) allocById.delete(rec.id)
      events.push({ ...rec, matchedAlloc: matched })
    } else {
      events.push(rec)
    }
  }

  const unpairedAllocs = [...allocById.values()].filter((a) => a.id !== undefined && graph.nodes.get(a.id!)?.state === 'alive')
  return { events, unpairedAllocs }
}

// ============================================================
// 5. 可读报告（DevTools 面板/CLI 文本形态——数据层的展示契约）
// ============================================================

export interface FormatOptions {
  readonly sourceLabel?: string
}

/** ★G-43 B4：诊断文本报告（对齐 devtools-ownership-graph.md §2.1 主视图叙事） */
export function formatOwnershipDiagnosis(d: OwnershipDiagnosis, opts: FormatOptions = {}): string {
  const src = opts.sourceLabel ?? '📍'
  const lines: string[] = []
  lines.push(`所有权图：${d.aliveNodes} alive / ${d.totalNodes} total`)

  if (d.orphans.length > 0) {
    lines.push(`🔴 无主资源 ${d.orphans.length} 处（必然泄漏——框架 bug 或未正确登记）：`)
    for (const o of d.orphans) lines.push(`  · ${o.id}（${o.type}，${o.byteSize}B）${o.sourceLocation ? `${src} ${o.sourceLocation}` : ''}`)
  }
  if (d.leaks.length > 0) {
    lines.push(`⚠️ 泄漏路径 ${d.leaks.length} 处（页面已销毁资源仍存活）：`)
    for (const l of d.leaks) {
      lines.push(`  · ${l.resourceId}（${l.type}，${l.byteSize}B）${l.sourceLocation ? `${src} ${l.sourceLocation}` : ''}`)
      for (const hop of l.referenceChain) lines.push(`      ${hop}`)
    }
  }
  if (d.longBorrows.length > 0) {
    lines.push(`🟡 长期借用 ${d.longBorrows.length} 处（>阈值——借用的运行时逃逸表现）：`)
    for (const b of d.longBorrows) lines.push(`  · ${b.resourceId} ← borrowed by ${b.borrowedBy}（owner ${b.owner ?? '无主'}）`)
  }
  if (d.crossPageRefs.length > 0) {
    lines.push(`⚠️ 跨页面强引用 ${d.crossPageRefs.length} 处（销毁时无法释放——应 transferTo/weak）：`)
    for (const c of d.crossPageRefs) lines.push(`  · ${c.resourceId}（owner ${c.owner ?? '无主'}）← 强持有 by ${c.heldBy}`)
  }
  if (d.orphans.length === 0 && d.leaks.length === 0 && d.longBorrows.length === 0 && d.crossPageRefs.length === 0) {
    lines.push('✅ 无异常（无无主资源/泄漏路径/长期借用/跨页强引用）')
  }
  return lines.join('\n')
}

// 类型引用再导出（供 index 统一）
export type { GraphEdge, GraphNode }

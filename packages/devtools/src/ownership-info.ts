// packages/devtools/src/ownership-info.ts
// ★G-43 B4 所有权面板采集纯逻辑（install.ts collectOwnershipData 用 + ws-bridge Proteus.ownership 响应；独立可测）
//   数据层消费 render-backend ownership-observability（diagnoseOwnershipIssues/buildOwnershipTimeline/counters）
//   输出 JSON-safe 视图数据（本地面板钩子 / 远程 Proteus.ownership 命令同构）
import {
  createOwnershipCounters,
  createOwnershipHistory,
  diagnoseOwnershipIssues,
  buildOwnershipTimeline,
  getProteusOwnershipGraph,
} from '@proteus-vue/render-backend'
import type { OwnershipGraph, OwnershipHistory, OwnershipCounters, OwnershipRecord, OwnershipDiagnosis, OwnershipTimeline, GraphNode } from '@proteus-vue/render-backend'

// ============================================================
// 视图数据（JSON-safe——本地面板与远程 WS 协议同构）
// ============================================================

export interface OwnershipResourceItem {
  readonly id: string
  readonly type: string
  readonly byteSize: number
  readonly owner: string | null
  readonly state: GraphNode['state']
  readonly sourceLocation: string | null
  /** 活跃借用方（borrows edges from） */
  readonly borrowedBy: string[]
}

export interface OwnershipViewData {
  readonly summary: { alive: number; total: number; bytesAlive: number; byType: Record<string, { allocated: number; alive: number }> }
  readonly diagnosis: {
    orphans: Array<{ id: string; type: string; byteSize: number; sourceLocation: string | null }>
    leaks: Array<{ resourceId: string; type: string; byteSize: number; sourceLocation: string | null; referenceChain: string[] }>
    longBorrows: Array<{ resourceId: string; borrowedBy: string; owner: string | null }>
    crossPageRefs: Array<{ resourceId: string; owner: string | null; heldBy: string }>
  }
  /** 按 owner 分组的存活资源（Graph 主视图——🟢 Owner + 📍 源码位置） */
  readonly resources: Array<{ owner: string; items: OwnershipResourceItem[] }>
  /** alloc/drop 时间线（V-06 配对 + 未配对高亮；截断 tail 保留最新） */
  readonly timeline: { events: Array<OwnershipRecord & { matchedAllocId?: string }>; unpairedIds: string[]; truncated: boolean }
}

/** 时间线渲染上限（防超大历史卡面板——保最新 tail） */
const TIMELINE_LIMIT = 200

export interface OwnershipTracer {
  /** 采集视图数据（面板 rerender / WS 响应共用；幂等纯读） */
  collect(): OwnershipViewData
  dispose(): void
}

export interface OwnershipTracerOptions {
  /** 所有权图（缺省 getProteusOwnershipGraph 全局单例） */
  graph?: OwnershipGraph
  /** 已有历史（业务在 graph 创建时挂的 createOwnershipHistory——缺省内部自建，从挂载时刻起记录） */
  history?: OwnershipHistory
}

/**
 * ★G-43 B4：所有权 tracer——history + counters 常驻挂接，collect 一次跑齐视图数据。
 * ★存量快照：history 只记录订阅后事件（面板后开场景）——collect 时对图内未出现过的节点补
 *   'alloc' 快照记录（视为面板接入前已分配），时间线/未配对判定不丢存量。
 */
export function createOwnershipTracer(options: OwnershipTracerOptions = {}): OwnershipTracer {
  const graph = options.graph ?? getProteusOwnershipGraph()
  const counters: OwnershipCounters = createOwnershipCounters(graph)
  const history: OwnershipHistory = options.history ?? createOwnershipHistory(graph)
  let disposed = false

  function collect(): OwnershipViewData {
    if (disposed) {
      return {
        summary: { alive: 0, total: 0, bytesAlive: 0, byType: {} },
        diagnosis: { orphans: [], leaks: [], longBorrows: [], crossPageRefs: [] },
        resources: [],
        timeline: { events: [], unpairedIds: [], truncated: false },
      }
    }

    const diagnosis: OwnershipDiagnosis = diagnoseOwnershipIssues(graph)

    // 存量快照：history 中未出现的存活节点 → 补 alloc 快照（只入本次视图数据，不污染 history）
    const seenAllocIds = new Set<string>()
    for (const r of history.records) {
      if (r.kind === 'alloc' && r.id) seenAllocIds.add(r.id)
    }
    const merged: OwnershipRecord[] = [...history.records]
    for (const n of graph.nodes.values()) {
      if (!seenAllocIds.has(n.id)) {
        merged.push({ ts: n.createdAt, kind: 'alloc', id: n.id, owner: n.owner, type: n.type, byteSize: n.byteSize, sourceLocation: n.sourceLocation })
      }
    }
    merged.sort((a, b) => a.ts - b.ts)

    const tl: OwnershipTimeline = buildOwnershipTimeline({ records: merged }, graph)
    const truncated = tl.events.length > TIMELINE_LIMIT
    const events = truncated ? tl.events.slice(-TIMELINE_LIMIT) : tl.events

    // 资源树（按 owner 分组的存活资源 + 借用方）
    const borrowedBy = new Map<string, string[]>()
    for (const e of graph.edges) {
      if (e.kind !== 'borrows') continue
      const list = borrowedBy.get(e.to) ?? []
      list.push(e.from)
      borrowedBy.set(e.to, list)
    }
    const byOwner = new Map<string, OwnershipResourceItem[]>()
    for (const n of graph.nodes.values()) {
      if (n.state !== 'alive') continue
      const key = n.owner ?? '（无主）'
      const list = byOwner.get(key) ?? []
      list.push({ id: n.id, type: n.type, byteSize: n.byteSize, owner: n.owner, state: n.state, sourceLocation: n.sourceLocation, borrowedBy: borrowedBy.get(n.id) ?? [] })
      byOwner.set(key, list)
    }

    return {
      summary: { alive: counters.alive, total: counters.total, bytesAlive: counters.bytesAlive, byType: counters.byType },
      diagnosis: {
        orphans: diagnosis.orphans.map((o) => ({ id: o.id, type: o.type, byteSize: o.byteSize, sourceLocation: o.sourceLocation })),
        leaks: diagnosis.leaks.map((l) => ({ resourceId: l.resourceId, type: l.type, byteSize: l.byteSize, sourceLocation: l.sourceLocation, referenceChain: l.referenceChain })),
        longBorrows: diagnosis.longBorrows.map((b) => ({ resourceId: b.resourceId, borrowedBy: b.borrowedBy, owner: b.owner })),
        crossPageRefs: diagnosis.crossPageRefs.map((c) => ({ resourceId: c.resourceId, owner: c.owner, heldBy: c.heldBy })),
      },
      resources: [...byOwner.entries()].map(([owner, items]) => ({ owner, items })),
      timeline: {
        events: events.map((e) => ({ ts: e.ts, kind: e.kind, id: e.id, owner: e.owner, type: e.type, byteSize: e.byteSize, sourceLocation: e.sourceLocation, from: e.from, to: e.to, matchedAllocId: e.matchedAlloc?.id })),
        unpairedIds: tl.unpairedAllocs.map((a) => a.id ?? ''),
        truncated,
      },
    }
  }

  return {
    collect,
    dispose() {
      disposed = true
      history.dispose()
    },
  }
}

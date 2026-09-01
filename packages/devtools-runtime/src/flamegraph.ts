// packages/devtools-runtime/src/flamegraph.ts
// devtools-plan M6（B6）：性能火焰图收集器（UI 无关纯逻辑）
//   · ingest：start/end 事件（Lifecycle/Compiler transform/Router 守卫/API）→ 嵌套栈构建父子树
//   · inclusive/exclusive：duration = inclusive；self = duration - Σchildren.duration
//   · 同层按 start 排序；startMs 相对录制起点（performance.now 语义）
//   · compare(a, b)：对比两次录制（±10% → regression/improvement）
//   · 录制控制：start（清空 + 基线）/ stop（停止采集，未结束 span 丢弃）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import type { TraceEvent } from './index'

export interface FlameNode {
  id: string
  source: string
  name: string
  /** 相对录制起点的毫秒时间戳 */
  startMs: number
  /** inclusive 耗时 */
  durationMs: number
  /** exclusive 耗时（duration - children 总时长） */
  selfMs: number
  traceId?: string
  children: FlameNode[]
  depth: number
}

export interface FlamegraphCollectorOptions {
  /** 完成节点缓冲上限（缺省 20000——火焰图万级 span 预算） */
  bufferSize?: number
  /** 时钟注入（缺省 performance.now 对齐 plan 0.1ms 分辨率） */
  now?: () => number
}

/** 对比结果（两次录制 diff） */
export interface FlameCompareEntry {
  source: string
  name: string
  /** 前次录制耗时 */
  aMs: number
  /** 本次录制耗时 */
  bMs: number
  /** 变化百分比（(b - a) / a × 100，保留 1 位） */
  deltaPct: number
  verdict: 'regression' | 'improvement' | 'same'
}

export interface FlamegraphCollector {
  /** 摄入事件（start/end；stop 后忽略） */
  ingest(event: TraceEvent): void
  /** 开始录制（清空 + 重置基线） */
  start(): void
  /** 停止录制（冻结当前树；未结束 span 丢弃） */
  stop(): void
  /** 完成树根节点（同层按 start 排序） */
  roots(): FlameNode[]
  /** 全部节点（含 children，按 start 序） */
  nodes(): FlameNode[]
  /** 倒置视图（icicle）：按 depth 降序（深→浅） */
  icicle(): FlameNode[]
  /** 对比当前录制与 previous（±10% 阈值，exclusive 耗时聚合） */
  compare(previous: FlameNode[]): FlameCompareEntry[]
  readonly recording: boolean
}

let seq = 0
function nextNodeId(): string {
  seq += 1
  return 'flame-' + seq
}

interface Inflight {
  node: FlameNode
  /** 事件绝对时间戳（end 配对用） */
  startTs: number
}

export function createFlamegraphCollector(options: FlamegraphCollectorOptions = {}): FlamegraphCollector {
  const bufferSize = options.bufferSize ?? 20000
  const now = options.now ?? (() => performance.now())
  const roots: FlameNode[] = []
  /** ★全局嵌套栈（火焰图父子关系跨 source：boot 根下挂 capability/store 子 span——区别于时间轴 per-source 泳道） */
  const stacks: Inflight[] = []
  let baselineTs = 0
  let recording = false

  function attach(inflight: Inflight): void {
    if (stacks.length) {
      // 嵌套：挂到当前栈顶（即父）children
      stacks[stacks.length - 1].node.children.push(inflight.node)
    } else {
      roots.push(inflight.node)
    }
    if (roots.length > bufferSize) roots.shift()
  }

  function finalize(inflight: Inflight, endTs: number): void {
    const node = inflight.node
    node.durationMs = Math.max(0, endTs - inflight.startTs)
    // exclusive = duration - children 总时长（children 已完成，duration 已定）
    let childTotal = 0
    for (const c of node.children) childTotal += c.durationMs
    node.selfMs = Math.max(0, node.durationMs - childTotal)
  }

  function ingest(event: TraceEvent): void {
    if (!recording) return
    if (event.phase !== 'start' && event.phase !== 'end') return // point/error 不进火焰图
    if (event.phase === 'start') {
      const node: FlameNode = {
        id: nextNodeId(),
        source: event.source,
        name: event.name,
        startMs: Math.max(0, event.timestamp - baselineTs),
        durationMs: 0,
        selfMs: 0,
        traceId: event.traceId,
        children: [],
        depth: 0,
      }
      const inflight: Inflight = { node, startTs: event.timestamp }
      // 深度 = 父深度 + 1（父即当前全局栈顶）
      if (stacks.length) node.depth = stacks[stacks.length - 1].node.depth + 1
      stacks.push(inflight)
      return
    }
    // end：全局栈从顶往下找第一个同 source 的进行中节点（弹栈 + 完成 + 挂到父）
    let idx = stacks.length - 1
    while (idx >= 0 && stacks[idx].node.source !== event.source) idx -= 1
    if (idx >= 0) {
      const done = stacks.splice(idx, 1)[0]
      finalize(done, event.timestamp)
      attach(done)
    }
  }

  function collectAll(list: FlameNode[], out: FlameNode[]): void {
    for (const n of list) {
      out.push(n)
      if (n.children.length) collectAll(n.children, out)
    }
  }

  function sortByStart(list: FlameNode[]): FlameNode[] {
    return list.slice().sort((a, b) => a.startMs - b.startMs)
  }

  return {
    start(): void {
      roots.length = 0
      stacks.length = 0
      baselineTs = now()
      recording = true
    },
    stop(): void {
      // 未结束 span 丢弃（火焰图只展示完成段）
      stacks.length = 0
      recording = false
    },
    get recording() {
      return recording
    },
    roots: () => sortByStart(roots),
    nodes: () => {
      const out: FlameNode[] = []
      collectAll(sortByStart(roots), out)
      return out
    },
    icicle: () => {
      const all: FlameNode[] = []
      collectAll(sortByStart(roots), all)
      return all.slice().sort((a, b) => b.depth - a.depth)
    },
    ingest,
    compare(previous: FlameNode[]): FlameCompareEntry[] {
      const aByKey = new Map<string, number>()
      const walkA = (list: FlameNode[]): void => {
        for (const n of list) {
          const key = n.source + '\u0000' + n.name
          const prev = aByKey.get(key)
          aByKey.set(key, (prev === undefined ? 0 : prev) + n.selfMs)
          if (n.children.length) walkA(n.children)
        }
      }
      walkA(previous)
      const bByKey = new Map<string, number>()
      const walkB = (list: FlameNode[]): void => {
        for (const n of list) {
          const key = n.source + '\u0000' + n.name
          const prev = bByKey.get(key)
          bByKey.set(key, (prev === undefined ? 0 : prev) + n.selfMs)
          if (n.children.length) walkB(n.children)
        }
      }
      // ★walkB 直接遍历根列表（勿传扁平 collectAll 输出——children 会被重复计数）
      walkB(roots)
      const out: FlameCompareEntry[] = []
      for (const entry of aByKey) {
        const parts = entry[0].split('\u0000')
        const aMs = entry[1]
        const prevB = bByKey.get(entry[0])
        const bMs = prevB === undefined ? 0 : prevB
        const deltaPct = aMs > 0 ? Math.round(((bMs - aMs) / aMs) * 1000) / 10 : bMs > 0 ? 100 : 0
        let verdict: FlameCompareEntry['verdict'] = 'same'
        if (deltaPct >= 10) verdict = 'regression'
        else if (deltaPct <= -10) verdict = 'improvement'
        out.push({ source: parts[0], name: parts[1], aMs, bMs, deltaPct, verdict })
      }
      return out.sort((x, y) => y.deltaPct - x.deltaPct)
    },
  }
}

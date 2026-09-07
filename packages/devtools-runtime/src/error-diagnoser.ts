// packages/devtools-runtime/src/error-diagnoser.ts
// devtools-plan M7（B7）：异常根因分析（UI 无关纯逻辑）
//   · ingest：收集 phase:'error' 事件 + 全部活动事件（traceId 聚合上下文）
//   · 归因规则：① error 为根因候选 ② 同 traceId 多 error → 最早 timestamp 为根因 ③ 已知模式库（401/ChunkLoadError/capability.unsupported，可扩展）
//   · 影响范围：同 traceId 涉及 source 集合（store/页面/组件推导）
//   · 复现脚本：同 traceId 的导航步骤序列（"一键生成最小复现序列"）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import type { TraceEvent } from './index'

/** error 事件记录（链节点） */
export interface ErrorEventRecord {
  source: string
  name: string
  payload?: unknown
  timestamp: number
  traceId?: string
}

/** 根因报告（每 traceId 一条） */
export interface RootCauseReport {
  /** 根因 error（规则 ①②：最早 timestamp） */
  rootCause: ErrorEventRecord
  /** 归因说明（规则 ③ 模式库命中） */
  attribution?: string
  /** 同 traceId 完整调用链（时间序——error 前的调用序列 = causedBy 链） */
  chain: ErrorEventRecord[]
  /** 影响范围（同 traceId 涉及的全部 source） */
  impactSources: string[]
  /** 复现脚本（导航步骤序列） */
  repro: string[]
}

/** 已知错误模式（可扩展插件） */
export interface ErrorPattern {
  match: (e: ErrorEventRecord) => boolean
  attribution: string
}

export interface ErrorDiagnoserOptions {
  /** 已知模式库（缺省内置：401 / ChunkLoadError / capability.unsupported） */
  patterns?: ErrorPattern[]
  /** error 记录环形缓冲上限（缺省 500） */
  bufferSize?: number
}

export interface ErrorDiagnoser {
  /** 摄入事件（error 入候选；全部事件入活动上下文） */
  ingest(event: TraceEvent): void
  /** 根因报告（每 traceId 一条；无 error → 空数组不误报） */
  diagnose(): RootCauseReport[]
  clear(): void
}

const DEFAULT_PATTERNS: ErrorPattern[] = [
  {
    match: (e) => {
      const p = e.payload as { status?: number } | undefined
      const status = p !== undefined ? p.status : undefined
      const statusText = status === undefined ? '' : String(status)
      return status === 401 || /401/.test(String(e.name) + statusText)
    },
    attribution: 'token 失效，检查 auth 守卫（401）',
  },
  {
    match: (e) => /ChunkLoadError|chunk load/i.test(String(e.name) + String(e.payload)),
    attribution: '分包加载失败，检查网络/分包配置（ChunkLoadError）',
  },
  {
    match: (e) => /unsupported/i.test(String(e.name)) || e.source === 'capability',
    attribution: '当前平台不支持，缺 fallback（capability.unsupported）',
  },
]

export function createErrorDiagnoser(options: ErrorDiagnoserOptions = {}): ErrorDiagnoser {
  const patterns = options.patterns ?? DEFAULT_PATTERNS
  const bufferSize = options.bufferSize ?? 500
  const errors: ErrorEventRecord[] = []
  const activity: ErrorEventRecord[] = []

  function push(list: ErrorEventRecord[], record: ErrorEventRecord): void {
    list.push(record)
    if (list.length > bufferSize) list.shift()
  }

  function toRecord(event: TraceEvent): ErrorEventRecord {
    return {
      source: event.source,
      name: event.name,
      payload: event.payload,
      timestamp: event.timestamp,
      traceId: event.traceId,
    }
  }

  function attributionOf(record: ErrorEventRecord): string | undefined {
    for (const p of patterns) {
      if (p.match(record)) return p.attribution
    }
    return undefined
  }

  return {
    ingest(event: TraceEvent): void {
      const record = toRecord(event)
      if (event.phase === 'error') push(errors, record)
      push(activity, record)
    },
    diagnose(): RootCauseReport[] {
      // 按 traceId 分组（无 traceId 各自成组）
      const groups = new Map<string, ErrorEventRecord[]>()
      for (const e of errors) {
        const key = e.traceId ?? 'no-trace-' + e.timestamp + '-' + e.name
        const list = groups.get(key)
        if (list) list.push(e)
        else groups.set(key, [e])
      }
      const reports: RootCauseReport[] = []
      for (const entry of groups) {
        const traceKey = entry[0]
        const group = entry[1]
        // 规则 ②：同 traceId 多 error → 最早 timestamp 为根因
        let rootCause = group[0]
        for (const e of group) {
          if (e.timestamp < rootCause.timestamp) rootCause = e
        }
        // 规则 ③：模式库归因
        const attribution = attributionOf(rootCause)
        // 同 traceId 调用链（时间序；无 traceId 组只含 error 本身）
        const chain: ErrorEventRecord[] = []
        for (const a of activity) {
          const same = traceKey.startsWith('no-trace-') ? a === rootCause : a.traceId === traceKey
          if (same) chain.push(a)
        }
        // 影响范围：chain 涉及的 source 去重
        const sources: string[] = []
        for (const a of chain) {
          if (sources.indexOf(a.source) < 0) sources.push(a.source)
        }
        // 复现脚本：router 导航事件 → 步骤序列
        const repro: string[] = []
        for (const a of chain) {
          if (a.source === 'router' && /nav/i.test(a.name)) {
            repro.push('导航 ' + a.name + ' → 等待结果')
          }
        }
        if (repro.length === 0) repro.push('触发 ' + rootCause.source + '.' + rootCause.name)
        reports.push({ rootCause, attribution, chain, impactSources: sources, repro })
      }
      return reports
    },
    clear: () => {
      errors.length = 0
      activity.length = 0
    },
  }
}

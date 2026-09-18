// packages/devtools/src/session-io.ts
// ★M11 可观测性（M8.2）：SessionBundle 导出/导入的纯逻辑——一次会话 → 另一环境完整还原（时间轴 + 路由 + 根因 + store）
//   会话 = 可重放事件日志（TraceEvent[]：时间轴/路由/根因/store/组件聚合的单一真相源——导入重放即全视图重建）
//   + device（设备面板数据）+ store 快照（复用 StoreSnapshotIO 形态）
//   纯函数零 DOM 依赖（happy-dom 可单测）；导入非法 → null
import type { TraceEvent, TraceSource, TracePhase } from '@proteus-vue/devtools-runtime'
import type { StoreSnapshotIO, StoreStepIO, StoreRestoreEntry } from './snapshot-io'
import type { DeviceInfo } from './views/device'

export interface SessionBundle {
  kind: 'proteus-session'
  version: 1
  exportedAt: number
  meta: {
    eventCount: number
    platform?: string
    userAgent?: string
  }
  /** 可重放事件日志（重建 timeline/flame/errors/router-nav/store/component 聚合的唯一真相源） */
  events: TraceEvent[]
  /** 设备面板数据（环境/能力/内存基线） */
  device?: DeviceInfo
  /** store 最新快照 + 步骤（应用侧恢复用；与快照导入同形态） */
  stores: StoreRestoreEntry[]
  steps: StoreStepIO[]
}

export interface ParsedSession {
  events: TraceEvent[]
  device?: DeviceInfo
  stores: StoreRestoreEntry[]
  steps: StoreStepIO[]
}

const VALID_SOURCES: TraceSource[] = ['lifecycle', 'router', 'store', 'api', 'capability', 'compiler', 'component', 'hmr']
const VALID_PHASES: TracePhase[] = ['start', 'end', 'point', 'error']

/** 序列化会话（面板导出：事件日志 + 设备 + store 快照） */
export function serializeSession(input: { events: TraceEvent[]; device?: DeviceInfo; stores: StoreRestoreEntry[]; steps: StoreStepIO[] }): string {
  const bundle: SessionBundle = {
    kind: 'proteus-session',
    version: 1,
    exportedAt: Date.now(),
    meta: { eventCount: input.events.length },
    events: input.events,
    device: input.device,
    stores: input.stores,
    steps: input.steps,
  }
  return JSON.stringify(bundle, null, 2)
}

/** 解析并校验会话（非法 → null；坏事件行过滤保留合法行） */
export function parseSession(json: string): ParsedSession | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const d = data as Partial<SessionBundle>
  if (d.kind !== 'proteus-session' || d.version !== 1 || !Array.isArray(d.events)) return null
  const events: TraceEvent[] = []
  for (const e of d.events) {
    if (!e || typeof e !== 'object') continue
    const ev = e as Partial<TraceEvent>
    if (typeof ev.source !== 'string' || (VALID_SOURCES as string[]).indexOf(ev.source) < 0) continue
    if (typeof ev.phase !== 'string' || (VALID_PHASES as string[]).indexOf(ev.phase) < 0) continue
    if (typeof ev.name !== 'string' || !ev.name) continue
    events.push({
      source: ev.source as TraceSource,
      phase: ev.phase as TracePhase,
      name: ev.name,
      payload: ev.payload,
      timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : Date.now(),
      traceId: typeof ev.traceId === 'string' ? ev.traceId : undefined,
    })
  }
  // store 快照/步骤（复用快照校验语义；坏行过滤）
  const stores: StoreRestoreEntry[] = []
  if (Array.isArray(d.stores)) {
    for (const s of d.stores) {
      if (s && typeof s.id === 'string' && s.state !== null && typeof s.state === 'object' && !Array.isArray(s.state)) {
        stores.push({ id: s.id, state: s.state as Record<string, unknown> })
      }
    }
  }
  const steps: StoreStepIO[] = []
  if (Array.isArray(d.steps)) {
    for (const st of d.steps) {
      if (st && typeof st.index === 'number' && typeof st.storeId === 'string' && (st.type === 'patch' || st.type === 'action')) {
        steps.push({
          index: st.index,
          storeId: st.storeId,
          type: st.type,
          name: typeof st.name === 'string' ? st.name : st.type,
          payload: st.payload,
          timestamp: typeof st.timestamp === 'number' ? st.timestamp : 0,
        })
      }
    }
  }
  return { events, device: d.device, stores, steps }
}

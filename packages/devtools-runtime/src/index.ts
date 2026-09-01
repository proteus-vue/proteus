// packages/devtools-runtime/src/index.ts
// Proteus DevTools 运行时（devtools-plan B1）：TraceBus 统一事件协议 + 环形缓冲 + 脱敏 + 采样 + 零开销门控
// 把分散的字符串 trace（lifecycle/router/compiler）收敛为统一事件流；面板（v1.0+）经 flush() 订阅
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 _proteus/devtools-runtime 进 MP）

export type TraceSource = 'lifecycle' | 'router' | 'store' | 'api' | 'capability' | 'compiler' | 'component' | 'hmr'
export type TracePhase = 'start' | 'end' | 'point' | 'error'

export interface TraceEvent<T = unknown> {
  source: TraceSource
  phase: TracePhase
  name: string
  /** JSON-safe（节点引用须转 handle，见 01-m1-trace-bus.md） */
  payload?: T
  timestamp: number
  /** 跨源链路 ID（采样/串联） */
  traceId?: string
}

export interface TraceBusOptions {
  /** 环形缓冲上限（默认 10000；满时丢弃最旧） */
  bufferSize?: number
  /** 默认关闭（生产零开销）；开发 setEnabled(true) */
  enabled?: boolean
  /** 脱敏键（大小写不敏感；缺省 password/token/authorization/idcard/phone） */
  redactKeys?: string[]
  /** 采样率 0-1（默认 1 全量）；error 事件强制全采（tail sampling） */
  sampleRate?: number
}

export interface TraceBus {
  /** 上报事件（enabled=false → noop；采样不命中 → 跳过；error 强制入缓冲） */
  emit(source: TraceSource, phase: TracePhase, name: string, payload?: unknown, traceId?: string): void
  /** 订阅事件流，返回取消函数 */
  on(handler: (e: TraceEvent) => void): () => void
  /** 环形缓冲（只读快照） */
  readonly buffer: TraceEvent[]
  /** 取出并清空缓冲（面板推送用） */
  flush(): TraceEvent[]
  setEnabled(v: boolean): void
  getEnabled(): boolean
  getTraceId(): string
}

const DEFAULT_REDACT_KEYS = ['password', 'token', 'authorization', 'idcard', 'phone']

/** 创建链路 ID（时间戳 + 随机 hex，跨源串联） */
export function createTraceId(): string {
  let r = ''
  for (let i = 0; i < 8; i++) r += Math.floor(Math.random() * 16).toString(16)
  return Date.now().toString(36) + '-' + r
}

/** 递归脱敏：命中键名（大小写不敏感）→ '[REDACTED]'；覆盖嵌套对象/数组/Map/Set/Date */
export function redactValue(value: unknown, redactKeys: string[]): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Map) {
    const out: Array<[unknown, unknown]> = []
    value.forEach((v, k) => {
      const keyStr = String(k)
      const val = redactValue(v, redactKeys)
      out.push([keyStr, isRedactKey(keyStr, redactKeys) ? '[REDACTED]' : val])
    })
    return out
  }
  if (value instanceof Set) {
    const out: unknown[] = []
    value.forEach((v) => {
      out.push(redactValue(v, redactKeys))
    })
    return out
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < value.length; i++) out.push(redactValue(value[i], redactKeys))
    return out
  }
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    out[k] = isRedactKey(k, redactKeys) ? '[REDACTED]' : redactValue(obj[k], redactKeys)
  }
  return out
}

function isRedactKey(key: string, redactKeys: string[]): boolean {
  const k = key.toLowerCase()
  for (let i = 0; i < redactKeys.length; i++) {
    if (k.indexOf(redactKeys[i].toLowerCase()) >= 0) return true
  }
  return false
}

/** 采样判定：traceId hash 取模（同链路同采弃）；sampleRate 缺失/>=1 → 全采 */
function shouldSample(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  let hash = 0
  for (let i = 0; i < traceId.length; i++) hash = (hash * 31 + traceId.charCodeAt(i)) % 100000
  return hash % 1000 < sampleRate * 1000
}

/** 创建 TraceBus（应用侧单例，devtools 开关经 config/开发环境设置） */
export function createTraceBus(options: TraceBusOptions = {}): TraceBus {
  const bufferSize = options.bufferSize ?? 10000
  const redactKeys = options.redactKeys ?? DEFAULT_REDACT_KEYS
  const sampleRate = options.sampleRate ?? 1
  let enabled = options.enabled ?? false
  let buffer: TraceEvent[] = []
  let handlers: Array<(e: TraceEvent) => void> = []
  let currentTraceId = createTraceId()

  return {
    get buffer() {
      return buffer.slice()
    },
    emit(source, phase, name, payload, traceId) {
      if (!enabled) return
      const tid = traceId ?? currentTraceId
      if (phase !== 'error' && !shouldSample(tid, sampleRate)) return
      const event: TraceEvent = {
        source,
        phase,
        name,
        payload: payload === undefined ? undefined : (redactValue(payload, redactKeys) as never),
        timestamp: Date.now(),
        traceId: tid,
      }
      buffer.push(event)
      if (buffer.length > bufferSize) buffer = buffer.slice(buffer.length - bufferSize)
      // ★M10 降级隔离（M7.5）：单订阅者抛错不阻断其余订阅者/缓冲，也不向外传播（devtools 订阅者异常不得崩应用）
      for (let i = 0; i < handlers.length; i++) {
        try {
          handlers[i](event)
        } catch (err) {
          console.warn('[proteus-devtools] 订阅者处理事件异常（已隔离，不影响其他订阅者）：', event.source + '.' + event.name, err instanceof Error ? err.message : String(err))
        }
      }
    },
    on(handler) {
      handlers.push(handler)
      let removed = false
      return () => {
        if (removed) return
        removed = true
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    },
    flush() {
      const out = buffer
      buffer = []
      return out
    },
    setEnabled(v) {
      enabled = v
    },
    getEnabled() {
      return enabled
    },
    getTraceId() {
      return currentTraceId
    },
  }
}

/**
 * 惰性单例 TraceBus（★一键接入收口）：router/api/capability 等发射端与 installProteusDevtools 共享同一实例，
 * 避免业务侧手动建 bus 传参。★enabled 由**应用侧源码**控制（本包 dist 是编译产物，vite 不转换 node_modules，
 * 内部引用全局会恒为 undefined → 必须在调用方显式开启）：
 *   const bus = getProteusTraceBus()
 *   if (import.meta.env.DEV || __PROTEUS_DEBUG__) bus.setEnabled(true)
 *   // import.meta.env.DEV：vite 可靠注入（dev→true/build→false）；__PROTEUS_DEBUG__：build 期 define（PROTEUS_DEBUG=1 强制生产调试）
 *   // ⚠ 勿用纯 __PROTEUS_DEBUG__：vite 5.4 dev 模式 define 不替换源码，未短路会 ReferenceError；build 产物常量折叠 tree-shake 零开销
 */
let singletonBus: TraceBus | null = null
export function getProteusTraceBus(): TraceBus {
  if (singletonBus === null) {
    singletonBus = createTraceBus()
  }
  return singletonBus
}

export { createTimelineCollector } from './timeline'
export type {
  TimelineSpan,
  TimelineCollector,
  TimelineCollectorOptions,
  TimelineFilter,
} from './timeline'
export { createStateSnapshotter, serializeState, deserializeState } from './state-snapshot'
export type {
  SnapshotStoreLike,
  StateSnapshotterOptions,
  StateSnapshot,
  PatchStep,
  StateSnapshotter,
} from './state-snapshot'
export { createRouteBacktracker } from './route-backtrack'
export type {
  GuardResult,
  RouteLocationLike,
  GuardRecord,
  NavRecord,
  RouteBacktrackerOptions,
  RouteBacktracker,
} from './route-backtrack'
export { createFlamegraphCollector } from './flamegraph'
export type {
  FlameNode,
  FlamegraphCollectorOptions,
  FlameCompareEntry,
  FlamegraphCollector,
} from './flamegraph'
export { createErrorDiagnoser } from './error-diagnoser'
export type {
  ErrorEventRecord,
  RootCauseReport,
  ErrorPattern,
  ErrorDiagnoserOptions,
  ErrorDiagnoser,
} from './error-diagnoser'
export { createStoreTracer } from './store-tracer'
export type { StoreTraceBus, StoreTracer } from './store-tracer'

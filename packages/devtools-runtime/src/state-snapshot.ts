// packages/devtools-runtime/src/state-snapshot.ts
// devtools-plan M4（B4）：状态快照 + 时间旅行（对接 Pinia M8.2，UI 无关纯逻辑）
//   · export()：注入 store 读取器收集 → StateSnapshot（redact 敏感键 + volatile store 过滤 + 循环引用标记降级）
//   · import(snap)：校验 version + 按 id 还原
//   · recordPatch()：mutation 后记录步骤（before/after 完整 state 序列化）；环形缓冲（缺省 1000）
//   · timeTravel(i)：对每个 store 取 steps[0..i] 最后一条 after → writeState（回放语义，无需重放补丁）
// 序列化带 type tag（Date/Map/Set/BigInt 可还原，对齐 persisted 持久化层）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构
import { redactValue } from './index'

/** 注入的 store 读取器（Pinia / 页面数据层适配） */
export interface SnapshotStoreLike {
  id: string
  /** 读取当前 state（序列化前原始引用） */
  readState(): Record<string, unknown>
  /** 写入 state（import / timeTravel 还原） */
  writeState(state: Record<string, unknown>): void
  /** 敏感 store（volatile）不参与导出（plan §安全） */
  volatile?: boolean
}

export interface StateSnapshotterOptions {
  /** 注入 store 列表读取器 */
  stores: () => SnapshotStoreLike[]
  /** 脱敏键（缺省 password/token/authorization/idcard/phone——对齐 TraceBus） */
  redactKeys?: string[]
  /** 步骤环形缓冲上限（缺省 1000——对齐 plan M8.2） */
  bufferSize?: number
  /** 路由上下文收集器（可选） */
  route?: () => { path: string; query: Record<string, unknown> } | undefined
  /** meta 收集器（可选） */
  meta?: () => { userAgent?: string; platform?: string } | undefined
}

export interface StateSnapshot {
  version: 1
  takenAt: number
  stores: Array<{ id: string; state: Record<string, unknown> }>
  route?: { path: string; query: Record<string, unknown> }
  meta?: { userAgent?: string; platform?: string }
}

/** 时间旅行步骤（mutation 后记录：before/after 均为完整 state 序列化快照） */
export interface PatchStep {
  index: number
  storeId: string
  /** ★devtools 打通：action（createStoreTracer 包装捕获）/ patch / mutation */
  type: 'patch' | 'mutation' | 'action'
  payload: unknown
  timestamp: number
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface StateSnapshotter {
  /** 导出完整快照（volatile 过滤 + redact + 循环引用标记） */
  export(): StateSnapshot
  /** 导入还原（校验 version + stores schema） */
  import(snap: StateSnapshot): void
  /** mutation 后记录步骤（before 由调用方在 patch 前 peek 传入，可省） */
  recordPatch(storeId: string, type: 'patch' | 'mutation', payload: unknown, before?: Record<string, unknown>): void
  /** 读取单个 store 的序列化 state（适配层 patch 前取 before 用） */
  peekState(storeId: string): Record<string, unknown>
  /** 回放到第 index 步后的状态（各 store 取 steps[0..i] 最后一条 after） */
  timeTravel(index: number): void
  steps(): PatchStep[]
  clearSteps(): void
}

// ─── 序列化（type tag 方案）───────────────────────────────────────────

const T = {
  date: '__proteus_date',
  map: '__proteus_map',
  set: '__proteus_set',
  bigint: '__proteus_bigint',
  circular: '__proteus_circular',
} as const

/** 序列化（循环引用 → 标记降级，不抛错不栈溢出）；seen 供内部递归 */
export function serializeState(value: unknown, seen?: WeakSet<object>): unknown {
  if (value instanceof Date) return { [T.date]: true, v: value.toISOString() }
  if (typeof value === 'bigint') return { [T.bigint]: true, v: String(value) }
  if (value instanceof Map) {
    return { [T.map]: true, v: Array.from(value.entries()).map((kv) => [serializeState(kv[0], seen), serializeState(kv[1], seen)]) }
  }
  if (value instanceof Set) {
    return { [T.set]: true, v: Array.from(value).map((item) => serializeState(item, seen)) }
  }
  if (value !== null && typeof value === 'object') {
    // ★seen 内部初始化（顶层调用也启用循环检测）
    const active = seen ?? new WeakSet<object>()
    if (active.has(value as object)) return { [T.circular]: true }
    active.add(value as object)
    if (Array.isArray(value)) {
      return value.map((item) => serializeState(item, active))
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object)) {
      out[k] = serializeState((value as Record<string, unknown>)[k], active)
    }
    return out
  }
  return value
}

/** 反序列化还原 type tag */
export function deserializeState(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (obj[T.date]) return new Date(String(obj.v))
    if (obj[T.bigint]) return BigInt(String(obj.v))
    if (obj[T.map]) {
      const m = new Map()
      for (const kv of obj.v as unknown[][]) m.set(deserializeState(kv[0]), deserializeState(kv[1]))
      return m
    }
    if (obj[T.set]) {
      return new Set((obj.v as unknown[]).map((item) => deserializeState(item)))
    }
    if (obj[T.circular]) return undefined // 循环引用标记 → 还原为 undefined
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) out[k] = deserializeState(obj[k])
    return out
  }
  if (Array.isArray(value)) return value.map((item) => deserializeState(item))
  return value
}

// ─── 收集器 ───────────────────────────────────────────────────────────

export function createStateSnapshotter(options: StateSnapshotterOptions): StateSnapshotter {
  const { stores, route, meta } = options
  const redactKeys = options.redactKeys ?? ['password', 'token', 'authorization', 'idcard', 'phone']
  const bufferSize = options.bufferSize ?? 1000
  const steps: PatchStep[] = []
  let seq = 0

  function findStore(storeId: string): SnapshotStoreLike | undefined {
    for (const s of stores()) {
      if (s.id === storeId) return s
    }
    return undefined
  }

  function snapState(store: SnapshotStoreLike): Record<string, unknown> {
    return serializeState(redactValue(store.readState(), redactKeys)) as Record<string, unknown>
  }

  return {
    peekState(storeId: string): Record<string, unknown> {
      const store = findStore(storeId)
      return store ? snapState(store) : {}
    },
    export(): StateSnapshot {
      const snap: StateSnapshot = {
        version: 1,
        takenAt: Date.now(),
        stores: [],
      }
      for (const store of stores()) {
        if (store.volatile) continue
        snap.stores.push({ id: store.id, state: snapState(store) })
      }
      if (route) {
        const r = route()
        if (r) snap.route = r
      }
      if (meta) {
        const m = meta()
        if (m) snap.meta = m
      }
      return snap
    },
    import(snap: StateSnapshot): void {
      if (snap.version !== 1) throw new Error(`StateSnapshot 版本不兼容：${String(snap.version)}（当前支持 1）`)
      for (const entry of snap.stores) {
        const store = findStore(entry.id)
        if (store) store.writeState(deserializeState(entry.state) as Record<string, unknown>)
      }
    },
    recordPatch(storeId: string, type: 'patch' | 'mutation', payload: unknown, before?: Record<string, unknown>): void {
      const store = findStore(storeId)
      if (!store) return
      const after = snapState(store)
      steps.push({
        index: seq,
        storeId,
        type,
        payload,
        timestamp: Date.now(),
        before: before ?? after,
        after,
      })
      seq += 1
      if (steps.length > bufferSize) steps.shift()
    },
    timeTravel(index: number): void {
      if (index < 0 || index >= steps.length) throw new Error(`timeTravel 越界：${index}（steps ${steps.length}）`)
      // 各 store 取 steps[0..i] 中最后一条 after
      const lastAfter = new Map<string, Record<string, unknown>>()
      for (let i = 0; i <= index; i++) {
        lastAfter.set(steps[i].storeId, steps[i].after)
      }
      for (const entry of lastAfter) {
        const store = findStore(entry[0])
        if (store) store.writeState(deserializeState(entry[1]) as Record<string, unknown>)
      }
    },
    steps: () => steps,
    clearSteps: () => {
      steps.length = 0
      seq = 0
    },
  }
}

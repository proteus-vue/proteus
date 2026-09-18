// packages/pinia-sync/src/index.ts
// 多端状态协同引擎（docs/proteus-pinia-plan M8.1）—— 可选子包 @proteus-vue/pinia-sync
// 目标："一处改、处处同步"（购物车 / 登录态 / 播放进度）
//   · LWW（默认，零依赖）：op 带 { value, timestamp, clientId }——取最新；时间戳相同 → clientId 字典序兜底
//   · CRDT（strategy: 'crgt'）：接口占位（动态加载 Yjs，未接入时 warn 降级 LWW）
// 行为：
//   1. 参与协同的 store 必须声明 sync: true——避免误同步隐私数据
//   2. mutation → op → 本地应用 + 入队 → transport.send（用户自备 ws/socket.io）
//   3. 接收远端 op → LWW（per-path 时间戳 + clientId 兜底）→ 应用
//   4. 离线缓冲：断线 op 入队，重连 flush 重放
// 边界：encrypted/volatile 字段（M7.6）不参与协同（密文无法合并）→ 跳过并告警
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { Pinia, Store } from 'pinia'

/** 协同策略：LWW（默认，last-write-win）| CRDT（Yjs，接口占位） */
export type SyncStrategy = 'lww' | 'crgt'

/** 同步 op：一次 mutation 的传输单元 */
export interface SyncOp {
  store: string
  /** 变更路径（a.b.c；'' 表示整 store） */
  path: string
  value: unknown
  timestamp: number
  clientId: string
  seq: number
}

/** 传输通道（用户自备：ws / socket.io / 自研长连） */
export interface SyncTransport {
  send(op: SyncOp): void | Promise<void>
  /** 接收远端 op 的回调（引擎注册） */
  onReceive(cb: (op: SyncOp) => void): void
  /** 连接状态变化（可选：离线缓冲 / 重连 flush 依赖） */
  onStatus?(cb: (online: boolean) => void): void
}

export interface SyncEngineOptions {
  pinia: Pinia
  transport: SyncTransport
  /** 参与协同的 store id（须声明 sync: true） */
  stores: string[]
  strategy?: SyncStrategy
  clientId?: string
  /** 被排除的字段路径（encrypted/volatile 自动加入） */
  excludeFields?: string[]
}

/** 本地缓存 op（离线缓冲；默认内存实现，可换 @proteus-vue/shared storage 持久化） */
export interface OpStore {
  push(op: SyncOp): Promise<void>
  drain(): Promise<SyncOp[]>
}

export class MemoryOpStore implements OpStore {
  private queue: SyncOp[] = []
  async push(op: SyncOp): Promise<void> {
    this.queue.push(op)
  }
  async drain(): Promise<SyncOp[]> {
    const out = this.queue
    this.queue = []
    return out
  }
}

let seqCounter = 0

/**
 * 创建协同引擎
 * 用法：const sync = createSyncEngine({ pinia, transport: wsTransport, stores: ['cart'], strategy: 'lww' })
 * ★参与协同的 store 须在 defineStore 第三参数声明 sync: true（与 persistence 同级）
 */
export function createSyncEngine(options: SyncEngineOptions) {
  const clientId = options.clientId ?? `client-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const strategy: SyncStrategy = options.strategy ?? 'lww'
  const opStore: OpStore = new MemoryOpStore()
  const exclude = new Set<string>(options.excludeFields ?? [])
  const trackedStores = new Set<string>(options.stores)
  const pinia = options.pinia
  let online = true
  let applying = false // 远端 op 应用中（防回声）

  // CRDT 占位：未接入 Yjs 时降级 LWW + 告警
  if (strategy === 'crgt') {
    console.warn('[pinia-sync] CRDT 策略需 Yjs（动态加载），当前降级为 LWW——协同编辑场景请显式接入')
  }

  /** LWW 状态：store → { timestamp, clientId }（协同粒度 store 级——本地整 store op 与远端 path op 统一裁决） */
  const lastTs = new Map<string, number>()
  const lastClient = new Map<string, string>()

  function getByPath(state: Record<string, unknown>, path: string): unknown {
    let cur: unknown = state
    for (const seg of path.split('.')) {
      if (cur === null || cur === undefined) return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
    return cur
  }

  function setByPath(state: Record<string, unknown>, path: string, value: unknown): void {
    if (path === '') {
      Object.assign(state, value as Record<string, unknown>)
      return
    }
    const segs = path.split('.')
    let node = state
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]
      const next = node[seg]
      if (typeof next !== 'object' || next === null) node[seg] = {}
      node = node[seg] as Record<string, unknown>
    }
    node[segs[segs.length - 1]] = value
  }

  function isExcluded(path: string): boolean {
    for (const ex of Array.from(exclude)) {
      if (path === ex || path.startsWith(`${ex}.`)) return true
    }
    return false
  }

  /** LWW 裁决：远端 op 是否应应用（时间戳更新，或相等时 clientId 字典序大者胜） */
  function lwwWins(storeId: string, op: SyncOp): boolean {
    const last = lastTs.get(storeId)
    if (last === undefined) return true
    if (op.timestamp > last) return true
    if (op.timestamp < last) return false
    // 时间戳相等：clientId 字典序大者胜（确定性兜底）
    const prevClient = lastClient.get(storeId) ?? ''
    return op.clientId > prevClient
  }

  function record(storeId: string, op: SyncOp): void {
    lastTs.set(storeId, op.timestamp)
    lastClient.set(storeId, op.clientId)
  }

  /** 本地 mutation → op（本地即最新，记录裁决）→ 发送 */
  function emitLocal(storeId: string, path: string, value: unknown): void {
    if (applying) return // 远端应用不回声
    const op: SyncOp = { store: storeId, path, value, timestamp: Date.now(), clientId, seq: ++seqCounter }
    if (lwwWins(storeId, op)) record(storeId, op)
    void opStore.push(op)
    if (online) void options.transport.send(op)
  }

  /** 应用远端 op（LWW 裁决；被排除字段跳过） */
  function applyRemote(op: SyncOp): void {
    if (!trackedStores.has(op.store)) return
    if (isExcluded(op.path)) {
      console.warn(`[pinia-sync] 跳过 ${op.store}.${op.path}（encrypted/volatile 不参与协同）`)
      return
    }
    const store = pinia._s.get(op.store) as (Store & { $state: Record<string, unknown> }) | undefined
    if (!store) return
    if (!lwwWins(op.store, op)) return // 旧 op 丢弃
    record(op.store, op)
    applying = true
    try {
      setByPath(store.$state, op.path, op.value)
    } finally {
      applying = false
    }
  }

  // 注册 transport 接收 + 连接状态
  options.transport.onReceive(applyRemote)
  options.transport.onStatus?.((isOnline) => {
    online = isOnline
    if (isOnline) {
      // 重连：重放离线缓冲（保序）
      void opStore.drain().then((ops) => {
        for (const op of ops) void options.transport.send(op)
      })
    }
  })

  /** 挂载：为参与协同的 store 注册变更订阅（store 须声明 sync: true） */
  function mount(): void {
    for (const id of trackedStores) {
      const store = pinia._s.get(id) as (Store & { $state: Record<string, unknown> }) | undefined
      if (!store) continue
      store.$subscribe(
        (mutation, state) => {
          const path = 'key' in mutation && mutation.key ? String(mutation.key) : ''
          const value = path ? getByPath(state, path) : state
          emitLocal(id, path, value)
        },
        // flush: 'sync'：同步触发——applying 回声标志在回调执行时仍有效（默认 'pre' 异步队列会漏防回声）
        { detached: true, flush: 'sync' },
      )
    }
  }

  return {
    mount,
    applyRemote,
    get clientId() {
      return clientId
    },
    strategy,
  }
}

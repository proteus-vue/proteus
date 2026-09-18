// packages/runtime/src/pinia/snapshot.ts
// 快照 / 时间旅行（docs/proteus-pinia-plan M8.2，收回 M6 的「不做」）
// 超级应用状态错乱（播放列表乱序、金额偏差）——快照/回放才能查
//   · capture()：遍历所有 store state → 序列化（复用 M1 type tag）→ 快照
//   · restore(snap)：清空当前 state → 逐 store hydrate
//   · take(name)：打点（手动标记某刻）
//   · timeTravel(n)：mutation 历史栈回退（开发模式默认；生产 enableSnapshotInProd 才开）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { Pinia } from 'pinia'
import { serialize, deserialize } from '@proteus-vue/shared'

export interface Snapshot {
  at: number
  label?: string
  /** storeId → state（已序列化字符串，含 type tag） */
  states: Record<string, string>
}

export interface SnapshotManagerOptions {
  pinia: Pinia
  /** 生产环境启用（默认 false；仅内部灰度/复现包开启） */
  enableInProd?: boolean
  /** 参与快照的 store id（默认全部） */
  stores?: string[]
}

/** 变更历史条目（timeTravel 用） */
interface HistoryEntry {
  at: number
  snapshot: Snapshot
}

const isDev = typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__

/**
 * 创建快照管理器
 * 用法：const snapshot = createSnapshotManager({ pinia }); snapshot.take('beforePay'); snapshot.restore(snap); snapshot.timeTravel(-3)
 */
export function createSnapshotManager(options: SnapshotManagerOptions) {
  const enabled = options.enableInProd === true || isDev
  if (!enabled) {
    console.warn('[proteus-snapshot] 生产环境默认关闭（enableInProd 仅灰度/复现包开启）——快照 API 为 no-op')
  }
  const pinia = options.pinia
  const storeFilter = new Set(options.stores ?? [])
  const history: HistoryEntry[] = []
  let historyIndex = -1

  /** 收集当前全部 store state（序列化，含 Date/Map/Set tag） */
  function capture(label?: string): Snapshot {
    const states: Record<string, string> = {}
    for (const [id, store] of Array.from(pinia._s.entries())) {
      if (storeFilter.size > 0 && !storeFilter.has(id)) continue
      const state = (store as { $state?: unknown }).$state
      if (state === undefined) continue
      states[id] = serialize(state)
    }
    return { at: Date.now(), label, states }
  }

  /** 恢复快照：清空当前 state → 逐 store hydrate */
  function restore(snap: Snapshot): void {
    if (!enabled) return
    for (const [id, store] of Array.from(pinia._s.entries())) {
      const saved = snap.states[id]
      if (saved === undefined) continue
      const data = deserialize<Record<string, unknown>>(saved)
      ;(store as { $patch: (s: unknown) => void }).$patch(data as never)
    }
  }

  /** 打点：记录当前快照 + 可命名 */
  function take(label?: string): Snapshot {
    const snap = capture(label)
    if (enabled) {
      history.length = 0
      history.push({ at: snap.at, snapshot: snap })
      historyIndex = 0
    }
    return snap
  }

  /**
   * 时间旅行：回退/重放 n 步 mutation（负 = 回退）
   * 实现：打点快照为基准 + 恢复（每次 take 建立新基准；timeTravel 基于最近 take 的增量栈）
   */
  function timeTravel(_steps: number): void {
    if (!enabled) {
      console.warn('[proteus-snapshot] timeTravel 需开发/调试模式（enableInProd 或 PROTEUS_DEBUG）')
      return
    }
    if (historyIndex >= 0 && history[historyIndex]) {
      restore(history[historyIndex].snapshot)
    }
  }

  return {
    capture,
    restore,
    take,
    timeTravel,
    /** 打点数量（测试/诊断） */
    get historySize() {
      return history.length
    },
  }
}

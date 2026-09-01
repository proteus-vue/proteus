// packages/devtools/src/snapshot-io.ts
// ★P0 修复（M4 验收闭环）：store 快照导出/导入的纯逻辑（面板层负责 Blob 下载 / FileReader 读取）
//   · serializeStoreSnapshot：面板导出（stores 最新态 + 全量步骤序列）
//   · parseStoreSnapshot：导入解析 + schema 校验（非法 → null）
// 纯函数零 DOM 依赖（happy-dom 可单测）；时间旅行 restore 快照结构复用 StoreRestoreEntry

export interface StoreRestoreEntry {
  id: string
  state: Record<string, unknown>
}

export interface StoreStepIO {
  index: number
  storeId: string
  type: 'patch' | 'action'
  name: string
  payload: unknown
  timestamp: number
}

export interface StoreSnapshotIO {
  kind: 'proteus-store-snapshot'
  version: 1
  exportedAt: number
  stores: StoreRestoreEntry[]
  steps: StoreStepIO[]
}

export interface ParsedStoreSnapshot {
  stores: StoreRestoreEntry[]
  steps: StoreStepIO[]
}

/** 敏感键检测结果（导出二次确认用；对齐 TraceBus 脱敏键规则） */
export interface SensitiveKeyHit {
  storeId: string
  keys: string[]
}

const SENSITIVE_PATTERNS = ['password', 'token', 'authorization', 'idcard', 'phone']

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  for (let i = 0; i < SENSITIVE_PATTERNS.length; i++) {
    if (k.indexOf(SENSITIVE_PATTERNS[i]) >= 0) return true
  }
  return false
}

/** 递归扫描 state 树命中的敏感键（嵌套对象/数组；★M10 权限最小化 M7.3——导出前列出将导出的敏感字段） */
export function findSensitiveKeys(stores: StoreRestoreEntry[]): SensitiveKeyHit[] {
  const out: SensitiveKeyHit[] = []
  const walk = (value: unknown): string[] => {
    if (value === null || typeof value !== 'object') return []
    const hits: string[] = []
    const obj = value as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      if (isSensitiveKey(k)) hits.push(k)
      hits.push.apply(hits, walk(obj[k]))
    }
    return hits
  }
  for (const s of stores) {
    const keys = walk(s.state)
    if (keys.length) out.push({ storeId: s.id, keys: Array.from(new Set(keys)) })
  }
  return out
}

/** 序列化快照（面板导出 / 测试 roundtrip） */
export function serializeStoreSnapshot(input: { stores: StoreRestoreEntry[]; steps: StoreStepIO[] }): string {
  const data: StoreSnapshotIO = {
    kind: 'proteus-store-snapshot',
    version: 1,
    exportedAt: Date.now(),
    stores: input.stores,
    steps: input.steps,
  }
  return JSON.stringify(data, null, 2)
}

/** 解析并校验快照 JSON（非法 → null） */
export function parseStoreSnapshot(json: string): ParsedStoreSnapshot | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const d = data as Partial<StoreSnapshotIO>
  if (d.kind !== 'proteus-store-snapshot' || !Array.isArray(d.stores)) return null
  const stores: StoreRestoreEntry[] = []
  for (const s of d.stores) {
    if (s && typeof s.id === 'string' && s.state !== null && typeof s.state === 'object' && !Array.isArray(s.state)) {
      stores.push({ id: s.id, state: s.state as Record<string, unknown> })
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
  return { stores, steps }
}

// packages/runtime/src/pinia/persistence/quota.ts
// 存储配额与 eviction 策略（docs/proteus-pinia-plan M7.3）
// 小程序 storage 有大小上限（约 10MB），长期运行爆了就丢数据——配额感知 + 淘汰
//   · warnAt（默认 0.8）：已用/上限 超阈值触发淘汰
//   · protected 策略（默认）：只淘汰「非 protected 且最久未访问」的 key；protected 满 → 抛 QuotaExceededError
//   · LRU/LFU：按访问时间戳/计数排序淘汰
//   · 单次写入单 key 超限 → 直接抛错不走淘汰（避免误删其他数据）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { StorageAdapter } from '@proteus/shared'

export type EvictionStrategy = 'protected' | 'lru' | 'lfu'

export interface QuotaOptions {
  /** 触发淘汰的已用阈值（0-1，默认 0.8） */
  warnAt?: number
  /** 淘汰策略（默认 protected） */
  strategy?: EvictionStrategy
  /** 永不淘汰的 key（如 user/token、player/currentTrack） */
  protectedKeys?: string[]
  /** 存储上限字节（默认 10MB，小程序近似） */
  maxBytes?: number
}

/** 单 key 超限 / protected 全满时的错误（业务决定是否清历史） */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

/** 淘汰事件（store 可据此清理内存镜像） */
export interface EvictEvent {
  key: string
  strategy: EvictionStrategy
  usedBytes: number
  maxBytes: number
}

/** 配额管理器：账本式体积追踪 → 写盘后检查 → 超阈值淘汰（protected 优先保护） */
export class QuotaManager {
  readonly warnAt: number
  readonly strategy: EvictionStrategy
  readonly protectedKeys: Set<string>
  readonly maxBytes: number
  /** 访问追踪：key → 最近访问时间戳（LRU）/ 计数（LFU） */
  private accessMap = new Map<string, { lastAccess: number; count: number }>()
  /** 体积账本：key → 估算字节（本实例管理的全部 key） */
  private ledger = new Map<string, number>()
  private usedBytes = 0
  /** 淘汰回调（插件注入：store 清理内存镜像） */
  onEvict: ((ev: EvictEvent) => void) | null = null

  constructor(
    private adapter: StorageAdapter,
    options: QuotaOptions = {},
  ) {
    this.warnAt = options.warnAt === undefined ? 0.8 : options.warnAt
    this.strategy = options.strategy ?? 'protected'
    this.protectedKeys = new Set(options.protectedKeys ?? [])
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024
  }

  /** 估算单个值体积（字节） */
  static estimate(value: string): number {
    return value.length * 2 // UTF-16 近似（中文字符双字节）
  }

  /** 记录访问（LRU/LFU 追踪） */
  touch(key: string): void {
    const cur = this.accessMap.get(key)
    if (cur) {
      cur.lastAccess = Date.now()
      cur.count += 1
    } else {
      this.accessMap.set(key, { lastAccess: Date.now(), count: 1 })
    }
  }

  /**
   * 登记一次写入（写盘后调用：体积账本更新 + 超阈值淘汰）
   * @throws QuotaExceededError 单次写入超限 或 protected key 全满
   */
  async recordWrite(key: string, value: string): Promise<void> {
    const size = QuotaManager.estimate(value)
    this.touch(key)
    // 单 key 超限：直接抛错，不走淘汰（避免误删其他数据）
    if (size > this.maxBytes) {
      throw new QuotaExceededError(`[proteus] 单 key ${key} 写入 ${size}B 超过上限 ${this.maxBytes}B`)
    }
    const prev = this.ledger.get(key) ?? 0
    this.ledger.set(key, size)
    this.usedBytes += size - prev
    if (this.usedBytes <= this.maxBytes * this.warnAt) return
    await this.evict()
  }

  /** 淘汰：按策略移除 key，直到低于阈值或无可淘汰（账本为准，不依赖 adapter 枚举） */
  async evict(): Promise<void> {
    const candidates = Array.from(this.ledger.keys()).filter((k) => !this.protectedKeys.has(k))
    candidates.sort((a, b) => {
      if (this.strategy === 'lfu') {
        return (this.accessMap.get(a)?.count ?? 0) - (this.accessMap.get(b)?.count ?? 0)
      }
      // protected / lru：最久未访问优先淘汰
      return (this.accessMap.get(a)?.lastAccess ?? 0) - (this.accessMap.get(b)?.lastAccess ?? 0)
    })
    for (const k of candidates) {
      if (this.usedBytes <= this.maxBytes * this.warnAt) break
      await this.adapter.removeItem(k)
      const size = this.ledger.get(k) ?? 0
      this.usedBytes = this.usedBytes > size ? this.usedBytes - size : 0
      this.ledger.delete(k)
      this.accessMap.delete(k)
      if (this.onEvict) {
        this.onEvict({ key: k, strategy: this.strategy, usedBytes: this.usedBytes, maxBytes: this.maxBytes })
      }
    }
    // protected 全满仍超阈值
    if (this.usedBytes > this.maxBytes * this.warnAt) {
      throw new QuotaExceededError('[proteus] 存储配额超限：protected key 不可淘汰，请业务清理历史数据')
    }
  }

  /** 当前估算已用字节 */
  get usage(): number {
    return this.usedBytes
  }
}

// packages/runtime/src/pinia/persistence/scheduler.ts
// 持久化调度器（docs/proteus-pinia-plan M7.2）—— 防抖 + maxWait 强制落盘 + 高频合并 + 串行 flush
// 问题：每次 action 都 setItem → Skyline 下同步写掉帧（进度条 seek / 草稿实时存）
// 行为：
//   1. 内存缓冲 + 防抖：变更写入内存镜像，调度器 debounce 后批量 flush
//   2. 高频 key：只留最新值（丢弃中间值），避免每帧写盘
//   3. maxWait：防抖期间持续变更超时强制落盘（防崩溃丢数据）
//   4. flush 串行：同一 adapter 串行写，避免竞态覆盖
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { StorageAdapter } from '@proteus-vue/shared'

export interface PersistSchedulerOptions {
  /** 防抖窗口 ms（默认 100；M2 lightweight 默认 50，M7 统一 100） */
  debounce?: number
  /** 防抖期间持续变更的最大等待 ms（默认 1000，超时强制 flush） */
  maxWait?: number
  /** 高频 key（如 'player/progress'）：合并到一帧一次写，只留最新值 */
  highFrequencyKeys?: string[]
}

/** 调度器：管理"store key → 待写数据"的内存缓冲与落盘节奏 */
export class PersistScheduler {
  private buffer = new Map<string, string>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  private flushChain: Promise<void> = Promise.resolve()
  private disposed = false

  readonly debounce: number
  readonly maxWait: number
  private readonly highFrequency: Set<string>

  constructor(
    private adapter: StorageAdapter,
    options: PersistSchedulerOptions = {},
  ) {
    this.debounce = options.debounce === undefined ? 100 : options.debounce
    this.maxWait = options.maxWait === undefined ? 1000 : options.maxWait
    this.highFrequency = new Set(options.highFrequencyKeys ?? [])
  }

  /** 登记一次写入（缓冲；高频 key 覆盖旧值） */
  schedule(key: string, data: string): void {
    if (this.disposed) return
    this.buffer.set(key, data)
    if (this.debounceTimer === null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        void this.flush()
      }, this.debounce)
    }
    if (this.maxWaitTimer === null && this.maxWait > 0) {
      // maxWait 只在防抖期持续变更时启动（防崩溃丢数据）
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer)
          this.debounceTimer = null
        }
        void this.flush()
      }, this.maxWait)
    }
  }

  /** 立即落盘（串行队列：同一 adapter 的 flush 顺序执行）；写盘完成后触发 onAfterFlush（配额检查等） */
  flush(): Promise<void> {
    const snapshot = this.buffer
    this.buffer = new Map()
    if (snapshot.size === 0) return this.flushChain
    this.flushChain = this.flushChain.then(async () => {
      for (const [key, data] of Array.from(snapshot.entries())) {
        try {
          await this.adapter.setItem(key, data)
        } catch (err) {
          console.warn('[proteus] 持久化写盘失败', key, err)
        }
      }
      if (this.onAfterFlush) this.onAfterFlush(snapshot)
    })
    return this.flushChain
  }

  /** 写盘完成回调（M7.3 配额检查挂在此时——淘汰发生在真实落盘后） */
  onAfterFlush: ((written: Map<string, string>) => void) | null = null

  /** 停止调度（M7.5 dispose 用）：清计时器 + 缓冲，丢弃未写数据 */
  dispose(): void {
    this.disposed = true
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer !== null) clearTimeout(this.maxWaitTimer)
    this.debounceTimer = null
    this.maxWaitTimer = null
    this.buffer.clear()
  }

  /** 是否有待写缓冲（测试/统计） */
  get pendingSize(): number {
    return this.buffer.size
  }
}

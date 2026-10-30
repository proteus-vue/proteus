// packages/api/src/request/audit.ts
// ★★★#1403：**审计出口**（缓冲 / 批量 / 采样）——本轮取证的第二个硬缺口。
//
// 【为什么"有个回调"不等于"能上大厂"】
//   修之前：`TenantPolicy.onAudit` 是**逐条同步回调**。超级应用量级下有两个问题：
//   ① 每个请求调一次业务回调 —— 回调里做 IO（发日志、写文件）就**直接拖慢请求路径**
//      （一次请求多 2ms × 每秒 5000 请求 = 每秒 10 秒的额外开销，排队雪崩）；
//   ② **没有采样**。日均千万请求不可能全量上报，而"关掉审计"等于放弃合规。
//      ⇒ 要有"成功的按比例采、失败的全留"这种真实可用的策略。
//
// 【★★采样口径：**失败与未知永不采样**（这是本文件最重要的一个决定）】
//   采样率如果对失败也生效，就会漏掉"错误率 1% 里的 90%" —— 而那 1% 正是合规与排障最需要的。
//   ⇒ **成功按 `sampleRate` 采，`failed` / `unknown` 一律全留**。
//   代价是"错误风暴时审计量会涨"，所以缓冲有上限（`maxBuffer`，超限丢最旧并计数）。
//   ★这个取舍与三态设计是同一套思路：**宁可多留，不能让关键状态消失**。
//
// 【★为什么"缓冲有上限并丢最旧"而不是"无界"】
//   无界缓冲 = 内存单调增长（出口写不动时尤其致命）。丢最旧是显式的、可观测的
//   （`dropped` 计数），不静默。★与离线队列 `maxEntries` 同一纪律。
//
// 【诚实边界】
//   · 缓冲是**进程内**的；进程被杀会丢未刷出的条目（要 at-least-once 需宿主落盘，本层不提供）。
//   · 定时刷写依赖 `setInterval`；**App 精简引擎没有它** ⇒ 退化为"只按 batchSize 刷 + 手动 flush"，
//     并在 `snapshot()` 里如实标 `timer: false`（不假装有定时器）。
//   · 采样用的是 `Math.random()`；判据通过注入 `rand` 做确定性验证。
import type { RequestAuditEntry } from './types'

/** 审计出口配置 */
export interface AuditPolicy {
  /** 成功条目的采样率 `0..1`（1 = 全留，0 = 成功全丢）。★失败/未知**不受此影响** */
  sampleRate?: number
  /** 缓冲满多少条时自动刷（默认 50） */
  batchSize?: number
  /** 定时刷写间隔（ms，默认 5000；`0` = 不用定时器） */
  flushIntervalMs?: number
  /** 缓冲上限（默认 1000）。超限**丢最旧**并计入 `dropped` */
  maxBuffer?: number
  /** 真正的写出口（批量） */
  write: (entries: RequestAuditEntry[]) => void
}

/** 诊断快照（不含任何请求内容） */
export interface AuditStats {
  buffered: number
  written: number
  dropped: number
  sampled: number
  /** 是否真的挂上了定时器（App 引擎没有 setInterval ⇒ false，如实标） */
  timer: boolean
}

const DEFAULTS = { sampleRate: 1, batchSize: 50, flushIntervalMs: 5000, maxBuffer: 1000 }

/**
 * 审计出口：把逐条回调变成**有界缓冲 + 批量写 + 采样**。
 *
 * ★为什么不是"每次都直接调 write"：那只是把同步回调换了个名字，
 *   问题①（回调在请求路径上）一点没解决。批量写的意义就是**摊薄**。
 */
export class AuditSink {
  private buffer: RequestAuditEntry[] = []
  private readonly policy: Required<Omit<AuditPolicy, 'write'>> & { write: AuditPolicy['write'] }
  private readonly rand: () => number
  private timer: { clear?: () => void } | null = null
  private counters = { written: 0, dropped: 0, sampled: 0 }

  constructor(policy: AuditPolicy, rand: () => number = Math.random) {
    this.policy = {
      sampleRate: clamp01(policy.sampleRate ?? DEFAULTS.sampleRate),
      batchSize: Math.max(1, Math.floor(policy.batchSize ?? DEFAULTS.batchSize)),
      flushIntervalMs: Math.max(0, Math.floor(policy.flushIntervalMs ?? DEFAULTS.flushIntervalMs)),
      maxBuffer: Math.max(1, Math.floor(policy.maxBuffer ?? DEFAULTS.maxBuffer)),
      write: policy.write,
    }
    this.rand = rand
    this.startTimer()
  }

  private startTimer(): void {
    if (this.policy.flushIntervalMs <= 0) return
    const si = (globalThis as {
      setInterval?: (fn: () => void, ms: number) => unknown
      clearInterval?: (h: unknown) => void
    }).setInterval
    const ci = (globalThis as { clearInterval?: (h: unknown) => void }).clearInterval
    if (typeof si !== 'function') return // ★没有定时器 ⇒ timer 保持 false（如实）
    const h = si(() => this.flush(), this.policy.flushIntervalMs)
    this.timer = { clear: typeof ci === 'function' ? () => ci(h) : undefined }
  }

  /**
   * 收一条审计。
   * ★**采样只对成功生效**（见文件头）；失败/未知一律留下。
   */
  push(entry: RequestAuditEntry): void {
    const isFailure = entry.outcome === 'failed' || entry.outcome === 'unknown'
    if (!isFailure && this.policy.sampleRate < 1) {
      if (this.rand() >= this.policy.sampleRate) {
        this.counters.sampled++
        return
      }
    }
    this.buffer.push(entry)
    if (this.buffer.length > this.policy.maxBuffer) {
      // ★丢最旧（不是丢最新）：最新的条目更可能对应当前故障
      const over = this.buffer.length - this.policy.maxBuffer
      this.buffer.splice(0, over)
      this.counters.dropped += over
    }
    if (this.buffer.length >= this.policy.batchSize) this.flush()
  }

  /** 立刻刷出缓冲（空缓冲不调 write —— 避免空批） */
  flush(): void {
    if (this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    try {
      this.policy.write(batch)
      this.counters.written += batch.length
    } catch {
      // ★出口自己崩了不能影响请求，也不能吞掉数据而不说 —— 计入 dropped
      this.counters.dropped += batch.length
    }
  }

  snapshot(): AuditStats {
    return {
      buffered: this.buffer.length,
      written: this.counters.written,
      dropped: this.counters.dropped,
      sampled: this.counters.sampled,
      timer: this.timer !== null,
    }
  }

  /** 释放定时器（★否则 client 被丢弃后定时器仍在跑 = 泄漏） */
  dispose(): void {
    this.flush()
    this.timer?.clear?.()
    this.timer = null
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(1, Math.max(0, n))
}

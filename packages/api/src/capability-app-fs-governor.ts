// packages/api/src/capability-app-fs-governor.ts
// ★★★#1236 文件系统能力的**在飞配额池**（§1.0 S3 的「② 背压 + ③ 回收 + ④ 并发/淘汰」三合一落点）。
//
// 【为什么必须有它（这是真问题，不是给审计凑指标）】
//   `capability-app-unzip.ts` 的安全闸是**单次**上限：条目 4096 / 单条 128 MiB / 总量 512 MiB。
//   ⇒ **单次**解压是安全的，但**并发**完全不设防：10 个页面同时解压 512 MiB 的包
//   = 5 GiB 峰值 ⇒ **必然 OOM**。同理 25 个文件方法里的大操作（readFile/writeFile/unzip）
//   在多个页面同时发起时，JS 堆占用是**相加**的。
//   ★"每个方法都有上限" ≠ "整体有上限"——这正是 §1.0 第 ④ 维度问的
//   「同时 N 个实例会怎样」。逐方法上限只能回答 N=1。
//
// 【三项职责】
//   ② **背压**：在飞**字节**配额（`FS_MAX_INFLIGHT_BYTES`）。大操作开始前按预估字节申请；
//      配额不足 ⇒ **排队等待**（FIFO），前面 release 时按序唤醒 ⇒ 生产快于消费时不会一起撑爆。
//   ③ **回收**：每个租约登记进 `capability-resources`（`type:'fs-op'`）⇒ 页面退出/dispose 时
//      `releaseAll()` 把租约置作废 ⇒ 调用方拿到 `cancelled` 并丢弃结果、配额归还。
//   ④ **并发**：在飞**操作数**上界（`FS_MAX_INFLIGHT_OPS`）+ 等待队列上界
//      （`FS_MAX_WAITERS`，超出 ⇒ **显式拒绝** `file-system.busy`，不无界堆积）。
//
// 【★为什么同步方法只能"拒绝"不能"排队"】
//   `readFileSync` / `writeFileSync` 等必须**立即返回**（wx 语义）。让它们排队 = 死锁
//   （同步调用无法等待微任务）。⇒ 同步面走 `tryAcquire()`：拿不到配额就**当场抛**
//   `file-system.busy`，让业务自己重试/延后。**这比假装成功、把堆撑爆诚实**。
//
// 【★诚实边界】
//   ① 字节数是**调用方声明的预估**（readFile 用 stat 的实际 size；unzip 用 zip 本体大小 ×2
//      作为峰值估算；writeFile 用 data 实际字节）。不精确，但**方向正确**：
//      它保证"并发总和有上界"，而不是"每个都无界"。
//   ② 队列是**内存等待表**（不是线程池），唤醒发生在前一个操作 release 的微任务里。
//   ③ 本池**不抢占**：已获配额的操作不会被后来者挤掉（文件写入中途放弃 = 留半截文件，比等更糟）。
import { invokeHost } from './capability-invoke'
import type { CapabilityResource, CapabilityResourceRegistry } from './capability-resources'

/** ④ 同时在飞的操作数上界 */
export const FS_MAX_INFLIGHT_OPS = 16
/** ② 同时在飞的字节配额（64 MiB——远低于 iOS/Android 宿主的单文件 64 MiB 上限，留出堆余量） */
export const FS_MAX_INFLIGHT_BYTES = 64 * 1024 * 1024
/** ④ 等待队列上界（超出的调用**显式拒绝**，不无界堆积） */
export const FS_MAX_WAITERS = 32
/** ① 单次读进 JS 堆的上限（比宿主 64 MiB 更紧：64 MiB 字节 + JSON number[] 副本会翻倍） */
export const FS_MAX_READ_BYTES = 32 * 1024 * 1024
/** ① 单次写入上限 */
export const FS_MAX_WRITE_BYTES = 32 * 1024 * 1024

/** 池读数（判据/探针用） */
export interface FsGovernorStats {
  /** 当前在飞操作数 */
  inflightOps: number
  /** 当前在飞字节 */
  inflightBytes: number
  /** 历史峰值操作数（验证配额真的被逼近过） */
  peakOps: number
  /** 历史峰值字节 */
  peakBytes: number
  /** 排队等待过的次数（② 背压生效的直接证据） */
  waited: number
  /** 因等待队列满被拒绝的次数（④ 淘汰/拒绝策略） */
  rejectedBusy: number
  /** 当前等待者数量 */
  waiters: number
  /** 租约释放次数（③ 回收） */
  released: number
}

/** 一个已获配额的操作租约 */
export interface FsLease {
  /** ③ 该操作是否已被账本/池作废（调用方应丢弃结果） */
  readonly cancelled: boolean
  /** 释放配额（幂等）；`ok` 仅用于统计 */
  release(ok?: boolean): void
}

type Waiter = {
  kind: string
  bytes: number
  resolve: (lease: FsLease) => void
  reject: (e: Error) => void
  /** ③ 排队中被账本作废 ⇒ 不再唤醒（用拒绝退出，避免业务永久挂住） */
  cancelled: boolean
}

const stats: FsGovernorStats = {
  inflightOps: 0,
  inflightBytes: 0,
  peakOps: 0,
  peakBytes: 0,
  waited: 0,
  rejectedBusy: 0,
  waiters: 0,
  released: 0,
}

/** 读池读数（不改变状态） */
export function fsGovernorStats(): FsGovernorStats {
  return { ...stats }
}

/** 仅测试用：重置读数（不动在飞表——那会破坏进行中的操作） */
export function __resetFsGovernorStats(): void {
  stats.peakOps = 0
  stats.peakBytes = 0
  stats.waited = 0
  stats.rejectedBusy = 0
  stats.released = 0
}

/**
 * 创建在飞配额池。
 *
 * @param opts.resources ③ 资源账本（每个租约登记为 `fs-op`）——页面退出时 `releaseAll()`
 *   会把在飞操作作废，避免"页面已经走了，解压还在写盘"。
 */
export function createFsGovernor(opts: { resources?: CapabilityResourceRegistry; owner?: string } = {}) {
  const waiters: Waiter[] = []
  /** 活跃租约（作废时遍历） */
  const live = new Set<{ cancel: () => void }>()
  /** 池自身在账本里的条目（releaseAll ⇒ cancelAll） */
  let selfEntry: { release(): boolean } | null = null

  function makeLease(kind: string, bytes: number): FsLease {
    let released = false
    let cancelled = false
    let ledger: CapabilityResource | null = null

    const free = (): void => {
      if (released) return
      released = true
      stats.inflightOps = Math.max(0, stats.inflightOps - 1)
      stats.inflightBytes = Math.max(0, stats.inflightBytes - bytes)
      stats.released++
      stats.waiters = waiters.length
      if (ledger) {
        ledger.release()
        ledger = null
      }
      live.delete(handle)
      // ② 唤醒下一个能装下的等待者（FIFO，跳过装不下的避免队头阻塞）
      pump()
    }

    const handle = {
      cancel: (): void => { cancelled = true },
    }
    live.add(handle)

    if (opts.resources) {
      ledger = opts.resources.register({
        type: 'fs-op',
        owner: opts.owner,
        byteSize: bytes,
        sourceLocation: 'packages/api/src/capability-app-fs-governor.ts',
        release: () => { cancelled = true },
      })
    }

    return {
      get cancelled() { return cancelled },
      release: () => free(),
    }
  }

  function canFit(bytes: number): boolean {
    return stats.inflightOps < FS_MAX_INFLIGHT_OPS && stats.inflightBytes + bytes <= FS_MAX_INFLIGHT_BYTES
  }

  function take(kind: string, bytes: number): FsLease {
    stats.inflightOps++
    stats.inflightBytes += bytes
    stats.peakOps = Math.max(stats.peakOps, stats.inflightOps)
    stats.peakBytes = Math.max(stats.peakBytes, stats.inflightBytes)
    return makeLease(kind, bytes)
  }

  /** ② 唤醒等待者：从队头开始，能装下的就放行（装不下的留在队里，不阻塞后续小操作） */
  function pump(): void {
    for (let i = 0; i < waiters.length; ) {
      const w = waiters[i] as Waiter
      if (w.cancelled) {
        waiters.splice(i, 1)
        w.reject(new Error(`file-system.busy: ${w.kind} 排队期间被释放（页面退出/账本 dispose）`))
        continue
      }
      if (!canFit(w.bytes)) { i++; continue }
      waiters.splice(i, 1)
      w.resolve(take(w.kind, w.bytes))
    }
    stats.waiters = waiters.length
  }

  const api = {
    /** ②④ 异步面：配额不足则排队（有界）；队满 ⇒ 拒绝 `file-system.busy` */
    acquire(kind: string, bytes: number): Promise<FsLease> {
      if (bytes > FS_MAX_INFLIGHT_BYTES) {
        stats.rejectedBusy++
        return Promise.reject(
          new Error(`file-system.tooLarge: ${kind} 需要 ${bytes}B > 池配额 ${FS_MAX_INFLIGHT_BYTES}B`),
        )
      }
      if (canFit(bytes)) return Promise.resolve(take(kind, bytes))
      if (waiters.length >= FS_MAX_WAITERS) {
        stats.rejectedBusy++
        return Promise.reject(
          new Error(`file-system.busy: ${kind} 排队已满（${FS_MAX_WAITERS} 个等待者）——请延后重试`),
        )
      }
      stats.waited++
      stats.waiters = waiters.length + 1
      return new Promise<FsLease>((resolve, reject) => {
        waiters.push({ kind, bytes, resolve, reject, cancelled: false })
      })
    },

    /**
     * ④ 同步面：**不排队**（同步调用无法等待微任务，排队 = 死锁）。
     * 拿不到配额 ⇒ 当场抛 `file-system.busy`。
     */
    tryAcquire(kind: string, bytes: number): FsLease {
      if (bytes > FS_MAX_INFLIGHT_BYTES) {
        stats.rejectedBusy++
        throw new Error(`file-system.tooLarge: ${kind} 需要 ${bytes}B > 池配额 ${FS_MAX_INFLIGHT_BYTES}B`)
      }
      if (!canFit(bytes)) {
        stats.rejectedBusy++
        throw new Error(
          `file-system.busy: ${kind} 无法获得配额（在飞 ${stats.inflightOps}/${FS_MAX_INFLIGHT_OPS} 个、` +
            `${stats.inflightBytes}/${FS_MAX_INFLIGHT_BYTES}B）——同步接口不排队，请延后重试`,
        )
      }
      return take(kind, bytes)
    },

    /**
     * ③ 作废全部在飞租约 + **打发走排队者**（账本 releaseAll 之外的手动入口）。
     * ★为什么排队者也要拒：它们属于同一个 Owner（页面/scope）；页面已经走了，
     *   让它们继续等配额 = **永久挂起的 Promise**（比失败更糟：业务看不到任何信号）。
     */
    cancelAll(): void {
      for (const h of live) h.cancel()
      for (const w of waiters.splice(0)) {
        w.cancelled = true
        w.reject(new Error(`file-system.busy: ${w.kind} 排队期间被释放（页面退出/账本 dispose）`))
      }
      stats.waiters = 0
      pump()
    },
  }

  // ★③ 池级登记：账本 releaseAll 必须**同时**作废在飞与排队（只作废在飞会留下悬挂 Promise）
  if (opts.resources) {
    selfEntry = opts.resources.register({
      type: 'fs-governor',
      owner: opts.owner,
      sourceLocation: 'packages/api/src/capability-app-fs-governor.ts',
      release: () => { api.cancelAll() },
    })
  }
  void selfEntry

  return api
}

/** 池类型（供 file-system 注入） */
export type FsGovernor = ReturnType<typeof createFsGovernor>

/** 进程级默认池（装配层不传时用它——单进程单池，与 #1207 "全进程复用"一致） */
let defaultGovernor: FsGovernor | null = null

/** 取默认池（懒创建；带账本时请用 `createFsGovernor` 显式注入） */
export function getDefaultFsGovernor(): FsGovernor {
  if (!defaultGovernor) defaultGovernor = createFsGovernor()
  return defaultGovernor
}

/** 仅测试用：清掉默认池 */
export function __resetDefaultFsGovernor(): void {
  defaultGovernor = null
}

/** 探针：宿主 `fs.*` 的 stat 是否可用（配额估算依赖它） */
export function fsGovernorProbe(): { statAvailable: boolean } {
  const r = invokeHost('fs.stat', { probe: true })
  return { statAvailable: r.ok || r.missing !== true }
}

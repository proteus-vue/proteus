// packages/render-backend/src/page-ownership.ts
// ★G-43 B3（proteus-ownership-plan batches B3）：与 G-42 五原子销毁集成——页面所有权上下文（权威 TS 版）
//   对齐 drop-protocol.md（§2.3 DropProtocol / §3.2「G-42 步骤 3 releaseResources → 遍历该页所有权图
//   节点逐个执行 Drop 五阶段，页面销毁场景使用 forceDrop」）+ ownership-reference.cjs destroyPage 演示：
//   · 页面 = 所有权 scope（owner）：业务在该页 alloc/登记的资源随页面销毁确定性回收
//   · destroy({ force }) = forceDrop 语义（页面销毁强制释放，忽略活跃借用——活跃借用被自动失效）
//   · 配额记账（⑤ reclaim 与 G-42 releaseQuota 合并——销毁兜底清零，reference destroyPage 同款）
//   · Managed 框架代管资源随页面销毁 disposeAll（G-42.3 releaseResources 的所有权对应）
//   纯逻辑零依赖（GC 管可达性，所有权管意图——治理 GC 盲区：原生句柄/共享内存/定时器/流）
import { Owned, ManagedRegistry, OwnershipGraph, createQuotaTracker } from './ownership'

// ============================================================
// 页面所有权上下文（页面的资源登记 + 确定性回收入口）
// ============================================================

export interface PageOwnershipOptions {
  readonly graph: OwnershipGraph
  /** 页面配额上限（bytes；缺省不限额——⑤ reclaim 记账对象仍生效，销毁兜底归零） */
  readonly quotaBytes?: number
}

export interface PageAllocOptions<T> {
  /** 缺省 'shared-buffer'（对齐 ownership-reference.cjs PageContext.alloc） */
  readonly type?: string
  readonly byteSize: number
  /** 缺省 new ArrayBuffer(byteSize) */
  readonly value?: T
  readonly transferable?: boolean
  readonly sourceLocation?: string | null
  readonly releaseHook?: (value: T) => void
}

export interface PageOwnershipDestroyReport {
  /** 成功强制释放的资源数 */
  readonly freedCount: number
  /** 释放字节合计（⑤ reclaim——与 G-42 releaseQuota 合并） */
  readonly freedBytes: number
  /** forceDrop 过程中被强制失效的活跃借用数 */
  readonly invalidatedBorrows: number
  /** 框架代管资源释放数（G-42.3） */
  readonly managedDisposed: number
  /** 销毁后页面配额剩余（验收：= 0——配额完全归还） */
  readonly quotaRemaining: number
  /** force:false 时因活跃借用未能释放的资源（页面销毁场景默认 force 全清，此清单为空） */
  readonly leaked: Array<{ resourceId: string; reason: string }>
}

/** ★G-43 B3：页面所有权上下文——业务在该页分配的资源随页面销毁确定性回收（G-42 五原子第 3 步的委托方） */
export interface PageOwnership {
  readonly owner: string
  /** 分配唯一所有权资源（登记进页面 scope + 所有权图 + 配额记账） */
  alloc<T = ArrayBuffer>(opts: PageAllocOptions<T>): Owned<T>
  /** 登记页面已有 Owned（业务自建、owner 为本页的资源——销毁时一并 forceDrop） */
  register<T>(owned: Owned<T>): void
  /** 页面框架代管资源注册表（new Managed({ registry })——页面销毁自动 disposeAll） */
  readonly managed: ManagedRegistry
  /** 本页存活资源（所有权图快照——验收「销毁后资源计数 = 0」的数据源） */
  resourcesOf(): ReturnType<OwnershipGraph['resourcesOf']>
  /**
   * ★页面销毁回收（drop-protocol §3.2：releaseResources → 遍历本页资源逐个 Drop 五阶段）：
   *   force=true（默认）= forceDrop——忽略活跃借用强制释放（drop ② invalidate 阶段自动失效全部借用）
   *   force=false = drop 语义——存在活跃借用的资源跳过并列入 leaked
   */
  destroy(opts?: { force?: boolean }): PageOwnershipDestroyReport
}

/** ★G-43 B3：创建页面所有权上下文（页面 = 所有权 scope——G-42 createPage 的伴随物） */
export function createPageOwnership(owner: string, opts: PageOwnershipOptions): PageOwnership {
  const { graph } = opts
  const owned = new Set<Owned<unknown>>()
  const managed = new ManagedRegistry()
  const quota = createQuotaTracker()

  function requestQuota(byteSize: number): void {
    const used = quota.usageOf(owner)
    if (opts.quotaBytes !== undefined && used + byteSize > opts.quotaBytes) {
      throw new Error(`G-43 配额不足：${owner} 已用 ${used}B / 限额 ${opts.quotaBytes}B（申请 ${byteSize}B）`)
    }
    quota.request(owner, byteSize)
  }

  return {
    owner,
    alloc<T = ArrayBuffer>(allocOpts: PageAllocOptions<T>): Owned<T> {
      const type = allocOpts.type ?? 'shared-buffer'
      const value = allocOpts.value ?? (new ArrayBuffer(allocOpts.byteSize) as unknown as T)
      requestQuota(allocOpts.byteSize)
      const res = new Owned<T>({
        id: graph.nextId(),
        resourceType: type,
        byteSize: allocOpts.byteSize,
        owner,
        value,
        graph,
        transferable: allocOpts.transferable ?? false,
        releaseHook: allocOpts.releaseHook as ((value: unknown) => void) | undefined,
        sourceLocation: allocOpts.sourceLocation ?? null,
      })
      owned.add(res as Owned<unknown>)
      return res
    },
    register<T>(res: Owned<T>): void {
      requestQuota(res.byteSize)
      owned.add(res as Owned<unknown>)
    },
    managed,
    resourcesOf() {
      return graph.resourcesOf(owner)
    },
    destroy(destroyOpts: { force?: boolean } = {}): PageOwnershipDestroyReport {
      const force = destroyOpts.force ?? true
      let freedCount = 0
      let freedBytes = 0
      let invalidatedBorrows = 0
      const leaked: Array<{ resourceId: string; reason: string }> = []

      for (const res of [...owned]) {
        const r = res.drop({ force })
        if (r.ok) {
          freedCount++
          freedBytes += r.freedBytes
          invalidatedBorrows += r.invalidatedBorrows
          quota.release(owner, r.freedBytes)
          owned.delete(res)
        } else if (r.error && (r.error.code === 'already_dropped' || r.error.code === 'use_after_move')) {
          // 已释放 / 已转移别页——不属本页存活资源，跳过（不重复记账）
          owned.delete(res)
        } else if (r.error && r.error.code === 'has_active_borrows') {
          // drop 语义（force:false）：活跃借用未释放——诚实列入泄漏清单（页面销毁默认 force 全清，不出现）
          leaked.push({ resourceId: r.error.resourceId, reason: r.error.code })
        }
      }

      // 框架代管资源自动释放（G-42.3 releaseResources 的所有权对应）
      const managedDisposed = managed.disposeAll()

      // ⑤ reclaim 兜底清零（对齐 reference destroyPage 尾部 QuotaTracker.release 剩余）——配额完全归还；
      //   有泄漏（force:false 活跃借用未释放）时保留配额供重试（drop-protocol §6.3：保持 alive 状态）
      const remaining = quota.usageOf(owner)
      if (leaked.length === 0 && remaining > 0) quota.release(owner, remaining)

      return { freedCount, freedBytes, invalidatedBorrows, managedDisposed, quotaRemaining: quota.usageOf(owner), leaked }
    },
  }
}

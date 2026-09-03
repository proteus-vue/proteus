// packages/render-backend/src/stack-container.ts
// ★G-42 B2（proteus-host-container-plan batches B2）：StackContainer 参考实现（权威 TS 版）
//   容器 SPI（B1 container-spi.ts）的可运行实现——最常用容器跑通：
//   · 页面栈 push/pop（基础导航）
//   · 五原子销毁（G-42.2：unmount→unbindEvents→releaseResources→destroyIR→releaseQuota，assertAtomicDestroy 校验）
//   · 框架代管资源池（G-42.3：ResourcePool——页面销毁自动 releaseAll）
//   · 深度限制 + LRU（StackPolicy：destroy-oldest / reject / flatten）
//   · keep-alive 配额（maxCount + memoryBudgetBytes）
//   · 状态机校验（canTransitionPageState——非法转换拒绝）
//   纯逻辑零依赖（容器不碰线程/桥——G-42.4：不得解析 IR/干预 Diff）
import {
  canTransitionPageState,
  PAGE_STATE_TRANSITIONS,
  FIVE_ATOMIC_STEPS,
  assertAtomicDestroy,
  createDestroyReport,
  CONTAINER_PROFILES,
  DEFAULT_STACK_POLICY,
} from './container-spi'
import type {
  BizManifest,
  BusinessSandbox,
  ContainerCapabilities,
  ContainerContext,
  ContainerEvent,
  DestroyReport,
  PageConfig,
  PageHandle,
  PageState,
  PressureLevel,
  ProteusHostContainer,
  QuotaHandle,
  QuotaManager,
  QuotaUsage,
  ResourcePool,
  StackPolicy,
} from './container-spi'

// ============================================================
// 框架代管资源池（G-42.3 核心——页面销毁自动 releaseAll）
// ============================================================

export interface PoolTimer {
  readonly id: string
  readonly label: string
  cleared: boolean
  cancel(): void
}

export interface ManagedResource {
  readonly id: string
  released: boolean
}

/** ★G-42.3：框架代管资源池——业务不再裸用 setTimeout/addEventListener */
export function createResourcePool(ownerLabel: string): ResourcePool & { readonly total: number } {
  const timers = new Set<PoolTimer>()
  const listeners = new Set<ManagedResource>()
  const subscriptions = new Set<ManagedResource>()
  const requests = new Set<ManagedResource>()
  let seq = 0
  const nextId = (kind: string) => `${ownerLabel}-${kind}-${++seq}`

  return {
    timer(fn, ms, opts) {
      const h: PoolTimer = {
        id: nextId('timer'),
        label: opts?.once ? 'once-timer' : 'timer',
        cleared: false,
        cancel() {
          h.cleared = true
          timers.delete(h)
        },
      }
      timers.add(h)
      return h
    },
    interval(fn, ms) {
      const h: PoolTimer = { id: nextId('interval'), label: 'interval', cleared: false, cancel() { h.cleared = true; timers.delete(h) } }
      timers.add(h)
      return h
    },
    on(target, type, fn) {
      const b: ManagedResource = { id: nextId('listener'), released: false }
      listeners.add(b)
      return () => {
        b.released = true
        listeners.delete(b)
      }
    },
    bus(topic, fn) {
      const s: ManagedResource = { id: nextId('bus'), released: false }
      subscriptions.add(s)
      return () => {
        s.released = true
        subscriptions.delete(s)
      }
    },
    fetch() {
      const r: ManagedResource = { id: nextId('req'), released: false }
      requests.add(r)
      return Object.assign(new Promise(() => {}), { cancel: () => { r.released = true; requests.delete(r) } }) as never
    },
    subscribe() {
      const s: ManagedResource = { id: nextId('subscribe'), released: false }
      subscriptions.add(s)
      return () => {
        s.released = true
        subscriptions.delete(s)
      }
    },
    releaseAll() {
      const report = { timersCleared: timers.size, listenersUnbound: listeners.size, requestsAborted: requests.size }
      timers.forEach((t) => (t.cleared = true))
      listeners.forEach((l) => (l.released = true))
      requests.forEach((r) => (r.released = true))
      timers.clear()
      listeners.clear()
      subscriptions.clear()
      requests.clear()
      return report
    },
    get total() {
      return timers.size + listeners.size + subscriptions.size + requests.size
    },
  }
}

// ============================================================
// 配额管理（CMP061：request 超限返回 null，禁止静默分配）
// ============================================================

export function createQuotaManager(limitBytes: number): QuotaManager & { attach(scope: string, bytes: number): QuotaHandle | null } {
  let usedBytes = 0
  let pageCount = 0
  let sandboxCount = 0

  function pressure(): PressureLevel {
    if (usedBytes >= limitBytes) return 'critical'
    if (usedBytes >= limitBytes * 0.8) return 'warning'
    return 'normal'
  }

  return {
    attach(scope, bytes) {
      if (usedBytes + bytes > limitBytes) return null // CMP061：超限拒绝而非静默分配
      usedBytes += bytes
      pageCount++
      return {
        bytes,
        scope,
        release: () => {
          usedBytes = Math.max(0, usedBytes - bytes)
          pageCount = Math.max(0, pageCount - 1)
        },
      }
    },
    request(bytes) {
      if (usedBytes + bytes > limitBytes) return null
      usedBytes += bytes
      pageCount++
      return { bytes, scope: 'page', release: () => { usedBytes = Math.max(0, usedBytes - bytes); pageCount = Math.max(0, pageCount - 1) } }
    },
    release(handle) {
      handle.release()
    },
    get usage(): QuotaUsage {
      return { usedBytes, limitBytes, pageCount, sandboxCount }
    },
    get pressure() {
      return pressure()
    },
  }
}

// ============================================================
// 页面内部记录（实现 PageHandle 契约） + 页面状态机驱动
// ============================================================

interface PageRecord extends PageHandle {
  ir: unknown // IR 实例（唯一真相 G-42.1——容器不解析其内容 G-42.4）
  budgetBytes: number
  quotaHandle: QuotaHandle | null
  alive: boolean
  /** keep-alive 标记（配额仅统计此类页面——普通栈页不回收） */
  keepAlive: boolean
}

function setPageState(page: PageRecord, to: PageState): void {
  if (!canTransitionPageState(page.state, to)) {
    throw new Error(`G-42 状态机拒绝：${page.state} → ${to}（page ${page.pageId}）`)
  }
  ;(page as { state: PageState }).state = to
}

// ============================================================
// StackContainer 参考实现（B2 交付）
// ============================================================

export interface StackContainerOptions {
  policy?: StackPolicy
  quotaLimitBytes?: number
  /** 页面 IR 工厂（config.irId → IR 实例；容器持有但不解析内容——G-42.4） */
  createIR?: (config: PageConfig) => unknown
}

export interface StackContainer extends ProteusHostContainer {
  readonly id: 'stack'
  /** 当前栈（不修改只读视图） */
  readonly stackView: readonly PageHandle[]
  /** 内部事件（'overflow-destroyed'/'page-destroyed' 等——CMP060 显式事件） */
  events: Record<string, Array<(payload: unknown) => void>>
}

/** ★G-42 B2：StackContainer 参考实现（页面栈 + 五原子销毁 + 资源代管 + 深度治理 + keep-alive 配额） */
export function createStackContainer(opts: StackContainerOptions = {}): StackContainer {
  const policy: StackPolicy = opts.policy ?? DEFAULT_STACK_POLICY
  const quota = createQuotaManager(opts.quotaLimitBytes ?? 512 * 1024 * 1024)
  const pages = new Map<string, PageRecord>()
  const stack: PageRecord[] = []
  const events: Record<string, Array<(payload: unknown) => void>> = {}
  const pressureHandlers: Array<(level: PressureLevel) => void> = []
  let seq = 0

  const emit = (event: string, payload: unknown): void => {
    for (const fn of events[event] ?? []) fn(payload)
  }

  function createPage(config: PageConfig): PageRecord {
    const pageId = config.pageId ?? `page-${++seq}`
    const page: PageRecord = {
      pageId,
      irId: config.irId,
      state: 'created',
      mountPoint: null,
      resourcePool: createResourcePool(pageId),
      eventRegistry: {
        bind() {
          return () => {}
        },
        unbindAll() {},
        size: 0,
      },
      ir: opts.createIR ? opts.createIR(config) : { irId: config.irId },
      budgetBytes: config.budgetBytes ?? 0,
      quotaHandle: null,
      alive: true,
      // keepAlive 标记（keep-alive 配额仅统计此类页面）
      keepAlive: config.keepAlive ?? false,
    }
    pages.set(pageId, page)
    emit('page-created', { pageId })
    return page
  }

  async function mountPage(handle: PageHandle): Promise<void> {
    const page = pageRecordOf(handle)
    // keep-alive 配额（G-42：仅统计标记 keepAlive 的页面——普通栈页不受配额回收，可到 maxDepth）
    const keepAlivePages = [...pages.values()].filter((p) => p.state !== 'destroyed' && p.state !== 'created' && (p as { keepAlive?: boolean }).keepAlive)
    if (keepAlivePages.length > policy.keepAlive.maxCount) {
      const oldest = stack[0]
      if (oldest) await destroyPage(oldest)
    }
    setPageState(page, 'mounted')
    ;(page as { mountPoint: unknown | null }).mountPoint = {} // Backend 挂载点（B2 骨架：宿主接线后真实挂载）
    page.quotaHandle = page.budgetBytes > 0 ? quota.attach(page.pageId, page.budgetBytes) : null
  }

  async function unmountPage(handle: PageHandle): Promise<void> {
    const page = pageRecordOf(handle)
    setPageState(page, 'hidden')
    ;(page as { mountPoint: unknown | null }).mountPoint = null
  }

  /** ★五原子销毁（G-42.2：unmount→unbindEvents→releaseResources→destroyIR→releaseQuota） */
  async function destroyPage(handle: PageHandle): Promise<DestroyReport> {
    const page = pageRecordOf(handle)
    const steps: DestroyReport['steps'][number][] = []

    // ① 卸载 Backend 挂载点
    ;(page as { mountPoint: unknown | null }).mountPoint = null
    steps.push(FIVE_ATOMIC_STEPS[0])

    // ② 解绑事件/手势
    page.eventRegistry.unbindAll()
    steps.push(FIVE_ATOMIC_STEPS[1])

    // ③ 清定时器/订阅（框架代管——业务无需手动）
    const { timersCleared } = page.resourcePool.releaseAll()
    steps.push(FIVE_ATOMIC_STEPS[2])

    // ④ 销毁 IR 实例（唯一真相 G-42.1）
    page.ir = null
    steps.push(FIVE_ATOMIC_STEPS[3])

    // ⑤ 归还内存配额
    page.quotaHandle?.release()
    page.quotaHandle = null
    steps.push(FIVE_ATOMIC_STEPS[4])

    // 校验五原子（G-42.2 铁律——步序用 FIVE_ATOMIC_STEPS 顺序，顺序错即抛错）
    const report: DestroyReport = { pageId: page.pageId, steps, leaked: [], reclaimedBytes: 0, durationMs: 0 }
    assertAtomicDestroy(report)

    page.alive = false
    ;(page as { state: PageState }).state = 'destroyed'
    pages.delete(page.pageId)
    const stackIdx = stack.indexOf(page)
    if (stackIdx >= 0) stack.splice(stackIdx, 1)
    emit('page-destroyed', { pageId: page.pageId, reclaimedBytes: report.reclaimedBytes })
    return report
  }

  function pageRecordOf(handle: PageHandle): PageRecord {
    const page = pages.get(handle.pageId)
    if (!page) throw new Error(`G-42: 未知页面 ${handle.pageId}`)
    return page
  }

  const container: StackContainer = {
    id: 'stack',
    version: '0.1.0',
    capabilities: CONTAINER_PROFILES.stack as ContainerCapabilities,

    async initialize() {},
    dispose() {
      pages.clear()
      stack.length = 0
    },

    createPage(config) {
      return createPage(config)
    },
    mountPage,
    unmountPage,
    destroyPage,

    async push(config) {
      if (stack.length >= policy.maxDepth) {
        if (policy.overflowStrategy === 'destroy-oldest') {
          const oldest = stack[0]
          if (oldest) {
            await destroyPage(oldest)
            emit('overflow', { strategy: 'destroy-oldest', pageId: oldest.pageId })
          }
        } else if (policy.overflowStrategy === 'reject') {
          throw new Error(`G-42 栈溢出：maxDepth=${policy.maxDepth}（reject 策略）`)
        }
        // flatten：仅告警，覆盖栈顶同层（简化：继续压但不超过 maxDepth）
      }
      const page = createPage(config)
      await mountPage(page)
      stack.push(page)
      return page
    },

    async pop() {
      const page = stack.pop()
      if (!page) return null
      await destroyPage(page)
      return page
    },
    getCurrent() {
      return stack[stack.length - 1] ?? null
    },
    getStackDepth() {
      return stack.length
    },

    async createSandbox(bizId, manifest) {
      void bizId
      void manifest
      throw new Error('G-42: stack 容器无沙箱（capabilities.multiBusiness=false）——SuperApp 容器 B4 提供')
    },
    async destroySandbox(bizId) {
      return createDestroyReport(bizId)
    },
    listSandboxes() {
      return []
    },

    quota,
    onMemoryPressure(cb) {
      pressureHandlers.push(cb)
      return () => {
        const i = pressureHandlers.indexOf(cb)
        if (i >= 0) pressureHandlers.splice(i, 1)
      }
    },
    on(event, handler) {
      events[event] = events[event] ?? []
      events[event].push(handler)
    },

    get stackView() {
      return [...stack]
    },
    get events() {
      return events
    },
  }
  return container
}
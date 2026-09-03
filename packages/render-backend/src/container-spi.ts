// packages/render-backend/src/container-spi.ts
// ★G-42 B1（proteus-host-container-plan batches B1）：HostContainer 容器 SPI + 类型定义（插头形状）
//   权威 TS 版——对齐 docs/proteus-host-container-plan/container-spi.md §1-7（接口唯一事实源）
//   + 页面生命周期状态机纯逻辑（page-lifecycle.md §5.1）+ 五原子销毁校验（G-42.2 铁律）
//   与 G-27/G-39/G-40 同形（readonly id/version/capabilities + initialize/dispose + 生命周期方法）
//   B1 是插头定义；B2 才实现 StackContainer（本文件只含纯逻辑校验，不涉实现）
//   纯逻辑零依赖（容器层不碰线程/桥——G-42.4：容器不得解析 IR/干预 Diff）

// ============================================================
// 1. 容器能力声明（CMP065：容器必须如实声明 capabilities）
// ============================================================

export interface ContainerCapabilities {
  readonly pageStack: boolean // 支持页面栈
  readonly multiBusiness: boolean // 支持多业务沙箱
  readonly crashIsolation: 0 | 1 | 2 | 3 // 0=无，1-3=三级（CMP 对齐 SuperApp L2）
  readonly resourceQuota: boolean // 支持资源配额
  readonly keepAlive: boolean // 支持 keep-alive
  readonly windowManagement: boolean // 支持多窗口
  readonly embedded: boolean // 支持嵌入式
}

/** 六种预设容器的能力画像（唯一事实源——batches B6 / 主文档 §3） */
export const CONTAINER_PROFILES: Record<string, ContainerCapabilities> = {
  singlepage: { pageStack: false, multiBusiness: false, crashIsolation: 0, resourceQuota: false, keepAlive: false, windowManagement: false, embedded: false },
  stack: { pageStack: true, multiBusiness: false, crashIsolation: 0, resourceQuota: true, keepAlive: true, windowManagement: false, embedded: false },
  superapp: { pageStack: true, multiBusiness: true, crashIsolation: 2, resourceQuota: true, keepAlive: true, windowManagement: false, embedded: false },
  miniprogram: { pageStack: true, multiBusiness: true, crashIsolation: 1, resourceQuota: true, keepAlive: true, windowManagement: false, embedded: false },
  window: { pageStack: true, multiBusiness: false, crashIsolation: 0, resourceQuota: true, keepAlive: true, windowManagement: true, embedded: false },
  embedded: { pageStack: false, multiBusiness: false, crashIsolation: 0, resourceQuota: false, keepAlive: false, windowManagement: false, embedded: true },
}

// ============================================================
// 2. 页面模型（页面生命周期状态机——page-lifecycle.md §5.1）
// ============================================================

export type PageState = 'created' | 'mounted' | 'hidden' | 'destroyed' | 'crashed' | 'recycled'

/**
 * ★页面生命周期状态机合法转换表（page-lifecycle.md §5.1）：
 *   created → mounted（hide/show 往返 mounted↔hidden）→ destroyed → recycled（对象池复用）
 *   异常路径：mounted → crashed（崩溃隔离，不影响宿主）→ destroyed
 *   任意前置态 → destroyed（页面随时可销毁——G-42.2 原子销毁的入口）
 */
export const PAGE_STATE_TRANSITIONS: Readonly<Record<PageState, readonly PageState[]>> = {
  created: ['mounted', 'destroyed'],
  mounted: ['hidden', 'destroyed', 'crashed'],
  hidden: ['mounted', 'destroyed'],
  crashed: ['destroyed'],
  destroyed: ['recycled'],
  recycled: [],
}

/** 状态机合法性判断（非法转换直接返回 false——B2 实现据此拒绝越界操作） */
export function canTransitionPageState(from: PageState, to: PageState): boolean {
  return PAGE_STATE_TRANSITIONS[from].includes(to)
}

// ============================================================
// 3. 框架代管资源池（G-42.3：业务不裸用 setTimeout/addEventListener）
// ============================================================

export interface TimerHandle {
  cancel(): void
}

export type UnbindFn = () => void

export interface CancellablePromise<T> extends Promise<T> {
  cancel(): void
}

export interface ReleaseReport {
  readonly timersCleared: number
  readonly listenersUnbound: number
  readonly requestsAborted: number
}

/** 最小事件目标（避免强依赖 DOM EventTarget——容器层零 DOM 假设） */
export interface EventTargetLike {
  addEventListener(type: string, fn: (...args: unknown[]) => void): void
  removeEventListener(type: string, fn: (...args: unknown[]) => void): void
}

export interface ResourcePool {
  timer(fn: () => void, ms: number, opts?: { once?: boolean }): TimerHandle
  interval(fn: () => void, ms: number): TimerHandle
  on(target: EventTargetLike, type: string, fn: (...args: unknown[]) => void): UnbindFn
  bus(topic: string, fn: (...args: unknown[]) => void): UnbindFn
  fetch(url: string, init?: Record<string, unknown>): CancellablePromise<unknown>
  subscribe(store: unknown, fn: (...args: unknown[]) => void): UnbindFn
  releaseAll(): ReleaseReport
}

// ============================================================
// 4. 销毁报告（G-42.2 五原子：steps 必须为 5 步）
// ============================================================

export type DestroyStep = 'unmount' | 'unbindEvents' | 'releaseResources' | 'destroyIR' | 'releaseQuota'

/** 五原子销毁步序（唯一事实源——主文档 §5.2 / container-spi §5） */
export const FIVE_ATOMIC_STEPS: readonly DestroyStep[] = ['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota']

export interface LeakItem {
  readonly kind: 'timer' | 'listener' | 'request' | 'subscription' | 'ir' | 'quota'
  readonly detail: string
}

export interface DestroyReport {
  readonly pageId: string
  readonly steps: readonly DestroyStep[] // 必须为 5 步（G-42.2）
  readonly leaked: readonly LeakItem[]
  readonly reclaimedBytes: number
  readonly durationMs: number
}

/** ★G-42.2 铁律：五原子销毁校验——steps 必须恰好五步（缺失/多余/顺序错都拒绝） */
export function assertAtomicDestroy(report: DestroyReport): void {
  if (report.steps.length !== 5) {
    throw new Error(`G-42.2 违反：页面销毁必须五原子（实际 ${report.steps.length} 步：${report.steps.join('→') || '无'}）`)
  }
  for (let i = 0; i < FIVE_ATOMIC_STEPS.length; i++) {
    if (report.steps[i] !== FIVE_ATOMIC_STEPS[i]) {
      throw new Error(`G-42.2 违反：五原子步骤顺序错误（第 ${i + 1} 步应为 ${FIVE_ATOMIC_STEPS[i]}，实际 ${report.steps[i]}）`)
    }
  }
}

/** 空销毁报告骨架（B2 实现填充——先满足五步序） */
export function createDestroyReport(pageId: string, reclaimedBytes = 0, durationMs = 0): DestroyReport {
  return { pageId, steps: [...FIVE_ATOMIC_STEPS], leaked: [], reclaimedBytes, durationMs }
}

// ============================================================
// 5. 配额管理（CMP061：超限返回 null，禁止静默分配）
// ============================================================

export type PressureLevel = 'normal' | 'warning' | 'critical'

export interface QuotaHandle {
  readonly bytes: number
  readonly scope: string
  release(): void
}

export interface QuotaUsage {
  readonly usedBytes: number
  readonly limitBytes: number
  readonly pageCount: number
  readonly sandboxCount: number
}

export interface QuotaManager {
  request(bytes: number): QuotaHandle | null // 超限返回 null（CMP061）
  release(handle: QuotaHandle): void
  readonly usage: QuotaUsage
  readonly pressure: PressureLevel
}

// ============================================================
// 6. 页面句柄与配置
// ============================================================

export interface PageHandle {
  readonly pageId: string
  readonly irId: string // IR 实例 ID（唯一真相——G-42.1）
  readonly state: PageState
  readonly mountPoint: unknown | null // Backend 提供的原生挂载点
  readonly resourcePool: ResourcePool
  readonly eventRegistry: EventRegistry
}

export interface EventRegistry {
  bind(type: string, fn: (...args: unknown[]) => void): UnbindFn
  unbindAll(): void
  readonly size: number
}

export interface PageConfig {
  readonly pageId?: string // 缺省自动生成
  readonly irId: string
  readonly hideable?: boolean
  readonly keepAlive?: boolean
  readonly budgetBytes?: number
}

// ============================================================
// 7. 业务沙箱（SuperApp 核心——B4 实现）
// ============================================================

export interface BizManifest {
  readonly bizId: string
  readonly signature?: string
  readonly requiredCapabilities?: readonly string[]
}

export interface BusinessSandbox {
  readonly bizId: string
  readonly isolatedScope: unknown
  readonly quotaHandle: QuotaHandle | null
  readonly state: 'running' | 'crashed' | 'destroyed'
}

// ============================================================
// 8. 容器策略配置（主文档 §4 页面栈治理）
// ============================================================

export interface StackPolicy {
  maxDepth: number // 默认 10
  overflowStrategy: 'destroy-oldest' | 'reject' | 'flatten'
  keepAlive: {
    maxCount: number // 默认 3
    memoryBudgetBytes: number // 默认 64MB
  }
}

export const DEFAULT_STACK_POLICY: StackPolicy = {
  maxDepth: 10,
  overflowStrategy: 'destroy-oldest',
  keepAlive: { maxCount: 3, memoryBudgetBytes: 64 * 1024 * 1024 },
}

export interface SuperAppPolicy extends StackPolicy {
  sandbox: {
    defaultMemoryBytes: number // 默认 128MB
    maxSandboxes: number // 默认 8
  }
  crash: {
    isolationLevel: 1 | 2 | 3
    autoRestart: boolean
    maxRestartCount: number
  }
  security: {
    requireSignature: boolean
    capabilityWhitelist: readonly string[]
  }
}

// ============================================================
// 9. 容器上下文 / 事件 / ★核心接口 ProteusHostContainer
// ============================================================

export interface ContainerContext {
  readonly runtime: unknown // G-39 HostRuntime（B2 后接线）
  readonly backends: unknown[] // G-27 RenderBackend 列表（B2 后接线）
}

export type ContainerEvent = 'page-created' | 'page-destroyed' | 'overflow' | 'crash' | 'pressure' | 'sandbox-crashed'

/** ★G-42 核心接口：ProteusHostContainer（与 G-27/G-39/G-40 同形设计语言） */
export interface ProteusHostContainer {
  // —— 身份与能力 ——
  readonly id: string // 'stack' | 'superapp' | 'miniprogram' | ...
  readonly version: string
  readonly capabilities: ContainerCapabilities

  // —— 生命周期 ——
  initialize(ctx: ContainerContext): Promise<void>
  dispose(): void

  // —— 页面管理 ——
  createPage(config: PageConfig): PageHandle
  mountPage(handle: PageHandle): Promise<void>
  unmountPage(handle: PageHandle): Promise<void>
  destroyPage(handle: PageHandle): Promise<DestroyReport>

  // —— 页面栈（StackContainer 核心） ——
  push(config: PageConfig): Promise<PageHandle>
  pop(): Promise<PageHandle | null>
  getCurrent(): PageHandle | null
  getStackDepth(): number

  // —— 业务沙箱（SuperAppContainer 核心） ——
  createSandbox(bizId: string, manifest: BizManifest): Promise<BusinessSandbox>
  destroySandbox(bizId: string): Promise<DestroyReport>
  listSandboxes(): readonly BusinessSandbox[]

  // —— 资源治理 ——
  readonly quota: QuotaManager
  onMemoryPressure(cb: (level: PressureLevel) => void): void

  // —— 事件 ——
  on(event: ContainerEvent, handler: (payload: unknown) => void): void
}

/** B1 验收：容器能力画像与容器类型一致（CMP065 诚实声明前置） */
export function profileOfContainer(id: string): ContainerCapabilities {
  return CONTAINER_PROFILES[id] ?? { pageStack: false, multiBusiness: false, crashIsolation: 0, resourceQuota: false, keepAlive: false, windowManagement: false, embedded: false }
}
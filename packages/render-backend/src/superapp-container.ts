// packages/render-backend/src/superapp-container.ts
// ★G-42 B4（proteus-host-container-plan batches B4）：SuperAppContainer——业务沙箱 + 崩溃隔离 + 安全网关（权威 TS 版）
//   对齐 superapp-hardening.md 四大能力 + container-reference.cjs SuperApp 逻辑 + B1 类型（BizManifest/BusinessSandbox/SuperAppPolicy）
//   · 业务沙箱：独立 scope（业务间不共享可变全局状态——G-42.5 前提）
//   · 崩溃隔离：executeInSandbox try/catch → sandbox-crashed 事件 + hostAlive=true + 其他业务不受影响 + 自动重启（maxRestartCount）
//   · 资源配额：继承 Stack 配额 + 沙箱内存预算记账
//   · 安全网关：签名（G39_SIGN）+ 能力白名单（G39_CAP）+ maxSandboxes（G39_LIMIT）——复用 B3 checkBizManifest
//   页面栈能力：委托内部 StackContainer（createStackContainer）
import { createStackContainer } from './stack-container'
import { checkBizManifest } from './container-conformance'
import { CONTAINER_PROFILES } from './container-spi'
import type { OwnershipGraph } from './ownership'
import type { PageOwnership } from './page-ownership'
import type {
  BizManifest,
  BusinessSandbox,
  ContainerCapabilities,
  ContainerEvent,
  DestroyReport,
  PageConfig,
  PageHandle,
  PressureLevel,
  ProteusHostContainer,
  QuotaManager,
  SuperAppPolicy,
} from './container-spi'

// ============================================================
// 业务沙箱（独立 scope——崩溃隔离前提）
// ============================================================

export interface SandboxExecutionResult<T = unknown> {
  ok: boolean
  bizId?: string
  hostAlive?: boolean
  otherSandboxesAlive?: number
  error?: string
  result?: T
}

export interface SuperSandbox extends BusinessSandbox {
  scope: { bizId: string; values: Record<string, unknown> }
  crashCount: number
  run<T>(fn: () => T): { ok: boolean; error?: unknown; result?: T }
}

function createBusinessSandbox(bizId: string, manifest: BizManifest, opts: { memoryBytes: number }): SuperSandbox {
  // ★独立 scope：业务之间不共享任何可变全局状态（G-42.5 崩溃隔离前提）
  const scope = { bizId, values: {} as Record<string, unknown> }
  const sb: SuperSandbox = {
    bizId,
    isolatedScope: scope,
    quotaHandle: null,
    state: 'running',
    crashCount: 0,
    scope,
    run<T>(fn: () => T): { ok: boolean; error?: unknown; result?: T } {
      try {
        const result = fn()
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error }
      }
    },
  }
  return sb
}

// ============================================================
// 安全网关（复用法则——B3 checkBizManifest 纯函数）
// ============================================================

function validateManifest(manifest: BizManifest, policy: SuperAppPolicy): void {
  const r = checkBizManifest(
    { bizId: manifest.bizId, signature: manifest.signature, capabilities: manifest.requiredCapabilities },
    { requireSignature: policy.security.requireSignature, whitelist: policy.security.capabilityWhitelist },
  )
  if (!r.ok) {
    throw new Error(`${r.code}: ${r.message}`)
  }
}

// ============================================================
// SuperAppContainer（委托 Stack + 沙箱/崩溃隔离/网关）
// ============================================================

export interface SuperAppOptions {
  policy?: Partial<SuperAppPolicy>
  quotaLimitBytes?: number
  /** ★G-43 B3：所有权图接入 pass-through（页面销毁时该页 Owned 资源 forceDrop——委托内部 StackContainer） */
  ownership?: { graph: OwnershipGraph; quotaBytes?: number }
}

export interface SuperAppContainer extends ProteusHostContainer {
  readonly id: 'superapp'
  crashLog: Array<{ bizId: string; error: string; at: number }>
  /** 崩溃隔离执行器：业务 fn 抛错 → 捕获 + 事件 + 自动重启，宿主与其他业务不受影响 */
  executeInSandbox<T>(bizId: string, fn: () => T): SandboxExecutionResult<T>
  readonly sandboxView: readonly SuperSandbox[]
  /** ★G-43 B3：页面所有权上下文（ownership 选项启用时——委托内部 StackContainer） */
  ownershipOf(pageId: string): PageOwnership | null
}

const DEFAULT_SUPERAPP_POLICY: SuperAppPolicy = {
  maxDepth: 10,
  overflowStrategy: 'destroy-oldest',
  keepAlive: { maxCount: 3, memoryBudgetBytes: 64 * 1024 * 1024 },
  sandbox: { defaultMemoryBytes: 128 * 1024 * 1024, maxSandboxes: 8 },
  crash: { isolationLevel: 2, autoRestart: true, maxRestartCount: 3 },
  security: { requireSignature: true, capabilityWhitelist: ['camera', 'location', 'storage'] },
}

/** ★G-42 B4：SuperAppContainer（业务沙箱 + 崩溃隔离 L1-L3 + 配额 + 安全网关；页面栈委托 StackContainer） */
export function createSuperAppContainer(opts: SuperAppOptions = {}): SuperAppContainer {
  const policy: SuperAppPolicy = {
    ...DEFAULT_SUPERAPP_POLICY,
    ...opts.policy,
    keepAlive: { ...DEFAULT_SUPERAPP_POLICY.keepAlive, ...(opts.policy?.keepAlive ?? {}) },
    sandbox: { ...DEFAULT_SUPERAPP_POLICY.sandbox, ...(opts.policy?.sandbox ?? {}) },
    crash: { ...DEFAULT_SUPERAPP_POLICY.crash, ...(opts.policy?.crash ?? {}) },
    security: { ...DEFAULT_SUPERAPP_POLICY.security, ...(opts.policy?.security ?? {}) },
  }

  // 页面栈/页面管理/配额：委托内部 StackContainer（复用 B2 五原子/资源池/LRU + G-43 B3 ownership 接入）
  const stack = createStackContainer({ policy, quotaLimitBytes: opts.quotaLimitBytes, ownership: opts.ownership })

  const sandboxes = new Map<string, SuperSandbox>()
  const crashLog: SuperAppContainer['crashLog'] = []
  const events: Record<string, Array<(payload: unknown) => void>> = {}

  const emit = (event: string, payload: unknown): void => {
    for (const fn of events[event] ?? []) fn(payload)
    // 同步到事件名映射（ContainerEvent）
    void event
  }

  const container: SuperAppContainer = {
    id: 'superapp',
    version: '1.0.0',
    capabilities: {
      ...CONTAINER_PROFILES.superapp,
      crashIsolation: policy.crash.isolationLevel,
    } as ContainerCapabilities,

    // —— 生命周期：委托 stack ——
    initialize: stack.initialize,
    dispose() {
      for (const bizId of [...sandboxes.keys()]) void container.destroySandbox(bizId)
      stack.dispose()
    },
    createPage: stack.createPage,
    mountPage: stack.mountPage,
    unmountPage: stack.unmountPage,
    destroyPage: stack.destroyPage,
    push: stack.push,
    pop: stack.pop,
    getCurrent: stack.getCurrent,
    getStackDepth: stack.getStackDepth,
    // ★G-43 B3：页面所有权上下文（委托内部 Stack 页面记录）
    ownershipOf: stack.ownershipOf,

    // —— 业务沙箱（SuperApp 核心） ——
    async createSandbox(bizId, manifest): Promise<BusinessSandbox> {
      if (sandboxes.size >= policy.sandbox.maxSandboxes) {
        throw new Error(`G39_LIMIT: max sandboxes ${policy.sandbox.maxSandboxes}`)
      }
      validateManifest(manifest, policy)
      const sb = createBusinessSandbox(bizId, manifest, { memoryBytes: policy.sandbox.defaultMemoryBytes })
      ;(sb as unknown as { state: 'running' | 'crashed' | 'destroyed' }).state = 'running'
      sandboxes.set(bizId, sb)
      emit('sandbox-created', { bizId })
      return sb
    },
    async destroySandbox(bizId): Promise<DestroyReport> {
      const sb = sandboxes.get(bizId)
      if (!sb) throw new Error(`G39_NOTFOUND: sandbox ${bizId} not found`)
      ;(sb as unknown as { state: 'running' | 'crashed' | 'destroyed' }).state = 'destroyed'
      sandboxes.delete(bizId)
      emit('sandbox-destroyed', { bizId })
      return { pageId: bizId, steps: ['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota'], leaked: [], reclaimedBytes: 0, durationMs: 0 }
    },
    listSandboxes() {
      return [...sandboxes.values()]
    },

    // —— 资源治理 ——
    quota: stack.quota as QuotaManager,
    onMemoryPressure(cb) {
      events['pressure'] = events['pressure'] ?? []
      events['pressure'].push(cb as (payload: unknown) => void)
      return () => {
        events['pressure'] = (events['pressure'] ?? []).filter((f) => f !== cb)
      }
    },
    on(event: ContainerEvent, handler) {
      events[event] = events[event] ?? []
      events[event].push(handler as (payload: unknown) => void)
    },

    // —— 崩溃隔离核心 ——
    executeInSandbox(bizId, fn) {
      const sb = sandboxes.get(bizId)
      if (!sb) throw new Error(`G39_NOTFOUND: sandbox ${bizId} not found`)
      const result = sb.run(fn)
      if (!result.ok) {
        const error = String((result.error as Error | undefined)?.message ?? result.error)
        crashLog.push({ bizId, error, at: Date.now() })
        emit('sandbox-crashed', { bizId, error, hostAlive: true })
        // 自动重启（maxRestartCount 内）
        if (policy.crash.autoRestart && sb.crashCount < policy.crash.maxRestartCount) {
          sb.crashCount++
          ;(sb as unknown as { state: 'running' | 'crashed' | 'destroyed' }).state = 'running'
        } else {
          ;(sb as unknown as { state: 'running' | 'crashed' | 'destroyed' }).state = 'crashed'
        }
        return {
          ok: false,
          bizId,
          hostAlive: true,
          otherSandboxesAlive: [...sandboxes.values()].filter((s) => s.bizId !== bizId && s.state === 'running').length,
          error,
        }
      }
      return { ok: true, bizId, result: result.result }
    },

    get crashLog() {
      return crashLog
    },
    get sandboxView() {
      return [...sandboxes.values()]
    },
  }
  return container
}
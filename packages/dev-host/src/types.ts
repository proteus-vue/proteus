/**
 * G-45 B2 —— DevHost 类型定义（接口与 proteus-dev_host-plan 03-spi.md 冻结版对齐）
 */

/** 插件后端实现（G-28 NativeBackend SPI 的动态形态） */
export type NativeBackendLike = Record<string, (...args: any[]) => unknown>

/** 降级后端实现（能力缺失/装载失败时兜底） */
export type FallbackImpl = (...args: any[]) => unknown

export interface BackendManifest {
  /** 插件唯一 id（热升级按 id 匹配） */
  id: string
  /** semver（热升级比较） */
  version: string
  /** 声明的能力集（G-28 capability 语义，必须诚实——G-37.3 同源） */
  capabilities: string[]
  /** 签名（G-42 安全网关同源；CMP084） */
  signature: string
  /** 基座最低版本要求 */
  minHostVersion?: string
  /** 同能力多插件时的优先级（复用 G-28 Adapter Registry 语义） */
  priority?: number
}

export interface ConformanceCase {
  name: string
  check(backend: NativeBackendLike): boolean | Promise<boolean>
}

export interface DynamicBackendModule {
  manifest: BackendManifest
  /** 语义快检用例：每能力 ≥1（CMP087）；Test IR 形态可序列化（G-44） */
  conformance: ConformanceCase[]
  factory(env: { host: ProteusDevHost }): NativeBackendLike
}

export type LoadRejectReason =
  | 'G45_MANIFEST_INCOMPLETE'
  | 'G45_SIGN'
  | 'G45_CONFORMANCE_COVERAGE'
  | 'G45_CONFORMANCE_FAIL'
  | 'G45_FACTORY_THROWN'

export interface ConformanceResult {
  name: string
  pass: boolean
}

export interface LoadReport {
  id: string | null
  version: string | null
  ok: boolean
  reason: LoadRejectReason | null
  /** reason 的补充信息（如失败的用例名） */
  reasonDetail?: string
  conformance: ConformanceResult[]
  /** 本次装载回放的 pending 调用数 */
  replayed: number
}

export interface CapabilityRecord {
  id: string
  version: string
  source: 'dynamic'
}

export interface BackendRecord {
  id: string
  version: string
  capabilities: string[]
}

export type DevHostEventType =
  | 'stub:pending'
  | 'stub:replay'
  | 'module:loaded'
  | 'module:upgraded'
  | 'module:rejected'
  | 'module:unloaded'
  | 'fallback'

export interface DevHostEventRecord {
  type: DevHostEventType
  payload: Record<string, unknown>
  at: number
}

export interface HostMetrics {
  loadedModules: number
  rejectedModules: number
  upgrades: number
  unloads: number
  replayedTotal: number
  fallbacks: number
  pendingPeak: number
  pendingNow: number
  /** ★ 恒为 0（动态装载路径），>0 即违规（G-45.4 / CMP086） */
  baseRebuildCount: number
  uptimeMs: number
  events: number
}

export interface PendingEntry {
  capability: string
  method: string
  args: unknown[]
  resolve(value: unknown): void
  reject(reason: unknown): void
  seq: number
  at: number
}

/**
 * ProteusDevHost SPI（G-45 冻结接口，03-spi.md 同形）：
 * 基座只实现此接口 + 装载协议，禁止静态依赖任何具体插件（G-45.1）。
 */
export interface ProteusDevHost {
  loadModule(mod: DynamicBackendModule): Promise<LoadReport>
  unloadModule(id: string): boolean
  listBackends(): BackendRecord[]
  capabilityOf(capability: string): CapabilityRecord | null
  registerFallback(capability: string, impl: FallbackImpl): void
  getMetrics(): HostMetrics
  getEvents(type?: DevHostEventType): DevHostEventRecord[]
  on(type: DevHostEventType, cb: (payload: Record<string, unknown>) => void): () => void
  createStub(capability: string, method: string): ForwardingStubLike
}

/** 转发桩接口（编译器为业务生成的运行时形态） */
export interface ForwardingStubLike {
  readonly capability: string
  readonly method: string
  call(...args: unknown[]): Promise<unknown>
}

/** 装载门禁内部的模块登记项 */
export interface ModuleEntry {
  manifest: BackendManifest
  module: DynamicBackendModule
  report: LoadReport
}

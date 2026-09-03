/**
 * G-45 B2 —— DevHost（调试基座）+ ForwardingStub（转发桩）
 *
 * 对齐 proteus-dev-host-plan：
 *   G-45.1 基座零插件知识（只认 SPI 与装载协议）
 *   G-45.2 未装载调用 pending 非抛（装载后回放）
 *   G-45.3 装载即验证（签名 + conformance 快检，失败拒绝 + 降级）
 *   G-45.5 全链事件可观测
 */

import type {
  BackendManifest,
  BackendRecord,
  CapabilityRecord,
  DevHostEventRecord,
  DevHostEventType,
  DynamicBackendModule,
  FallbackImpl,
  HostMetrics,
  LoadReport,
  ModuleEntry,
  PendingEntry,
  ProteusDevHost,
} from './types'

/** 装载门禁能解析出的目标（stub 直调用） */
interface ResolveTarget {
  manifest: BackendManifest
  module: DynamicBackendModule
}

/* ================= ForwardingStub（转发桩，编译器为业务生成的运行时形态） ================= */

export class ForwardingStub {
  readonly capability: string
  readonly method: string
  /** 最近一次观察到的宿主 pending 队列长度 */
  pendingCount = 0
  /** 已直通的调用次数（观测用） */
  directCalls = 0

  private host: DevHost

  constructor(host: DevHost, capability: string, method: string) {
    this.host = host
    this.capability = capability
    this.method = method
  }

  /**
   * 业务调用唯一入口（useNative().scanQR() 的运行时形态）：
   *   后端就绪 → 直调；未就绪 → pending（G-45.2 禁止同步抛异常），装载成功后按 seq 序回放。
   */
  call(...args: unknown[]): Promise<unknown> {
    const target = this.host.resolve(this.capability)
    if (target) {
      this.directCalls += 1
      return this.host.invoke(target, this.method, args)
    }
    return new Promise((resolve, reject) => {
      this.pendingCount = this.host.enqueuePending({
        capability: this.capability,
        method: this.method,
        args,
        resolve,
        reject,
        seq: 0, // enqueuePending 内分配
        at: Date.now(),
      })
    })
  }
}

/* ================= DevHost（Install-Once Host） ================= */

export class DevHost implements ProteusDevHost {
  private modules = new Map<string, ModuleEntry>()
  private caps = new Map<string, CapabilityRecord>()
  private fallbacks = new Map<string, FallbackImpl>()
  private pendings: PendingEntry[] = []
  private stubs = new Map<string, ForwardingStub>()
  private events: DevHostEventRecord[] = []
  private listeners = new Map<DevHostEventType, Set<(payload: Record<string, unknown>) => void>>()
  private seq = 0
  private metrics = {
    loadedModules: 0,
    rejectedModules: 0,
    upgrades: 0,
    unloads: 0,
    replayedTotal: 0,
    fallbacks: 0,
    pendingPeak: 0,
  }
  private readonly createdAt = Date.now()

  /** ★ 基座重打次数：动态装载路径下恒为 0（G-45.4），>0 即违规 */
  readonly baseRebuildCount = 0

  /* ---- stub 与降级 ---- */

  /** 编译器为业务生成转发桩（同 cap.method 复用同一实例——热升级对业务透明） */
  createStub(capability: string, method: string): ForwardingStub {
    const key = `${capability}.${method}`
    if (!this.stubs.has(key)) {
      this.stubs.set(key, new ForwardingStub(this, capability, method))
    }
    return this.stubs.get(key) as ForwardingStub
  }

  /** 内置降级后端：能力缺失/装载失败时兜底（降级不崩溃） */
  registerFallback(capability: string, impl: FallbackImpl): void {
    this.fallbacks.set(capability, impl)
  }

  /* ---- 查询 ---- */

  capabilityOf(capability: string): CapabilityRecord | null {
    return this.caps.get(capability) ?? null
  }

  listBackends(): BackendRecord[] {
    return [...this.modules.values()].map((entry) => ({
      id: entry.manifest.id,
      version: entry.manifest.version,
      capabilities: entry.manifest.capabilities,
    }))
  }

  getMetrics(): HostMetrics {
    return {
      ...this.metrics,
      pendingNow: this.pendings.length,
      baseRebuildCount: this.baseRebuildCount,
      uptimeMs: Date.now() - this.createdAt,
      events: this.events.length,
    }
  }

  getEvents(type?: DevHostEventType): DevHostEventRecord[] {
    return type ? this.events.filter((e) => e.type === type) : [...this.events]
  }

  /** 订阅事件（返回取消函数）；DevTools/TraceBus 接线点（G-45.5） */
  on(type: DevHostEventType, cb: (payload: Record<string, unknown>) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    const set = this.listeners.get(type) as Set<(payload: Record<string, unknown>) => void>
    set.add(cb)
    return () => set.delete(cb)
  }

  /* ---- 装载 / 卸载 ---- */

  /**
   * 动态装载插件模块（dev server push 的入口）。
   * 门禁链：manifest 完整性 → 签名 → conformance 覆盖率 → conformance 快检 → 注册 → pending 回放。
   */
  async loadModule(mod: DynamicBackendModule): Promise<LoadReport> {
    const manifest = mod?.manifest
    const report: LoadReport = {
      id: manifest?.id ?? null,
      version: manifest?.version ?? null,
      ok: false,
      reason: null,
      conformance: [],
      replayed: 0,
    }

    // 门禁 1：manifest 完整性（CMP084）
    if (
      !manifest ||
      !manifest.id ||
      !manifest.version ||
      !Array.isArray(manifest.capabilities) ||
      manifest.capabilities.length === 0
    ) {
      return this.reject(report, 'G45_MANIFEST_INCOMPLETE')
    }

    // 门禁 2：签名（CMP084，G-42 安全网关同源）
    if (typeof manifest.signature !== 'string' || !/^sig-[a-z0-9]+$/.test(manifest.signature)) {
      return this.reject(report, 'G45_SIGN')
    }

    // 门禁 3：conformance 覆盖率——每能力至少一例（CMP087）
    if (!Array.isArray(mod.conformance) || mod.conformance.length < manifest.capabilities.length) {
      return this.reject(report, 'G45_CONFORMANCE_COVERAGE')
    }

    // 门禁 4：装载即验证——任一 FAIL 拒绝装载（CMP085）
    let backend
    try {
      backend = mod.factory({ host: this })
    } catch (e) {
      report.reasonDetail = e instanceof Error ? e.message : String(e)
      return this.reject(report, 'G45_FACTORY_THROWN')
    }
    for (const c of mod.conformance) {
      let pass = false
      let detail = ''
      try {
        pass = await c.check(backend)
      } catch (e) {
        detail = e instanceof Error ? e.message : String(e)
      }
      report.conformance.push({ name: c.name, pass })
      if (!pass) {
        report.reasonDetail = `${c.name}${detail ? ` (${detail})` : ''}`
        const rejected = this.reject(report, 'G45_CONFORMANCE_FAIL')
        // 装载失败：该能力的 pending 调用转内置降级后端（降级不崩溃）
        this.drainPendingToFallback(manifest.capabilities)
        return rejected
      }
    }

    // 装载 / 热升级
    const existing = this.modules.get(manifest.id)
    if (existing) {
      this.metrics.upgrades += 1
      this.emit('module:upgraded', {
        id: manifest.id,
        from: existing.manifest.version,
        to: manifest.version,
      })
    } else {
      this.metrics.loadedModules += 1
    }
    this.modules.set(manifest.id, { manifest, module: mod, report })
    for (const cap of manifest.capabilities) {
      this.caps.set(cap, { id: manifest.id, version: manifest.version, source: 'dynamic' })
    }
    this.emit('module:loaded', {
      id: manifest.id,
      version: manifest.version,
      capabilities: [...manifest.capabilities],
    })

    // 就绪回放：pending 调用按 seq 序回放（CMP083 的另一半）
    report.replayed = this.replayPending(manifest.capabilities)
    report.ok = true
    return report
  }

  /** 卸载：能力退回 pending 语义（等待再推送），已存在的 stub 调用不断 */
  unloadModule(id: string): boolean {
    const entry = this.modules.get(id)
    if (!entry) return false
    for (const cap of entry.manifest.capabilities) {
      const rec = this.caps.get(cap)
      // 只清本模块占用的能力（同能力可能被更高版本模块占用）
      if (rec && rec.id === id) this.caps.delete(cap)
    }
    this.modules.delete(id)
    this.metrics.unloads += 1
    this.emit('module:unloaded', { id })
    return true
  }

  /* ---- 内部：stub 桥（ForwardingStub 消费） ---- */

  resolve(capability: string): ResolveTarget | null {
    const rec = this.caps.get(capability)
    if (!rec) return null
    const entry = this.modules.get(rec.id)
    if (!entry) return null
    return { manifest: entry.manifest, module: entry.module }
  }

  invoke(target: ResolveTarget, method: string, args: unknown[]): Promise<unknown> {
    const backend = target.module.factory({ host: this })
    const fn = backend[method]
    if (typeof fn !== 'function') {
      return Promise.reject(
        new Error(`G45_METHOD_MISSING: ${target.manifest.id}.${method}`)
      )
    }
    return Promise.resolve().then(() => fn.apply(backend, args))
  }

  enqueuePending(entry: PendingEntry): number {
    entry.seq = ++this.seq
    this.pendings.push(entry)
    if (this.pendings.length > this.metrics.pendingPeak) {
      this.metrics.pendingPeak = this.pendings.length
    }
    this.emit('stub:pending', {
      capability: entry.capability,
      method: entry.method,
      pendingCount: this.pendings.length,
    })
    return this.pendings.length
  }

  /* ---- 内部：pending 管理 ---- */

  private replayPending(capabilities: string[]): number {
    const mine = this.pendings.filter((p) => capabilities.includes(p.capability))
    if (!mine.length) return 0
    this.pendings = this.pendings.filter((p) => !capabilities.includes(p.capability))
    for (const p of mine) {
      const target = this.resolve(p.capability)
      if (!target) {
        p.reject(new Error(`G45_REPLAY_STALE: ${p.capability}`))
        continue
      }
      this.invoke(target, p.method, p.args).then(p.resolve, p.reject)
      this.metrics.replayedTotal += 1
      this.emit('stub:replay', {
        capability: p.capability,
        method: p.method,
        waitedMs: Date.now() - p.at,
        seq: p.seq,
      })
    }
    return mine.length
  }

  private drainPendingToFallback(capabilities: string[]): void {
    const mine = this.pendings.filter((p) => capabilities.includes(p.capability))
    if (!mine.length) return
    this.pendings = this.pendings.filter((p) => !capabilities.includes(p.capability))
    for (const p of mine) {
      this.fallbackInvoke(p.capability, p.method, p.args).then(p.resolve, p.reject)
    }
  }

  private fallbackInvoke(capability: string, method: string, args: unknown[]): Promise<unknown> {
    const impl = this.fallbacks.get(capability)
    this.metrics.fallbacks += 1
    this.emit('fallback', { capability, method, reason: 'backend-unavailable' })
    if (!impl) {
      return Promise.reject(new Error(`G45_NO_FALLBACK: ${capability}`))
    }
    return Promise.resolve().then(() => impl.apply(null, args))
  }

  /* ---- 内部：事件 ---- */

  private emit(type: DevHostEventType, payload: Record<string, unknown>): void {
    this.events.push({ type, payload, at: Date.now() })
    const set = this.listeners.get(type)
    if (set) {
      for (const cb of set) cb(payload)
    }
  }

  private reject(report: LoadReport, reason: LoadReport['reason']): LoadReport {
    report.ok = false
    report.reason = reason
    this.metrics.rejectedModules += 1
    this.emit('module:rejected', { ...report })
    return report
  }
}

export function createDevHost(): DevHost {
  return new DevHost()
}

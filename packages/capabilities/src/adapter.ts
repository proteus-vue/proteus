// packages/capabilities/src/adapter.ts
// ★platform-plan B2（M2 Adapter Registry）：统一管理"哪个平台用哪个实现"，业务不感知
// 选择策略（§4）：platform 过滤 → priority 降序 → isSupported() 探测 → 命中第一个 → 无命中 → fallback
// 多实例隔离（§5）：createCapabilityRegistry 工厂——SSR / Worker 场景独立 registry，禁止全局可变副作用
import type { Capability, CapabilityAPI, CapabilityPlatform } from './types'

/** 能力可观测事件总线（结构与 devtools-runtime TraceBus.emit 兼容；零硬依赖注入） */
export interface CapabilityTraceBus {
  emit(source: 'capability', phase: 'point' | 'start' | 'end' | 'error', name: string, payload?: unknown, traceId?: string): void
}

/** 独立 adapter（capabilities/*.adapter.ts 或描述文件 adapters 展开产物） */
export interface CapabilityAdapter<C extends CapabilityAPI = CapabilityAPI> {
  /** 所属能力 id */
  capability: string
  platform: CapabilityPlatform
  /** 优先级（同平台多实现时降序命中；缺省 0） */
  priority?: number
  /** 探测（feature detection；★不得在模块顶层执行 wx.*——延后到调用） */
  isSupported(): boolean | Promise<boolean>
  create(): C
  /** Worklet 能力标注（Skyline UI 线程可运行） */
  runsInWorklet?: boolean
}

/** ★devtools 打通：能力状态快照条目（M8 设备面板能力表数据源；resolveSync 探测当前平台命中情况） */
export interface CapabilitySnapshotEntry {
  /** 能力 id */
  capability: string
  /** 当前探测平台 */
  platform: CapabilityPlatform
  /** 该能力在当前平台 adapter 的优先级（无则 0） */
  priority: number
  /** ★B4：required 标记（缺失阻断流程） */
  required: boolean
  /** 降级能力 id（描述文件 fallback） */
  fallback?: string
  /** 当前平台是否支持（resolveSync 探测命中） */
  supported: boolean
  /** Worklet 能力标注（Skyline UI 线程可运行） */
  runsInWorklet?: boolean
  /** 已注册平台列表（web/skyline/app；展示多平台覆盖） */
  platforms: CapabilityPlatform[]
}

/** 校验 adapter（纯函数） */
export function validateAdapter(input: unknown): { ok: true; value: CapabilityAdapter } | { ok: false; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = []
  const a = (input ?? {}) as CapabilityAdapter
  if (typeof a.capability !== 'string' || !a.capability) errors.push({ field: 'capability', message: '必填：能力 id' })
  if (!['web', 'skyline', 'app'].includes(a.platform as string)) errors.push({ field: 'platform', message: '必填：web / skyline / app' })
  if (typeof a.isSupported !== 'function') errors.push({ field: 'isSupported', message: '必填：探测函数（feature detection）' })
  if (typeof a.create !== 'function') errors.push({ field: 'create', message: '必填：创建能力 API 实例' })
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: a }
}

/** 声明平台 adapter（编译期校验：不合法当场抛错，透明化铁律） */
export function defineAdapter<C extends CapabilityAPI>(adapter: CapabilityAdapter<C>): CapabilityAdapter<C> {
  const result = validateAdapter(adapter)
  if (!result.ok) {
    const detail = result.errors.map((e) => `  - ${e.field}: ${e.message}`).join('\n')
    throw new Error(`[proteus-capabilities] adapter 校验失败（${adapter.capability ?? '(未命名)'}@${adapter.platform ?? '?'}）：\n${detail}`)
  }
  return adapter
}

/** ★多实例隔离的注册中心（工厂——SSR / Worker 用独立实例） */
export class CapabilityRegistry {
  private adapters = new Map<string, CapabilityAdapter[]>()
  private fallbacks = new Map<string, string>() // capability id → fallback id
  private requireds = new Map<string, boolean>() // ★B4：required——缺失阻断（§4）
  private traceBus: CapabilityTraceBus | undefined

  /** ★devtools 打通：注入可观测事件总线（capability.detect 探测/降级事件 → 面板 timeline 能力泳道；bus 门控生产零开销） */
  setTraceBus(bus: CapabilityTraceBus | undefined): void {
    this.traceBus = bus
  }

  private emitDetect(id: string, platform: CapabilityPlatform, supported: boolean, fallback?: string): void {
    this.traceBus?.emit('capability', 'point', 'capability.detect', { name: id, platform, supported, fallback }, 'cap-' + id)
  }

  /** 注册 fallback 关系（capability 描述文件） */
  registerFallback(capability: string, fallback: string | undefined): void {
    if (fallback) this.fallbacks.set(capability, fallback)
  }

  /** 读取 fallback 关系（devtools 能力表标注降级目标） */
  fallbackOf(capability: string): string | undefined {
    return this.fallbacks.get(capability)
  }

  /** ★devtools 打通：能力状态快照（M8 设备面板能力表）——已注册能力逐项按当前平台 resolveSync 探测 */
  snapshot(platform: CapabilityPlatform = detectPlatform()): CapabilitySnapshotEntry[] {
    const out: CapabilitySnapshotEntry[] = []
    for (const [capability, list] of this.adapters) {
      const cur = list.find((a) => a.platform === platform)
      const supported = cur !== undefined && this.resolveSync(capability, platform) !== undefined
      out.push({
        capability,
        platform,
        priority: cur?.priority ?? 0,
        required: this.requireds.get(capability) ?? false,
        fallback: this.fallbacks.get(capability),
        supported,
        runsInWorklet: cur?.runsInWorklet,
        platforms: list.map((a) => a.platform),
      })
    }
    return out.sort((a, b) => a.capability.localeCompare(b.capability))
  }

  /** ★B4：注册 required 标记（§4 降级级别——required 缺失阻断流程） */
  registerRequired(capability: string, required: boolean): void {
    this.requireds.set(capability, required)
  }

  /** ★B4：是否 required */
  isRequired(capability: string): boolean {
    return this.requireds.get(capability) ?? false
  }

  /** 注册 adapter（同 capability+platform 重复 → 报错，编译期约束 §7；按 priority 降序排序） */
  register(adapter: CapabilityAdapter): void {
    const list = this.adapters.get(adapter.capability) ?? []
    if (list.some((a) => a.platform === adapter.platform)) {
      throw new Error(`[proteus-capabilities] 能力 "${adapter.capability}" 的 "${adapter.platform}" 平台重复注册 adapter（编译期约束：同 capability+platform 唯一）`)
    }
    list.push(adapter)
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    this.adapters.set(adapter.capability, list)
  }

  /** 批量注册（幂等语义：已存在同 id+platform 则跳过——scan 场景） */
  registerIdempotent(adapter: CapabilityAdapter): void {
    const list = this.adapters.get(adapter.capability) ?? []
    if (list.some((a) => a.platform === adapter.platform)) return
    this.register(adapter)
  }

  /** 能力是否已注册任何 adapter */
  has(capability: string): boolean {
    return (this.adapters.get(capability)?.length ?? 0) > 0
  }

  /** 清空（测试隔离） */
  clear(): void {
    this.adapters.clear()
    this.fallbacks.clear()
    this.requireds.clear()
  }

  /**
   * 解析能力（选择策略 §4）：platform 过滤（缺省探测）→ priority 降序 → isSupported() 探测 → 第一个；
   * 无命中 → fallback 能力递归解析；返回 undefined（无 adapter / 全不支持）
   */
  async resolve<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Promise<Capability<C> | undefined> {
    const list = this.adapters.get(id) ?? []
    const candidates = platform ? list.filter((a) => a.platform === platform) : list
    for (const adapter of candidates) {
      try {
        if (await adapter.isSupported()) {
          return this.wrap(adapter as CapabilityAdapter<C>, platform)
        }
      } catch {
        // 探测抛错 → 视为不支持（缺失能力不抛异常铁律）
      }
    }
    const fb = this.fallbacks.get(id)
    if (fb && fb !== id) {
      // 探测不支持 → 先记录降级事件，再递归 fallback 能力（命中与否都保留探测痕迹）
      this.emitDetect(id, platform, false, fb)
      const fbCap = await this.resolve<C>(fb, platform)
      if (fbCap) return fbCap
      return undefined
    }
    this.emitDetect(id, platform, false)
    return undefined
  }

  /** 同步解析（isSupported 为同步时可用；异步探测的 adapter 返回 undefined） */
  resolveSync<C extends CapabilityAPI = CapabilityAPI>(id: string, platform: CapabilityPlatform = detectPlatform()): Capability<C> | undefined {
    const list = this.adapters.get(id) ?? []
    for (const adapter of list.filter((a) => a.platform === platform)) {
      try {
        const supported = adapter.isSupported() as boolean | Promise<boolean>
        if (typeof supported === 'boolean' && supported) return this.wrap(adapter as CapabilityAdapter<C>, platform)
      } catch {
        // 忽略
      }
    }
    const fb = this.fallbacks.get(id)
    if (fb && fb !== id) {
      // 探测不支持 → 先记录降级事件，再递归 fallback 能力（命中与否都保留探测痕迹）
      this.emitDetect(id, platform, false, fb)
      const fbCap = this.resolveSync<C>(fb, platform)
      if (fbCap) return fbCap
      return undefined
    }
    this.emitDetect(id, platform, false)
    return undefined
  }

  private wrap<C extends CapabilityAPI>(adapter: CapabilityAdapter<C>, platform: CapabilityPlatform): Capability<C> {
    const api = adapter.create()
    const cap: Capability<C> = {
      meta: { id: adapter.capability, tier: 2, name: adapter.capability },
      api,
      isSupported: () => adapter.isSupported(),
    }
    const fb = this.fallbacks.get(adapter.capability)
    let fallbackId: string | undefined
    if (fb && fb !== adapter.capability) {
      const fbCap = this.resolveSync<C>(fb, platform)
      if (fbCap) {
        cap.fallback = fbCap
        fallbackId = fb
      }
    }
    this.emitDetect(adapter.capability, platform, true, fallbackId)
    return cap
  }

  /** 已注册的（capability, platform）集合（审计/DevTools） */
  entries(): Array<{ capability: string; platform: CapabilityPlatform; priority: number }> {
    const out: Array<{ capability: string; platform: CapabilityPlatform; priority: number }> = []
    for (const [capability, list] of this.adapters) {
      for (const a of list) out.push({ capability, platform: a.platform, priority: a.priority ?? 0 })
    }
    return out.sort((a, b) => a.capability.localeCompare(b.capability) || (b.priority - a.priority) || a.platform.localeCompare(b.platform))
  }

  /** 编译期约束 §7 校验：每 capability 至少一个 adapter（fallback 存在性由调用方结合 fallbacks 检查） */
  validate(): Array<{ field: string; message: string }> {
    const issues: Array<{ field: string; message: string }> = []
    for (const [capability, list] of this.adapters) {
      if (!list.length) issues.push({ field: capability, message: 'capability 无任何 adapter（编译期约束：至少一个）' })
      for (const a of list) {
        const fb = this.fallbacks.get(capability)
        if (fb && !this.adapters.has(fb)) issues.push({ field: `${capability}.fallback`, message: `降级能力 "${fb}" 未注册（编译期约束：fallback 必须真实存在）` })
      }
    }
    return issues
  }
}

/** 平台探测（feature detection：wx → skyline / window → web；无则 web） */
export function detectPlatform(): CapabilityPlatform {
  const wxGlobal = (globalThis as { wx?: unknown }).wx
  return typeof wxGlobal !== 'undefined' ? 'skyline' : 'web'
}

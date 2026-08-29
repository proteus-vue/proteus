// packages/module/src/orchestrator.ts
// ★module-plan B2（M2 ModuleOrchestrator + 生命周期）：
//   createModuleSystem——按拓扑序（B3）初始化模块、版本协商、生命周期调度
// 生命周期：register → resolve → init → ready → active → inactive → destroy
// 单例保证：本工厂纯函数不自动挂载——调用方（main.mp.ts）挂 getApp().moduleSystem（页面切换不重建）
import { DependencyGraph, CycleError } from './graph'

/** 模块状态机 */
export type ModuleState = 'registered' | 'init' | 'ready' | 'active' | 'inactive' | 'destroyed'

/** 模块事件总线（模块内事件：订单创建等；模块间通信走事件，铁律） */
export interface ModuleEventBus {
  on(event: string, cb: (payload?: unknown) => void): () => void
  emit(event: string, payload?: unknown): void
}

export function createModuleEventBus(): ModuleEventBus {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>()
  return {
    on(event, cb) {
      const list = listeners.get(event) ?? new Set()
      list.add(cb)
      listeners.set(event, list)
      return () => {
        list.delete(cb)
      }
    },
    emit(event, payload) {
      for (const cb of listeners.get(event) ?? []) cb(payload)
    },
  }
}

/** 模块定义（createModuleSystem 输入） */
export interface ModuleDefinition {
  name: string
  version: string
  /** 依赖的其他模块（key = 模块名，value = semver range） */
  dependencies?: Record<string, string>
  /** 业务服务（函数 = 懒创建工厂；对象 = 直接实例） */
  services?: Record<string, unknown> | (() => Record<string, unknown>)
  /** 生命周期钩子 */
  lifecycle?: {
    onInit?: () => void | Promise<void>
    onReady?: () => void | Promise<void>
    onActive?: () => void | Promise<void>
    onInactive?: () => void | Promise<void>
    onDestroy?: () => void | Promise<void>
  }
}

/** 模块实例（getModule 返回） */
export interface ModuleInstance {
  name: string
  version: string
  state: ModuleState
  services: Record<string, unknown>
  events: ModuleEventBus
  init(): Promise<void>
  destroy(): Promise<void>
  activate(): Promise<void>
  deactivate(): Promise<void>
}

export interface ModuleSystem {
  /** 按拓扑序初始化全部模块（依赖者后 init；有环 → CycleError） */
  init(): Promise<void>
  /** 获取模块实例 */
  getModule(name: string): ModuleInstance
  /** 模块状态 */
  getState(name: string): ModuleState
  /** 模块进入前台（onActive） */
  activate(name: string): Promise<void>
  /** 模块进入后台（onInactive） */
  deactivate(name: string): Promise<void>
  /** 逆拓扑序销毁全部模块 */
  destroy(): Promise<void>
  /** 已注册模块名 */
  modules(): string[]
}

/** ★版本冲突：依赖 range 与实际解析版本不匹配（含冲突链） */
export class VersionMismatchError extends Error {
  constructor(public readonly module: string, public readonly dependency: string, public readonly range: string, public readonly actual: string) {
    super(`[proteus-module] ★版本冲突：${module} 依赖 "${dependency}@${range}"，实际解析 ${dependency}@${actual}——请统一版本或调整 range`)
    this.name = 'VersionMismatchError'
  }
}

/** semver 解析（x.y.z） */
export function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null
}

/** semver range 匹配（^1.2.3 / ~1.2.3 / 1.2.3 / 1.2.3 - 2.0.0；对齐 npm 语义） */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version)
  if (!v) return false
  const r = range.trim()
  const rangeM = r.match(/^(\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+)$/)
  if (rangeM) {
    const lo = parseSemver(rangeM[1])!
    const hi = parseSemver(rangeM[2])!
    const cmp = (a: { major: number; minor: number; patch: number }, b: { major: number; minor: number; patch: number }): number =>
      a.major !== b.major ? a.major - b.major : a.minor !== b.minor ? a.minor - b.minor : a.patch - b.patch
    return cmp(v, lo) >= 0 && cmp(v, hi) <= 0
  }
  const m = r.match(/^([\^~]?)(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const pre = m[1]
  const ma = Number(m[2])
  const mi = Number(m[3])
  const pa = Number(m[4])
  const minorPatchAtLeast = (minor: number, patch: number): boolean => v.minor > minor || (v.minor === minor && v.patch >= patch)
  if (pre === '^') {
    if (ma > 0) return v.major === ma && minorPatchAtLeast(mi, pa)
    if (mi > 0) return v.major === 0 && v.minor === mi && v.patch >= pa
    return v.major === 0 && v.minor === 0 && v.patch === pa
  }
  if (pre === '~') return v.major === ma && v.minor === mi && v.patch >= pa
  return v.major === ma && v.minor === mi && v.patch === pa
}

/** 运行时模块编排器（register → resolve → init → ready → active/inactive → destroy） */
export function createModuleSystem(options: { modules: ModuleDefinition[] }): ModuleSystem {
  const defs = new Map<string, ModuleDefinition>()
  for (const def of options.modules) {
    if (defs.has(def.name)) throw new Error(`[proteus-module] 重复注册模块 "${def.name}"（模块标识全局唯一）`)
    defs.set(def.name, def)
  }
  // ★resolve（先于拓扑）：依赖完整性 + 版本协商——未注册依赖 / 版本不匹配当场报错（含冲突链）
  for (const def of defs.values()) {
    for (const [dep, range] of Object.entries(def.dependencies ?? {})) {
      const depDef = defs.get(dep)
      if (!depDef) throw new Error(`[proteus-module] 模块 "${def.name}" 依赖 "${dep}" 未注册（dependencies 声明与 modules 列表不一致）`)
      if (!satisfies(depDef.version, range)) throw new VersionMismatchError(def.name, dep, range, depDef.version)
    }
  }
  // ★B3：依赖图 + 拓扑序（环 → CycleError）
  const graph = DependencyGraph.fromConfigs(options.modules)
  const initOrder = graph.topologicalSort()
  const reverseOrder = [...initOrder].reverse()

  const instances = new Map<string, ModuleInstance>()
  for (const name of initOrder) {
    const def = defs.get(name)!
    const events = createModuleEventBus()
    let services: Record<string, unknown> = {}
    const inst: ModuleInstance = {
      name,
      version: def.version,
      state: 'registered',
      services,
      events,
      async init() {
        inst.state = 'init'
        await def.lifecycle?.onInit?.()
        services = typeof def.services === 'function' ? def.services() : (def.services ?? {})
        inst.services = services
        inst.state = 'ready'
        await def.lifecycle?.onReady?.()
      },
      async destroy() {
        await def.lifecycle?.onDestroy?.()
        inst.state = 'destroyed'
      },
      async activate() {
        inst.state = 'active'
        await def.lifecycle?.onActive?.()
      },
      async deactivate() {
        inst.state = 'inactive'
        await def.lifecycle?.onInactive?.()
      },
    }
    instances.set(name, inst)
  }

  return {
    async init() {
      for (const name of initOrder) await instances.get(name)!.init()
    },
    getModule(name) {
      const inst = instances.get(name)
      if (!inst) throw new Error(`[proteus-module] 模块 "${name}" 未注册（已注册：${[...instances.keys()].join(', ') || '—'}）`)
      return inst
    },
    getState(name) {
      return instances.get(name)?.state ?? 'destroyed'
    },
    async activate(name) {
      await instances.get(name)?.activate()
    },
    async deactivate(name) {
      await instances.get(name)?.deactivate()
    },
    async destroy() {
      for (const name of reverseOrder) await instances.get(name)!.destroy()
    },
    modules() {
      return [...initOrder]
    },
  }
}

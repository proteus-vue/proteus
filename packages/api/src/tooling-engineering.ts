// packages/api/src/tooling-engineering.ts
// ★G-32 B5 续三（proteus-semantic-primitives-plus-plan §8 ④）：E24-E28 工程化语义面——injectable 设计
//   E24 useDevTools（开发工具接入——dev 事件面）/ E25 useInspector（元素审查——组件树快照）
//   E26 usePerformance（性能埋点——wx.reportPerformance 语义）/ E27 defineComponent（类型化组件定义含 C-IR 元信息）
//   E28 defineCapability（能力降级声明——G-30 降级链解析）
//   注入式：reactivity（vue 或 mock）+ 各句柄可注入时间源/上报器/探测函数——同 createEngineering 族零运行时依赖 vue
//   MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构
import type { Reactivity } from './engineering'

// ---------- E24 useDevTools：开发工具接入（dev 事件面） ----------

/** dev 事件（devtools 面板消费；enabled 关闭时不发射） */
export interface DevToolsEvent {
  /** 事件类型（自定义命名空间：'render' / 'api' / 'state' 等） */
  type: string
  /** 事件载荷 */
  detail: unknown
  /** 发生时间（注入 now；缺省 Date.now） */
  time: number
}

/** E24 useDevTools 句柄 */
export interface DevToolsHandle {
  /** 是否启用（外部开关注入；false → log 不发射且不记录） */
  enabled: boolean
  /** 发射 dev 事件（记入响应式队列 + 转发注入 sink） */
  log(type: string, detail?: unknown): void
  /** 事件队列（响应式——devtools 面板可订阅渲染） */
  events: { value: DevToolsEvent[] }
  /** 清空事件队列 */
  clear(): void
}

export interface UseDevToolsOptions {
  /** 启用开关（缺省 true；生产可注入 false 关停） */
  enabled?: boolean
  /** 外部消费 sink（devtools 面板/埋点接收器）——缺省 undefined */
  sink?: (event: DevToolsEvent) => void
  /** 时间源（缺省 Date.now） */
  now?: () => number
}

// ---------- E25 useInspector：元素审查（组件树快照） ----------

/** 组件审查节点（snapshot 产物） */
export interface InspectorNode {
  id: string
  name: string
  /** C-IR 语义（可空——Layer 1 兼容层组件无 semantic） */
  semantic?: string
  props: Record<string, unknown>
  children: InspectorNode[]
}

/** E25 useInspector 句柄 */
export interface InspectorHandle {
  /** 登记一个组件实例（parentId 缺省 → 根；重复 id 覆盖） */
  register(info: { id: string; name: string; semantic?: string; props?: Record<string, unknown>; parentId?: string }): void
  /** 注销组件实例（子树一并移除） */
  unregister(id: string): void
  /** 当前组件树快照（根节点数组） */
  snapshot(): InspectorNode[]
}

// ---------- E26 usePerformance：性能埋点（wx.reportPerformance 语义） ----------

/** 上报的指标记录（响应式队列——埋点面板消费） */
export interface PerformanceMetricRecord {
  name: string
  value: number
}

/** E26 usePerformance 句柄 */
export interface PerformanceHandle {
  /** 打点（mark 语义：记录时刻到时间映射） */
  mark(name: string): void
  /** 测距（measure 语义：startMark（缺省上一个 mark）→ 现在；返回时长 ms） */
  measure(name: string, startMark?: string): number | undefined
  /** 上报指标（委托注入 reporter——wx.reportPerformance 桥/web 埋点；同步记录响应式 metrics） */
  report(name: string, value: number): void
  /** 已上报记录（响应式） */
  metrics: { value: PerformanceMetricRecord[] }
  /** 清空已上报记录 */
  reset(): void
}

export interface UsePerformanceOptions {
  /** 时间源（缺省 Date.now；Web 可注入 performance.now） */
  now?: () => number
  /** 上报器（缺省 undefined——report 仅记录队列安全 no-op） */
  reporter?: (name: string, value: number) => void
}

// ---------- E27 defineComponent：类型化组件定义（含 C-IR 元信息） ----------

/** 组件 prop 描述（类型化声明——编译器静态提取 + MP properties 对齐） */
export interface ComponentPropDef {
  /** 运行时类型（Vue/MP properties 类型面） */
  type?: 'String' | 'Number' | 'Boolean' | 'Array' | 'Object' | 'Function' | 'Any'
  required?: boolean
  default?: unknown
}

/** 组件定义（C-IR 元信息：semantic 供 toComponentIR/渲染后端消费） */
export interface ComponentMeta {
  /** 组件名（p-* 惯例） */
  name: string
  /** C-IR 语义（G-32 语义面——消费方写入有效 semantic；api 包零依赖不校验 enum） */
  semantic: string
  /** prop 描述表 */
  props?: Record<string, ComponentPropDef>
  /** emit 事件名 */
  emits?: string[]
  /** 插槽名 */
  slots?: string[]
}

const COMPONENT_PROP_TYPES = ['String', 'Number', 'Boolean', 'Array', 'Object', 'Function', 'Any']

/** 纯函数：校验组件定义（返回错误列表；空 = 合法）——E27 声明期验证，编译器/开发期消费 */
export function validateComponentMeta(meta: ComponentMeta): string[] {
  const errors: string[] = []
  if (!meta.name || meta.name.trim() === '') errors.push('name 必填（组件名）')
  if (!meta.semantic || meta.semantic.trim() === '') errors.push('semantic 必填（C-IR 语义）')
  if (meta.props) {
    for (const key of Object.keys(meta.props)) {
      const type = meta.props[key].type
      if (type !== undefined && COMPONENT_PROP_TYPES.indexOf(type) < 0) {
        errors.push(`prop ${key} 的 type 非法：${type}（期望 ${COMPONENT_PROP_TYPES.join('/')}）`)
      }
    }
  }
  if (meta.emits) {
    for (const e of meta.emits) {
      if (typeof e !== 'string' || e === '') errors.push('emits 项必须是非空字符串')
    }
  }
  if (meta.slots) {
    for (const s of meta.slots) {
      if (typeof s !== 'string' || s === '') errors.push('slots 项必须是非空字符串')
    }
  }
  return errors
}

/**
 * ★E27 defineComponent：类型化组件定义（含 C-IR 元信息）
 * 用法：const def = defineComponent({ name: 'p-my', semantic: 'layout.box', props: { label: { type: 'String' } } })
 * 设计：类型化透传（TS 泛型保住字面量类型）——定义本身是声明，零拷贝；
 *       声明前用 validateComponentMeta 校验（E27 声明期验证，开发/编译期消费）
 */
export function defineComponent<T extends ComponentMeta>(meta: T): T {
  return meta
}

// ---------- E28 defineCapability：能力降级声明（G-30 降级链） ----------

/** 能力合同（G-30 降级链声明） */
export interface CapabilityContract {
  /** 能力实现名（自身） */
  name: string
  /** 降级链（自身不可用 → 依序尝试；G-30「降级链」语义） */
  fallback: string[]
  /** 是否必需（链全不可用且 required → 语义为 error；非必需 → 接受缺失） */
  required?: boolean
}

/** 实现可用性表（resolveCapabilityChain 入参） */
export interface CapabilityAvailability {
  name: string
  available: boolean
}

/** E28 defineCapability 句柄 */
export interface CapabilityDefinition {
  contract: CapabilityContract
  /** 探测自身可用性（probe 注入；缺省恒 true——声明面信任宿主） */
  check(): Promise<boolean>
  /** 解析当前应使用的实现（resolveCapabilityChain 纯逻辑；不注入 availability → 仅自身） */
  resolve(availability?: CapabilityAvailability[]): string | undefined
  /** 是否降级（chosen ≠ name） */
  isDegraded(chosen: string | undefined): boolean
}

/** 纯函数：校验能力合同（返回错误列表；空 = 合法） */
export function validateCapabilityContract(contract: CapabilityContract): string[] {
  const errors: string[] = []
  if (!contract.name || contract.name.trim() === '') errors.push('name 必填（能力实现名）')
  if (!contract.fallback || contract.fallback.length === 0) errors.push('fallback 降级链必填（可为空数组表示无降级）')
  const seen: string[] = []
  for (const f of contract.fallback) {
    if (seen.indexOf(f) >= 0) errors.push(`fallback 重复：${f}`)
    if (!f || f === contract.name) errors.push(`fallback 非法：${f}（不得为空或等于自身）`)
    seen.push(f)
  }
  return errors
}

/**
 * 纯函数：降级链解析（G-30）——自身可用 → 自身；否则依序返回链上第一个可用；全不可用 → undefined
 * 用法：resolveCapabilityChain(contract.name, contract.fallback, (impl) => hardware[impl])
 */
export function resolveCapabilityChain(name: string, fallback: string[], available: (impl: string) => boolean): string | undefined {
  if (available(name)) return name
  for (const impl of fallback) {
    if (available(impl)) return impl
  }
  return undefined
}

export interface DefineCapabilityOptions {
  /** 自身可用性探测（缺省恒 true——声明面信任宿主；注入可测） */
  probe?: () => boolean | Promise<boolean>
}

/**
 * ★E28 defineCapability：能力降级声明（G-30）
 * 用法：const cap = defineCapability({ name: 'scan-qr', fallback: ['scan-qr-input', 'manual'], required: false })
 * 设计：声明合同 + 探测注入 → check/resolve；resolve 用纯函数 resolveCapabilityChain（可离线断言）
 */
export function defineCapability(contract: CapabilityContract, options: DefineCapabilityOptions = {}): CapabilityDefinition {
  const probe = options.probe !== undefined ? options.probe : () => true
  return {
    contract,
    check: async () => probe(),
    resolve: (availability) => {
      if (!availability) return contract.name
      return resolveCapabilityChain(contract.name, contract.fallback, (impl) => {
        for (const item of availability) {
          if (item.name === impl) return item.available
        }
        return false
      })
    },
    isDegraded: (chosen) => chosen !== undefined && chosen !== contract.name,
  }
}

// ---------- createToolingEngineering 工厂 ----------

/** createToolingEngineering 注入项 */
export interface ToolingEngineeringOptions {
  /** reactivity（注入——与 createEngineering 同族） */
  reactivity: Reactivity
}

/** G-32 §8 ④ 工程化语义（E24-E28） */
export interface ToolingEngineering {
  /** E24 useDevTools：开发工具接入（dev 事件面） */
  useDevTools(options?: UseDevToolsOptions): DevToolsHandle
  /** E25 useInspector：元素审查（组件树快照） */
  useInspector(): InspectorHandle
  /** E26 usePerformance：性能埋点（wx.reportPerformance 语义） */
  usePerformance(options?: UsePerformanceOptions): PerformanceHandle
  /** E27 defineComponent：类型化组件定义（纯函数，含 C-IR 元信息） */
  defineComponent<T extends ComponentMeta>(meta: T): T
  /** E28 defineCapability：能力降级声明（G-30） */
  defineCapability(contract: CapabilityContract, options?: DefineCapabilityOptions): CapabilityDefinition
}

/**
 * ★createToolingEngineering：工程化语义实例（注入式——reactivity + 各句柄可注入源）
 * 用法：const tool = createToolingEngineering({ reactivity: { ref, computed, watch } })
 * 设计：E24-E26 为注入式 Hook（dev/inspector/perf 面，MP/web 共用语义）；
 *      E27/E28 为纯声明工具（define 语义 + 校验纯函数，开发期/编译期消费）
 */
export function createToolingEngineering(options: ToolingEngineeringOptions): ToolingEngineering {
  const { reactivity } = options

  return {
    useDevTools(opts = {}) {
      const enabled = opts.enabled !== undefined ? opts.enabled : true
      const now = opts.now !== undefined ? opts.now : () => Date.now()
      const events = reactivity.ref<DevToolsEvent[]>([])
      return {
        enabled,
        log(type, detail) {
          if (!enabled) return
          const event: DevToolsEvent = { type, detail, time: now() }
          events.value = events.value.concat(event)
          if (opts.sink) opts.sink(event)
        },
        events,
        clear() {
          events.value = []
        },
      }
    },
    useInspector() {
      const nodes: Array<InspectorNode & { parentId?: string }> = []
      return {
        register(info) {
          const existing = nodes.find((n) => n.id === info.id)
          if (existing) {
            existing.name = info.name
            if (info.semantic !== undefined) existing.semantic = info.semantic
            existing.props = info.props !== undefined ? { ...info.props } : {}
            existing.parentId = info.parentId
            return
          }
          nodes.push({
            id: info.id,
            name: info.name,
            semantic: info.semantic,
            props: info.props !== undefined ? { ...info.props } : {},
            parentId: info.parentId,
            children: [],
          })
        },
        unregister(id) {
          const removed = nodes.filter((n) => n.id === id || n.parentId === id)
          for (const r of removed) {
            const idx = nodes.indexOf(r)
            if (idx >= 0) nodes.splice(idx, 1)
          }
        },
        snapshot() {
          const byParent: Record<string, InspectorNode[]> = {}
          for (const n of nodes) {
            const key = n.parentId || ''
            const list = byParent[key]
            if (list) list.push(toSnapshotNode(n))
            else byParent[key] = [toSnapshotNode(n)]
          }
          const roots: InspectorNode[] = []
          for (const key of Object.keys(byParent)) {
            if (key === '') roots.push(...byParent[key])
          }
          const attach = (parentId: string, parent: InspectorNode) => {
            for (const child of byParent[parentId] || []) {
              parent.children.push(child)
              attach(child.id, child)
            }
          }
          for (const root of roots) attach(root.id, root)
          return roots
        },
      }
      function toSnapshotNode(n: InspectorNode & { parentId?: string }): InspectorNode {
        return { id: n.id, name: n.name, semantic: n.semantic, props: { ...n.props }, children: [] }
      }
    },
    usePerformance(opts = {}) {
      const now = opts.now !== undefined ? opts.now : () => Date.now()
      const marks: Record<string, number> = {}
      let lastMark: string | undefined
      const metrics = reactivity.ref<PerformanceMetricRecord[]>([])
      // 共享上报逻辑（measure 与 report 双入口——wx.reportPerformance 语义）
      const reportMetric = (name: string, value: number) => {
        metrics.value = metrics.value.concat({ name, value })
        if (opts.reporter) opts.reporter(name, value)
      }
      return {
        mark(name) {
          marks[name] = now()
          lastMark = name
        },
        measure(name, startMark) {
          const startName = startMark !== undefined ? startMark : lastMark
          const start = startName !== undefined ? marks[startName] : undefined
          if (start === undefined) return undefined
          const value = now() - start
          reportMetric(name, value)
          return value
        },
        report(name, value) {
          reportMetric(name, value)
        },
        metrics,
        reset() {
          metrics.value = []
        },
      }
    },
    defineComponent: (meta) => defineComponent(meta),
    defineCapability: (contract, contractOpts) => defineCapability(contract, contractOpts),
  }
}
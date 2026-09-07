// packages/devtools/src/plugins.ts
// devtools-plan M9：插件扩展机制（B9）——第三方插件注册自定义视图/订阅事件/注册命令，不改核心
//   · PluginRegistry：register/unregister/activate/list + peerDependencies 拓扑排序激活 + 循环依赖检测报错
//   · 崩溃隔离：setup 或事件回调抛错 → 插件标记 crashed + 卸载订阅，核心与其他插件不受影响
//   · 纯逻辑（KVStorage/CommandRegistry 独立可测）；面板接线见 panel.ts
import type { TraceEvent } from '@proteus-vue/devtools-runtime'

export interface DevToolsPlugin {
  name: string
  version: string
  /** 依赖插件（激活拓扑排序；循环依赖 → activate 报错并给出环路径） */
  peerDependencies?: string[]
  setup(ctx: PluginContext): void | Promise<void>
}

export interface PluginBus {
  /** 订阅事件流；回调抛错 → 自动卸载 + 插件标记 crashed（核心不崩） */
  on(cb: (e: TraceEvent) => void): () => void
}

export interface PanelAPI {
  /** 注册自定义视图（侧栏导航项 + 内容容器）；render 由面板 16ms 节流 rerender 调用 */
  addView(id: string, opts: { label: string; icon?: string; render: (container: HTMLElement) => void }): void
}

export interface CommandRegistry {
  register(id: string, run: () => void): void
  run(id: string): void
  /** 已注册命令 id 列表（命令面板展示用） */
  list(): string[]
}

export interface KVStorage {
  get(key: string): unknown | undefined
  set(key: string, value: unknown): void
}

export interface PluginContext {
  name: string
  bus: PluginBus
  panel: PanelAPI
  commands: CommandRegistry
  storage: KVStorage
}

export type PluginStatus = 'registered' | 'active' | 'crashed'

export interface PluginEntry {
  name: string
  version: string
  status: PluginStatus
  error?: string
}

/** 内存 KV（缺省存储；业务可注入 localStorage/IndexedDB 持久化） */
export function createMemoryStorage(): KVStorage {
  const map = new Map<string, unknown>()
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value)
    },
  }
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, () => void>()
  return {
    register(id, run) {
      commands.set(id, run)
    },
    run(id) {
      commands.get(id)?.()
    },
    list() {
      return Array.from(commands.keys())
    },
  }
}

/**
 * 拓扑排序（Kahn）+ 循环依赖检测：按 peerDependencies 求激活顺序。
 * 存在环 → 返回剩余节点的依赖环路径（用于报错提示）；无环 → cycle = null。
 */
export function resolveActivationOrder(plugins: DevToolsPlugin[]): { order: string[]; cycle: string[] | null } {
  const byName = new Map(plugins.map((p) => [p.name, p]))
  const deps = new Map<string, string[]>()
  for (const p of plugins) deps.set(p.name, (p.peerDependencies ?? []).filter((d) => byName.has(d)))
  const indegree = new Map<string, number>()
  for (const [name, ds] of deps) indegree.set(name, ds.length)
  const queue: string[] = []
  for (const [name, d] of indegree) if (d === 0) queue.push(name)
  const order: string[] = []
  while (queue.length) {
    const name = queue.shift() as string
    order.push(name)
    for (const other of deps.keys()) {
      const list = deps.get(other) as string[]
      if (list.includes(name)) {
        const nd = (indegree.get(other) as number) - 1
        indegree.set(other, nd)
        if (nd === 0) queue.push(other)
      }
    }
  }
  const remaining = plugins.map((p) => p.name).filter((n) => !order.includes(n))
  if (remaining.length) {
    // 从任一剩余节点沿依赖链提取环路径
    const start = remaining[0]
    const cyclePath: string[] = []
    const seen = new Set<string>()
    let cur: string | null = start
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      cyclePath.push(cur)
      cur = ((deps.get(cur) as string[]) ?? []).find((d) => remaining.includes(d)) ?? null
    }
    if (cur) cyclePath.push(cur)
    return { order, cycle: cyclePath }
  }
  return { order, cycle: null }
}

export interface PluginRegistry {
  register(plugin: DevToolsPlugin): void
  unregister(name: string): void
  /** 拓扑序激活全部已注册插件（含依赖先激活）；插件崩溃不影响其余 */
  activateAll(ctx: (plugin: DevToolsPlugin) => PluginContext): Promise<PluginEntry[]>
  list(): PluginEntry[]
  get(name: string): DevToolsPlugin | undefined
}

export function createPluginRegistry(initial: DevToolsPlugin[] = []): PluginRegistry {
  const plugins = new Map<string, DevToolsPlugin>()
  const statuses = new Map<string, PluginStatus>()
  const errors = new Map<string, string>()
  for (const p of initial) {
    plugins.set(p.name, p)
    statuses.set(p.name, 'registered')
  }

  return {
    register(plugin) {
      plugins.set(plugin.name, plugin)
      statuses.set(plugin.name, 'registered')
    },
    unregister(name) {
      plugins.delete(name)
      statuses.delete(name)
      errors.delete(name)
    },
    async activateAll(ctx) {
      const all = Array.from(plugins.values())
      const { order, cycle } = resolveActivationOrder(all)
      if (cycle) throw new Error('插件循环依赖：' + cycle.join(' → ') + '（请解除依赖后再激活）')
      for (const name of order) {
        const plugin = plugins.get(name) as DevToolsPlugin
        try {
          await plugin.setup(ctx(plugin))
          statuses.set(name, 'active')
          errors.delete(name)
        } catch (err) {
          statuses.set(name, 'crashed')
          errors.set(name, err instanceof Error ? err.message : String(err))
        }
      }
      return Array.from(plugins.keys()).map((name) => ({
        name,
        version: (plugins.get(name) as DevToolsPlugin).version,
        status: (statuses.get(name) as PluginStatus) ?? 'registered',
        error: errors.get(name),
      }))
    },
    list() {
      return Array.from(plugins.keys()).map((name) => ({
        name,
        version: (plugins.get(name) as DevToolsPlugin).version,
        status: (statuses.get(name) as PluginStatus) ?? 'registered',
        error: errors.get(name),
      }))
    },
    get: (name) => plugins.get(name),
  }
}

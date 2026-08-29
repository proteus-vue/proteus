// packages/module/src/graph.ts
// ★module-plan B3（M3 DependencyGraph）：模块依赖图——循环检测（DFS 三色）+ 拓扑排序（Kahn）+ chunk 分组
// 消费方：Router M7.1（chunk → subPackages）、Skyline 打包器（M5）、preloadRule 生成器（initOrder）
// 错误信息含环路径 + 建议（AI 可读，透明化铁律）
import type { ModuleConfig } from './contract'

/** 图节点 */
export interface ModuleNode {
  name: string
  version: string
  chunk?: string
}

export type Cycle = string[]

/** 循环依赖错误：含完整环路径（A → B → A）与修复建议 */
export class CycleError extends Error {
  constructor(public readonly cycles: Cycle[], public readonly nodeNames: string[]) {
    super(
      `[proteus-module] ★循环依赖检测到：\n${cycles
        .map((c) => `  ${c.join(' → ')} → ${c[0]}`)
        .join('\n')}\n\nSuggestion: extract shared logic into a common module, or use event-based communication.`,
    )
    this.name = 'CycleError'
  }
}

/** 版本冲突：同一模块被多个依赖方以不同 range 声明 */
export interface VersionConflict {
  module: string
  ranges: Array<{ from: string; range: string }>
}

export class DependencyGraph {
  private nodes = new Map<string, ModuleNode>()
  private edges = new Map<string, Set<string>>()
  private edgeRanges = new Map<string, string>() // "from>to" → range

  /** 注册模块（重复注册：保留首个；版本不一致时覆盖并记录冲突由 caller 处理） */
  addModule(config: Pick<ModuleConfig, 'name' | 'version' | 'chunk'>): void {
    if (!this.nodes.has(config.name)) {
      this.nodes.set(config.name, { name: config.name, version: config.version, chunk: config.chunk })
    }
  }

  addDependency(from: string, to: string, versionRange: string): void {
    if (!this.edges.has(from)) this.edges.set(from, new Set())
    this.edges.get(from)!.add(to)
    this.edgeRanges.set(`${from}>${to}`, versionRange)
  }

  get size(): number {
    return this.nodes.size
  }

  nodeNames(): string[] {
    return [...this.nodes.keys()]
  }

  /** 模块所属 chunk（未声明归入自身名） */
  chunkOf(name: string): string {
    return this.nodes.get(name)?.chunk ?? name
  }

  /** 模块依赖列表（拓扑/分块用） */
  dependenciesOf(name: string): string[] {
    return [...(this.edges.get(name) ?? [])]
  }

  /** 从模块契约列表构建图（B1 scan 结果 / 测试直接传入） */
  static fromConfigs(configs: Array<Pick<ModuleConfig, 'name' | 'version' | 'chunk' | 'dependencies'>>): DependencyGraph {
    const g = new DependencyGraph()
    for (const c of configs) {
      g.addModule(c)
      for (const [dep, range] of Object.entries(c.dependencies ?? {})) {
        g.addDependency(c.name, dep, range)
      }
    }
    return g
  }

  /**
   * 循环检测（DFS 三色标记）：0 白（未访问）/ 1 灰（当前路径上）/ 2 黑（已完成）
   * 遇灰 → 环（从灰节点回溯到当前节点的路径）；返回全部环（去重后按长度排序）
   */
  detectCycles(): Cycle[] {
    const color = new Map<string, number>()
    const path: string[] = []
    const cycles: Cycle[] = []
    const seen = new Set<string>()

    const visit = (name: string): void => {
      color.set(name, 1)
      path.push(name)
      for (const next of this.edges.get(name) ?? []) {
        const c = color.get(next) ?? 0
        if (c === 1) {
          // 环：从 next 开始到当前路径末尾
          const start = path.indexOf(next)
          const cycle = path.slice(start)
          const key = [...cycle].sort().join(',')
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push(cycle)
          }
        } else if (c === 0) {
          visit(next)
        }
      }
      path.pop()
      color.set(name, 2)
    }

    for (const name of this.nodeNames()) {
      if ((color.get(name) ?? 0) === 0) visit(name)
    }
    return cycles.sort((a, b) => a.length - b.length)
  }

  /**
   * 拓扑排序（Kahn）：★被依赖者先 init（无依赖的模块先初始化）
   * 入度 = 依赖数（出边数）；出队后减少依赖它的模块的未满足依赖数；有环 → CycleError
   */
  topologicalSort(): string[] {
    const cycles = this.detectCycles()
    if (cycles.length) throw new CycleError(cycles, this.nodeNames())
    // 反向索引：to → [依赖它的模块]
    const dependents = new Map<string, string[]>()
    for (const from of this.nodeNames()) {
      for (const to of this.edges.get(from) ?? []) {
        if (!this.nodes.has(to)) continue
        const list = dependents.get(to) ?? []
        list.push(from)
        dependents.set(to, list)
      }
    }
    const pending = new Map<string, number>() // 未满足依赖数
    for (const n of this.nodeNames()) pending.set(n, this.edges.get(n)?.size ?? 0)
    const queue = this.nodeNames().filter((n) => (pending.get(n) ?? 0) === 0).sort()
    const result: string[] = []
    while (queue.length) {
      const node = queue.shift()!
      result.push(node)
      for (const from of dependents.get(node) ?? []) {
        const d = (pending.get(from) ?? 0) - 1
        pending.set(from, d)
        if (d === 0) {
          const idx = queue.findIndex((q) => q > from)
          queue.splice(idx === -1 ? queue.length : idx, 0, from)
        }
      }
    }
    if (result.length !== this.nodes.size) {
      const missing = this.nodeNames().filter((n) => !result.includes(n))
      throw new Error(`[proteus-module] 依赖图不完整（悬挂依赖无法拓扑）：${missing.join(', ')}——请检查模块依赖声明（proteus-module.config.ts）`)
    }
    return result
  }

  /** chunk 分组：chunk 名 → 模块名列表（无 chunk 声明的模块归入自身 chunk；供 Router M7.1 / Skyline 打包器消费） */
  chunkGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>()
    for (const n of this.nodeNames()) {
      const chunk = this.nodes.get(n)!.chunk ?? n
      const list = groups.get(chunk) ?? []
      list.push(n)
      groups.set(chunk, list)
    }
    return groups
  }

  /** ★版本冲突：同一模块被多个依赖方以不同 range 声明（精确交集为后续；MVP 检测声明不一致） */
  versionConflicts(): VersionConflict[] {
    const byTarget = new Map<string, Array<{ from: string; range: string }>>()
    for (const [key, range] of this.edgeRanges) {
      const [from, to] = key.split('>')
      const list = byTarget.get(to) ?? []
      list.push({ from, range })
      byTarget.set(to, list)
    }
    const out: VersionConflict[] = []
    for (const [module, ranges] of byTarget) {
      const distinct = new Set(ranges.map((r) => r.range))
      if (distinct.size > 1) out.push({ module, ranges })
    }
    return out
  }
}

/** 生成 module-graph manifest（module-graph.json）：modules + chunks + initOrder */
export function buildModuleGraphManifest(g: DependencyGraph): {
  modules: Array<{ name: string; chunk: string; dependencies: string[] }>
  chunks: Record<string, string[]>
  initOrder: string[]
} {
  const modules = g
    .nodeNames()
    .sort()
    .map((name) => ({
      name,
      chunk: g.chunkOf(name),
      dependencies: g.dependenciesOf(name).sort(),
    }))
  const chunks: Record<string, string[]> = {}
  for (const [chunk, names] of g.chunkGroups()) chunks[chunk] = [...names].sort()
  return { modules, chunks, initOrder: g.topologicalSort() }
}

/** Mermaid 依赖图（CLI audit module --graph / 可视化）；有环 → 说明文本（拓扑不可用） */
export function moduleGraphToMermaid(g: DependencyGraph): string {
  const lines = ['graph TD']
  let sorted: string[]
  try {
    sorted = g.topologicalSort()
  } catch {
    return 'graph TD\n  %% ★循环依赖：无法生成依赖图（请先修复环，见 proteus module:check）'
  }
  for (const name of sorted) {
    for (const dep of g.dependenciesOf(name).sort()) {
      lines.push(`  ${dep} --> ${name}`)
    }
  }
  return lines.join('\n')
}

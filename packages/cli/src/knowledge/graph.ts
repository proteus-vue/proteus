// packages/cli/src/knowledge/graph.ts
// ★★G-54 M0（决策 #1153）：**SPI 拓扑图（能力④ buildGraph）**
//
// 【纯/不纯分离（G-54 要求六方法是纯查询）】
//   · `buildGraph(manifests)` —— **纯函数**：输入已加载的清单，输出图（无 IO、无副作用）
//   · `loadManifests(dir)`     —— **唯一 IO 入口**：读 `packages/*/package.json`
//   ⇒ 内核可被 CLI / Studio / VSCode 适配器共用，IO 由宿主决定（降级档各自实现）。
//
// 【数据源是 package.json，不是文档】
//   00-architecture.md 的包注册表用的是旧包名（pinia / devtools-panel / vite-plugin / test-utils），
//   与磁盘真名不一致（#1139「过期索引比没有更糟」的实证）⇒ 以 `packages/*/package.json` 为准，
//   文档只作为**分层口径**的依据（见 layer-map.ts）。
//
// 【依赖口径】只把 dependencies + peerDependencies 建成边（**不含 devDependencies**）：
//   devDeps 是"测试/构建时临时用"，不代表架构依赖方向。
//   ★但 devDeps **不丢弃**——清单里保留 `devDeps` 字段，供 `diagnoseDevLayering()` 单独报告
//   （独立验证发现的口径盲区：devDeps 里的向上依赖既不入图也不进诊断 ⇒ 两套口径互相矛盾）。
//
// 【环检测为什么用 SCC 而不是裸 DFS（独立验证打回首版）】
//   首版三色 DFS 只在遇到 GRAY（回边）时记录，遇到 BLACK（交叉边）直接丢弃 ⇒ 只能回答
//   "有没有环"，**漏报具体环**（随机对拍 9.5% 少报；最小反例：a→e, b→c, c→b, c→e, e→b, e→c
//   真实环还有 c→e→c 未报）。而 #1146 的教训是"结论只在 commit message 里，无法复核"⇒
//   环路必须**可归因**。现改为 Tarjan SCC：环 = size>1 的强连通分量（数学上完备，不多不少），
//   每个分量再取一条**真实存在的**代表回路（调用方可用 `isValidCycle` 复核相邻边）。
//
// 【自环不被吞掉】`a → a` 单独进 `selfLoops`（首版把它当噪声 continue 掉 ⇒ 「依赖成环」判据
//   对自环免疫）。边表仍不含自环（避免方向诊断噪音），但环检测会把它报成 `[a, a]`。

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 单个包的清单（已归一化为**目录名**，与 layer-map 同 key） */
export interface PackageManifest {
  /** 目录名（packages/<dir>）——图节点 id */
  dir: string
  /** package.json 的 name（诊断输出用；可能与 dir 不同） */
  name: string
  /** 生产依赖（dependencies + peerDependencies，指向 dir） */
  deps: string[]
  /** 仅开发期依赖（devDependencies 里的内部包；**不入图**，仅供口径诊断） */
  devDeps: string[]
}

/** 图的一条边：from 依赖 to */
export interface SpiEdge {
  from: string
  to: string
}

export interface SpiGraph {
  /** 节点（目录名，升序） */
  nodes: string[]
  /** 边（按 from,to 升序，保证输出可复现；**不含自环**） */
  edges: SpiEdge[]
  /** 环（每个环 = 首尾相同的节点序列 + 相邻边真实存在；空数组 = 无环） */
  cycles: string[][]
  /** 强连通分量（size>1；**环的完备证据**——cycles 只是每个分量的一条代表回路） */
  sccs: string[][]
  /** 自环（`a` 依赖 `a`；单列，因为它在边表里被刻意排除） */
  selfLoops: string[]
  /** 反向依赖表：被依赖者 → 依赖它的包（增量影响面用） */
  reverseDeps: Record<string, string[]>
}

/**
 * 读 `packages/<dir>/package.json` 构造清单。
 * ★唯一 IO 入口（内核其余部分保持纯函数）。
 * @param packagesDir `packages/` 绝对路径
 */
export function loadManifests(packagesDir: string): PackageManifest[] {
  if (!existsSync(packagesDir)) {
    throw new Error(`loadManifests: 目录不存在（${packagesDir}）`)
  }
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  // 第一遍：目录名 ⇄ 包名
  const raw: Array<{ dir: string; name: string; spec: Record<string, string>; dev: Record<string, string> }> = []
  const byName = new Map<string, string>()
  for (const dir of dirs) {
    const pj = join(packagesDir, dir, 'package.json')
    if (!existsSync(pj)) continue // Rust crate（只有 Cargo.toml）——不是 npm 包，不入图
    const json = JSON.parse(readFileSync(pj, 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const name = json.name ?? dir
    raw.push({
      dir,
      name,
      spec: { ...(json.dependencies ?? {}), ...(json.peerDependencies ?? {}) },
      dev: { ...(json.devDependencies ?? {}) },
    })
    byName.set(name, dir)
  }

  // 第二遍：包名 → 目录名（只保留内部依赖）
  const toDirs = (spec: Record<string, string>): string[] =>
    [...new Set(Object.keys(spec).map((n) => byName.get(n)).filter((d): d is string => Boolean(d)))].sort()

  return raw
    .map(({ dir, name, spec, dev }) => ({ dir, name, deps: toDirs(spec), devDeps: toDirs(dev) }))
    .sort((a, b) => a.dir.localeCompare(b.dir))
}

/**
 * 构造 SPI 拓扑图（纯函数）。
 *
 * @param manifests `loadManifests` 的输出（或任意构造的清单——测试注入人造环用）
 */
export function buildGraph(manifests: readonly PackageManifest[]): SpiGraph {
  const nodes = manifests.map((m) => m.dir).sort()
  const known = new Set(nodes)

  const edges: SpiEdge[] = []
  const selfLoops: string[] = []
  const reverseDeps: Record<string, string[]> = {}
  for (const n of nodes) reverseDeps[n] = []

  for (const m of manifests) {
    if (!known.has(m.dir)) continue
    for (const dep of [...new Set(m.deps)].sort()) {
      if (!known.has(dep)) continue
      if (dep === m.dir) {
        // ★自环：不入边表（方向诊断无意义），但必须被报告——否则「成环」判据对自环免疫
        selfLoops.push(m.dir)
        continue
      }
      edges.push({ from: m.dir, to: dep })
      reverseDeps[dep].push(m.dir)
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  for (const k of Object.keys(reverseDeps)) reverseDeps[k].sort()

  const analysis = analyzeCycles(nodes, edges)
  return {
    nodes,
    edges,
    cycles: analysis.cycles,
    sccs: analysis.sccs,
    selfLoops: [...new Set(selfLoops)].sort(),
    reverseDeps,
  }
}

export interface CycleAnalysis {
  /** 强连通分量（size>1，升序）——**成环的完备证据**（SCC 定理：同一分量内任意两点互相可达） */
  sccs: string[][]
  /** 每个分量一条代表回路（首尾相同、相邻边真实存在）——用于人类可读归因 */
  cycles: string[][]
}

/**
 * 环分析（Tarjan SCC + 代表回路）。
 *
 * ★为什么"有没有环"看 `sccs` 而"长什么样"看 `cycles`：
 *   有向图里"覆盖分量全部节点的一条回路"不一定存在（且求解代价高），
 *   而**分量内部任意两点互相可达**是 SCC 的定义 ⇒ 完备性由 `sccs` 保证，
 *   `cycles` 只给一条可打印的代表路径（不保证覆盖分量内全部节点）。
 *
 * ★契约：`edges` 里出现但不在 `nodes` 里的端点**不会被丢弃**（邻接表按 nodes ∪ 端点构造）。
 */
export function analyzeCycles(nodes: readonly string[], edges: readonly SpiEdge[]): CycleAnalysis {
  const adj = adjacency(nodes, edges)
  const all = [...adj.keys()].sort()
  const selfLoops = [...new Set(edges.filter((e) => e.from === e.to).map((e) => e.from))].sort()

  const sccs = tarjanSccs(all, adj).filter((s) => s.length > 1)
  const cycles: string[][] = sccs.map((scc) => representativeCycle(scc, adj))
  for (const s of selfLoops) cycles.push([s, s])
  return { sccs, cycles }
}

/**
 * 环检测（便捷入口）。
 * @returns 每个强连通分量一条代表回路（首尾相同、相邻边真实存在，可用 `isValidCycle` 复核）；
 *          **完备的成环判定请用 `analyzeCycles().sccs`**
 */
export function findCycles(nodes: readonly string[], edges: readonly SpiEdge[]): string[][] {
  return analyzeCycles(nodes, edges).cycles
}

/** 强连通分量（Tarjan，迭代栈实现——避免深递归爆栈） */
export function tarjanSccs(nodes: readonly string[], adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []
  let counter = 0

  for (const start of nodes) {
    if (index.has(start)) continue
    // 显式 DFS 栈：帧 = [节点, 邻居下标]
    const frames: Array<[string, number]> = [[start, 0]]
    index.set(start, counter)
    low.set(start, counter)
    counter++
    stack.push(start)
    onStack.add(start)

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (!frame) break
      const [v, i] = frame
      const nbrs = adj.get(v) ?? []
      if (i < nbrs.length) {
        frame[1] = i + 1
        const w = nbrs[i]
        if (w === undefined) continue
        if (!index.has(w)) {
          index.set(w, counter)
          low.set(w, counter)
          counter++
          stack.push(w)
          onStack.add(w)
          frames.push([w, 0])
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0))
        }
        continue
      }
      // v 的邻居走完 ⇒ 回溯
      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent) {
        const p = parent[0]
        low.set(p, Math.min(low.get(p) ?? 0, low.get(v) ?? 0))
      }
      if (low.get(v) === index.get(v)) {
        const comp: string[] = []
        for (;;) {
          const w = stack.pop()
          if (w === undefined) break
          onStack.delete(w)
          comp.push(w)
          if (w === v) break
        }
        sccs.push(comp.sort())
      }
    }
  }
  return sccs
}

/** 在强连通分量内取一条真实回路（起点 = 分量首节点；SCC 保证必然存在） */
function representativeCycle(scc: readonly string[], adj: Map<string, string[]>): string[] {
  const members = new Set(scc)
  const start = scc[0]
  if (start === undefined) return []
  const path: string[] = []
  const visited = new Set<string>()

  const walk = (v: string): boolean => {
    path.push(v)
    visited.add(v)
    for (const w of adj.get(v) ?? []) {
      if (!members.has(w)) continue
      if (w === start) return true
      if (visited.has(w)) continue
      if (walk(w)) return true
    }
    path.pop()
    return false
  }

  return walk(start) ? [...path, start] : []
}

/**
 * 校验一条环路：首尾相同 + **每一对相邻节点之间确有边**。
 * ★这是环检测的独立 oracle（首版测试只验首尾与节点集合，错误实现 `[a,c,b,a]` 也能过）。
 */
export function isValidCycle(cycle: readonly string[], edges: readonly SpiEdge[]): boolean {
  if (cycle.length < 2) return false
  if (cycle[0] !== cycle[cycle.length - 1]) return false
  const set = new Set(edges.map((e) => `${e.from}>${e.to}`))
  for (let i = 0; i < cycle.length - 1; i++) {
    const a = cycle[i]
    const b = cycle[i + 1]
    if (a === undefined || b === undefined) return false
    if (!set.has(`${a}>${b}`)) return false
  }
  return true
}

/** 邻接表：节点集 = nodes ∪ edges 端点（**不丢边**，见 findCycles 契约） */
function adjacency(nodes: readonly string[], edges: readonly SpiEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  const ensure = (n: string): string[] => {
    const cur = adj.get(n)
    if (cur) return cur
    const created: string[] = []
    adj.set(n, created)
    return created
  }
  for (const n of nodes) ensure(n)
  for (const e of edges) {
    ensure(e.from)
    ensure(e.to)
    const list = ensure(e.from)
    if (!list.includes(e.to)) list.push(e.to)
  }
  for (const [, list] of adj) list.sort()
  return adj
}
